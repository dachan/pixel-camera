"""Flask backend for the Pi camera app.

Serves:
  * a JSON/streaming API under the ``/api`` prefix, and
  * the static Next.js export from ``../frontend/out`` via a catch-all, so in
    production the kiosk is single-origin.

In dev the frontend runs separately on :3000 and talks here cross-origin
(flask-cors handles it); in prod it is same-origin and CORS is a no-op.
"""

from __future__ import annotations

import argparse
import os
import queue
import subprocess
import threading
from datetime import datetime

from flask import Flask, Response, jsonify, request, send_file
from flask_cors import CORS

from camera import get_camera

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))


def _find_frontend_out():
    """Locate frontend/out across both layouts.

    Mac dev: app.py is in pi-xel/backend/, frontend is a sibling
        -> ../frontend/out
    Pi deploy: backend/* is flattened into ~/ir-cam/, frontend/out is a child
        -> ./frontend/out
    An explicit FRONTEND_OUT env var overrides both.
    """
    override = os.environ.get("FRONTEND_OUT")
    if override:
        return os.path.normpath(override)
    candidates = (
        os.path.join(BACKEND_DIR, "frontend", "out"),                       # Pi
        os.path.normpath(os.path.join(BACKEND_DIR, "..", "frontend", "out")),  # Mac dev
    )
    for candidate in candidates:
        if os.path.isdir(candidate):
            return candidate
    return candidates[0]


FRONTEND_OUT = _find_frontend_out()
CAPTURES_DIR = os.path.join(BACKEND_DIR, "captures")

app = Flask(__name__, static_folder=None)
CORS(app)

# Single camera instance for the process, chosen by the CAMERA env var.
camera = get_camera()


# Subscribers (one queue per open /api/capture/events connection) that get a
# "start"/"done" message on every capture, regardless of what triggered it.
# This is what lets the UI shutter flash play identically whether a capture
# came from the on-screen button or the physical GPIO button.
_capture_subscribers: list[queue.Queue] = []
_capture_subscribers_lock = threading.Lock()


def _broadcast_capture_event(event: str) -> None:
    with _capture_subscribers_lock:
        subscribers = list(_capture_subscribers)
    for q in subscribers:
        q.put(event)


def _do_capture() -> dict:
    """Capture a still to CAPTURES_DIR. The one method every capture trigger
    (the API route, the physical shutter button) calls, so they're always
    identical — including the UI feedback, broadcast via SSE below."""
    _broadcast_capture_event("start")
    try:
        os.makedirs(CAPTURES_DIR, exist_ok=True)
        base = datetime.now().strftime("capture-%Y%m%d-%H%M%S-%f")
        path = os.path.join(CAPTURES_DIR, base + ".jpg")
        return camera.capture(path)
    finally:
        _broadcast_capture_event("done")


@app.route("/api/capture/events")
def capture_events():
    """SSE stream of "start"/"done" capture events, from any trigger source."""
    q: queue.Queue = queue.Queue()
    with _capture_subscribers_lock:
        _capture_subscribers.append(q)

    def generate():
        try:
            while True:
                yield f"data: {q.get()}\n\n"
        finally:
            with _capture_subscribers_lock:
                if q in _capture_subscribers:
                    _capture_subscribers.remove(q)

    return Response(generate(), mimetype="text/event-stream")


if os.environ.get("CAMERA") == "real":
    from shutter_button import start_shutter_button

    # Held at module scope: lgpio does not keep this alive on its own, and a
    # locally-scoped callback would be garbage-collected almost immediately.
    _shutter_button = start_shutter_button(_do_capture)


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #

@app.after_request
def api_no_cache(response):
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/api/health")
def health():
    return jsonify(status="ok")


@app.route("/api/preview")
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


@app.route("/api/camera/info")
def camera_info():
    """Static camera info: properties + adjustable controls (min/max/default)."""
    try:
        return jsonify(camera.info())
    except Exception as exc:  # surface a clean error instead of a 500 stack
        return jsonify(error=str(exc)), 503


@app.route("/api/camera/metadata")
def camera_metadata():
    """Live per-frame metadata snapshot (exposure, gain, lux, temp, ...)."""
    try:
        return jsonify(camera.metadata())
    except Exception as exc:
        return jsonify(error=str(exc)), 503


@app.route("/api/camera/controls", methods=["GET", "POST"])
def camera_controls():
    """GET current exposure state; POST {auto_exposure, iso, shutter_us} to set.

    Aperture is not included: Pi cameras have no software-controllable aperture.
    """
    try:
        if request.method == "POST":
            settings = request.get_json(silent=True) or {}
            return jsonify(camera.set_controls(settings))
        return jsonify(camera.controls_state())
    except Exception as exc:
        return jsonify(error=str(exc)), 503


@app.route("/api/camera/orientation", methods=["GET", "POST"])
def camera_orientation():
    """GET the capture orientation; POST {rotation} (degrees clockwise) to set."""
    try:
        if request.method == "POST":
            settings = request.get_json(silent=True) or {}
            return jsonify(camera.set_orientation(settings))
        return jsonify(camera.get_orientation())
    except ValueError as exc:  # invalid rotation value
        return jsonify(error=str(exc)), 400
    except Exception as exc:
        return jsonify(error=str(exc)), 503


def _read_pi_temperatures():
    """Read Pi thermal-zone temperatures as ``{label: celsius}``.

    Reads every ``/sys/class/thermal/thermal_zone*`` (CPU, and any internal/SoC
    sensors). Identical readings are de-duplicated so a separate "internal" temp
    only appears when it actually differs from the CPU. Returns ``{}`` off-Pi
    (e.g. Mac dev) where ``/sys/class/thermal`` is absent.
    """
    import glob

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
        import math
        import time

        wobble = math.sin(time.time() * 0.3) * 0.5 + 0.5  # 0..1
        temps["cpu-thermal"] = round(45.0 + wobble * 10.0, 1)

    return temps


@app.route("/api/system/temperature")
def system_temperature():
    """Pi temperatures (CPU and internal sensors) as ``{label: celsius}``."""
    return jsonify(temperatures=_read_pi_temperatures())


@app.route("/api/system/exit-kiosk", methods=["POST"])
def exit_kiosk():
    """Close the kiosk browser and drop to the desktop.

    Stops the labwc respawner first (so Chromium isn't relaunched), then closes
    only the kiosk browser (matched by its ``--kiosk`` flag, so a normal dev
    browser is never touched). Same-user pkill, no sudo. No-op off the Pi.
    """
    subprocess.run(["pkill", "-f", "lwrespawn"], check=False)
    subprocess.run(["pkill", "-f", "--", "--kiosk"], check=False)
    return jsonify(status="exiting")


@app.route("/api/camera/quality", methods=["GET", "POST"])
def camera_quality():
    """GET the capture JPEG quality; POST {quality} (1..100) to set."""
    try:
        if request.method == "POST":
            settings = request.get_json(silent=True) or {}
            return jsonify(camera.set_quality(settings))
        return jsonify(camera.get_quality())
    except ValueError as exc:  # invalid quality value
        return jsonify(error=str(exc)), 400
    except Exception as exc:
        return jsonify(error=str(exc)), 503


@app.route("/api/camera/format", methods=["GET", "POST"])
def camera_format():
    """GET the capture format; POST {format} (jpeg|raw+jpeg|raw) to set."""
    try:
        if request.method == "POST":
            settings = request.get_json(silent=True) or {}
            return jsonify(camera.set_format(settings))
        return jsonify(camera.get_format())
    except ValueError as exc:  # invalid format value
        return jsonify(error=str(exc)), 400
    except Exception as exc:
        return jsonify(error=str(exc)), 503


@app.route("/api/capture", methods=["POST"])
def capture():
    result = _do_capture()
    files = result.get("files", [])
    # Prefer the previewable (JPEG) file; fall back to whatever was saved.
    filename = result.get("preview") or (files[0] if files else None)
    return jsonify(filename=filename, files=files)


@app.route("/api/captures")
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


@app.route("/api/captures/<path:filename>")
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

# --------------------------------------------------------------------------- #
# Static Next export (catch-all). Anything not under /api is served from
# ../frontend/out, handling trailingSlash routes and asset files, falling back
# to index.html.
# --------------------------------------------------------------------------- #

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def static_proxy(path):
    if path == "api" or path.startswith("api/"):
        return "Not found", 404

    if not os.path.isdir(FRONTEND_OUT):
        return (
            "frontend/out not found. Run a build "
            "(NEXT_PUBLIC_API_BASE= npm run build) first.",
            404,
        )

    candidates = []
    if path:
        # Direct file (assets, _next/*, favicon, etc.).
        candidates.append(os.path.join(FRONTEND_OUT, path))
        # trailingSlash route export: <route>/index.html
        candidates.append(os.path.join(FRONTEND_OUT, path, "index.html"))
        # Non-trailing variant: <route>.html
        candidates.append(os.path.join(FRONTEND_OUT, path + ".html"))

    candidates.append(os.path.join(FRONTEND_OUT, "index.html"))

    for candidate in candidates:
        candidate = os.path.normpath(candidate)
        # Keep resolved paths inside the export dir.
        if not candidate.startswith(FRONTEND_OUT):
            continue
        if os.path.isfile(candidate):
            return send_file(candidate)

    return "Not found", 404


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Pi camera Flask backend")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    args = parser.parse_args()
    app.run(host=args.host, port=args.port, threaded=True)
