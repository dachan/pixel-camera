"""Camera runtime: the singleton device, capture orchestration, and events.

Every way of taking a picture — the HTTP route, the physical GPIO shutter
button, anything added later — funnels through :func:`do_capture`, so captures
behave identically regardless of trigger, and every capture is announced on
:data:`capture_events` (which drives the kiosk's shutter-flash UI).
"""

from __future__ import annotations

import logging
import os
from datetime import datetime

from camera import get_camera
from events import SseBroadcaster
from thermal import ThermalMonitor, set_cpu_throttled

logger = logging.getLogger(__name__)

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
CAPTURES_DIR = os.path.join(BACKEND_DIR, "captures")
# Append-only audit log for destructive/irreversible actions (delete-all,
# reboot). Lives next to the backend like settings.json — excluded from
# deploys and git — so it survives redeploys and journal rotation, unlike
# the systemd journal (which is what left an earlier data-loss incident
# undiagnosable). Best-effort: logging must never take an action down.
AUDIT_LOG_PATH = os.path.join(BACKEND_DIR, "actions.log")


def audit_log(action: str, detail: str = "") -> None:
    """Record an irreversible action to the audit log and the journal."""
    line = f"{datetime.now().isoformat(timespec='seconds')}  {action}  {detail}".rstrip()
    logger.warning("AUDIT: %s %s", action, detail)
    try:
        with open(AUDIT_LOG_PATH, "a") as f:
            f.write(line + "\n")
    except OSError:
        pass
# Cached gallery thumbnails, generated on demand. Hidden (dot-dir) so the
# captures listing never picks it up.
THUMBS_DIR = os.path.join(CAPTURES_DIR, ".thumbs")
THUMB_MAX_DIM = 480

# Single camera instance for the process, chosen by the CAMERA env var.
camera = get_camera()

# "start"/"done" is published here around every capture, from any trigger.
capture_events = SseBroadcaster()

# App-level thermal protection: cap the CPU frequency AND the live-preview
# framerate when it runs hot, restore both when it cools (thresholds in
# thermal.py; preview fps caps are on the camera — see PREVIEW_FPS_* in
# camera.py). The user can turn it off in Settings; the choice persists with
# the camera settings (restored by get_camera() above, hence read after it).
# Establish a clean CPU baseline (uncapped) at startup in case a prior crash
# left it pinned low — the camera's own preview fps cap is applied when it
# opens, so no equivalent reset is needed here.


def _on_throttle():
    set_cpu_throttled(True)
    camera.set_preview_throttled(True)


def _on_resume():
    set_cpu_throttled(False)
    camera.set_preview_throttled(False)


set_cpu_throttled(False)
thermal = ThermalMonitor(
    on_throttle=_on_throttle,
    on_resume=_on_resume,
    enabled=camera.get_throttle_enabled(),
)


def thumbnail_for(filename: str) -> str:
    """Path to a cached thumbnail for a captured JPEG, generated on demand.

    Captures are full sensor resolution (10+ MB at quality 100) — far too
    heavy to use as gallery grid thumbnails. Thumbs are capped at
    THUMB_MAX_DIM on the long edge (~30-60 KB) and cached next to the
    captures; regenerated only if the source is newer. Raises OSError if
    the source can't be read.
    """
    src = os.path.join(CAPTURES_DIR, filename)
    dst = os.path.join(THUMBS_DIR, filename)
    if os.path.isfile(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
        return dst
    from PIL import Image

    os.makedirs(THUMBS_DIR, exist_ok=True)
    img = Image.open(src)
    img.thumbnail((THUMB_MAX_DIM, THUMB_MAX_DIM))
    # Write-then-rename so concurrent requests never see a half-written file.
    tmp = dst + ".tmp"
    img.convert("RGB").save(tmp, format="JPEG", quality=80)
    os.replace(tmp, dst)
    return dst


def delete_all_captures(source: str = "") -> int:
    """Delete every capture (JPEG + DNG) and its cached thumbnail.

    ``source`` (e.g. the requester's IP) is recorded in the audit log.
    Returns the number of capture files removed (thumbs not counted).
    """
    deleted = 0
    for directory, count_them in ((CAPTURES_DIR, True), (THUMBS_DIR, False)):
        if not os.path.isdir(directory):
            continue
        for name in os.listdir(directory):
            if not name.endswith((".jpg", ".dng")):
                continue
            path = os.path.join(directory, name)
            if not os.path.isfile(path):
                continue
            try:
                os.remove(path)
                if count_them:
                    deleted += 1
            except OSError:
                pass  # best-effort; report what actually went
    detail = f"removed {deleted} capture(s)"
    if source:
        detail += f", from {source}"
    audit_log("delete-all", detail)
    return deleted


def _new_capture_path() -> str:
    """Timestamped JPEG path that doesn't collide with an existing capture.

    Filenames have one-second resolution, so a second capture within the
    same second (e.g. HTTP + physical button) gets a -2/-3/... suffix
    instead of silently overwriting the first.
    """
    base = datetime.now().strftime("%Y-%m-%d-%H%M%S")
    path = os.path.join(CAPTURES_DIR, base + ".jpg")
    n = 2
    while os.path.exists(path) or os.path.exists(os.path.splitext(path)[0] + ".dng"):
        path = os.path.join(CAPTURES_DIR, f"{base}-{n}.jpg")
        n += 1
    return path


def do_capture() -> dict:
    """Capture a still into CAPTURES_DIR; returns camera.capture()'s result."""
    capture_events.publish("start")
    try:
        os.makedirs(CAPTURES_DIR, exist_ok=True)
        return camera.capture(_new_capture_path())
    finally:
        capture_events.publish("done")


if os.environ.get("CAMERA") == "real":
    from shutter_button import start_shutter_button

    # Held at module scope: lgpio does not keep the callback alive on its own,
    # and a locally-scoped one would be garbage-collected almost immediately.
    _shutter_button = start_shutter_button(do_capture)
