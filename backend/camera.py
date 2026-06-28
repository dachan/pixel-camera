"""Camera abstraction.

A single ``BaseCamera`` interface with two implementations selected at runtime
by :func:`get_camera`, keyed on the ``CAMERA`` env var:

    CAMERA=real  -> RealCamera   (Raspberry Pi, picamera2)
    otherwise    -> MockCamera   (Mac dev, Pillow-synthesized frames)

IMPORTANT: ``picamera2`` is imported lazily inside ``RealCamera.__init__`` and is
NOT a declared dependency (requirements.txt). On the Pi it comes from apt
(python3-picamera2) via a venv created with --system-site-packages. Keeping the
import out of module scope is what lets this module import cleanly on the Mac.
"""

from __future__ import annotations

import abc
import io
import math
import os
import threading
import time
from datetime import datetime


def _shutter_label(us: int) -> str:
    """Human shutter label, e.g. 10000 -> '1/100s', 500000 -> '0.5s'."""
    if us <= 0:
        return "0s"
    if us >= 1_000_000:
        return f"{us / 1_000_000:.1f}s"
    return f"1/{round(1_000_000 / us)}s"


def _jsonable(value):
    """Recursively coerce camera data into JSON-serializable primitives.

    libcamera/picamera2 return tuples, numpy scalars, enums and the like; this
    flattens them so they can go straight out as JSON. Unknown types fall back
    to ``str()`` rather than raising.
    """
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    # numpy scalars expose .item(); enums expose .value.
    item = getattr(value, "item", None)
    if callable(item):
        try:
            return _jsonable(item())
        except Exception:
            pass
    if hasattr(value, "value") and not callable(value.value):
        return _jsonable(value.value)
    return str(value)


def _live_exposure_from_metadata(meta: dict) -> tuple[int | None, int | None]:
    """Map frame metadata to ``(iso, shutter_us)`` for auto-exposure display."""
    iso = shutter = None
    gain = meta.get("AnalogueGain")
    if gain is not None:
        iso = max(100, int(round(float(gain) * 100)))
    exposure = meta.get("ExposureTime")
    if exposure is not None:
        shutter = max(1, int(exposure))
    return iso, shutter

class BaseCamera(abc.ABC):
    """Interface shared by the mock and real cameras."""

    # Allowed capture rotations, in degrees clockwise.
    ROTATIONS = (0, 90, 180, 270)

    def __init__(self):
        # Rotation (degrees clockwise) applied to captured stills.
        self._rotation = 0

    def get_orientation(self) -> dict:
        """Return the current capture orientation: ``{"rotation": int}``."""
        return {"rotation": getattr(self, "_rotation", 0)}

    def set_orientation(self, settings: dict) -> dict:
        """Set capture rotation (degrees clockwise; one of :attr:`ROTATIONS`)."""
        rotation = settings.get("rotation")
        if rotation is not None:
            rotation = int(rotation) % 360
            if rotation not in self.ROTATIONS:
                raise ValueError(
                    f"rotation must be one of {self.ROTATIONS}, got {rotation}"
                )
            self._rotation = rotation
        return self.get_orientation()

    def _rotate_jpeg(self, data: bytes) -> bytes:
        """Apply the current rotation to encoded JPEG ``data``; no-op at 0°.

        Used for both preview frames and captured stills so the saved image
        matches what the live preview shows.
        """
        rotation = getattr(self, "_rotation", 0)
        if not rotation:
            return data
        from PIL import Image

        img = Image.open(io.BytesIO(data))
        # PIL rotates counter-clockwise; negate for clockwise. expand keeps the
        # full frame when the aspect ratio flips (90/270).
        rotated = img.rotate(-rotation, expand=True).convert("RGB")
        buf = io.BytesIO()
        rotated.save(buf, format="JPEG", quality=90)
        return buf.getvalue()

    @abc.abstractmethod
    def stream(self):
        """Yield raw JPEG bytes (one complete frame per iteration)."""
        raise NotImplementedError

    @abc.abstractmethod
    def capture(self, path: str) -> None:
        """Capture a single still and write it to ``path`` as JPEG."""
        raise NotImplementedError

    @abc.abstractmethod
    def info(self) -> dict:
        """Return static camera info: ``{"properties": {...}, "controls": {...}}``.

        ``controls`` maps each adjustable control name to
        ``{"min": ..., "max": ..., "default": ...}``.
        """
        raise NotImplementedError

    @abc.abstractmethod
    def metadata(self) -> dict:
        """Return the current per-frame metadata as a flat dict."""
        raise NotImplementedError

    @abc.abstractmethod
    def set_controls(self, settings: dict) -> dict:
        """Apply exposure settings to the live camera; return the new state.

        Accepted keys (all optional): ``auto_exposure`` (bool), ``iso`` (int,
        mapped to analogue gain = iso/100), ``shutter_us`` (int, ExposureTime in
        microseconds). Aperture is intentionally absent — Pi cameras have no
        software-controllable aperture.
        """
        raise NotImplementedError

    @abc.abstractmethod
    def controls_state(self) -> dict:
        """Return the current ``{auto_exposure, iso, shutter_us}`` state."""
        raise NotImplementedError


class MockCamera(BaseCamera):
    """Synthesizes JPEG frames with Pillow so the dev stream is visibly live.

    Each frame draws a moving circle (position driven by wall-clock time) plus a
    live timestamp, so it is obvious the feed is a real stream and not a frozen
    image.
    """

    WIDTH = 1280
    HEIGHT = 720
    FPS = 10

    def __init__(self):
        super().__init__()
        # Exposure state, mirrored from set_controls so the UI is testable.
        self._auto_exposure = False
        self._exposure_us = 10000   # 1/100 s
        self._gain = 1.0            # ISO 100

    def _render_frame(self):
        from PIL import Image, ImageDraw

        img = Image.new("RGB", (self.WIDTH, self.HEIGHT), (18, 18, 24))
        draw = ImageDraw.Draw(img)

        # Moving circle: travels horizontally on a sine-driven vertical path.
        t = time.time()
        x = int((math.sin(t * 0.9) * 0.5 + 0.5) * (self.WIDTH - 120) + 60)
        y = int((math.sin(t * 1.7) * 0.5 + 0.5) * (self.HEIGHT - 120) + 60)
        r = 48
        draw.ellipse((x - r, y - r, x + r, y + r), fill=(80, 200, 255))

        # Live timestamp so a frozen frame is immediately obvious.
        stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        draw.text((20, 20), f"MOCK CAMERA  {stamp}", fill=(240, 240, 240))

        # Overlay current exposure settings so control changes are visible.
        st = self.controls_state()
        mode = "AUTO" if st["auto_exposure"] else "MANUAL"
        draw.text(
            (20, 40),
            f"{mode}  ISO {st['iso']}  {_shutter_label(st['shutter_us'])}",
            fill=(120, 230, 160),
        )

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80)
        return buf.getvalue()

    def set_controls(self, settings: dict) -> dict:
        if settings.get("auto_exposure") is not None:
            self._auto_exposure = bool(settings["auto_exposure"])
        if settings.get("shutter_us") is not None:
            self._exposure_us = max(1, int(settings["shutter_us"]))
        if settings.get("iso") is not None:
            self._gain = max(1.0, float(settings["iso"]) / 100.0)
        return self.controls_state()

    def controls_state(self) -> dict:
        state = {
            "auto_exposure": self._auto_exposure,
            "iso": int(round(self._gain * 100)),
            "shutter_us": self._exposure_us,
        }
        if self._auto_exposure:
            iso, shutter = _live_exposure_from_metadata(self.metadata())
            if iso is not None:
                state["iso"] = iso
            if shutter is not None:
                state["shutter_us"] = shutter
        return state

    def stream(self):
        interval = 1.0 / self.FPS
        while True:
            start = time.time()
            yield self._rotate_jpeg(self._render_frame())
            elapsed = time.time() - start
            if elapsed < interval:
                time.sleep(interval - elapsed)

    def capture(self, path: str) -> None:
        with open(path, "wb") as f:
            f.write(self._rotate_jpeg(self._render_frame()))

    def info(self) -> dict:
        # A representative slice of what a real Pi sensor reports, so the UI can
        # be built and verified on the Mac without hardware.
        return {
            "properties": {
                "Model": "mock-imx-sim",
                "PixelArraySize": [self.WIDTH, self.HEIGHT],
                "PixelArrayActiveAreas": [[0, 0, self.WIDTH, self.HEIGHT]],
                "ColorFilterArrangement": "RGGB",
                "Rotation": 0,
                "Location": 2,
                "ScalerCropMaximum": [0, 0, self.WIDTH, self.HEIGHT],
                "SystemDevices": ["/dev/mock-video0"],
            },
            "controls": {
                "ExposureTime": {"min": 14, "max": 11767556, "default": None},
                "AnalogueGain": {"min": 1.0, "max": 16.0, "default": None},
                "ExposureValue": {"min": -8.0, "max": 8.0, "default": 0.0},
                "Brightness": {"min": -1.0, "max": 1.0, "default": 0.0},
                "Contrast": {"min": 0.0, "max": 32.0, "default": 1.0},
                "Saturation": {"min": 0.0, "max": 32.0, "default": 1.0},
                "Sharpness": {"min": 0.0, "max": 16.0, "default": 1.0},
                "AeEnable": {"min": False, "max": True, "default": True},
                "AwbEnable": {"min": False, "max": True, "default": True},
                "FrameDurationLimits": {"min": 33333, "max": 120000, "default": None},
            },
        }

    def metadata(self) -> dict:
        # Live values: a few oscillate with time so the UI visibly updates.
        t = time.time()
        wobble = math.sin(t * 0.7) * 0.5 + 0.5  # 0..1
        # In manual mode, report the set exposure/gain instead of the wobble.
        if self._auto_exposure:
            exposure = int(8000 + wobble * 12000)
            gain = round(1.0 + wobble * 3.0, 3)
        else:
            exposure = self._exposure_us
            gain = round(self._gain, 3)
        return _jsonable(
            {
                "ExposureTime": exposure,
                "AnalogueGain": gain,
                "DigitalGain": 1.0,
                "Lux": round(120 + wobble * 380, 1),
                "ColourTemperature": int(4200 + wobble * 1600),
                "ColourGains": [round(1.4 + wobble * 0.6, 3), round(2.6 - wobble * 0.4, 3)],
                "FocusFoM": int(2000 + wobble * 4000),
                "FrameDuration": 33333,
                "SensorTemperature": round(38.0 + wobble * 4.0, 1),
                "SensorTimestamp": int(t * 1e9),
                "AeLocked": wobble > 0.5,
            }
        )


class RealCamera(BaseCamera):
    """Raspberry Pi camera via picamera2.

    Streams MJPEG through a :class:`StreamingOutput` (an ``io.BufferedIOBase``
    guarded by a ``threading.Condition``) fed by picamera2's ``MJPEGEncoder``.
    """

    WIDTH = 1280
    HEIGHT = 720

    class StreamingOutput(io.BufferedIOBase):
        """Receives encoded JPEG frames from the MJPEGEncoder file output."""

        def __init__(self):
            self.frame = None
            self.condition = threading.Condition()

        def write(self, buf):
            with self.condition:
                self.frame = buf
                self.condition.notify_all()
            return len(buf)

    def __init__(self):
        super().__init__()
        # Lazy, Pi-only imports — never at module scope (see module docstring).
        from picamera2 import Picamera2
        from picamera2.encoders import MJPEGEncoder
        from picamera2.outputs import FileOutput

        self._Picamera2 = Picamera2
        self._picam2 = Picamera2()

        video_config = self._picam2.create_video_configuration(
            main={"size": (self.WIDTH, self.HEIGHT)}
        )
        self._picam2.configure(video_config)

        # Full-sensor still configuration for high-resolution captures. The
        # streaming/main config above is only 1280x720; captures briefly switch
        # to this (defaults to the sensor's maximum resolution) instead.
        self._still_config = self._picam2.create_still_configuration()

        self._output = self.StreamingOutput()
        self._picam2.start_recording(MJPEGEncoder(), FileOutput(self._output))

        # Exposure state echoed back to clients (defaults: manual).
        self._state = {"auto_exposure": False, "iso": 100, "shutter_us": 10000}
        self.set_controls(self._state)

    def stream(self):
        while True:
            with self._output.condition:
                self._output.condition.wait()
                frame = self._output.frame
            if frame is not None:
                # Rotate to match the configured sensor rotation. At 0° this is
                # a no-op pass-through (no re-encode), so there is no overhead
                # unless a rotation is actually selected.
                yield self._rotate_jpeg(frame)

    def capture(self, path: str) -> None:
        # Full-resolution still: briefly switch to the full-sensor still
        # configuration, capture, then the camera returns to the streaming
        # config. The live preview pauses for the capture and resumes after.
        request = self._picam2.switch_mode_and_capture_request(self._still_config)
        try:
            img = request.make_image("main")
            rotation = getattr(self, "_rotation", 0)
            if rotation:
                # PIL rotates counter-clockwise; negate for clockwise.
                img = img.rotate(-rotation, expand=True)
            img.convert("RGB").save(path, format="JPEG", quality=95)
        finally:
            request.release()

    def info(self) -> dict:
        # camera_controls maps name -> (min, max, default).
        controls = {}
        for name, vals in self._picam2.camera_controls.items():
            try:
                cmin, cmax, cdefault = vals
            except (TypeError, ValueError):
                cmin = cmax = cdefault = None
            controls[str(name)] = {
                "min": _jsonable(cmin),
                "max": _jsonable(cmax),
                "default": _jsonable(cdefault),
            }
        return {
            "properties": _jsonable(dict(self._picam2.camera_properties)),
            "controls": controls,
        }

    def metadata(self) -> dict:
        return _jsonable(dict(self._picam2.capture_metadata()))

    def set_controls(self, settings: dict) -> dict:
        if settings.get("auto_exposure") is not None:
            self._state["auto_exposure"] = bool(settings["auto_exposure"])
        if settings.get("iso") is not None:
            self._state["iso"] = max(100, int(settings["iso"]))
        if settings.get("shutter_us") is not None:
            self._state["shutter_us"] = max(1, int(settings["shutter_us"]))

        if self._state["auto_exposure"]:
            # Hand exposure back to the auto-exposure algorithm.
            self._picam2.set_controls({"AeEnable": True})
        else:
            # Manual: disable AE and pin gain (ISO/100) + exposure time.
            self._picam2.set_controls(
                {
                    "AeEnable": False,
                    "AnalogueGain": self._state["iso"] / 100.0,
                    "ExposureTime": self._state["shutter_us"],
                }
            )
        return self.controls_state()

    def controls_state(self) -> dict:
        state = dict(self._state)
        if state["auto_exposure"]:
            iso, shutter = _live_exposure_from_metadata(self.metadata())
            if iso is not None:
                state["iso"] = iso
            if shutter is not None:
                state["shutter_us"] = shutter
        return state


def get_camera() -> BaseCamera:
    """Factory: ``CAMERA=real`` -> RealCamera, anything else -> MockCamera."""
    if os.environ.get("CAMERA") == "real":
        return RealCamera()
    return MockCamera()
