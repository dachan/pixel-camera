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

from settings_store import SettingsStore


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


# Rotation (degrees clockwise) -> EXIF/TIFF Orientation tag value. Raw DNG data
# is stored in native sensor orientation (rotating the Bayer grid would corrupt
# the colour mosaic); instead the Orientation tag tells raw editors how to show
# it, matching the rotation baked into the JPEG.
_EXIF_ORIENTATION = {0: 1, 90: 6, 180: 3, 270: 8}


def _set_dng_orientation(path: str, rotation: int) -> bool:
    """Patch the Orientation tag of a DNG (TIFF) in place. Best-effort.

    Rewrites the existing IFD0 Orientation tag (0x0112) value rather than adding
    a tag, so the file isn't restructured. Returns True if it was set.
    """
    import struct

    orientation = _EXIF_ORIENTATION.get(int(rotation) % 360)
    if orientation is None:
        return False
    try:
        with open(path, "r+b") as f:
            header = f.read(8)
            if len(header) < 8:
                return False
            if header[:2] == b"II":
                bo = "<"
            elif header[:2] == b"MM":
                bo = ">"
            else:
                return False
            if struct.unpack(bo + "H", header[2:4])[0] != 42:  # standard TIFF
                return False
            ifd_off = struct.unpack(bo + "I", header[4:8])[0]
            f.seek(ifd_off)
            n = struct.unpack(bo + "H", f.read(2))[0]
            for i in range(n):
                entry_off = ifd_off + 2 + i * 12
                f.seek(entry_off)
                tag = struct.unpack(bo + "H", f.read(2))[0]
                if tag == 0x0112:  # Orientation (SHORT, stored inline)
                    f.seek(entry_off + 8)
                    f.write(struct.pack(bo + "H", orientation))
                    return True
    except Exception:
        pass
    return False


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
    # JPEG quality bounds for saved captures.
    QUALITY_MIN = 1
    QUALITY_MAX = 100
    # Capture formats: "jpeg" (only), "raw+jpeg" (DNG + JPEG), "raw" (DNG only).
    FORMATS = ("jpeg", "raw+jpeg", "raw")

    def __init__(self):
        # Rotation (degrees clockwise) applied to captured stills.
        self._rotation = 0
        # JPEG quality (1..100) for saved captures.
        self._quality = 100
        # Capture format (one of FORMATS).
        self._format = "raw+jpeg"
        # Settings persistence (see settings_store.py).
        self._store = SettingsStore()
        # Suppress saving while restoring (applying loaded values back).
        self._restoring = False

    def get_orientation(self) -> dict:
        """Return the current capture orientation: ``{"rotation": int}``."""
        return {"rotation": self._rotation}

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
        self._save_settings()
        return self.get_orientation()

    def get_quality(self) -> dict:
        """Return the current capture JPEG quality: ``{"quality": int}``."""
        return {"quality": self._quality}

    def set_quality(self, settings: dict) -> dict:
        """Set capture JPEG quality (``QUALITY_MIN``..``QUALITY_MAX``)."""
        quality = settings.get("quality")
        if quality is not None:
            quality = int(quality)
            if not self.QUALITY_MIN <= quality <= self.QUALITY_MAX:
                raise ValueError(
                    f"quality must be {self.QUALITY_MIN}..{self.QUALITY_MAX}, "
                    f"got {quality}"
                )
            self._quality = quality
        self._save_settings()
        return self.get_quality()

    def get_format(self) -> dict:
        """Return the current capture format: ``{"format": str}``."""
        return {"format": self._format}

    def set_format(self, settings: dict) -> dict:
        """Set the capture format (one of :attr:`FORMATS`)."""
        fmt = settings.get("format")
        if fmt is not None:
            if fmt not in self.FORMATS:
                raise ValueError(
                    f"format must be one of {self.FORMATS}, got {fmt!r}"
                )
            self._format = fmt
        self._save_settings()
        return self.get_format()

    # --- Persistence -------------------------------------------------------- #

    def _settings_snapshot(self) -> dict:
        """Current persistable settings."""
        snap = {
            "rotation": self._rotation,
            "quality": self._quality,
            "format": self._format,
        }
        try:
            snap["controls"] = self.controls_state()
        except Exception:
            pass
        return snap

    def _save_settings(self) -> None:
        """Persist settings to disk (best-effort; skipped while restoring)."""
        if self._restoring:
            return
        self._store.save(self._settings_snapshot())

    def restore_settings(self) -> None:
        """Load persisted settings and apply them. Call once the camera is ready."""
        data = self._store.load()
        if not data:
            return
        self._restoring = True
        try:
            # Each setting restores independently: one bad/stale value (e.g.
            # from an older schema) must not block the rest.
            for key, apply in (
                ("rotation", lambda v: self.set_orientation({"rotation": v})),
                ("quality", lambda v: self.set_quality({"quality": v})),
                ("format", lambda v: self.set_format({"format": v})),
                ("controls", self.set_controls),
            ):
                if key not in data:
                    continue
                try:
                    apply(data[key])
                except Exception:
                    pass
        finally:
            self._restoring = False

    def _capture_targets(self, path: str):
        """Resolve which files a capture should write for the current format.

        ``path`` is the JPEG path. Returns ``(save_jpeg, jpeg_path, save_raw,
        dng_path)``. The DNG sits next to the JPEG with a ``.dng`` extension.
        """
        fmt = self._format
        dng_path = os.path.splitext(path)[0] + ".dng"
        return (fmt in ("jpeg", "raw+jpeg"), path,
                fmt in ("raw", "raw+jpeg"), dng_path)

    def _rotate_jpeg(self, data: bytes) -> bytes:
        """Apply the current rotation to encoded JPEG ``data``; no-op at 0°.

        Used for preview frames so the stream matches the saved captures.
        """
        if not self._rotation:
            return data
        from PIL import Image

        img = Image.open(io.BytesIO(data))
        # PIL rotates counter-clockwise; negate for clockwise. expand keeps the
        # full frame when the aspect ratio flips (90/270).
        rotated = img.rotate(-self._rotation, expand=True).convert("RGB")
        buf = io.BytesIO()
        rotated.save(buf, format="JPEG", quality=90)
        return buf.getvalue()

    def _save_still_jpeg(self, img, path: str) -> None:
        """Rotate a captured PIL image per current settings and save it.

        The one JPEG-writing path for stills, shared by mock and real capture,
        so rotation handling and quality can never drift between them.
        """
        if self._rotation:
            # PIL rotates counter-clockwise; negate for clockwise.
            img = img.rotate(-self._rotation, expand=True)
        img.convert("RGB").save(path, format="JPEG", quality=self._quality)

    @abc.abstractmethod
    def stream(self):
        """Yield raw JPEG bytes (one complete frame per iteration)."""
        raise NotImplementedError

    @abc.abstractmethod
    def capture(self, path: str) -> dict:
        """Capture a still, writing files per the current format.

        ``path`` is the JPEG path; a raw capture writes a sibling ``.dng``.
        Returns ``{"files": [basenames...], "preview": <jpeg basename or None>}``
        — ``preview`` is what the gallery can display (None for raw-only).
        """
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
        self._auto_exposure = True
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
        self._save_settings()
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

    def capture(self, path: str) -> dict:
        from PIL import Image

        save_jpeg, jpeg_path, save_raw, dng_path = self._capture_targets(path)
        files = []
        preview = None

        frame = self._render_frame()
        if save_jpeg:
            self._save_still_jpeg(Image.open(io.BytesIO(frame)), jpeg_path)
            files.append(os.path.basename(jpeg_path))
            preview = os.path.basename(jpeg_path)
        if save_raw:
            # No real sensor off-Pi — write the synthesized frame as a stand-in
            # so the format toggle and file flow are testable in dev. On the Pi,
            # RealCamera writes a genuine DNG.
            with open(dng_path, "wb") as f:
                f.write(frame)
            files.append(os.path.basename(dng_path))
        return {"files": files, "preview": preview}

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
        self._camera_lock = threading.RLock()

        video_config = self._picam2.create_video_configuration(
            main={"size": (self.WIDTH, self.HEIGHT)}
        )
        self._picam2.configure(video_config)

        # Full-sensor still configuration for high-resolution captures. The
        # streaming/main config above is only 1280x720; captures briefly switch
        # to this (defaults to the sensor's maximum resolution) instead. The
        # raw stream is included so DNG (raw) captures are available on demand.
        self._still_config = self._picam2.create_still_configuration(raw={})

        self._output = self.StreamingOutput()
        self._encoder = MJPEGEncoder()
        self._file_output = FileOutput(self._output)
        self._picam2.start_recording(self._encoder, self._file_output)

        # Exposure state echoed back to clients (defaults: auto). Apply without
        # persisting — restore_settings() (called after construction) loads any
        # saved values and would otherwise be clobbered by these defaults.
        self._state = {"auto_exposure": True, "iso": 100, "shutter_us": 10000}
        self._restoring = True
        try:
            self.set_controls(self._state)
        finally:
            self._restoring = False

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

    def capture(self, path: str) -> dict:
        save_jpeg, jpeg_path, save_raw, dng_path = self._capture_targets(path)
        files = []
        preview = None
        # switch_mode_and_capture_request deadlocks if MJPEG recording is still
        # active — stop the encoder first, capture, then resume the stream.
        with self._camera_lock:
            self._picam2.stop_recording()
            try:
                request = self._picam2.switch_mode_and_capture_request(
                    self._still_config
                )
                try:
                    if save_jpeg:
                        self._save_still_jpeg(request.make_image("main"), jpeg_path)
                        files.append(os.path.basename(jpeg_path))
                        preview = os.path.basename(jpeg_path)
                    if save_raw:
                        # Raw Bayer data straight from the sensor — stored in
                        # native orientation (rotating the mosaic would corrupt
                        # colour); rotation is recorded as the DNG Orientation
                        # tag so raw editors display it like the JPEG.
                        request.save_dng(dng_path)
                        _set_dng_orientation(dng_path, self._rotation)
                        files.append(os.path.basename(dng_path))
                finally:
                    request.release()
            finally:
                self._picam2.start_recording(self._encoder, self._file_output)
        return {"files": files, "preview": preview}

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
        with self._camera_lock:
            return _jsonable(dict(self._picam2.capture_metadata()))

    def set_controls(self, settings: dict) -> dict:
        if settings.get("auto_exposure") is not None:
            self._state["auto_exposure"] = bool(settings["auto_exposure"])
        if settings.get("iso") is not None:
            self._state["iso"] = max(100, int(settings["iso"]))
        if settings.get("shutter_us") is not None:
            self._state["shutter_us"] = max(1, int(settings["shutter_us"]))

        with self._camera_lock:
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
        self._save_settings()
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
    """Factory: ``CAMERA=real`` -> RealCamera, anything else -> MockCamera.

    Restores persisted settings so the camera comes up with the last-used
    rotation/quality/format/exposure after a restart or reboot.
    """
    camera = RealCamera() if os.environ.get("CAMERA") == "real" else MockCamera()
    camera.restore_settings()
    return camera
