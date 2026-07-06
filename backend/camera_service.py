"""Camera runtime: the singleton device, capture orchestration, and events.

Every way of taking a picture — the HTTP route, the physical GPIO shutter
button, anything added later — funnels through :func:`do_capture`, so captures
behave identically regardless of trigger, and every capture is announced on
:data:`capture_events` (which drives the kiosk's shutter-flash UI).
"""

from __future__ import annotations

import os
from datetime import datetime

from camera import get_camera
from events import SseBroadcaster

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
CAPTURES_DIR = os.path.join(BACKEND_DIR, "captures")
# Cached gallery thumbnails, generated on demand. Hidden (dot-dir) so the
# captures listing never picks it up.
THUMBS_DIR = os.path.join(CAPTURES_DIR, ".thumbs")
THUMB_MAX_DIM = 480

# Single camera instance for the process, chosen by the CAMERA env var.
camera = get_camera()

# "start"/"done" is published here around every capture, from any trigger.
capture_events = SseBroadcaster()


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


def do_capture() -> dict:
    """Capture a still into CAPTURES_DIR; returns camera.capture()'s result."""
    capture_events.publish("start")
    try:
        os.makedirs(CAPTURES_DIR, exist_ok=True)
        base = datetime.now().strftime("capture-%Y%m%d-%H%M%S-%f")
        path = os.path.join(CAPTURES_DIR, base + ".jpg")
        return camera.capture(path)
    finally:
        capture_events.publish("done")


if os.environ.get("CAMERA") == "real":
    from shutter_button import start_shutter_button

    # Held at module scope: lgpio does not keep the callback alive on its own,
    # and a locally-scoped one would be garbage-collected almost immediately.
    _shutter_button = start_shutter_button(do_capture)
