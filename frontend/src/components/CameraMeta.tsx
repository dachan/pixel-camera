"use client";

import { type ReactNode, useEffect, useState } from "react";
import {
  cameraInfo,
  cameraMetadata,
  type CameraInfo,
  type CameraMetadata,
} from "@/lib/camera-api";
import { errorMessage } from "@/lib/errors";
import { usePolling } from "@/lib/use-polling";
import DragScrollArea from "@/components/DragScrollArea";

// Title-case a metadata key for display ("exposure_time" → "Exposure Time").
function titleCaseLabel(key: string): string {
  return key
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

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

function MetaPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-md border border-stone-300 bg-stone-100 text-sm">
      <h2 className="border-b border-stone-300 px-3 py-2 text-xs font-semibold text-stone-500">
        {title}
      </h2>
      <dl className="space-y-1 p-3">{children}</dl>
    </section>
  );
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-stone-500">{label}</dt>
      <dd className="font-mono text-stone-700">{children}</dd>
    </div>
  );
}

function MetaPlaceholder({ children }: { children: ReactNode }) {
  return <p className="text-stone-500">{children}</p>;
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
    <DragScrollArea className="flex flex-col gap-4 pb-3">
      <MetaPanel title="Live Metadata">
        {meta ? (
          Object.entries(meta).map(([k, v]) => (
            <MetaRow key={k} label={titleCaseLabel(k)}>
              {fmt(v)}
            </MetaRow>
          ))
        ) : (
          <MetaPlaceholder>waiting…</MetaPlaceholder>
        )}
      </MetaPanel>

      <MetaPanel title="Controls (Range)">
        {info ? (
          Object.entries(info.controls).map(([k, r]) => (
            <MetaRow key={k} label={titleCaseLabel(k)}>
              {fmt(r.min)} … {fmt(r.max)}
              {r.default !== null && (
                <span className="text-stone-500"> (def {fmt(r.default)})</span>
              )}
            </MetaRow>
          ))
        ) : (
          <MetaPlaceholder>loading…</MetaPlaceholder>
        )}
      </MetaPanel>

      <MetaPanel title="Properties">
        {info ? (
          Object.entries(info.properties).map(([k, v]) => (
            <MetaRow key={k} label={titleCaseLabel(k)}>
              {fmt(v)}
            </MetaRow>
          ))
        ) : (
          <MetaPlaceholder>loading…</MetaPlaceholder>
        )}
      </MetaPanel>
    </DragScrollArea>
  );
}
