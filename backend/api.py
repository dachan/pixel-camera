"""The /api HTTP surface: JSON endpoints + the MJPEG preview + SSE events.

Thin by design — request parsing and response shaping only. Camera behavior
lives in camera.py; capture orchestration and the camera singleton live in
camera_service.py.

Error contract (via blueprint-scoped handlers, so no per-route try/except):
  * ValueError (bad input, e.g. rotation=45)  -> 400 {"error": ...}
  * any other exception (camera unavailable)  -> 503 {"error": ...}
"""

from __future__ import annotations

import glob
import math
import os
import subprocess
import time

from flask import Blueprint, Response, jsonify, request, send_file

from camera_service import CAPTURES_DIR, camera, capture_events, do_capture

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
    """Serve a single captured JPEG (inline) or DNG raw (download)."""
    if os.path.basename(filename) != filename:
        return "Not found", 404
    is_jpeg = filename.endswith(".jpg")
    is_dng = filename.endswith(".dng")
    if not (is_jpeg or is_dng):
        return "Not found", 404
    path = os.path.join(CAPTURES_DIR, filename)
    if not os.path.isfile(path):
        return "Not found", 404
    if is_dng:
        # DNG can't render in a browser; offer it as a download instead.
        return send_file(path, mimetype="image/x-adobe-dng",
                         as_attachment=True, download_name=filename)
    return send_file(path, mimetype="image/jpeg")


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


# --- System ------------------------------------------------------------------- #

def _read_pi_temperatures():
    """Read Pi thermal-zone temperatures as ``{label: celsius}``.

    Reads every ``/sys/class/thermal/thermal_zone*`` (CPU, and any internal/SoC
    sensors). Identical readings are de-duplicated so a separate "internal" temp
    only appears when it actually differs from the CPU. Returns ``{}`` off-Pi
    (e.g. Mac dev) where ``/sys/class/thermal`` is absent.
    """
    temps: dict[str, float] = {}
    seen: set[float] = set()
    for zone in sorted(glob.glob("/sys/class/thermal/thermal_zone*")):
        try:
            with open(os.path.join(zone, "temp")) as f:
                celsius = round(int(f.read().strip()) / 1000.0, 1)
        except (OSError, ValueError):
            continue
        if celsius in seen:
            continue  # same as a zone already shown — only surface distinct temps
        try:
            with open(os.path.join(zone, "type")) as f:
                label = f.read().strip()
        except OSError:
            label = os.path.basename(zone)
        temps[label] = celsius
        seen.add(celsius)

    if not temps and os.environ.get("CAMERA") != "real":
        # Mock dev (no /sys/class/thermal, e.g. macOS): synthesize a plausible,
        # slowly wobbling CPU temperature so the panel is visible and testable
        # off-Pi, mirroring MockCamera's synthesized metadata.
        wobble = math.sin(time.time() * 0.3) * 0.5 + 0.5  # 0..1
        temps["cpu-thermal"] = round(45.0 + wobble * 10.0, 1)

    return temps


@api.route("/system/temperature")
def system_temperature():
    """Pi temperatures (CPU and internal sensors) as ``{label: celsius}``."""
    return jsonify(temperatures=_read_pi_temperatures())


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
