"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { previewUrl } from "@/lib/camera-api";

const FLASH_MS = 600;

type CaptureSession = {
  flashDone: boolean;
  captureDone: boolean;
};

export function CameraPreview() {
  const imgRef = useRef<HTMLImageElement>(null);
  const sessionRef = useRef<CaptureSession | null>(null);
  const [frozen, setFrozen] = useState<string | null>(null);
  const [flashing, setFlashing] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  const resumeLivePreview = useCallback(() => {
    sessionRef.current = null;
    setFrozen(null);
    setFlashing(false);
    // Reconnect the MJPEG stream after the backend resumes video mode.
    setPreviewKey((k) => k + 1);
  }, []);

  const tryResumeLivePreview = useCallback(() => {
    const session = sessionRef.current;
    if (!session?.flashDone || !session.captureDone) return;
    resumeLivePreview();
  }, [resumeLivePreview]);

  useEffect(() => {
    function onCapture() {
      sessionRef.current = { flashDone: false, captureDone: false };

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

      setFlashing(true);
      window.setTimeout(() => {
        if (!sessionRef.current) return;
        sessionRef.current.flashDone = true;
        setFlashing(false);
        tryResumeLivePreview();
      }, FLASH_MS);
    }

    function onCaptureDone() {
      if (!sessionRef.current) return;
      sessionRef.current.captureDone = true;
      tryResumeLivePreview();
    }

    window.addEventListener("camera-capture", onCapture);
    window.addEventListener("camera-capture-done", onCaptureDone);
    return () => {
      window.removeEventListener("camera-capture", onCapture);
      window.removeEventListener("camera-capture-done", onCaptureDone);
    };
  }, [tryResumeLivePreview]);

  const streamSrc =
    previewKey > 0 ? `${previewUrl()}?v=${previewKey}` : previewUrl();

  return (
    <div className="relative flex overflow-hidden border border-zinc-800 h-full">
      <img
        ref={imgRef}
        src={streamSrc}
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
      {flashing && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-white"
          style={{ animation: `camera-flash ${FLASH_MS}ms ease-out forwards` }}
        />
      )}
    </div>
  );
}
