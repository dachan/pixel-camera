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


class BaseCamera(abc.ABC):
    """Interface shared by the mock and real cameras."""

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


class MockCamera(BaseCamera):
    """Synthesizes JPEG frames with Pillow so the dev stream is visibly live.

    Each frame draws a moving circle (position driven by wall-clock time) plus a
    live timestamp, so it is obvious the feed is a real stream and not a frozen
    image.
    """

    WIDTH = 1280
    HEIGHT = 720
    FPS = 10

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

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80)
        return buf.getvalue()

    def stream(self):
        interval = 1.0 / self.FPS
        while True:
            start = time.time()
            yield self._render_frame()
            elapsed = time.time() - start
            if elapsed < interval:
                time.sleep(interval - elapsed)

    def capture(self, path: str) -> None:
        with open(path, "wb") as f:
            f.write(self._render_frame())

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
        return _jsonable(
            {
                "ExposureTime": int(8000 + wobble * 12000),
                "AnalogueGain": round(1.0 + wobble * 3.0, 3),
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

        self._output = self.StreamingOutput()
        self._picam2.start_recording(MJPEGEncoder(), FileOutput(self._output))

    def stream(self):
        while True:
            with self._output.condition:
                self._output.condition.wait()
                frame = self._output.frame
            if frame is not None:
                yield frame

    def capture(self, path: str) -> None:
        # Still capture using a separate request; works while recording.
        request = self._picam2.capture_request()
        try:
            request.save("main", path)
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


def get_camera() -> BaseCamera:
    """Factory: ``CAMERA=real`` -> RealCamera, anything else -> MockCamera."""
    if os.environ.get("CAMERA") == "real":
        return RealCamera()
    return MockCamera()
