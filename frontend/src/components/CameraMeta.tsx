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

const PANEL_CLASS =
  "flex-1 rounded-lg border border-border bg-surface-elevated text-sm";
const HEADING_CLASS =
  "top-0 z-10 bg-surface-header px-4 py-1 font-semibold text-primary-foreground backdrop-blur-sm";

function MetaPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={PANEL_CLASS}>
      <h2 className={HEADING_CLASS}>{title}</h2>
      <dl className="space-y-1 px-4 py-2">{children}</dl>
    </section>
  );
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-foreground font-mono">{children}</dd>
    </div>
  );
}

function MetaPlaceholder({ children }: { children: ReactNode }) {
  return <div className="text-muted">{children}</div>;
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
      <p className="text-destructive-border flex h-full items-center justify-center text-sm">
        Camera metadata unavailable: {error}
      </p>
    );
  }

  return (
    <DragScrollArea className="flex flex-col gap-4">
      <MetaPanel title="Live Metadata">
        {meta ? (
          Object.entries(meta).map(([k, v]) => (
            <MetaRow key={k} label={k}>
              {fmt(v)}
            </MetaRow>
          ))
        ) : (
          <MetaPlaceholder>waiting…</MetaPlaceholder>
        )}
      </MetaPanel>

      <MetaPanel title="Controls (range)">
        {info ? (
          Object.entries(info.controls).map(([k, r]) => (
            <MetaRow key={k} label={k}>
              {fmt(r.min)} … {fmt(r.max)}
              {r.default !== null && (
                <span className="text-muted"> (def {fmt(r.default)})</span>
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
            <MetaRow key={k} label={k}>
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
