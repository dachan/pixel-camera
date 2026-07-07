"use client";

import { useState } from "react";
import { captureThumbUrl, captureUrl, listCaptures } from "@/lib/camera-api";
import { errorMessage } from "@/lib/errors";
import { usePolling } from "@/lib/use-polling";
import DragScrollArea from "@/components/DragScrollArea";

export default function CaptureGallery() {
  const [captures, setCaptures] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Filename of the capture opened full-screen (null = grid view).
  const [selected, setSelected] = useState<string | null>(null);

  usePolling(() => {
    listCaptures()
      .then(setCaptures)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, 3000);

  if (error) {
    return (
      <p className="flex h-full items-center justify-center text-sm text-destructive-border">
        Captures unavailable: {error}
      </p>
    );
  }

  if (loading) {
    return (
      <p className="flex h-full items-center justify-center text-sm text-muted">
        Loading captures…
      </p>
    );
  }

  if (captures.length === 0) {
    return (
      <p className="flex h-full items-center justify-center text-sm text-muted">
        No captures yet. Use the Capture button on the Camera tab.
      </p>
    );
  }

  return (
    <DragScrollArea>
      <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {captures.map((filename) => (
          <figure
            key={filename}
            onClick={() => setSelected(filename)}
            className="cursor-pointer overflow-hidden rounded-lg border border-border bg-surface-elevated transition hover:border-border-hover"
          >
            <div className="flex aspect-video w-full items-center justify-center bg-surface-deep">
              <img
                src={captureThumbUrl(filename)}
                alt={filename}
                loading="lazy"
                decoding="async"
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <figcaption className="truncate px-2 py-1.5 font-mono text-xs text-muted">
              {filename}
            </figcaption>
          </figure>
        ))}
      </div>

      {selected && (
        <div
          role="dialog"
          aria-label={selected}
          onClick={() => setSelected(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
        >
          <img
            src={captureUrl(selected)}
            alt={selected}
            className="max-h-full max-w-full object-contain"
          />
          <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-overlay px-2 py-1 font-mono text-xs text-heading">
            {selected} · tap to close
          </span>
        </div>
      )}
    </DragScrollArea>
  );
}
