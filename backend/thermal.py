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
import subprocess
import threading
import time
from collections import deque

logger = logging.getLogger(__name__)

# CPU frequency policies (Pi 5: all cores share one clock, but glob covers any
# layout). When throttling, scaling_max_freq is pinned to the hardware minimum
# to cut heat (power scales ~V²·f); on resume it's restored to the maximum.
_CPU_POLICY_GLOB = "/sys/devices/system/cpu/cpufreq/policy*"

# Throttle above this CPU temperature (°C); resume below RESUME_C.
# Overridable via env for testing on cool hardware.
THROTTLE_C = float(os.environ.get("THERMAL_THROTTLE_C", 65.0))
RESUME_C = float(os.environ.get("THERMAL_RESUME_C", THROTTLE_C - 5.0))
CHECK_INTERVAL_S = 10.0
I2C_SLAVE = 0x0703
X1201_I2C_BUS = "/dev/i2c-1"
X1201_FUEL_GAUGE_ADDR = 0x36
X1201_CAPACITY_REG = 0x04
X1201_VCELL_REG = 0x02
# VCELL LSB in volts (MAX1704x: 78.125 µV). Works for both MAX17040 and
# MAX17048 — the /16 vs ×16 scale difference cancels to the same value.
X1201_VCELL_LSB_V = 78.125e-6

# Charging detection. This fuel gauge exposes no charge flag (its CRATE
# register is unimplemented), so charging is inferred from the cell-voltage
# trend: a rise over the window means the charger is pushing current in; a
# fall means the Pi is running the battery down. A flat, near-full voltage is
# the charger holding the cell topped up (CV phase).
CHARGE_WINDOW_S = 90
CHARGE_RISE_V = 0.01
# Flat voltage held at/above this means the charger is present: under the Pi's
# constant load a battery on battery power sags and steadily declines, so it
# can't hold a high voltage flat. Set below the ~4.1 V charge plateau so the
# slow constant-voltage phase near full still reads as charging.
BATTERY_FULL_HOLD_V = 4.05


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


def read_battery_level() -> int | None:
    """Read a battery/UPS percentage from Linux power-supply sysfs, if present."""
    for supply in sorted(glob.glob("/sys/class/power_supply/*")):
        try:
            with open(os.path.join(supply, "type")) as f:
                supply_type = f.read().strip().lower()
        except OSError:
            supply_type = ""
        if supply_type not in {"battery", "ups"}:
            continue
        try:
            with open(os.path.join(supply, "capacity")) as f:
                return max(0, min(100, int(f.read().strip())))
        except (OSError, ValueError):
            continue
    level = _read_x1201_battery_level()
    if level is not None:
        return level
    if os.environ.get("CAMERA") != "real":
        wobble = math.sin(time.time() * 0.08) * 0.5 + 0.5  # 0..1
        return round(72 + wobble * 24)
    return None


def read_battery_voltage() -> float | None:
    """Battery cell voltage in volts, or None if no battery/UPS is present.

    Prefers a Linux power-supply ``voltage_now`` (µV), falling back to the
    Geekworm X1201 fuel gauge over I2C.
    """
    for supply in sorted(glob.glob("/sys/class/power_supply/*")):
        try:
            with open(os.path.join(supply, "type")) as f:
                if f.read().strip().lower() not in {"battery", "ups"}:
                    continue
            with open(os.path.join(supply, "voltage_now")) as f:
                return int(f.read().strip()) / 1_000_000.0
        except (OSError, ValueError):
            continue
    return _read_x1201_voltage()


def _read_x1201_voltage() -> float | None:
    """Cell voltage (V) from the Geekworm X1201/MAX1704x VCELL over I2C."""
    try:
        import fcntl

        with open(X1201_I2C_BUS, "r+b", buffering=0) as bus:
            fcntl.ioctl(bus, I2C_SLAVE, X1201_FUEL_GAUGE_ADDR)
            bus.write(bytes([X1201_VCELL_REG]))
            data = bus.read(2)
    except OSError:
        return None
    if len(data) != 2:
        return None
    return ((data[0] << 8) | data[1]) * X1201_VCELL_LSB_V


def _read_x1201_battery_level() -> int | None:
    """Battery % from the X1201 fuel gauge's ModelGauge SOC register (0x04).

    This is the most accurate reading the hardware offers: SOC compensates for
    the nonlinear discharge curve, load sag, and charge-voltage elevation that
    fool any voltage-only estimate (e.g. at 4.17 V mid-charge the cell reads
    ~97% by voltage but is really ~79% full — SOC gets this right). It does
    NOT match the board's cruder voltage-based LED bars. None if absent.
    """
    try:
        import fcntl

        with open(X1201_I2C_BUS, "r+b", buffering=0) as bus:
            fcntl.ioctl(bus, I2C_SLAVE, X1201_FUEL_GAUGE_ADDR)
            bus.write(bytes([X1201_CAPACITY_REG]))
            data = bus.read(2)
    except OSError:
        return None
    if len(data) != 2:
        return None
    # SOC is an 8.8 fixed-point percentage, big-endian.
    return max(0, min(100, round(((data[0] << 8) | data[1]) / 256.0)))


def _cpu_freq_bounds() -> tuple[int, int] | None:
    """(min, max) CPU frequency in kHz from cpufreq sysfs, or None off-Pi."""
    for policy in sorted(glob.glob(_CPU_POLICY_GLOB)):
        try:
            with open(os.path.join(policy, "cpuinfo_min_freq")) as f:
                lo = int(f.read().strip())
            with open(os.path.join(policy, "cpuinfo_max_freq")) as f:
                hi = int(f.read().strip())
            return lo, hi
        except (OSError, ValueError):
            continue
    return None


def set_cpu_throttled(throttled: bool) -> None:
    """Cap (or restore) the CPU max frequency for thermal management.

    Pins scaling_max_freq to the hardware minimum when throttled, back to the
    maximum on resume, across all cpufreq policies. Needs root, via passwordless
    sudo. No-op off the Pi (no cpufreq sysfs).
    """
    bounds = _cpu_freq_bounds()
    if bounds is None:
        return
    lo, hi = bounds
    target = lo if throttled else hi
    # One sudo call writes every policy's scaling_max_freq.
    script = (
        f'for f in {_CPU_POLICY_GLOB}/scaling_max_freq; do '
        f'echo {target} > "$f"; done'
    )
    result = subprocess.run(["sudo", "sh", "-c", script], check=False)
    if result.returncode != 0:
        logger.warning("failed to set CPU max freq to %d kHz", target)


class ThermalMonitor:
    """Background thread flipping throttle callbacks on temperature crossings."""

    def __init__(self, on_throttle, on_resume, enabled=True):
        self.enabled = bool(enabled)
        self.throttled = False
        # None until the first battery reading; then True/False (charging).
        self.charging = None
        self._volts = deque()  # (monotonic_time, volts) over CHARGE_WINDOW_S
        self._on_throttle = on_throttle
        self._on_resume = on_resume
        thread = threading.Thread(
            target=self._run, name="thermal-monitor", daemon=True
        )
        thread.start()

    def _update_charging(self) -> None:
        """Infer charging from the cell-voltage trend (see CHARGE_* consts)."""
        volts = read_battery_voltage()
        if volts is None:
            return
        now = time.monotonic()
        self._volts.append((now, volts))
        while self._volts and now - self._volts[0][0] > CHARGE_WINDOW_S:
            self._volts.popleft()
        delta = volts - self._volts[0][1]
        if delta >= CHARGE_RISE_V:
            self.charging = True
        elif delta <= -CHARGE_RISE_V:
            self.charging = False
        elif volts >= BATTERY_FULL_HOLD_V:
            # Flat and near-full: the charger is holding it topped up.
            self.charging = True
        elif self.charging is None:
            self.charging = False  # flat mid-range at startup: assume on battery

    def set_enabled(self, enabled: bool) -> None:
        """Turn monitoring on/off; disabling lifts an active throttle."""
        self.enabled = bool(enabled)
        if not self.enabled and self.throttled:
            self.throttled = False
            logger.warning("thermal throttling disabled: resuming full rate")
            self._safely(self._on_resume)

    def _run(self):
        while True:
            try:
                self._update_charging()  # runs regardless of throttle setting
                temps = read_temperatures() if self.enabled else None
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
