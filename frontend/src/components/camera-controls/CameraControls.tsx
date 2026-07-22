"use client";

import { useState } from "react";
import { capture } from "@/lib/camera-api";
import { errorMessage } from "@/lib/errors";
import Button from "@/components/_shared/Button";
import ExposureControls from "@/components/camera-controls/ExposureControls";
import FocusControls from "@/components/camera-controls/FocusControls";
import WbControls from "@/components/camera-controls/WbControls";

// Tab list + active-tab type are shared with CameraTabs, which renders the
// tab selector itself (under the live preview) while this component renders
// the selected panel's content (beside the preview) — so the selector lives
// in a different part of the layout than the content it controls.
export const CONTROL_TABS = [
  { id: "exposure", label: "Exposure" },
  { id: "focus", label: "Focus" },
  { id: "wb", label: "White Balance" },
] as const;

export type ControlTabId = (typeof CONTROL_TABS)[number]["id"];

export default function CameraControls({
  panel,
  showCaptureButton = true,
}: {
  panel: ControlTabId;
  showCaptureButton?: boolean;
}) {
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  async function onCapture() {
    setCaptureBusy(true);
    setCaptureError(null);
    try {
      await capture();
    } catch (e) {
      setCaptureError(errorMessage(e));
    } finally {
      setCaptureBusy(false);
    }
  }

  return (
    <section className="flex h-full w-full flex-col gap-4">
      <div className="min-h-0 flex-1">
        {panel === "exposure" ? (
          <ExposureControls />
        ) : panel === "focus" ? (
          <FocusControls />
        ) : (
          <WbControls />
        )}
      </div>

      {showCaptureButton && (
        <Button onClick={onCapture} disabled={captureBusy}>
          {captureBusy ? "Capturing…" : "Capture"}
        </Button>
      )}
      {captureError && (
        <p className="text-center text-sm text-red-500">
          Capture failed: {captureError}
        </p>
      )}
    </section>
  );
}
