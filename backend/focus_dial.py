"""GPIO rotary-encoder control for manual camera focus.

The encoder is wired to BCM GPIO 23 (CLK/A), GPIO 24 (DT/B), and optionally
GPIO 25 (SW).  All inputs use the Pi's internal pull-ups, so the encoder's
common ground is the only return connection required.
"""

from __future__ import annotations

import logging
import os
import threading
import time

logger = logging.getLogger(__name__)

DEFAULT_CLK_PIN = 23
DEFAULT_DT_PIN = 24
DEFAULT_SWITCH_PIN = 25
DEFAULT_STEP = 0.5
SWITCH_DEBOUNCE_S = 0.35

# Valid one-bit quadrature transitions. The sign convention can be flipped
# without editing code when a particular encoder's clockwise direction differs.
_TRANSITIONS = {
    (0, 1): 1,
    (1, 3): 1,
    (3, 2): 1,
    (2, 0): 1,
    (0, 2): -1,
    (2, 3): -1,
    (3, 1): -1,
    (1, 0): -1,
}


def _env_pin(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


def start_focus_dial(camera):
    """Start the focus dial and return callback objects that must be retained.

    A full encoder detent produces four valid quadrature transitions. Invalid
    transitions from contact bounce are ignored. Rotating always changes to
    manual focus first; pressing the shaft toggles continuous autofocus and
    manual focus. Set ``FOCUS_DIAL_REVERSE=1`` if clockwise goes the wrong way.
    """
    import lgpio

    clk_pin = _env_pin("FOCUS_DIAL_CLK_PIN", DEFAULT_CLK_PIN)
    dt_pin = _env_pin("FOCUS_DIAL_DT_PIN", DEFAULT_DT_PIN)
    switch_pin = _env_pin("FOCUS_DIAL_SWITCH_PIN", DEFAULT_SWITCH_PIN)
    step = float(os.environ.get("FOCUS_DIAL_STEP", DEFAULT_STEP))
    direction = -1 if os.environ.get("FOCUS_DIAL_REVERSE") == "1" else 1

    handle = lgpio.gpiochip_open(0)
    lgpio.gpio_claim_alert(handle, clk_pin, lgpio.BOTH_EDGES, lgpio.SET_PULL_UP)
    lgpio.gpio_claim_alert(handle, dt_pin, lgpio.BOTH_EDGES, lgpio.SET_PULL_UP)
    lgpio.gpio_claim_alert(
        handle, switch_pin, lgpio.FALLING_EDGE, lgpio.SET_PULL_UP
    )

    lock = threading.Lock()
    last_state = (lgpio.gpio_read(handle, clk_pin) << 1) | lgpio.gpio_read(
        handle, dt_pin
    )
    transition_total = 0
    last_switch_at = 0.0

    def move_focus(amount: int) -> None:
        if not camera.focus_available():
            logger.warning("focus dial ignored: camera has no focus motor")
            return
        try:
            current = camera.get_focus()
            position = float(current.get("lens_position", 0.0)) + amount * step
            camera.set_focus({"af_mode": "manual", "lens_position": position})
        except Exception:
            # GPIO callbacks must never die because the camera is temporarily
            # busy (or because the installed camera lacks focus support).
            logger.exception("focus dial adjustment failed")

    def on_turn(chip, gpio, level, tick) -> None:
        nonlocal last_state, transition_total
        state = (lgpio.gpio_read(handle, clk_pin) << 1) | lgpio.gpio_read(
            handle, dt_pin
        )
        with lock:
            delta = _TRANSITIONS.get((last_state, state), 0)
            last_state = state
            if not delta:
                return
            transition_total += delta
            if abs(transition_total) < 4:
                return
            amount = 1 if transition_total > 0 else -1
            transition_total = 0
        move_focus(amount * direction)

    def on_switch(chip, gpio, level, tick) -> None:
        nonlocal last_switch_at
        # A press alternates AF and manual. The focus model freezes the live
        # AF position when entering manual, so this never causes a lens jump.
        now = time.monotonic()
        with lock:
            if now - last_switch_at < SWITCH_DEBOUNCE_S:
                return
            last_switch_at = now
        try:
            if not camera.focus_available():
                return
            mode = camera.get_focus().get("af_mode")
            next_mode = "manual" if mode == "continuous" else "continuous"
            camera.set_focus({"af_mode": next_mode})
        except Exception:
            logger.exception("focus dial button failed")

    logger.info(
        "focus dial enabled (CLK GPIO%d, DT GPIO%d, SW GPIO%d, %.2f dioptres/detent)",
        clk_pin,
        dt_pin,
        switch_pin,
        step,
    )
    return (
        lgpio.callback(handle, clk_pin, lgpio.BOTH_EDGES, on_turn),
        lgpio.callback(handle, dt_pin, lgpio.BOTH_EDGES, on_turn),
        lgpio.callback(handle, switch_pin, lgpio.FALLING_EDGE, on_switch),
    )
