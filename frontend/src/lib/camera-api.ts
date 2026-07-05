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
// Empty off-Pi (e.g. Mac dev). Identical readings are de-duplicated server-side.
export type SystemTemperatures = Record<string, number>;

export async function systemTemperature(): Promise<SystemTemperatures> {
  const data = await getJson<{ temperatures: SystemTemperatures }>(
    "/system/temperature",
    "system temperature",
  );
  return data.temperatures;
}

// Close the kiosk browser and drop to the Pi desktop. The request often won't
// return — the page is being torn down as Chromium closes — so errors are
// expected and swallowed.
export async function exitKiosk(): Promise<void> {
  await fetch(`${BASE}/api/system/exit-kiosk`, { method: "POST" }).catch(() => {
    // Expected: the browser may be killed before the response arrives.
  });
}
