"use client";

import { useEffect, useState } from "react";
import {
  cameraInfo,
  cameraMetadata,
  type CameraInfo,
  type CameraMetadata,
} from "@/lib/camera-api";
import { errorMessage } from "@/lib/errors";
import { usePolling } from "@/lib/use-polling";
import DragScrollArea from "@/components/DragScrollArea";

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

  useEffect(() => {
    cameraInfo()
      .then(setInfo)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  usePolling(() => {
    cameraMetadata()
      .then(setMeta)
      .catch(() => setMeta(null));
  }, 1000);

  if (error) {
    return (
      <p className="flex h-full items-center justify-center text-sm text-red-500">
        Camera metadata unavailable: {error}
      </p>
    );
  }

  return (
    <DragScrollArea className="flex flex-col gap-4">
      <section className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900/50 text-sm">
        <h2 className="top-0 z-10 flex items-center gap-2 bg-zinc-900/95 px-4 pt-4 pb-2 font-semibold text-zinc-100 backdrop-blur-sm">
          <span className="h-2 w-2 animate-pulse bg-green-500" />
          Live Metadata
        </h2>
        <dl className="space-y-1 px-4 pb-4">
          {meta ? (
            Object.entries(meta).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-zinc-400">{k}</dt>
                <dd className="font-mono text-zinc-100">{fmt(v)}</dd>
              </div>
            ))
          ) : (
            <p className="text-zinc-500">waiting…</p>
          )}
        </dl>
      </section>

      <section className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900/50 text-sm">
        <h2 className="top-0 z-10 bg-zinc-900/95 px-4 pt-4 pb-2 font-semibold text-zinc-100 backdrop-blur-sm">
          Controls (range)
        </h2>
        <dl className="space-y-1 px-4 pb-4">
          {info ? (
            Object.entries(info.controls).map(([k, r]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-zinc-400">{k}</dt>
                <dd className="font-mono text-zinc-100">
                  {fmt(r.min)} … {fmt(r.max)}
                  {r.default !== null && (
                    <span className="text-zinc-500">
                      {" "}
                      (def {fmt(r.default)})
                    </span>
                  )}
                </dd>
              </div>
            ))
          ) : (
            <p className="text-zinc-500">loading…</p>
          )}
        </dl>
      </section>

      <section className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900/50 text-sm">
        <h2 className="top-0 z-10 bg-zinc-900/95 px-4 pt-4 pb-2 font-semibold text-zinc-100 backdrop-blur-sm">
          Properties
        </h2>
        <dl className="space-y-1 px-4 pb-4">
          {info ? (
            Object.entries(info.properties).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-zinc-400">{k}</dt>
                <dd className="font-mono text-zinc-100">{fmt(v)}</dd>
              </div>
            ))
          ) : (
            <p className="text-zinc-500">loading…</p>
          )}
        </dl>
      </section>
    </DragScrollArea>
  );
}
