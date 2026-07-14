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

from settings_store import SettingsStore

# Persisted lowest/highest cell voltage ever observed (see ThermalMonitor),
# next to the backend code like settings.json — excluded from deploys so it
# survives redeploys.
_BATTERY_LOG_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "battery_log.json"
)

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
X1201_VCELL_REG = 0x02
# VCELL LSB in volts (MAX1704x: 78.125 µV). Works for both MAX17040 and
# MAX17048 — the /16 vs ×16 scale difference cancels to the same value.
X1201_VCELL_LSB_V = 78.125e-6

# Single-cell Li-ion/LiPo open-circuit-voltage -> state-of-charge, the
# standard reference curve used when a fuel gauge's own model can't be
# trusted (ascending by voltage; reflects the real discharge shape — flat
# through the ~40-90% midrange, steep at both ends — unlike a straight
# line). This specific X1201 gauge is a MAX17040/41-class chip with a
# fixed, non-programmable internal model that reads implausibly low for
# this battery (confirmed via a QuickStart reset: no change), so voltage
# through this curve is used instead of its SOC register.
_OCV_CURVE_V_PCT: tuple[tuple[float, int], ...] = (
    (3.27, 0), (3.61, 5), (3.69, 10), (3.71, 15), (3.73, 20),
    (3.75, 25), (3.77, 30), (3.79, 35), (3.80, 40), (3.82, 45),
    (3.84, 50), (3.85, 55), (3.87, 60), (3.91, 65), (3.95, 70),
    (3.98, 75), (4.02, 80), (4.08, 85), (4.11, 90), (4.15, 95),
    (4.20, 100),
)


def voltage_to_percent(volts: float) -> int:
    """Map a cell voltage to 0..100% via piecewise-linear interpolation over
    _OCV_CURVE_V_PCT, clamped at the table's ends.

    Like any voltage-only estimate, this still sags under heavy load —
    there's no current-sense hardware here to correct for that.
    """
    points = _OCV_CURVE_V_PCT
    if volts <= points[0][0]:
        return points[0][1]
    if volts >= points[-1][0]:
        return points[-1][1]
    for (v0, p0), (v1, p1) in zip(points, points[1:]):
        if volts <= v1:
            frac = (volts - v0) / (v1 - v0)
            return round(p0 + frac * (p1 - p0))
    return points[-1][1]  # unreachable (volts < points[-1][0] handled above)

# Charging detection. This fuel gauge exposes no charge flag (its CRATE
# register is unimplemented), so charging is inferred from the cell-voltage
# trend: a rise over the window means the charger is pushing current in; a
# fall means the Pi is running the battery down. A flat, near-full voltage is
# the charger holding the cell topped up (CV phase). The trend compares
# averaged early-vs-late halves of the sample window (not two raw endpoint
# readings) — VCELL is noisy enough under the Pi's variable load that a
# single-sample comparison read a false "charging" from ~10mV of jitter with
# no charger connected at all.
CHARGE_WINDOW_S = 90
CHARGE_RISE_V = 0.03
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


def _battery_supplies():
    """Yield /sys/class/power_supply dirs whose type is battery or UPS."""
    for supply in sorted(glob.glob("/sys/class/power_supply/*")):
        try:
            with open(os.path.join(supply, "type")) as f:
                if f.read().strip().lower() in {"battery", "ups"}:
                    yield supply
        except OSError:
            continue


def read_battery_level(volts: float | None = None) -> int | None:
    """Battery percentage: Linux power-supply sysfs ``capacity`` if present
    (authoritative when available), else derived from cell voltage via the
    standard Li-ion OCV curve (see read_battery_voltage, voltage_to_percent).

    Pass ``volts`` if the voltage was just read, to skip a second (I2C)
    read for the fallback path.
    """
    for supply in _battery_supplies():
        try:
            with open(os.path.join(supply, "capacity")) as f:
                return max(0, min(100, int(f.read().strip())))
        except (OSError, ValueError):
            continue
    if volts is None:
        volts = read_battery_voltage()
    return voltage_to_percent(volts) if volts is not None else None


def read_battery_voltage() -> float | None:
    """Battery cell voltage in volts, or None if no battery/UPS is present.

    Prefers a Linux power-supply ``voltage_now`` (µV), falling back to the
    Geekworm X1201 fuel gauge over I2C. Off-Pi (e.g. Mac dev, no I2C bus) a
    slow sweep across the full 3.0-4.2V range is synthesized so charging
    detection and the min/max log are visible and testable without hardware,
    mirroring MockCamera's synthesized metadata.
    """
    for supply in _battery_supplies():
        try:
            with open(os.path.join(supply, "voltage_now")) as f:
                return int(f.read().strip()) / 1_000_000.0
        except (OSError, ValueError):
            continue
    volts = _read_x1201_voltage()
    if volts is not None:
        return volts
    if os.environ.get("CAMERA") != "real":
        wobble = math.sin(time.time() * 0.017) * 0.5 + 0.5  # 0..1, ~6min period
        return round(3.0 + wobble * 1.2, 3)
    return None


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
        # Persisted battery min/max (see _update_battery_extremes). Loaded
        # once here so a restart doesn't lose a low reading taken earlier.
        self._battery_log = SettingsStore(_BATTERY_LOG_PATH)
        log = self._battery_log.load() or {}
        self.battery_min_v: float | None = log.get("min_v")
        self.battery_min_at: float | None = log.get("min_at")
        self.battery_max_v: float | None = log.get("max_v")
        self.battery_max_at: float | None = log.get("max_at")
        self.battery_first_at: float | None = log.get("first_at")
        self._on_throttle = on_throttle
        self._on_resume = on_resume
        thread = threading.Thread(
            target=self._run, name="thermal-monitor", daemon=True
        )
        thread.start()

    def _update_battery(self) -> None:
        """Sample battery voltage once per tick, feeding both the charging
        trend detector and the persisted min/max log."""
        volts = read_battery_voltage()
        if volts is None:
            return
        self._update_charging(volts)  # resolves self.charging first
        # Min/max should reflect the battery's own state, not the charger:
        # while charging, voltage is being actively driven up by the
        # charger's output rather than reflecting the cell's own remaining
        # capacity, which would make "highest ever" a measure of the
        # charger, not the battery. Skipped only when charging is confirmed
        # True — an unresolved/unknown state (None, e.g. briefly after a
        # restart) still gets logged so a real reading isn't dropped.
        if self.charging is not True:
            self._update_battery_extremes(volts)

    def _update_battery_extremes(self, volts: float) -> None:
        """Track the lowest/highest cell voltage ever observed while NOT
        charging, persisted to disk so it survives a service restart
        (deploys restart it often, which would otherwise lose a low reading
        taken mid-session) — the real range a single instantaneous reading
        can't show, e.g. whether the cell ever recovers to a healthy resting
        voltage or just sits low (suggesting a genuinely depleted or failing
        battery)."""
        now = time.time()
        changed = self.battery_first_at is None
        self.battery_first_at = self.battery_first_at or now
        if self.battery_min_v is None or volts < self.battery_min_v:
            self.battery_min_v, self.battery_min_at = volts, now
            changed = True
        if self.battery_max_v is None or volts > self.battery_max_v:
            self.battery_max_v, self.battery_max_at = volts, now
            changed = True
        if changed:
            self._battery_log.save({
                "min_v": self.battery_min_v, "min_at": self.battery_min_at,
                "max_v": self.battery_max_v, "max_at": self.battery_max_at,
                "first_at": self.battery_first_at,
            })

    def _update_charging(self, volts: float) -> None:
        """Infer charging from the cell-voltage trend (see CHARGE_* consts)."""
        now = time.monotonic()
        self._volts.append((now, volts))
        while self._volts and now - self._volts[0][0] > CHARGE_WINDOW_S:
            self._volts.popleft()
        if len(self._volts) < 4:
            return  # not enough samples yet for a de-noised trend
        # Compare averaged early-vs-late halves rather than two raw samples,
        # so a single noisy reading can't flip the state (see CHARGE_RISE_V).
        samples = list(self._volts)
        mid = len(samples) // 2
        early = sum(v for _, v in samples[:mid]) / mid
        late = sum(v for _, v in samples[mid:]) / (len(samples) - mid)
        delta = late - early
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

    def reset_battery_log(self) -> None:
        """Clear the persisted battery min/max (e.g. after swapping cells)."""
        self.battery_min_v = self.battery_min_at = None
        self.battery_max_v = self.battery_max_at = None
        self.battery_first_at = None
        self._battery_log.save({})

    def _run(self):
        while True:
            try:
                self._update_battery()  # runs regardless of throttle setting
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
