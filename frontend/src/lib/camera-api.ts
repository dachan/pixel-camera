// Single entry point for all camera API calls.
//
// BASE comes from NEXT_PUBLIC_API_BASE, baked in at build time.
//   - dev:  http://localhost:5000  (frontend on :3000 talks cross-origin)
//   - prod: "" (empty) -> relative "/api", served single-origin by Flask (kiosk)

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export function previewUrl(): string {
  return `${BASE}/api/preview`;
}

export async function capture(): Promise<{ filename: string }> {
  const res = await fetch(`${BASE}/api/capture`, { method: "POST" });
  if (!res.ok) throw new Error(`capture failed: ${res.status}`);
  return res.json();
}

export function captureUrl(filename: string): string {
  return `${BASE}/api/captures/${encodeURIComponent(filename)}`;
}

export async function listCaptures(): Promise<string[]> {
  const res = await fetch(`${BASE}/api/captures`, { cache: "no-store" });
  if (!res.ok) throw new Error(`list captures failed: ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      "list captures failed: backend returned HTML — restart or redeploy the backend",
    );
  }
  const data: { captures: string[] } = await res.json();
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

export async function cameraInfo(): Promise<CameraInfo> {
  const res = await fetch(`${BASE}/api/camera/info`);
  if (!res.ok) throw new Error(`camera info failed: ${res.status}`);
  return res.json();
}

export async function cameraMetadata(): Promise<CameraMetadata> {
  const res = await fetch(`${BASE}/api/camera/metadata`);
  if (!res.ok) throw new Error(`camera metadata failed: ${res.status}`);
  return res.json();
}

// --- Exposure controls (ISO + shutter; aperture is fixed on Pi cameras) -----

export type CameraControlsState = {
  auto_exposure: boolean;
  iso: number;
  shutter_us: number;
};

export async function getControls(): Promise<CameraControlsState> {
  const res = await fetch(`${BASE}/api/camera/controls`);
  if (!res.ok) throw new Error(`get controls failed: ${res.status}`);
  return res.json();
}

export async function setControls(
  settings: Partial<CameraControlsState>,
): Promise<CameraControlsState> {
  const res = await fetch(`${BASE}/api/camera/controls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error(`set controls failed: ${res.status}`);
  return res.json();
}

// --- System (Pi temperatures) -----------------------------------------------

// Map of thermal-zone label -> temperature in °C (e.g. { "cpu-thermal": 47.2 }).
// Empty off-Pi (e.g. Mac dev). Identical readings are de-duplicated server-side.
export type SystemTemperatures = Record<string, number>;

export async function systemTemperature(): Promise<SystemTemperatures> {
  const res = await fetch(`${BASE}/api/system/temperature`);
  if (!res.ok) throw new Error(`system temperature failed: ${res.status}`);
  const data: { temperatures: SystemTemperatures } = await res.json();
  return data.temperatures;
}

// --- Orientation (rotation applied to captured images) ----------------------

export type CameraOrientation = {
  rotation: number; // degrees clockwise: 0 | 90 | 180 | 270
};

export async function getOrientation(): Promise<CameraOrientation> {
  const res = await fetch(`${BASE}/api/camera/orientation`);
  if (!res.ok) throw new Error(`get orientation failed: ${res.status}`);
  return res.json();
}

export async function setOrientation(
  settings: Partial<CameraOrientation>,
): Promise<CameraOrientation> {
  const res = await fetch(`${BASE}/api/camera/orientation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error(`set orientation failed: ${res.status}`);
  return res.json();
}
