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
      .then((names) => {
        setCaptures(names);
        setError(null); // a later successful poll clears a transient failure
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, 3000);

  if (error) {
    return (
      <p className="flex size-full items-center justify-center text-center text-sm text-red-500">
        Captures unavailable: {error}
      </p>
    );
  }

  if (loading) {
    return (
      <p className="flex size-full items-center justify-center text-center text-sm text-zinc-500">
        Loading captures…
      </p>
    );
  }

  if (captures.length === 0) {
    return (
      <p className="flex size-full items-center justify-center text-center text-sm text-zinc-500">
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
            className="cursor-pointer overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/50 transition hover:border-zinc-600"
          >
            <div className="flex aspect-video w-full items-center justify-center bg-zinc-950">
              <img
                src={captureThumbUrl(filename)}
                alt={filename}
                loading="lazy"
                decoding="async"
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <figcaption className="truncate px-2 py-1.5 font-mono text-xs text-zinc-400">
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4"
        >
          <img
            src={captureUrl(selected)}
            alt={selected}
            className="max-h-full max-w-full object-contain"
          />
          <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-black/60 px-2 py-1 font-mono text-xs text-zinc-300">
            {selected} · tap to close
          </span>
        </div>
      )}
    </DragScrollArea>
  );
}
