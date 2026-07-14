"""Persistence for camera settings, kept out of the camera abstraction.

One JSON file holding the last-used rotation/quality/format/exposure so the
camera comes back the way it was left after a restart or reboot. Best-effort
by design: a missing or corrupt file means defaults, a failed write is
ignored — persistence must never take the camera down.
"""

from __future__ import annotations

import json
import os

_DEFAULT_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "settings.json"
)


class SettingsStore:
    """Load/save a dict as JSON. Generic — used for camera settings and for
    other small bits of persisted state (e.g. the battery min/max log).

    Path resolution: explicit ``path`` arg, else ``SETTINGS_PATH`` env var,
    else a default next to the backend code (i.e. ~/ir-cam/settings.json on
    the Pi), which deploys exclude so per-device state survives redeploys.
    """

    def __init__(self, path: str | None = None):
        self.path = path or os.environ.get("SETTINGS_PATH") or _DEFAULT_PATH

    def load(self) -> dict | None:
        try:
            with open(self.path) as f:
                data = json.load(f)
        except (OSError, ValueError):
            return None
        return data if isinstance(data, dict) else None

    def save(self, settings: dict) -> None:
        # Write-then-rename so a crash mid-write can't leave a truncated
        # file — a corrupt settings.json would silently reset every setting.
        tmp = self.path + ".tmp"
        try:
            with open(tmp, "w") as f:
                json.dump(settings, f, indent=2)
            os.replace(tmp, self.path)
        except OSError:
            pass
