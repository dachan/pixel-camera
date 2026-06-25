"use client";

import { useEffect, useState } from "react";
import {
  cameraInfo,
  cameraMetadata,
  type CameraInfo,
  type CameraMetadata,
} from "@/lib/camera-api";

// Format any camera value (numbers, booleans, arrays, nested) for display.
function fmt(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toString() : value.toFixed(3);
  }
  if (Array.isArray(value)) return `[${value.map(fmt).join(", ")}]`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function CameraMeta() {
  const [info, setInfo] = useState<CameraInfo | null>(null);
  const [meta, setMeta] = useState<CameraMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Static info: fetch once.
  useEffect(() => {
    cameraInfo()
      .then(setInfo)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Live metadata: poll every second.
  useEffect(() => {
    let active = true;
    const tick = () =>
      cameraMetadata()
        .then((m) => active && setMeta(m))
        .catch(() => active && setMeta(null));
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  if (error) {
    return (
      <p className="text-sm text-red-500">Camera metadata unavailable: {error}</p>
    );
  }

  return (
    <div className="grid w-full max-w-4xl gap-6 text-sm md:grid-cols-3">
      {/* Live per-frame metadata */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 flex items-center gap-2 font-semibold text-zinc-100">
          <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
          Live Metadata
        </h2>
        <dl className="space-y-1">
          {meta
            ? Object.entries(meta).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-zinc-400">{k}</dt>
                  <dd className="font-mono text-zinc-100">{fmt(v)}</dd>
                </div>
              ))
            : <p className="text-zinc-500">waiting…</p>}
        </dl>
      </section>

      {/* Adjustable controls and their ranges */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 font-semibold text-zinc-100">Controls (range)</h2>
        <dl className="space-y-1">
          {info
            ? Object.entries(info.controls).map(([k, r]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-zinc-400">{k}</dt>
                  <dd className="font-mono text-zinc-100">
                    {fmt(r.min)} … {fmt(r.max)}
                    {r.default !== null && (
                      <span className="text-zinc-500"> (def {fmt(r.default)})</span>
                    )}
                  </dd>
                </div>
              ))
            : <p className="text-zinc-500">loading…</p>}
        </dl>
      </section>

      {/* Static sensor properties */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 font-semibold text-zinc-100">Properties</h2>
        <dl className="space-y-1">
          {info
            ? Object.entries(info.properties).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-zinc-400">{k}</dt>
                  <dd className="font-mono text-zinc-100">{fmt(v)}</dd>
                </div>
              ))
            : <p className="text-zinc-500">loading…</p>}
        </dl>
      </section>
    </div>
  );
}
