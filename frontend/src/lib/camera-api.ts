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
