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
EOF

echo "==> Done. App live at http://${PI_HOST}:5000"
