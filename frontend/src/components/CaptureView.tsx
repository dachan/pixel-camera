"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  previewUrl,
  getOrientation,
  captureEventsUrl,
  focusAtPoint,
} from "@/lib/camera-api";
import { useElementSize } from "@/lib/use-element-size";
import { useFocus } from "@/lib/focus-context";

const FLASH_MS = 600;
const FOCUS_RING_MS = 900;

// The streamed frame is always 1280x720 (16:9), rotated server-side to
// 9:16 at 90/270. Kept in sync with RealCamera/MockCamera WIDTH/HEIGHT.
const STREAM_ASPECT = 16 / 9;

// Must match the frame's border-4 (px). The border uses box-sizing:
// border-box, so it eats into the box's content area — where the <img>
// with object-contain actually lives. Fitting the aspect ratio to the
// content area (see fitFrameToAspect) instead of the full bordered box
// keeps that interior exactly on-ratio, so object-contain never has to
// letterbox a few px inside its own frame.
const FRAME_BORDER_PX = 4;

// Largest {width, height} (px), including the border, so the box's
// content area (after subtracting the border) exactly fits `container`
// at `aspect` — no leftover space, and no letterboxing inside the border
// from an off-ratio content area.
function fitFrameToAspect(
  container: { width: number; height: number },
  aspect: number,
): { width: number; height: number } {
  const inset = FRAME_BORDER_PX * 2;
  const content = {
    width: Math.max(0, container.width - inset),
    height: Math.max(0, container.height - inset),
  };
  if (content.width <= 0 || content.height <= 0) {
    return { width: 0, height: 0 };
  }
  const widthAtFullHeight = content.height * aspect;
  const fitted =
    widthAtFullHeight <= content.width
      ? { width: widthAtFullHeight, height: content.height }
      : { width: content.width, height: content.width / aspect };
  return { width: fitted.width + inset, height: fitted.height + inset };
}

type CaptureSession = {
  flashDone: boolean;
  captureDone: boolean;
};

export function CameraPreview({ showGrid = false }: { showGrid?: boolean }) {
  const { ref: containerRef, size: containerSize } =
    useElementSize<HTMLDivElement>();
  const imgRef = useRef<HTMLImageElement>(null);
  const sessionRef = useRef<CaptureSession | null>(null);
  const [frozen, setFrozen] = useState<string | null>(null);
  const [flashing, setFlashing] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  // Sensor rotation drives the preview box aspect: landscape at 0/180,
  // portrait at 90/270 (the streamed frame is rotated server-side to match).
  const [rotation, setRotation] = useState(0);
  // Live focus state (shared poll — see focus-context): drives both
  // tap-to-focus availability and the manual-focus peaking overlay below.
  const focus = useFocus();
  const focusAvailable = focus?.available ?? null;
  const [focusRing, setFocusRing] = useState<{
    x: number;
    y: number;
    key: number;
  } | null>(null);

  // Explicitly abort the in-flight MJPEG stream request on unmount. Removing
  // an <img> from the DOM does not reliably cancel its underlying network
  // request for a multipart/x-mixed-replace stream (confirmed: the backend
  // connection stayed ESTABLISHED after switching tabs away from Camera) —
  // clearing src is the standard way to force the browser to abort it. This
  // is what lets the backend detach its MJPEG encoder (the dominant CPU/heat
  // cost) the moment nobody's actually viewing the preview.
  useEffect(() => {
    return () => {
      if (imgRef.current) imgRef.current.src = "";
    };
  }, []);

  useEffect(() => {
    getOrientation()
      .then((o) => setRotation(o.rotation))
      .catch(() => {});
  }, []);

  function onTapToFocus(e: React.MouseEvent<HTMLDivElement>) {
    if (focusAvailable === false) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const key = Date.now();
    setFocusRing({ x, y, key });
    window.setTimeout(
      () => setFocusRing((ring) => (ring?.key === key ? null : ring)),
      FOCUS_RING_MS,
    );
    focusAtPoint(x, y).catch(() => {});
  }

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

    // Every capture — on-screen button or physical GPIO button — is signaled
    // here by the backend, so the flash plays identically no matter the
    // trigger (see /api/capture/events in app.py).
    const source = new EventSource(captureEventsUrl());
    source.onmessage = (e) => {
      if (e.data === "start") onCapture();
      else if (e.data === "done") onCaptureDone();
    };
    return () => source.close();
  }, [tryResumeLivePreview]);

  const streamSrc =
    previewKey > 0 ? `${previewUrl()}?v=${previewKey}` : previewUrl();

  // At 90/270 the stream is rotated server-side to portrait. The box is
  // sized in exact pixels to fit the measured container at that aspect —
  // not a static w-full/h-full guess — so its edges always match the
  // displayed image with no letterboxing or leftover space.
  const portrait = rotation === 90 || rotation === 270;
  const aspect = portrait ? 1 / STREAM_ASPECT : STREAM_ASPECT;
  const box = fitFrameToAspect(containerSize, aspect);

  return (
    <div ref={containerRef} className="flex items-start justify-start">
      <div
        onClick={onTapToFocus}
        style={
          box.width > 0 ? { width: box.width, height: box.height } : undefined
        }
        className={`relative overflow-hidden rounded-sm border-4 border-stone-50 bg-black shadow-[0_0_15px_rgba(0,0,0,0.5)] ${
          focusAvailable ? "cursor-crosshair" : ""
        }`}
      >
        <img
          ref={imgRef}
          src={streamSrc}
          alt="Live camera preview"
          className="h-full w-full object-contain"
          width={100}
          height={100}
        />
        {frozen && (
          <img
            src={frozen}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          />
        )}
        {focus?.af_mode === "manual" && (
          // Focus peaking: an edge-detect + threshold SVG filter (defined
          // below) applied to a second copy of the same stream, screen-
          // blended over the base image so only strong edges add a bright
          // highlight — the rest of the filtered layer is black and
          // contributes nothing. GPU-composited by Chromium, so this adds
          // no backend encode cost (same MJPEG stream broadcast to a second
          // listener) and negligible client cost.
          <img
            src={streamSrc}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full object-contain mix-blend-screen"
            style={{ filter: "url(#focus-peaking)" }}
          />
        )}
        {showGrid && (
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute inset-y-0 left-1/3 w-px bg-white/40" />
            <div className="absolute inset-y-0 left-2/3 w-px bg-white/40" />
            <div className="absolute inset-x-0 top-1/3 h-px bg-white/40" />
            <div className="absolute inset-x-0 top-2/3 h-px bg-white/40" />
          </div>
        )}
        {focusRing && (
          <div
            key={focusRing.key}
            aria-hidden
            className="pointer-events-none absolute h-16 w-16 rounded-lg border-2 border-yellow-400"
            style={{
              left: `${focusRing.x * 100}%`,
              top: `${focusRing.y * 100}%`,
              animation: `focus-ring ${FOCUS_RING_MS}ms ease-out forwards`,
            }}
          />
        )}
        {flashing && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-white"
            style={{
              animation: `camera-flash ${FLASH_MS}ms ease-out forwards`,
            }}
          />
        )}
      </div>

      {/* Focus-peaking filter chain (see the peaking <img> above): grayscale
          -> Laplacian edge detect -> threshold (suppress weak/noise edges,
          keep strong in-focus ones) -> tint red so peaked edges read clearly
          against any scene colour, including this NoIR camera's palette. */}
      <svg width="0" height="0" className="absolute" aria-hidden>
        <defs>
          <filter id="focus-peaking" colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="0.33 0.33 0.33 0 0
                      0.33 0.33 0.33 0 0
                      0.33 0.33 0.33 0 0
                      0    0    0    1 0"
              result="gray"
            />
            <feConvolveMatrix
              in="gray"
              order="3"
              kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1"
              divisor="1"
              bias="0"
              edgeMode="duplicate"
              preserveAlpha="true"
              result="edges"
            />
            <feComponentTransfer in="edges" result="thresholded">
              <feFuncR type="linear" slope="4" intercept="-0.7" />
              <feFuncG type="linear" slope="4" intercept="-0.7" />
              <feFuncB type="linear" slope="4" intercept="-0.7" />
            </feComponentTransfer>
            <feColorMatrix
              in="thresholded"
              type="matrix"
              values="1 1 1 0 0
                      0 0 0 0 0
                      0 0 0 0 0
                      0.33 0.33 0.33 0 0"
            />
          </filter>
        </defs>
      </svg>
    </div>
  );
}
