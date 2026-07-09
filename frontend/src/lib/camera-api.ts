// Single entry point for all camera API calls.
//
// BASE comes from NEXT_PUBLIC_API_BASE, baked in at build time.
//   - dev:  http://localhost:5000  (frontend on :3000 talks cross-origin)
//   - prod: "" (empty) -> relative "/api", served single-origin by Flask (kiosk)

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

// --- Fetch helpers -----------------------------------------------------------

async function parseJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} failed: ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      `${what} failed: backend returned HTML — restart or redeploy the backend`,
    );
  }
  return res.json();
}

async function getJson<T>(path: string, what: string): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, { cache: "no-store" });
  return parseJson(res, what);
}

async function postJson<T>(
  path: string,
  what: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method: "POST",
    ...(body !== undefined && {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  return parseJson(res, what);
}

// --- Preview + capture ---------------------------------------------------------

export function previewUrl(): string {
  return `${BASE}/api/preview`;
}

// SSE stream of "start"/"done" capture events, from any trigger (on-screen
// button or the physical GPIO shutter button) — drives the shutter flash.
export function captureEventsUrl(): string {
  return `${BASE}/api/capture/events`;
}

export function captureUrl(filename: string): string {
  return `${BASE}/api/captures/${encodeURIComponent(filename)}`;
}

// Small cached thumbnail of a capture — what the gallery grid loads, since
// full captures are 10+ MB each.
export function captureThumbUrl(filename: string): string {
  return `${BASE}/api/captures/${encodeURIComponent(filename)}?thumb=1`;
}

// Health + a per-process "started" token that changes on every backend
// restart (i.e. every deploy) — see use-reload-on-restart.
export function health(): Promise<{ status: string; started: number }> {
  return getJson("/health", "health");
}

export function capture(): Promise<{ filename: string }> {
  return postJson("/capture", "capture");
}

export async function listCaptures(): Promise<string[]> {
  const data = await getJson<{ captures: string[] }>(
    "/captures",
    "list captures",
  );
  return data.captures;
}

// Delete every capture (JPEG + RAW) on the Pi. Returns how many were removed.
export async function deleteAllCaptures(): Promise<number> {
  const res = await fetch(`${BASE}/api/captures`, { method: "DELETE" });
  const data = await parseJson<{ deleted: number }>(res, "delete captures");
  return data.deleted;
}

// --- Camera metadata --------------------------------------------------------

export type ControlRange = {
  min: number | boolean | null;
  max: number | boolean | null;
  default: number | boolean | null;
};

export type CameraInfo = {
  properties: Record<string, unknown>;
  controls: Record<string, ControlRange>;
};

export type CameraMetadata = Record<string, unknown>;

export function cameraInfo(): Promise<CameraInfo> {
  return getJson("/camera/info", "camera info");
}

export function cameraMetadata(): Promise<CameraMetadata> {
  return getJson("/camera/metadata", "camera metadata");
}

// --- Exposure controls (ISO + shutter; aperture is fixed on Pi cameras) -----

export type CameraControlsState = {
  auto_exposure: boolean;
  iso: number;
  shutter_us: number;
};

export function getControls(): Promise<CameraControlsState> {
  return getJson("/camera/controls", "get controls");
}

export function setControls(
  settings: Partial<CameraControlsState>,
): Promise<CameraControlsState> {
  return postJson("/camera/controls", "set controls", settings);
}

// --- Focus (Camera Module 3 lens motor; absent on fixed-focus cameras) ------

export type FocusState = {
  available: boolean;
  af_mode?: "continuous" | "manual";
  // Dioptres: 0 = infinity, higher = closer. Live AF value in continuous.
  lens_position?: number;
  min?: number;
  max?: number;
};

export function getFocus(): Promise<FocusState> {
  return getJson("/camera/focus", "get focus");
}

export function setFocus(settings: {
  af_mode?: "continuous" | "manual";
  lens_position?: number;
}): Promise<FocusState> {
  return postJson("/camera/focus", "set focus", settings);
}

// Tap-to-focus: x/y are normalized 0..1 within the displayed preview frame.
// Steers continuous AF to that spot (switching from manual if needed).
export function focusAtPoint(x: number, y: number): Promise<FocusState> {
  return postJson("/camera/focus/point", "focus at point", { x, y });
}

// --- White balance -----------------------------------------------------------

export type WhiteBalanceMode =
  | "auto"
  | "incandescent"
  | "tungsten"
  | "fluorescent"
  | "indoor"
  | "daylight"
  | "cloudy"
  | "manual";

export type WhiteBalanceState = {
  mode: WhiteBalanceMode;
  // Live AWB gains outside manual mode; the driving values in manual.
  red_gain: number;
  blue_gain: number;
  // False on NoIR sensors, whose greyworld AWB tuning ignores AwbMode —
  // the UI then offers only auto/manual.
  presets_supported: boolean;
};

export function getWhiteBalance(): Promise<WhiteBalanceState> {
  return getJson("/camera/wb", "get white balance");
}

export function setWhiteBalance(
  settings: Partial<WhiteBalanceState>,
): Promise<WhiteBalanceState> {
  return postJson("/camera/wb", "set white balance", settings);
}

// --- Colour tuning (NoIR sensors only) ---------------------------------------

export type CameraTuning = {
  // "default" = the sensor's own tuning; "standard" = the filtered variant's
  // tuning, which enables colour-temperature AWB (WB presets) on NoIR.
  tuning: "default" | "standard";
  // False when there's no alternative tuning (non-NoIR cameras).
  available: boolean;
};

export function getTuning(): Promise<CameraTuning> {
  return getJson("/camera/tuning", "get tuning");
}

// Note: switching rebuilds the camera pipeline — the response takes a few
// seconds and the preview stream restarts.
export function setTuning(
  settings: Partial<CameraTuning>,
): Promise<CameraTuning> {
  return postJson("/camera/tuning", "set tuning", settings);
}

// --- Orientation (rotation applied to captured images) ----------------------

export type CameraOrientation = {
  rotation: number; // degrees clockwise: 0 | 90 | 180 | 270
};

export function getOrientation(): Promise<CameraOrientation> {
  return getJson("/camera/orientation", "get orientation");
}

export function setOrientation(
  settings: Partial<CameraOrientation>,
): Promise<CameraOrientation> {
  return postJson("/camera/orientation", "set orientation", settings);
}

// --- Capture quality (JPEG quality for saved photos) ------------------------

export type CaptureQuality = {
  quality: number; // 1..100
};

export function getQuality(): Promise<CaptureQuality> {
  return getJson("/camera/quality", "get quality");
}

export function setQuality(
  settings: Partial<CaptureQuality>,
): Promise<CaptureQuality> {
  return postJson("/camera/quality", "set quality", settings);
}

// --- Capture format (JPEG / RAW+JPEG / RAW DNG) -----------------------------

export type CaptureFormatValue = "jpeg" | "raw+jpeg" | "raw";

export type CaptureFormat = {
  format: CaptureFormatValue;
};

export function getFormat(): Promise<CaptureFormat> {
  return getJson("/camera/format", "get format");
}

export function setFormat(
  settings: Partial<CaptureFormat>,
): Promise<CaptureFormat> {
  return postJson("/camera/format", "set format", settings);
}

// --- System ------------------------------------------------------------------

// Map of thermal-zone label -> temperature in °C (e.g. { "cpu-thermal": 47.2 }).
// Identical readings are de-duplicated server-side.
export type SystemTemperatures = Record<string, number>;

// A logged battery extreme: the voltage/percent seen, and when (unix
// seconds). Null if that extreme hasn't been observed yet.
export type BatteryExtreme = {
  volts: number;
  percent: number;
  at: number;
} | null;

export type SystemThermal = {
  battery_level: number | null;
  // Cell voltage (V), for cross-checking against the board's LED bars.
  battery_volts: number | null;
  // Lowest/highest cell voltage ever observed, persisted across restarts —
  // shows whether the battery ever recovers to a healthy voltage or just
  // sits low, which a single instantaneous reading can't tell you.
  battery_min: BatteryExtreme;
  battery_max: BatteryExtreme;
  // True while charging, false on battery, null until known. Inferred from
  // the voltage trend (the fuel gauge has no charge flag).
  charging: boolean | null;
  temperatures: SystemTemperatures;
  // True while the app is reducing preview frame rate to cool the Pi.
  throttled: boolean;
  // The CPU temperature (°C) that triggers throttling.
  throttle_at: number;
  // Whether thermal throttling may engage at all (user setting).
  throttle_enabled: boolean;
};

export function systemTemperature(): Promise<SystemThermal> {
  return getJson("/system/temperature", "system temperature");
}

export function setThrottleEnabled(
  enabled: boolean,
): Promise<{ enabled: boolean; throttled: boolean }> {
  return postJson("/system/throttle", "set throttle", { enabled });
}

// Clear the persisted battery min/max log (e.g. after swapping cells).
export function resetBatteryLog(): Promise<{ status: string }> {
  return postJson("/system/battery-log/reset", "reset battery log");
}

// Close the kiosk browser and drop to the Pi desktop. The request often won't
// return — the page is being torn down as Chromium closes — so errors are
// expected and swallowed.
export async function exitKiosk(): Promise<void> {
  await fetch(`${BASE}/api/system/exit-kiosk`, { method: "POST" }).catch(() => {
    // Expected: the browser may be killed before the response arrives.
  });
}
