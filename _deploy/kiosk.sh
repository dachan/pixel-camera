#!/usr/bin/env bash
# Kiosk launcher for the Pi (Wayland/labwc). Waits for the API to come up,
# then launches Chromium full-screen pointed at the single-origin app.
#
# Referenced from ~/.config/labwc/autostart via /usr/bin/lwrespawn so it is
# restarted if it exits.
set -euo pipefail

API_URL="http://localhost:5000"

# Wait for the Flask API to be healthy before opening the browser.
until curl -sf "${API_URL}/api/health" >/dev/null 2>&1; do
  sleep 1
done

# Find a chromium binary (Bookworm ships `chromium`; some images use chromium-browser).
CHROMIUM="$(command -v chromium || command -v chromium-browser)"

exec "${CHROMIUM}" \
  --kiosk \
  --app="${API_URL}" \
  --ozone-platform=wayland \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --check-for-update-interval=31536000 \
  --no-first-run
