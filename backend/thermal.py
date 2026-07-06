"""CPU-temperature reading and app-level thermal throttling.

The Pi's firmware protects itself by hard-throttling the CPU around 80°C;
this acts far earlier: past THROTTLE_C the preview frame rate is reduced
(the MJPEG encode is the app's main steady heat source), restoring once
the temperature falls below RESUME_C. The gap between the two thresholds
is hysteresis so the state doesn't flap around the trigger point.
"""

from __future__ import annotations

import glob
import logging
import math
import os
import threading
import time

logger = logging.getLogger(__name__)

# Throttle above this CPU temperature (°C); resume below RESUME_C.
# Overridable via env for testing on cool hardware.
THROTTLE_C = float(os.environ.get("THERMAL_THROTTLE_C", 60.0))
RESUME_C = float(os.environ.get("THERMAL_RESUME_C", THROTTLE_C - 5.0))
CHECK_INTERVAL_S = 10.0


def read_temperatures() -> dict[str, float]:
    """Read Pi thermal-zone temperatures as ``{label: celsius}``.

    Reads every ``/sys/class/thermal/thermal_zone*`` (CPU, and any internal/SoC
    sensors). Identical readings are de-duplicated so a separate "internal" temp
    only appears when it actually differs from the CPU. Off-Pi (e.g. Mac dev,
    where /sys/class/thermal is absent) a plausible wobbling CPU temperature is
    synthesized so the panel is visible and testable, mirroring MockCamera's
    synthesized metadata.
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
        wobble = math.sin(time.time() * 0.3) * 0.5 + 0.5  # 0..1
        temps["cpu-thermal"] = round(45.0 + wobble * 10.0, 1)

    return temps


class ThermalMonitor:
    """Background thread flipping throttle callbacks on temperature crossings."""

    def __init__(self, on_throttle, on_resume):
        self.throttled = False
        self._on_throttle = on_throttle
        self._on_resume = on_resume
        thread = threading.Thread(
            target=self._run, name="thermal-monitor", daemon=True
        )
        thread.start()

    def _run(self):
        while True:
            try:
                temps = read_temperatures()
                temp = max(temps.values()) if temps else None
                if temp is not None:
                    if not self.throttled and temp >= THROTTLE_C:
                        self.throttled = True
                        logger.warning(
                            "CPU at %.1f°C (>= %.1f°C): throttling preview",
                            temp, THROTTLE_C,
                        )
                        self._safely(self._on_throttle)
                    elif self.throttled and temp <= RESUME_C:
                        self.throttled = False
                        logger.warning(
                            "CPU back to %.1f°C (<= %.1f°C): resuming full rate",
                            temp, RESUME_C,
                        )
                        self._safely(self._on_resume)
            except Exception:
                logger.exception("thermal check failed")
            time.sleep(CHECK_INTERVAL_S)

    @staticmethod
    def _safely(callback):
        try:
            callback()
        except Exception:
            logger.exception("thermal throttle callback failed")
