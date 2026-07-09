#!/usr/bin/env bash
# Deploy from the Mac to the Pi. Code only ever flows Mac -> Pi.
#
# Steps:
#   1. Build the frontend static export with an EMPTY API base (relative /api).
#   2. rsync backend source + frontend/out/ to the Pi.
#   3. ssh in: install Python deps, restart the API service.
#
# Auth: SSH keys (passwordless). Run `ssh-copy-id ${PI_HOST}` once beforehand.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

# --- Config ----------------------------------------------------------------
# Copy deploy.env.example -> deploy.env and edit it for your Pi (gitignored).
# Values can also be overridden via the environment. Defaults target a stock
# Raspberry Pi OS setup.
[ -f "${ROOT}/deploy.env" ] && source "${ROOT}/deploy.env"
PI_USER="${PI_USER:-pi}"
PI_HOST="${PI_HOST:-raspberrypi.local}"
PI_TARGET="${PI_USER}@${PI_HOST}"
PI_DIR="${PI_DIR:-/home/${PI_USER}/ir-cam}"
# ---------------------------------------------------------------------------

echo "==> [1/3] Building frontend static export (relative /api)"
NEXT_PUBLIC_API_BASE= npm --prefix frontend run build

echo "==> [2/3] Syncing to ${PI_TARGET}:${PI_DIR}"
# Create the target dir tree up front (openrsync on macOS can't --mkpath, and
# rsync won't create missing parent dirs of a destination path).
ssh "${PI_TARGET}" "mkdir -p ${PI_DIR}/frontend/out"

# Backend source (exclude venv, captures, caches). Exclude 'frontend' so the
# --delete here does NOT wipe the frontend/out tree synced below (backend/ has
# no frontend dir, so without this --delete would remove it).
rsync -az --delete \
  --exclude '.venv' \
  --exclude 'captures' \
  --exclude 'settings.json' \
  --exclude 'battery_log.json' \
  --exclude '__pycache__' \
  --exclude 'frontend' \
  backend/ "${PI_TARGET}:${PI_DIR}/"

# Static frontend export.
rsync -az --delete \
  frontend/out/ "${PI_TARGET}:${PI_DIR}/frontend/out/"

# requirements + systemd unit (handy to keep in sync). The unit is rendered
# from the template with the configured user/dir before syncing.
rsync -az requirements.txt "${PI_TARGET}:${PI_DIR}/requirements.txt"
RENDERED_SERVICE="$(mktemp)"
trap 'rm -f "${RENDERED_SERVICE}"' EXIT
sed -e "s|__PI_USER__|${PI_USER}|g" \
    -e "s|__PI_DIR__|${PI_DIR}|g" \
    _deploy/ircam-api.service.tpl > "${RENDERED_SERVICE}"
rsync -az "${RENDERED_SERVICE}" "${PI_TARGET}:${PI_DIR}/ircam-api.service"

# labwc kiosk config (device-agnostic touch rule for swipe-to-scroll).
rsync -az _deploy/labwc-rc.xml "${PI_TARGET}:${PI_DIR}/labwc-rc.xml"

# Kiosk launcher + labwc autostart (boots straight into the kiosk). The
# autostart is rendered from its template with the configured PI_DIR.
rsync -az _deploy/kiosk.sh "${PI_TARGET}:${PI_DIR}/kiosk.sh"
RENDERED_AUTOSTART="$(mktemp)"
trap 'rm -f "${RENDERED_SERVICE}" "${RENDERED_AUTOSTART}"' EXIT
sed -e "s|__PI_DIR__|${PI_DIR}|g" \
    _deploy/labwc-autostart.tpl > "${RENDERED_AUTOSTART}"
rsync -az "${RENDERED_AUTOSTART}" "${PI_TARGET}:${PI_DIR}/labwc-autostart"

echo "==> [3/3] Installing deps, restarting service"
ssh "${PI_TARGET}" bash -s <<EOF
set -euo pipefail
cd "${PI_DIR}"
# Create the venv with system site packages (for apt-provided picamera2) if missing.
if [ ! -d .venv ]; then
  python3 -m venv --system-site-packages .venv
fi
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt
# Install + enable the systemd unit on first deploy; restart on subsequent ones.
if ! systemctl list-unit-files | grep -q '^ircam-api.service'; then
  sudo cp "${PI_DIR}/ircam-api.service" /etc/systemd/system/ircam-api.service
  sudo systemctl daemon-reload
  sudo systemctl enable ircam-api.service
fi
sudo systemctl restart ircam-api.service

# Install the labwc touch config if it differs; touch-input config only takes
# effect after a compositor restart, so flag a reboot when it changes.
mkdir -p ~/.config/labwc
chmod +x "${PI_DIR}/kiosk.sh"
if ! cmp -s "${PI_DIR}/labwc-rc.xml" ~/.config/labwc/rc.xml 2>/dev/null; then
  [ -f ~/.config/labwc/rc.xml ] && cp ~/.config/labwc/rc.xml ~/.config/labwc/rc.xml.bak
  cp "${PI_DIR}/labwc-rc.xml" ~/.config/labwc/rc.xml
  echo "REBOOT_REQUIRED: labwc touch config updated (run: sudo reboot)"
fi
# Install the labwc autostart so the Pi boots straight into the kiosk. Only
# takes effect on the next login/boot, so flag a reboot when it changes.
if ! cmp -s "${PI_DIR}/labwc-autostart" ~/.config/labwc/autostart 2>/dev/null; then
  [ -f ~/.config/labwc/autostart ] && cp ~/.config/labwc/autostart ~/.config/labwc/autostart.bak
  cp "${PI_DIR}/labwc-autostart" ~/.config/labwc/autostart
  echo "REBOOT_REQUIRED: kiosk autostart updated (run: sudo reboot)"
fi
EOF

echo "==> Done. App live at http://${PI_HOST}:5000"
echo "    If the deploy printed REBOOT_REQUIRED, reboot the Pi to apply touch config."
