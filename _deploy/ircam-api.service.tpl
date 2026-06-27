# Template — scripts/deploy.sh renders this into ircam-api.service on the Pi,
# substituting __PI_USER__ / __PI_DIR__ from deploy.env (see deploy.env.example).
[Unit]
Description=IR Cam Flask API (picamera2)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=__PI_USER__
WorkingDirectory=__PI_DIR__
Environment=CAMERA=real
ExecStart=__PI_DIR__/.venv/bin/python app.py --host 0.0.0.0 --port 5000
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
