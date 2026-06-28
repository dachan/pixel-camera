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
    return temps


@app.route("/api/system/temperature")
def system_temperature():
    """Pi temperatures (CPU and internal sensors) as ``{label: celsius}``."""
    return jsonify(temperatures=_read_pi_temperatures())


@app.route("/api/capture", methods=["POST"])
def capture():
    os.makedirs(CAPTURES_DIR, exist_ok=True)
    filename = datetime.now().strftime("capture-%Y%m%d-%H%M%S-%f") + ".jpg"
    path = os.path.join(CAPTURES_DIR, filename)
    camera.capture(path)
    return jsonify(filename=filename)


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
    """Serve a single captured JPEG."""
    if os.path.basename(filename) != filename or not filename.endswith(".jpg"):
        return "Not found", 404
    path = os.path.join(CAPTURES_DIR, filename)
    if not os.path.isfile(path):
        return "Not found", 404
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
