# pi-xel — Raspberry Pi camera control app

A single-device camera UI: a **Next.js** (static-export) frontend and a
**Flask + picamera2** backend. Develop on a Mac against a mock camera, then
deploy to a Pi 5 (Bookworm 64-bit, Wayland/labwc) where it runs as a service
(with an optional full-screen kiosk mode).

Code only ever flows **Mac → Pi**. The Pi is a runtime, not a dev box.

## Architecture

```
pi-xel/
├── backend/
│   ├── camera.py   # BaseCamera + MockCamera / RealCamera, get_camera() factory
│   ├── app.py      # Flask: /api/* + static Next export catch-all
│   └── .venv/      # local dev venv (gitignored)
├── frontend/       # Next.js static export (TS, Tailwind, app router, src dir)
│   └── src/
│       ├── lib/camera-api.ts        # all API calls go through here
│       ├── components/CaptureView.tsx
│       └── app/page.tsx
├── scripts/deploy.sh        # Mac → Pi deploy
├── _deploy/
│   ├── ircam-api.service    # systemd unit (CAMERA=real)
│   └── kiosk.sh             # Chromium kiosk launcher
├── requirements.txt         # flask, flask-cors, Pillow  (NOT picamera2)
└── package.json             # `npm run dev` runs both servers
```

- **Camera selection** is by the `CAMERA` env var: `real` → `RealCamera`
  (picamera2), anything else → `MockCamera` (Pillow-synthesized frames).
- `picamera2` is imported lazily inside `RealCamera.__init__` and is **not** in
  `requirements.txt`; on the Pi it comes from apt via a `--system-site-packages`
  venv. This is what lets the backend import cleanly on the Mac.
- In production Flask serves the static export from `frontend/out`, so the kiosk
  is single-origin (relative `/api`). In dev the frontend runs on :3000 and
  talks cross-origin to Flask on :5000 (flask-cors handles it).

## Dev setup (Mac)

Prereqs: Node 18+, Python 3.9+.

```bash
# 1. Backend venv + deps
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r requirements.txt

# 2. Frontend + root deps
npm --prefix frontend install
npm install

# 3. Frontend env
cp frontend/.env.example frontend/.env.local   # already points at :5000

# 4. Run both servers (backend :5000 with mock camera, frontend :3000)
npm run dev
```

Open <http://localhost:3000>. You should see the moving mock preview and a
Capture button that saves a frame to `backend/captures/` and reports its
filename.

Quick API check:

```bash
curl -s localhost:5000/api/health           # {"status":"ok"}
curl -s -X POST localhost:5000/api/capture  # {"filename":"capture-...jpg"}
```

## Deploy (Mac → Pi)

One-time, from the Mac:

```bash
cp deploy.env.example deploy.env   # then edit it for your Pi (gitignored)
ssh-copy-id pi@raspberrypi.local   # passwordless SSH for deploys
```

Then deploy anytime:

```bash
./scripts/deploy.sh
```

This builds the static export with an **empty** API base (relative `/api`),
rsyncs `backend/` + `frontend/out/` to the Pi (`~/ir-cam/` by default), installs
deps in the Pi venv, restarts the API service, and relaunches the kiosk.

Host/user/path come from `deploy.env` (copy `deploy.env.example` to `deploy.env`
and edit it — it's gitignored), or from matching environment variables. Defaults
target a stock Raspberry Pi OS setup (`pi@raspberrypi.local`). The systemd unit
is rendered from `_deploy/ircam-api.service.tpl` using the same values, so the
deployed service always matches your config.

## Pi setup (run on the Pi, once)

> Do these once on a fresh Pi before the first `./scripts/deploy.sh`.

```bash
# 1. System packages (picamera2 from apt — do NOT pip install it)
sudo apt update
sudo apt install -y python3-picamera2 chromium rsync

# 2. App dir + venv WITH system site packages (so picamera2 is importable)
mkdir -p ~/ir-cam && cd ~/ir-cam
python3 -m venv --system-site-packages .venv

# (deploy.sh will rsync the code and pip-install flask/flask-cors/Pillow here)
```

### systemd API service

`scripts/deploy.sh` **installs and enables the service automatically** the first
time it runs (and restarts it on every deploy after). So normally you don't need
to do anything here — just verify after a deploy:

```bash
systemctl status ircam-api.service          # should be active (running)
curl -s localhost:5000/api/health           # {"status":"ok"}
```

This relies on the deploy user having passwordless `sudo` (the Raspberry Pi OS
default for the setup user). If `sudo` prompts for a password, install it
manually once instead:

```bash
sudo cp ~/ir-cam/ircam-api.service /etc/systemd/system/ircam-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now ircam-api.service
```

By default the Pi does **not** boot into kiosk mode. The API runs as a service,
and you open the app yourself in a browser (on the Pi or any device on the
network) at `http://<pi-host>:5000`. Deploys never launch or relaunch a browser.

### Optional: kiosk autostart (labwc)

If you *do* want the Pi to boot straight into a full-screen Chromium kiosk on
the app, wire up the launcher yourself (it is not configured by `deploy.sh`):

```bash
# Copy the launcher to home and make it executable
cp ~/ir-cam/kiosk.sh ~/kiosk.sh   # (or copy from the repo's _deploy/kiosk.sh)
chmod +x ~/kiosk.sh

# Reference it from the labwc autostart, respawned if it exits
mkdir -p ~/.config/labwc
echo "/usr/bin/lwrespawn $HOME/kiosk.sh" >> ~/.config/labwc/autostart
```

For the kiosk to autostart on boot the Pi needs to log into the desktop session
automatically:

```bash
sudo raspi-config
# System Options → Boot / Auto Login → Desktop Autologin
sudo reboot
```

After reboot the Pi boots to the desktop, labwc autostarts `kiosk.sh`, which
waits for the API and launches Chromium full-screen on the app.

To turn kiosk mode back off later, remove the `lwrespawn` line from
`~/.config/labwc/autostart` (and reboot, or `pkill -f chromium`).

> Note: `deploy.sh` syncs `backend/` and `frontend/out/` but not `kiosk.sh`.
> Copy `_deploy/kiosk.sh` to `~/kiosk.sh` on the Pi yourself (it rarely changes).

## Troubleshooting

**macOS: `localhost:5000` returns 403 `AirTunes` instead of the backend.**
macOS Control Center runs an **AirPlay Receiver** on port 5000 (incl. IPv6),
and `localhost` resolves to IPv6 `::1` first, shadowing Flask. The backend is
fine — it's just hidden. Two fixes:

- **Recommended:** turn it off — System Settings → General → AirDrop & Handoff →
  **AirPlay Receiver: Off**. Then `localhost:5000` works everywhere (browser +
  curl).
- **Or** use the IPv4 address: `curl 127.0.0.1:5000/api/health`, and set
  `NEXT_PUBLIC_API_BASE=http://127.0.0.1:5000` in `frontend/.env.local`.

This only affects Mac dev. The Pi has no such conflict.

## Notes

- `RealCamera` only runs on the Pi; it is never exercised on the Mac.
- The captured images live in `backend/captures/` (dev) and `~/ir-cam/captures/`
  (Pi), both gitignored.
- The home page UI is intentionally minimal (preview + capture) — build the real
  UI on top of `CaptureView`.

## Security

This app has **no authentication**. On the Pi the API service binds
`0.0.0.0:5000`, so anyone who can reach the Pi on the network can view the live
preview, trigger captures, and read saved images. That's intentional for a
single-device kiosk on a trusted home/lab LAN — but it means **the Pi trusts its
entire network**.

Before exposing it more widely:

- Keep the device on a trusted network; do **not** port-forward `:5000` to the
  public internet.
- Put it behind a reverse proxy with auth/TLS, or bind the API to `127.0.0.1`
  and front it, if you need access beyond the local kiosk.
- The Flask server is run directly via systemd (not behind a WSGI server). This
  is fine for one local device but is not hardened for untrusted traffic.

## License

[MIT](LICENSE) © David Chan
