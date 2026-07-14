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


# libcamera AwbModeEnum values, keyed by the API's white-balance mode names.
# ("manual" is not an AwbMode — it's AwbEnable=False plus explicit ColourGains.)
_AWB_MODE_IDS = {
    "auto": 0,
    "incandescent": 1,
    "tungsten": 2,
    "fluorescent": 3,
    "indoor": 4,
    "daylight": 5,
    "cloudy": 6,
}

# libcamera AfModeEnum values.
_AF_MANUAL = 0
_AF_CONTINUOUS = 2

# libcamera AfMeteringEnum values.
_AF_METERING_AUTO = 0
_AF_METERING_WINDOWS = 1

# libcamera AfRangeEnum values. "Normal" (the hardware default we'd otherwise
# get by never setting this) trades away the extremes of the lens travel for
# faster/more stable convergence on typical shots — on this sensor that means
# continuous AF can under-shoot true infinity on distant scenes. "Full" is a
# strict superset (searches the complete lens range, including infinity),
# so there's no downside to always using it.
_AF_RANGE_FULL = 2


def _unrotate_point(x: float, y: float, rotation: int) -> tuple[float, float]:
    """Map a normalized point in the rotated (displayed) frame back to native
    sensor orientation — the inverse of the clockwise rotation baked into
    preview frames, since AF windows are expressed in sensor coordinates.
    """
    if rotation == 90:
        return (y, 1.0 - x)
    if rotation == 180:
        return (1.0 - x, 1.0 - y)
    if rotation == 270:
        return (1.0 - y, x)
    return (x, y)

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
    # Autofocus modes ("auto" one-shot is deliberately not exposed — on a
    # kiosk, continuous or a manual lens position covers everything).
    AF_MODES = ("continuous", "manual")
    # White-balance modes: libcamera AWB presets plus "manual" colour gains.
    WB_MODES = ("auto", "incandescent", "tungsten", "fluorescent", "indoor",
                "daylight", "cloudy", "manual")
    # Colour gain bounds (hardware allows up to 32; anything much past 8 is
    # just noise amplification, but the API accepts the full range).
    GAIN_MIN = 0.1
    GAIN_MAX = 32.0
    # Colour tunings: "default" = the sensor's own tuning file; "standard" =
    # the non-NoIR variant, whose colour-temperature AWB makes WB presets
    # meaningful on a NoIR sensor (only offered there — see tuning_available).
    TUNINGS = ("default", "standard")
    # Live-preview framerate cap. The Pi 5 has no hardware video encoder, so
    # MJPEG-encoding the preview is pure CPU work that scales with fps — 24fps
    # is smooth enough for a viewfinder while capping that cost; dropped
    # further to PREVIEW_FPS_THROTTLED while thermally throttled.
    PREVIEW_FPS_NORMAL = 24
    PREVIEW_FPS_THROTTLED = 15

    def __init__(self):
        # Rotation (degrees clockwise) applied to captured stills.
        self._rotation = 0
        # JPEG quality (1..100) for saved captures.
        self._quality = 100
        # Capture format (one of FORMATS).
        self._format = "raw+jpeg"
        # Exposure intent: auto, or manual ISO + shutter. Like focus/WB below,
        # this holds the last-set manual values even while in auto, so they
        # survive a restart (see _settings_snapshot).
        self._controls = {"auto_exposure": True, "iso": 100, "shutter_us": 10000}
        # Focus intent (only meaningful when focus_available()).
        self._focus = {"af_mode": "continuous", "lens_position": 1.0}
        # Tap-to-focus point in native sensor coords (None = whole scene).
        self._af_point: tuple[float, float] | None = None
        # White-balance intent; gains only drive the sensor in "manual".
        self._wb = {"mode": "auto", "red_gain": 2.0, "blue_gain": 2.0}
        # Colour tuning (one of TUNINGS); real cameras load it at open time.
        self._tuning = "default"
        # Whether the thermal monitor may throttle at all (user setting).
        # The throttle itself is a CPU-frequency cap (thermal.py) plus a
        # preview-framerate cap (set_preview_throttled below).
        self._throttle_enabled = True
        # Current preview-framerate-throttle state, so it can be re-applied
        # after anything that rebuilds the camera pipeline (e.g. a tuning
        # switch). No-op on cameras that don't override set_preview_throttled.
        self._preview_throttled = False
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

    # --- Focus ---------------------------------------------------------------- #
    # State + validation live here; pushing values into the sensor is the
    # subclass hook _apply_focus(). Cameras without a focus motor (e.g. the HQ
    # camera) override focus_available().

    def focus_available(self) -> bool:
        """Whether this camera has a controllable focus (lens motor)."""
        return True

    def _lens_range(self) -> tuple[float, float]:
        """(min, max) LensPosition in dioptres; 0 = infinity, higher = closer."""
        return (0.0, 10.0)

    def _apply_focus(self) -> None:
        """Push self._focus into the sensor. No-op for the mock."""

    def get_focus(self) -> dict:
        """Focus state: ``{available, af_mode, lens_position, min, max}``.

        In continuous mode ``lens_position`` is the live value the AF
        algorithm chose (from frame metadata), not the stored manual one.
        """
        if not self.focus_available():
            return {"available": False}
        lo, hi = self._lens_range()
        state = {"available": True, "min": lo, "max": hi, **self._focus}
        if self._focus["af_mode"] == "continuous":
            live = self.metadata().get("LensPosition")
            if live is not None:
                state["lens_position"] = round(float(live), 2)
        return state

    def set_focus(self, settings: dict) -> dict:
        """Set ``af_mode`` (continuous|manual) and/or ``lens_position``."""
        if not self.focus_available():
            raise ValueError("this camera has no focus control")
        mode = settings.get("af_mode")
        position = settings.get("lens_position")
        if mode is not None:
            if mode not in self.AF_MODES:
                raise ValueError(
                    f"af_mode must be one of {self.AF_MODES}, got {mode!r}"
                )
            if (
                mode == "manual"
                and self._focus["af_mode"] == "continuous"
                and position is None
            ):
                # Freeze focus where continuous AF currently has the lens,
                # instead of jumping to a stale stored manual position.
                live = self.metadata().get("LensPosition")
                if live is not None:
                    position = float(live)
            self._focus["af_mode"] = mode
        if position is not None:
            lo, hi = self._lens_range()
            self._focus["lens_position"] = min(hi, max(lo, float(position)))
        # Any explicit mode/position change drops a previous tap-to-focus
        # window: continuous goes back to whole-scene metering.
        self._af_point = None
        self._apply_focus()
        self._save_settings()
        return self.get_focus()

    def _apply_focus_point(self, x: float, y: float) -> None:
        """Push a tap-to-focus window into the sensor. No-op for the mock."""

    def set_focus_point(self, point: dict) -> dict:
        """Focus on a spot: ``{x, y}`` normalized 0..1 in the displayed frame.

        Steers continuous AF to a window around the tap (switching to
        continuous if the camera was in manual, like phone camera apps).
        The preview is rotated server-side, so the tap is mapped back to
        native sensor orientation first.
        """
        if not self.focus_available():
            raise ValueError("this camera has no focus control")
        try:
            x, y = float(point["x"]), float(point["y"])
        except (KeyError, TypeError, ValueError):
            raise ValueError("x and y (normalized 0..1) are required")
        if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
            raise ValueError(f"x and y must be within 0..1, got ({x}, {y})")
        x, y = _unrotate_point(x, y, self._rotation)
        self._focus["af_mode"] = "continuous"
        self._af_point = (x, y)
        self._apply_focus_point(x, y)
        return self.get_focus()

    # --- White balance ---------------------------------------------------------- #

    def _apply_white_balance(self) -> None:
        """Push self._wb into the sensor. No-op for the mock."""

    def wb_presets_supported(self) -> bool:
        """Whether AwbMode presets actually do anything on this camera.

        NoIR sensors ship a "greyworld" AWB tuning without colour-temperature
        curves, so every preset behaves identically to auto — the UI hides
        them and offers only auto/manual.
        """
        return True

    def get_white_balance(self) -> dict:
        """WB state: ``{mode, red_gain, blue_gain, presets_supported}``.

        Outside "manual", the gains are the live values AWB chose (from frame
        metadata) — handy as a starting point when switching to manual.
        """
        state = dict(self._wb)
        state["presets_supported"] = self.wb_presets_supported()
        if self._wb["mode"] != "manual":
            gains = self.metadata().get("ColourGains")
            if isinstance(gains, (list, tuple)) and len(gains) == 2:
                state["red_gain"] = round(float(gains[0]), 2)
                state["blue_gain"] = round(float(gains[1]), 2)
        return state

    def set_white_balance(self, settings: dict) -> dict:
        """Set ``mode`` (one of :attr:`WB_MODES`) and/or manual gains."""
        mode = settings.get("mode")
        if mode is not None:
            if mode not in self.WB_MODES:
                raise ValueError(
                    f"mode must be one of {self.WB_MODES}, got {mode!r}"
                )
            self._wb["mode"] = mode
        for key in ("red_gain", "blue_gain"):
            value = settings.get(key)
            if value is not None:
                self._wb[key] = min(self.GAIN_MAX, max(self.GAIN_MIN, float(value)))
        self._apply_white_balance()
        self._save_settings()
        return self.get_white_balance()

    # --- Thermal throttling ------------------------------------------------------ #
    # on/off preference here; the CPU-frequency cap lives in thermal.py, the
    # preview-framerate cap below — the ThermalMonitor (camera_service) drives
    # both together.

    def get_throttle_enabled(self) -> bool:
        return self._throttle_enabled

    def set_throttle_enabled(self, enabled) -> None:
        """Persist the user's thermal-throttling on/off choice."""
        self._throttle_enabled = bool(enabled)
        self._save_settings()

    def set_preview_throttled(self, throttled: bool) -> None:
        """Cap (or restore) the live preview framerate for thermal management.

        No-op unless overridden — the mock stream has no real encode cost to
        manage, so it just remembers the state for consistency.
        """
        self._preview_throttled = bool(throttled)

    # --- Colour tuning ---------------------------------------------------------- #

    def tuning_available(self) -> bool:
        """Whether a "standard" tuning alternative exists for this camera.

        Only NoIR sensors have one (the filtered variant's tuning file);
        a regular camera is already on it.
        """
        return False

    def _apply_tuning(self) -> None:
        """Make self._tuning take effect. Real cameras rebuild the pipeline."""

    def get_tuning(self) -> dict:
        return {"tuning": self._tuning, "available": self.tuning_available()}

    def set_tuning(self, settings: dict) -> dict:
        """Set the colour tuning (one of :attr:`TUNINGS`).

        On a real camera this tears down and reopens the pipeline (a few
        seconds); a no-op when the value is unchanged, so restoring persisted
        settings at boot doesn't rebuild a camera that opened with them.
        """
        tuning = settings.get("tuning")
        if tuning is not None and tuning != self._tuning:
            if tuning not in self.TUNINGS:
                raise ValueError(
                    f"tuning must be one of {self.TUNINGS}, got {tuning!r}"
                )
            if not self.tuning_available():
                raise ValueError("no alternative tuning for this camera")
            self._tuning = tuning
            self._apply_tuning()
            self._save_settings()
        return self.get_tuning()

    # --- Persistence -------------------------------------------------------- #

    def _settings_snapshot(self) -> dict:
        """Current persistable settings.

        Exposure, focus and white balance persist their *intent* dicts, which
        hold the last-set manual values (ISO/shutter, lens position, colour
        gains) even while in auto/continuous — so the camera comes back
        exactly as it was left, including the last manual settings.
        """
        snap = {
            "rotation": self._rotation,
            "quality": self._quality,
            "format": self._format,
            "tuning": self._tuning,
            "throttle_enabled": self._throttle_enabled,
            "white_balance": dict(self._wb),
            "controls": dict(self._controls),
        }
        if self.focus_available():
            snap["focus"] = dict(self._focus)
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
                ("tuning", lambda v: self.set_tuning({"tuning": v})),
                ("throttle_enabled", self.set_throttle_enabled),
                ("focus", self.set_focus),
                ("white_balance", self.set_white_balance),
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

    def snapshot(self) -> bytes:
        """Return one complete JPEG frame from the live preview.

        Reuses ``stream()`` — and thus its viewer accounting, encoder
        attach/detach, and rotation — but pulls a single fresh frame and
        stops. Backs /api/snapshot.jpg for tools that poll a still image
        (Home Assistant "generic camera", OctoPrint) rather than hold an
        MJPEG connection open. Distinct from ``capture()``, which switches to
        the full-resolution still mode and writes to disk.
        """
        frames = self.stream()
        try:
            return next(frames)
        finally:
            frames.close()

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

    def _apply_controls(self) -> None:
        """Push self._controls into the sensor. No-op for the mock."""

    def set_controls(self, settings: dict) -> dict:
        """Apply exposure settings to the live camera; return the new state.

        Accepted keys (all optional): ``auto_exposure`` (bool), ``iso`` (int,
        mapped to analogue gain = iso/100), ``shutter_us`` (int, ExposureTime in
        microseconds). Aperture is intentionally absent — Pi cameras have no
        software-controllable aperture.
        """
        if settings.get("auto_exposure") is not None:
            self._controls["auto_exposure"] = bool(settings["auto_exposure"])
        if settings.get("iso") is not None:
            self._controls["iso"] = max(100, int(settings["iso"]))
        if settings.get("shutter_us") is not None:
            self._controls["shutter_us"] = max(1, int(settings["shutter_us"]))
        self._apply_controls()
        self._save_settings()
        return self.controls_state()

    def controls_state(self) -> dict:
        """Current ``{auto_exposure, iso, shutter_us}`` state.

        In auto mode ``iso``/``shutter_us`` are the live values the AE
        algorithm chose (from frame metadata), not the stored manual ones.
        """
        state = dict(self._controls)
        if state["auto_exposure"]:
            iso, shutter = _live_exposure_from_metadata(self.metadata())
            if iso is not None:
                state["iso"] = iso
            if shutter is not None:
                state["shutter_us"] = shutter
        return state


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

        # Overlay current exposure/focus/WB settings so control changes are
        # visible in the dev stream.
        st = self.controls_state()
        mode = "AUTO" if st["auto_exposure"] else "MANUAL"
        draw.text(
            (20, 40),
            f"{mode}  ISO {st['iso']}  {_shutter_label(st['shutter_us'])}",
            fill=(120, 230, 160),
        )
        focus = self.get_focus()
        draw.text(
            (20, 60),
            f"AF {self._focus['af_mode'].upper()} {focus['lens_position']:.2f}"
            f"  WB {self._wb['mode'].upper()}",
            fill=(120, 230, 160),
        )

        # Tap-to-focus marker: drawn in native coords pre-rotation, so after
        # the stream is rotated it lands exactly where the user tapped.
        if self._af_point:
            px = int(self._af_point[0] * self.WIDTH)
            py = int(self._af_point[1] * self.HEIGHT)
            r = 40
            draw.rectangle((px - r, py - r, px + r, py + r),
                           outline=(255, 210, 80), width=3)

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80)
        return buf.getvalue()

    def tuning_available(self) -> bool:
        # Pretend to be a NoIR sensor so the Settings toggle and the
        # preset-hiding behavior are both testable off-Pi.
        return True

    def wb_presets_supported(self) -> bool:
        return self._tuning == "standard"

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
                "LensPosition": {"min": 0.0, "max": 10.0, "default": 1.0},
                "AfMode": {"min": 0, "max": 2, "default": 0},
                "ColourGains": {"min": 0.0, "max": 32.0, "default": None},
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
        if self._controls["auto_exposure"]:
            exposure = int(8000 + wobble * 12000)
            gain = round(1.0 + wobble * 3.0, 3)
        else:
            exposure = self._controls["shutter_us"]
            gain = round(self._controls["iso"] / 100.0, 3)
        # Manual WB reports the set gains; otherwise AWB "chooses" a wobble.
        if self._wb["mode"] == "manual":
            colour_gains = [self._wb["red_gain"], self._wb["blue_gain"]]
        else:
            colour_gains = [round(1.4 + wobble * 0.6, 3), round(2.6 - wobble * 0.4, 3)]
        # Continuous AF "hunts" a little; manual holds the set position.
        if self._focus["af_mode"] == "continuous":
            lens_position = round(1.0 + wobble * 2.0, 2)
        else:
            lens_position = self._focus["lens_position"]
        return _jsonable(
            {
                "ExposureTime": exposure,
                "AnalogueGain": gain,
                "DigitalGain": 1.0,
                "Lux": round(120 + wobble * 380, 1),
                "ColourTemperature": int(4200 + wobble * 1600),
                "ColourGains": colour_gains,
                "LensPosition": lens_position,
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
    guarded by a ``threading.Condition``) fed by picamera2's ``JpegEncoder``.

    JpegEncoder (simplejpeg/libjpeg-turbo, multi-threaded) rather than the
    default MJPEGEncoder (which resolves to LibavMjpegEncoder — ffmpeg-based
    — since this platform has no hardware encoder; confirmed via picamera2's
    own _hw_encoder_available check and by enumerating every V4L2 device on
    the board, none of which expose an encoder, only an HEVC *decoder*).
    Measured on this hardware at identical resolution/framerate: ~40% less
    CPU for the same output (34.6% -> 20.6% of a core at 1280x720/24fps).
    """

    WIDTH = 1280
    HEIGHT = 720
    # JPEG quality (0-100) for the live preview only — separate from capture
    # quality (user-controlled, PIL-encoded in _save_still_jpeg). Chosen to
    # look comparable to the previous encoder's output at a glance; easy to
    # retune here if the preview looks noticeably different.
    PREVIEW_JPEG_QUALITY = 80

    class StreamingOutput(io.BufferedIOBase):
        """Receives encoded JPEG frames from the JpegEncoder file output."""

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
        from picamera2.encoders import JpegEncoder
        from picamera2.outputs import FileOutput

        self._Picamera2 = Picamera2
        self._JpegEncoder = JpegEncoder
        self._FileOutput = FileOutput
        self._camera_lock = threading.RLock()
        # MJPEG-encoding the preview is the dominant CPU/heat cost on Pi 5
        # (no hardware video encoder — measured ~43% of a core with it
        # attached vs. ~5% with just the raw camera running), so the encoder
        # is only attached while someone is actually watching. _open_camera
        # always starts the raw camera (needed continuously for metadata,
        # AE/AWB/AF convergence, and instant physical-shutter captures);
        # stream() attaches/detaches it via these two, reference-counted so
        # multiple simultaneous viewers don't fight over it.
        self._preview_viewers = 0
        self._encoder_attached = False
        # One StreamingOutput for the process lifetime: preview generators
        # hold a reference to it, so tuning rebuilds swap the camera/encoder
        # underneath without breaking connected streams.
        self._output = self.StreamingOutput()

        self._picam2 = None
        self._model = ""
        # Always open with the default tuning first: choosing an alternative
        # file needs the sensor model, and probing it any other way spins up
        # libcamera's camera manager before the tuning override can be set,
        # which silently pins the default tuning (the IPA loads its tuning
        # when the manager enumerates the camera). A persisted "standard"
        # choice is applied via one rebuild right after — same proven path
        # as toggling it in Settings.
        self._open_camera()

        # Exposure/focus/WB defaults applied to the live sensor. Apply without
        # persisting — restore_settings() (called after construction) loads any
        # saved values and would otherwise be clobbered by these defaults.
        self._restoring = True
        try:
            self._apply_controls()
            self._apply_white_balance()
            if self.focus_available():
                self._apply_focus()

            # Persisted "standard" tuning: rebuild once, now that the state
            # _apply_tuning re-applies exists.
            saved = self._store.load() or {}
            if saved.get("tuning") == "standard" and self.tuning_available():
                self._tuning = "standard"
                self._apply_tuning()

            self.set_preview_throttled(False)  # establish the PREVIEW_FPS_NORMAL cap
        finally:
            self._restoring = False

    def _open_camera(self) -> None:
        """(Re)build the whole pipeline: camera, configs, MJPEG encoder."""
        self._picam2 = self._Picamera2(tuning=self._load_tuning())
        self._model = str(self._picam2.camera_properties.get("Model", ""))

        video_config = self._picam2.create_video_configuration(
            main={"size": (self.WIDTH, self.HEIGHT)},
            raw=self._full_fov_raw_stream(),
        )
        self._picam2.configure(video_config)

        # Full-sensor still configuration for high-resolution captures. The
        # streaming/main config above is only 1280x720; captures briefly switch
        # to this (defaults to the sensor's maximum resolution) instead. The
        # raw stream is included so DNG (raw) captures are available on demand.
        self._still_config = self._picam2.create_still_configuration(raw={})

        self._encoder = self._JpegEncoder(
            num_threads=4, q=self.PREVIEW_JPEG_QUALITY
        )
        self._file_output = self._FileOutput(self._output)
        # Camera runs continuously; the encoder attaches on demand (see
        # __init__'s comment) — never at open, even if viewers were active
        # before a rebuild (_apply_tuning re-attaches explicitly afterward).
        self._picam2.start()
        self._encoder_attached = False

    def _load_tuning(self):
        """Tuning dict for the current self._tuning choice, or None (default).

        "standard" maps a NoIR model to its filtered variant's tuning file
        (imx708_noir -> imx708.json), using the model cached from the
        previous open — probing libcamera for it here would create the
        camera manager too early and pin the default tuning (see __init__).
        Best-effort: any failure logs and falls back to the default tuning
        rather than taking the camera down.
        """
        if self._tuning != "standard" or not self._model.endswith("_noir"):
            return None
        try:
            return self._Picamera2.load_tuning_file(
                self._model[: -len("_noir")] + ".json"
            )
        except Exception:
            import logging
            logging.getLogger(__name__).exception(
                "failed to load standard tuning; using the sensor default"
            )
            return None

    def tuning_available(self) -> bool:
        return self._model.endswith("_noir")

    def _apply_tuning(self) -> None:
        # The tuning file is baked in at open time, so rebuild the pipeline,
        # then re-apply the software-held state to the fresh camera.
        with self._camera_lock:
            if self._encoder_attached:
                self._picam2.stop_encoder(self._encoder)
            self._picam2.stop()
            self._picam2.close()
            had_viewers = self._preview_viewers > 0
            self._open_camera()
            was_restoring = self._restoring
            self._restoring = True
            try:
                self._apply_controls()
                self._apply_white_balance()
                if self.focus_available():
                    if self._af_point:
                        # Keep an active tap-to-focus window across the
                        # rebuild instead of silently widening to full scene.
                        self._apply_focus_point(*self._af_point)
                    else:
                        self._apply_focus()
                self.set_preview_throttled(self._preview_throttled)
                # Restore the encoder if viewers were watching before the
                # rebuild — _open_camera() always starts it detached.
                if had_viewers:
                    self._picam2.start_encoder(self._encoder, self._file_output)
                    self._encoder_attached = True
            finally:
                self._restoring = was_restoring

    def set_preview_throttled(self, throttled: bool) -> None:
        """Cap the live preview to PREVIEW_FPS_THROTTLED (or restore
        PREVIEW_FPS_NORMAL), by fixing the main stream's frame duration.

        min == max forces an exact rate rather than just an upper bound —
        deliberate, since this is the preview stream only (stills capture
        via a separate still_config), so pinning exposure headroom here
        doesn't affect capture quality.
        """
        self._preview_throttled = bool(throttled)
        fps = self.PREVIEW_FPS_THROTTLED if throttled else self.PREVIEW_FPS_NORMAL
        us = round(1_000_000 / fps)
        with self._camera_lock:
            self._picam2.set_controls({"FrameDurationLimits": (us, us)})

    def _acquire_preview_encoder(self) -> None:
        """Attach the MJPEG encoder if this is the first active viewer.

        Reference-counted so N simultaneous viewers (e.g. the kiosk plus a
        browser on another device) don't fight over attach/detach.
        """
        with self._camera_lock:
            self._preview_viewers += 1
            if not self._encoder_attached:
                self._picam2.start_encoder(self._encoder, self._file_output)
                self._encoder_attached = True

    def _release_preview_encoder(self) -> None:
        """Detach the encoder once the last viewer disconnects."""
        with self._camera_lock:
            self._preview_viewers = max(0, self._preview_viewers - 1)
            if self._preview_viewers == 0 and self._encoder_attached:
                self._picam2.stop_encoder(self._encoder)
                self._encoder_attached = False

    def _full_fov_raw_stream(self):
        """Raw-stream spec that keeps the preview at the sensor's full FoV.

        Left to itself, libcamera picks the smallest sensor mode that fits the
        main stream — on the imx708 that's a *cropped* mode (1536x864 reads a
        3072x1728 centre crop), so the live preview showed a narrower field of
        view than captures. Instead, pick the lowest-resolution sensor mode
        among those with the widest crop (i.e. the binned full-FoV mode), so
        preview and stills frame identically. Returns None (previous behavior)
        if modes can't be inspected.
        """
        try:
            modes = [
                m for m in self._picam2.sensor_modes if m.get("crop_limits")
            ]
            if not modes:
                return None

            def crop_area(mode):
                _x, _y, w, h = mode["crop_limits"]
                return w * h

            widest = max(crop_area(m) for m in modes)
            full_fov = [m for m in modes if crop_area(m) == widest]
            smallest = min(full_fov, key=lambda m: m["size"][0] * m["size"][1])
            return {"size": smallest["size"]}
        except Exception:
            return None

    def stream(self):
        # Encoder attaches for this viewer and detaches again once nobody's
        # watching (see _acquire/_release_preview_encoder) — the raw camera
        # itself keeps running throughout, so switching tabs and back is
        # instant and metadata/AE/AWB/AF elsewhere never sees a gap.
        self._acquire_preview_encoder()
        try:
            while True:
                with self._output.condition:
                    self._output.condition.wait()
                    frame = self._output.frame
                if frame is not None:
                    # Rotate to match the configured sensor rotation. At 0°
                    # this is a no-op pass-through (no re-encode), so there's
                    # no overhead unless a rotation is actually selected.
                    yield self._rotate_jpeg(frame)
        finally:
            self._release_preview_encoder()

    def capture(self, path: str) -> dict:
        save_jpeg, jpeg_path, save_raw, dng_path = self._capture_targets(path)
        files = []
        preview = None
        # switch_mode_and_capture_request deadlocks (confirmed: it hands the
        # still-mode frame to the encoder, which chokes on the resolution
        # mismatch) if the encoder is still attached — detach it first if it
        # is, capture, then restore it to whatever state it was in. The raw
        # camera itself is never stopped, so this is fast either way.
        with self._camera_lock:
            was_attached = self._encoder_attached
            if was_attached:
                self._picam2.stop_encoder(self._encoder)
                self._encoder_attached = False
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
                if was_attached:
                    self._picam2.start_encoder(self._encoder, self._file_output)
                    self._encoder_attached = True
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

    def _apply_controls(self) -> None:
        with self._camera_lock:
            if self._controls["auto_exposure"]:
                # Hand exposure back to the auto-exposure algorithm.
                self._picam2.set_controls({"AeEnable": True})
            else:
                # Manual: disable AE and pin gain (ISO/100) + exposure time.
                self._picam2.set_controls(
                    {
                        "AeEnable": False,
                        "AnalogueGain": self._controls["iso"] / 100.0,
                        "ExposureTime": self._controls["shutter_us"],
                    }
                )

    def focus_available(self) -> bool:
        # Only cameras with a lens motor (e.g. Camera Module 3) report
        # LensPosition; fixed-focus modules (HQ, v2) don't.
        return "LensPosition" in self._picam2.camera_controls

    def _lens_range(self) -> tuple[float, float]:
        lo, hi, _default = self._picam2.camera_controls["LensPosition"]
        return (float(lo), float(hi))

    def _apply_focus(self) -> None:
        with self._camera_lock:
            if self._focus["af_mode"] == "continuous":
                # Whole-scene metering: also clears any tap-to-focus window.
                self._picam2.set_controls({
                    "AfMode": _AF_CONTINUOUS,
                    "AfMetering": _AF_METERING_AUTO,
                    "AfRange": _AF_RANGE_FULL,
                })
            else:
                self._picam2.set_controls({
                    "AfMode": _AF_MANUAL,
                    "LensPosition": float(self._focus["lens_position"]),
                })

    def _apply_focus_point(self, x: float, y: float) -> None:
        if "AfWindows" not in self._picam2.camera_controls:
            raise ValueError("this camera does not support focus windows")
        with self._camera_lock:
            crop = self._picam2.camera_properties["ScalerCropMaximum"]
            try:
                cx, cy, cw, ch = crop
            except TypeError:  # older picamera2 hands back a libcamera Rectangle
                cx, cy, cw, ch = crop.x, crop.y, crop.width, crop.height
            # ~15% window centred on the tap, clamped inside the sensor crop.
            ww, wh = int(cw * 0.15), int(ch * 0.15)
            wx = cx + min(max(int(x * cw) - ww // 2, 0), cw - ww)
            wy = cy + min(max(int(y * ch) - wh // 2, 0), ch - wh)
            self._picam2.set_controls({
                "AfMode": _AF_CONTINUOUS,
                "AfMetering": _AF_METERING_WINDOWS,
                "AfWindows": [(wx, wy, ww, wh)],
                "AfRange": _AF_RANGE_FULL,
            })

    def wb_presets_supported(self) -> bool:
        # The standard tuning has colour-temperature AWB, making AwbMode
        # meaningful even on a NoIR sensor.
        if self._tuning == "standard":
            return True
        model = str(self._picam2.camera_properties.get("Model", ""))
        return not model.endswith("_noir")

    def _apply_white_balance(self) -> None:
        with self._camera_lock:
            if self._wb["mode"] == "manual":
                self._picam2.set_controls({
                    "AwbEnable": False,
                    "ColourGains": (self._wb["red_gain"], self._wb["blue_gain"]),
                })
            else:
                self._picam2.set_controls({
                    "AwbEnable": True,
                    "AwbMode": _AWB_MODE_IDS[self._wb["mode"]],
                })


def get_camera() -> BaseCamera:
    """Factory: ``CAMERA=real`` -> RealCamera, anything else -> MockCamera.

    Restores persisted settings so the camera comes up with the last-used
    rotation/quality/format/exposure after a restart or reboot.
    """
    camera = RealCamera() if os.environ.get("CAMERA") == "real" else MockCamera()
    camera.restore_settings()
    return camera
