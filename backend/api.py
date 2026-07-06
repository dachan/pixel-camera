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

from flask import Blueprint, Response, jsonify, request, send_file

import thermal as thermal_config
from camera_service import (
    CAPTURES_DIR,
    camera,
    capture_events,
    do_capture,
    thermal,
    thumbnail_for,
)

api = Blueprint("api", __name__, url_prefix="/api")


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
    return jsonify(status="ok")


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


@api.route("/captures")
def list_captures():
    """List saved capture filenames, newest first."""
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

@api.route("/system/temperature")
def system_temperature():
    """Pi temperatures plus the app's thermal-throttle state."""
    return jsonify(
        temperatures=thermal_config.read_temperatures(),
        throttled=thermal.throttled,
        throttle_at=thermal_config.THROTTLE_C,
    )


@api.route("/system/exit-kiosk", methods=["POST"])
def exit_kiosk():
    """Close the kiosk browser and drop to the desktop.

    Stops the labwc respawner first (so Chromium isn't relaunched), then closes
    only the kiosk browser (matched by its ``--kiosk`` flag, so a normal dev
    browser is never touched). Same-user pkill, no sudo. No-op off the Pi.
    """
    subprocess.run(["pkill", "-f", "lwrespawn"], check=False)
    subprocess.run(["pkill", "-f", "--", "--kiosk"], check=False)
    return jsonify(status="exiting")
