"""Flask backend for the Pi camera app.

Assembly only — the interesting parts live in focused modules:

    api.py             /api routes (JSON + MJPEG preview + SSE events)
    camera_service.py  camera singleton, capture orchestration, GPIO button
    camera.py          BaseCamera + MockCamera / RealCamera
    events.py          SSE fan-out
    settings_store.py  settings.json persistence

This module wires the blueprint, CORS, and the static Next.js export from
``frontend/out`` (served via a catch-all so the production kiosk is
single-origin). In dev the frontend runs separately on :3000 and talks here
cross-origin (flask-cors handles it); in prod CORS is a no-op.
"""

from __future__ import annotations

import argparse
import os

from flask import Flask, send_file
from flask_cors import CORS

from api import api

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))


def _find_frontend_out():
    """Locate frontend/out across both layouts.

    Mac dev: app.py is in pixel-camera/backend/, frontend is a sibling
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

app = Flask(__name__, static_folder=None)
CORS(app)
app.register_blueprint(api)


# --------------------------------------------------------------------------- #
# Static Next export (catch-all). Anything not under /api is served from
# frontend/out, handling trailingSlash routes and asset files, falling back
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
        # Keep resolved paths strictly inside the export dir. (The separator
        # matters: a bare prefix check would also match a sibling directory
        # like frontend/out-other.)
        if not candidate.startswith(FRONTEND_OUT + os.sep):
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
