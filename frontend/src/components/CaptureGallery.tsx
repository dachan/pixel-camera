"use client";

import { useCallback, useEffect, useState } from "react";
import { captureUrl, listCaptures } from "@/lib/camera-api";

export default function CaptureGallery() {
  const [captures, setCaptures] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    listCaptures()
      .then(setCaptures)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  if (error) {
    return (
      <p className="flex h-full items-center justify-center text-sm text-red-500">
        Captures unavailable: {error}
      </p>
    );
  }

  if (loading) {
    return (
      <p className="flex h-full items-center justify-center text-sm text-zinc-500">
        Loading captures…
      </p>
    );
  }

  if (captures.length === 0) {
    return (
      <p className="flex h-full items-center justify-center text-sm text-zinc-500">
        No captures yet. Use the Capture button on the Camera tab.
      </p>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto touch-pan-y overscroll-contain scrollbar-none [&::-webkit-scrollbar]:hidden">
      <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {captures.map((filename) => (
          <figure
            key={filename}
            className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/50"
          >
            <img
              src={captureUrl(filename)}
              alt={filename}
              className="aspect-video w-full object-cover"
            />
            <figcaption className="truncate px-2 py-1.5 font-mono text-xs text-zinc-400">
              {filename}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
