"use client";

import { useEffect, useRef, useState } from "react";
import { previewUrl } from "@/lib/camera-api";

export function CameraPreview() {
  const imgRef = useRef<HTMLImageElement>(null);
  // Frozen snapshot shown during the shutter flash, plus a key to retrigger
  // the flash animation on each capture.
  const [frozen, setFrozen] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState(0);

  useEffect(() => {
    function onCapture() {
      // Freeze the preview on the current frame for the flash duration, then
      // resume the live stream.
      const img = imgRef.current;
      if (img) {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext("2d");
          if (ctx && canvas.width && canvas.height) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            setFrozen(canvas.toDataURL("image/jpeg"));
          }
        } catch {
          // Canvas can throw if the frame isn't ready; just skip the freeze.
        }
      }
      setFlashKey((k) => k + 1);
      window.setTimeout(() => setFrozen(null), 600);
    }
    window.addEventListener("camera-capture", onCapture);
    return () => window.removeEventListener("camera-capture", onCapture);
  }, []);

  return (
    <div className="relative flex overflow-hidden border border-zinc-800 h-full">
      <img
        ref={imgRef}
        src={previewUrl()}
        alt="Live camera preview"
        className="h-full w-full object-cover"
        width={100}
        height={100}
      />
      {frozen && (
        <img
          src={frozen}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      )}
      {flashKey > 0 && (
        <div
          key={flashKey}
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-white"
          style={{ animation: "camera-flash 600ms ease-out forwards" }}
        />
      )}
    </div>
  );
}
