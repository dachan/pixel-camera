"""The /api HTTP surface: JSON endpoints + the MJPEG preview + SSE events.

Thin by design — request parsing and response shaping only. Camera behavior
lives in camera.py; capture orchestration and the camera singleton live in
camera_service.py.

Error contract (via blueprint-scoped handlers, so no per-route try/except):
  * ValueError (bad input, e.g. rotation=45)  -> 400 {"error": ...}
  * any other exception (camera unavailable)  -> 503 {"error": ...}
"""

from __future__ import annotations

import os
import subprocess
import time

from flask import Blueprint, Response, jsonify, request, send_file

import thermal as thermal_config
from camera_service import (
    CAPTURES_DIR,
    audit_log,
    camera,
    capture_events,
    delete_all_captures,
    do_capture,
    thermal,
    thumbnail_for,
)

api = Blueprint("api", __name__, url_prefix="/api")

# Per-process start token. Every deploy restarts the service, so a changed
# value tells the (never-self-reloading) kiosk page a new build is live and
# it should reload — see use-reload-on-restart on the frontend.
_STARTED = time.time()


@api.errorhandler(ValueError)
def invalid_input(exc):
    return jsonify(error=str(exc)), 400


@api.errorhandler(Exception)
def camera_unavailable(exc):
    # Surface a clean JSON error instead of a 500 HTML stack trace.
    return jsonify(error=str(exc)), 503


@api.after_request
def no_cache(response):
    # Captured files are immutable (timestamped names), so let the browser
    # cache them; everything else on the API is live state.
    if not request.path.startswith("/api/captures/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@api.route("/health")
def health():
    return jsonify(status="ok", started=_STARTED)


# --- Live preview + capture -------------------------------------------------- #

@api.route("/preview")
def preview():
    boundary = "frame"

    def generate():
        for jpeg in camera.stream():
            yield (
                b"--" + boundary.encode() + b"\r\n"
                b"Content-Type: image/jpeg\r\n"
                b"Content-Length: " + str(len(jpeg)).encode() + b"\r\n\r\n"
                + jpeg + b"\r\n"
            )

    return Response(
        generate(),
        mimetype=f"multipart/x-mixed-replace; boundary={boundary}",
    )


@api.route("/stream")
def stream_page():
    """Full-bleed HTML page wrapping the MJPEG preview in an <img>.

    OBS's Browser Source (and any browser) loads a *page*, not a raw
    multipart/x-mixed-replace response, so pointing it straight at /api/preview
    renders nothing. This page is the copy-paste URL for OBS: black background,
    the stream scaled to fit, and an onerror reconnect so a Pi restart or the
    brief encoder detach during a capture doesn't leave a dead frame.
    """
    html = """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Pixel UI stream</title>
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  img { width: 100%; height: 100%; object-fit: contain; display: block; }
</style>
</head>
<body>
<img id="s" src="/api/preview" alt="">
<script>
  // MJPEG streams end (Pi restart, capture-time encoder detach, network
  // blip). Reconnect with a cache-busted URL so the browser reopens it.
  var img = document.getElementById("s");
  img.onerror = function () {
    setTimeout(function () {
      img.src = "/api/preview?t=" + Date.now();
    }, 1000);
  };
</script>
</body>
</html>
"""
    return Response(html, mimetype="text/html")


@api.route("/capture", methods=["POST"])
def capture():
    result = do_capture()
    files = result.get("files", [])
    # Prefer the previewable (JPEG) file; fall back to whatever was saved.
    filename = result.get("preview") or (files[0] if files else None)
    return jsonify(filename=filename, files=files)


@api.route("/capture/events")
def capture_event_stream():
    """SSE stream of "start"/"done" capture events, from any trigger source."""
    return Response(capture_events.stream(), mimetype="text/event-stream")


@api.route("/captures", methods=["GET", "DELETE"])
def list_captures():
    """GET the saved capture filenames (newest first); DELETE removes all."""
    if request.method == "DELETE":
        return jsonify(deleted=delete_all_captures(source=request.remote_addr))
    os.makedirs(CAPTURES_DIR, exist_ok=True)
    names = [
        f
        for f in os.listdir(CAPTURES_DIR)
        if f.endswith(".jpg") and os.path.isfile(os.path.join(CAPTURES_DIR, f))
    ]
    names.sort(reverse=True)
    return jsonify(captures=names)


@api.route("/captures/<path:filename>")
def get_capture(filename):
    """Serve a single captured JPEG (inline) or DNG raw (download).

    ``?thumb=1`` on a JPEG serves a small cached thumbnail instead — what
    the gallery grid uses, since full captures run 10+ MB each.
    """
    if os.path.basename(filename) != filename:
        return "Not found", 404
    is_jpeg = filename.endswith(".jpg")
    is_dng = filename.endswith(".dng")
    if not (is_jpeg or is_dng):
        return "Not found", 404
    path = os.path.join(CAPTURES_DIR, filename)
    if not os.path.isfile(path):
        return "Not found", 404
    year = 365 * 24 * 3600
    if is_dng:
        # DNG can't render in a browser; offer it as a download instead.
        return send_file(path, mimetype="image/x-adobe-dng",
                         as_attachment=True, download_name=filename,
                         max_age=year)
    if request.args.get("thumb"):
        try:
            return send_file(thumbnail_for(filename), mimetype="image/jpeg",
                             max_age=year)
        except Exception:
            pass  # fall back to the full image below
    return send_file(path, mimetype="image/jpeg", max_age=year)


# --- Camera info + settings --------------------------------------------------- #

@api.route("/camera/info")
def camera_info():
    """Static camera info: properties + adjustable controls (min/max/default)."""
    return jsonify(camera.info())


@api.route("/camera/metadata")
def camera_metadata():
    """Live per-frame metadata snapshot (exposure, gain, lux, temp, ...)."""
    return jsonify(camera.metadata())


@api.route("/camera/controls", methods=["GET", "POST"])
def camera_controls():
    """GET current exposure state; POST {auto_exposure, iso, shutter_us} to set.

    Aperture is not included: Pi cameras have no software-controllable aperture.
    """
    if request.method == "POST":
        return jsonify(camera.set_controls(request.get_json(silent=True) or {}))
    return jsonify(camera.controls_state())


@api.route("/camera/orientation", methods=["GET", "POST"])
def camera_orientation():
    """GET the capture orientation; POST {rotation} (degrees clockwise) to set."""
    if request.method == "POST":
        return jsonify(camera.set_orientation(request.get_json(silent=True) or {}))
    return jsonify(camera.get_orientation())


@api.route("/camera/quality", methods=["GET", "POST"])
def camera_quality():
    """GET the capture JPEG quality; POST {quality} (1..100) to set."""
    if request.method == "POST":
        return jsonify(camera.set_quality(request.get_json(silent=True) or {}))
    return jsonify(camera.get_quality())


@api.route("/camera/format", methods=["GET", "POST"])
def camera_format():
    """GET the capture format; POST {format} (jpeg|raw+jpeg|raw) to set."""
    if request.method == "POST":
        return jsonify(camera.set_format(request.get_json(silent=True) or {}))
    return jsonify(camera.get_format())


@api.route("/camera/focus", methods=["GET", "POST"])
def camera_focus():
    """GET focus state; POST {af_mode, lens_position} to set.

    ``af_mode`` is continuous|manual; ``lens_position`` is dioptres
    (0 = infinity, higher = closer). {"available": false} on cameras
    without a focus motor.
    """
    if request.method == "POST":
        return jsonify(camera.set_focus(request.get_json(silent=True) or {}))
    return jsonify(camera.get_focus())


@api.route("/camera/focus/point", methods=["POST"])
def camera_focus_point():
    """POST {x, y} — tap-to-focus on a normalized point of the displayed frame.

    Steers continuous AF to a window around the point (switching to
    continuous if the camera was in manual focus).
    """
    return jsonify(camera.set_focus_point(request.get_json(silent=True) or {}))


@api.route("/camera/wb", methods=["GET", "POST"])
def camera_white_balance():
    """GET white-balance state; POST {mode, red_gain, blue_gain} to set.

    ``mode`` is an AWB preset (auto/incandescent/tungsten/fluorescent/indoor/
    daylight/cloudy) or "manual", where the gains drive the sensor directly.
    """
    if request.method == "POST":
        return jsonify(camera.set_white_balance(request.get_json(silent=True) or {}))
    return jsonify(camera.get_white_balance())


@api.route("/camera/tuning", methods=["GET", "POST"])
def camera_tuning():
    """GET the colour tuning; POST {tuning} (default|standard) to set.

    "standard" runs a NoIR sensor with the filtered variant's tuning file,
    enabling colour-temperature AWB (WB presets). Switching rebuilds the
    camera pipeline, which takes a few seconds. ``available`` is false on
    cameras that have no alternative tuning (non-NoIR).
    """
    if request.method == "POST":
        return jsonify(camera.set_tuning(request.get_json(silent=True) or {}))
    return jsonify(camera.get_tuning())


# --- System ------------------------------------------------------------------- #

def _battery_extreme(volts, at):
    """{volts, percent, at} for a logged min/max, or None if not seen yet."""
    if volts is None:
        return None
    return {
        "volts": round(volts, 2),
        "percent": thermal_config.voltage_to_percent(volts),
        "at": at,
    }


@api.route("/system/temperature")
def system_temperature():
    """Pi temperatures plus the app's thermal-throttle state."""
    volts = thermal_config.read_battery_voltage()
    return jsonify(
        battery_level=thermal_config.read_battery_level(),
        battery_volts=round(volts, 2) if volts is not None else None,
        # Lowest/highest cell voltage ever observed (persisted across
        # restarts) — a single instantaneous reading can't show whether the
        # battery ever recovers to a healthy voltage or just sits low.
        battery_min=_battery_extreme(thermal.battery_min_v, thermal.battery_min_at),
        battery_max=_battery_extreme(thermal.battery_max_v, thermal.battery_max_at),
        charging=thermal.charging,
        temperatures=thermal_config.read_temperatures(),
        throttled=thermal.throttled,
        throttle_at=thermal_config.THROTTLE_C,
        throttle_enabled=thermal.enabled,
    )


@api.route("/system/throttle", methods=["GET", "POST"])
def system_throttle():
    """GET/POST {enabled} — whether thermal throttling may engage at all."""
    if request.method == "POST":
        enabled = bool((request.get_json(silent=True) or {}).get("enabled"))
        camera.set_throttle_enabled(enabled)  # persists the choice
        thermal.set_enabled(enabled)          # acts on it (lifts if active)
    return jsonify(enabled=thermal.enabled, throttled=thermal.throttled)


@api.route("/system/battery-log/reset", methods=["POST"])
def reset_battery_log():
    """Clear the persisted battery min/max (e.g. after swapping cells)."""
    thermal.reset_battery_log()
    return jsonify(status="reset")


@api.route("/system/exit-kiosk", methods=["POST"])
def exit_kiosk():
    """Reboot into the desktop once, then back to the kiosk.

    Writes a one-shot flag the kiosk launcher (kiosk.sh) honors on the next
    boot — staying on the plain desktop instead of launching Chromium — then
    reboots. The boot after that finds no flag and returns to kiosk mode.
    No-op off the Pi (guarded on CAMERA=real) so dev machines never reboot.
    """
    if os.environ.get("CAMERA") != "real":
        return jsonify(status="noop-off-pi")
    audit_log("reboot", f"exit-to-desktop, from {request.remote_addr}")
    flag = os.path.join(os.path.expanduser("~"), ".ircam-boot-to-desktop")
    try:
        open(flag, "w").close()
    except OSError:
        pass
    subprocess.run(["sudo", "reboot"], check=False)
    return jsonify(status="rebooting")
