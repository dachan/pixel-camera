"""Physical shutter-button support via GPIO (Raspberry Pi only).

Talks to ``lgpio`` directly rather than through ``gpiozero``. On this Pi 5
(RP1) + lgpio combination, gpiozero's ``Button(pull_up=True)`` silently fails
to apply the pull-up — ``pinctrl``/``gpioinfo`` confirmed the line comes up
with no pull configured, so the input floats and never reads HIGH even when
idle. Calling ``lgpio.gpio_claim_alert`` with ``SET_PULL_UP`` directly does
apply the pull-up correctly (verified the same way), so this bypasses
gpiozero's GPIO handling entirely for this device.
"""

from __future__ import annotations

import logging
import os
import threading
import time

logger = logging.getLogger(__name__)

# BCM pin the button is wired to (button between the pin and GND, using the
# Pi's internal pull-up — pressed pulls the pin LOW, a falling edge).
# Override with the SHUTTER_GPIO_PIN env var if wired to a different pin.
DEFAULT_PIN = 17
# Quiet window after a capture completes before another press is accepted.
DEBOUNCE_S = 0.3
# While the button is held down, poll for release at this interval, up to
# MAX_HOLD_S (a safety cap so a stuck-LOW line can't block the thread forever).
HOLD_POLL_S = 0.02
MAX_HOLD_S = 10.0


def start_shutter_button(on_press):
    """Start listening for shutter-button presses; calls ``on_press()`` on each.

    Runs on lgpio's own alert-notification thread. Returns the callback
    object — callers must keep a reference to it (unlike gpiozero, lgpio does
    not keep the underlying handle alive on your behalf).

    One physical press produces exactly one capture: after firing, the next
    press is not accepted until the button has been physically released (the
    line returns HIGH), then a short quiet window elapses. This prevents a
    held button, contact bounce, or an intermittent/dirty contact — whose
    edges can be spaced further apart than a single ~1s capture — from firing
    repeated captures from a single press. A press arriving while a capture is
    still running is dropped, not queued.
    """
    import lgpio

    pin = int(os.environ.get("SHUTTER_GPIO_PIN", DEFAULT_PIN))
    handle = lgpio.gpiochip_open(0)
    lgpio.gpio_claim_alert(handle, pin, lgpio.FALLING_EDGE, lgpio.SET_PULL_UP)

    busy = threading.Lock()
    last_trigger = 0.0

    def _handle_edge(chip, gpio, level, tick):
        nonlocal last_trigger
        now = time.monotonic()
        # Quiet window is measured from the previous capture's *completion*
        # (set in finally), so bounce right after a capture is ignored.
        if now - last_trigger < DEBOUNCE_S:
            return
        if not busy.acquire(blocking=False):
            return
        try:
            on_press()
        except Exception:
            # Never let a failed capture (disk full, camera busy, ...)
            # propagate into lgpio's notification thread — that would kill it
            # and silently disable the button until the service restarts.
            logger.exception("shutter button capture failed")
        finally:
            # Wait for the button to be released (line HIGH) before re-arming,
            # so a still-held or bouncing contact can't auto-repeat. Falls back
            # to a plain time debounce if the level can't be read.
            try:
                deadline = time.monotonic() + MAX_HOLD_S
                while (
                    lgpio.gpio_read(handle, pin) == 0
                    and time.monotonic() < deadline
                ):
                    time.sleep(HOLD_POLL_S)
            except Exception:
                pass
            last_trigger = time.monotonic()
            busy.release()

    return lgpio.callback(handle, pin, lgpio.FALLING_EDGE, _handle_edge)
