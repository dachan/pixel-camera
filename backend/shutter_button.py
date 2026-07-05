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

import os
import threading
import time

# BCM pin the button is wired to (button between the pin and GND, using the
# Pi's internal pull-up — pressed pulls the pin LOW, a falling edge).
# Override with the SHUTTER_GPIO_PIN env var if wired to a different pin.
DEFAULT_PIN = 17
DEBOUNCE_S = 0.2


def start_shutter_button(on_press):
    """Start listening for shutter-button presses; calls ``on_press()`` on each.

    Runs on lgpio's own alert-notification thread. Returns the callback
    object — callers must keep a reference to it (unlike gpiozero, lgpio does
    not keep the underlying handle alive on your behalf).

    A press is dropped, rather than queued, if it arrives within the
    debounce window or while a prior ``on_press`` call is still running
    (a capture briefly stops and restarts the preview stream).
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
        if now - last_trigger < DEBOUNCE_S:
            return
        last_trigger = now
        if not busy.acquire(blocking=False):
            return
        try:
            on_press()
        finally:
            busy.release()

    return lgpio.callback(handle, pin, lgpio.FALLING_EDGE, _handle_edge)
