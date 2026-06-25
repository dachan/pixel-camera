"use client";

import { previewUrl } from "@/lib/camera-api";

export function CameraPreview() {
  return (
    <div className="flex overflow-hidden border border-zinc-800">
      <img
        src={previewUrl()}
        alt="Live camera preview"
        className="h-full w-full object-cover"
        width={100}
        height={100}
      />
    </div>
  );
}
