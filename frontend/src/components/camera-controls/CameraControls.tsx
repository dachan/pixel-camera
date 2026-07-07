"use client";

import { useState } from "react";
import { capture } from "@/lib/camera-api";
import { errorMessage } from "@/lib/errors";
import Tabs from "@/components/_shared/Tabs";
import Button from "@/components/_shared/Button";
import ExposureControls from "@/components/camera-controls/ExposureControls";
import FocusControls from "@/components/camera-controls/FocusControls";
import WbControls from "@/components/camera-controls/WbControls";

const CONTROL_TABS = [
  { id: "exposure", label: "Exposure" },
  { id: "focus", label: "Focus" },
  { id: "wb", label: "WB" },
] as const;

type ControlTabId = (typeof CONTROL_TABS)[number]["id"];

export default function CameraControls({
  showCaptureButton = true,
}: {
  showCaptureButton?: boolean;
}) {
  const [panel, setPanel] = useState<ControlTabId>("exposure");
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
    <section className="flex h-full flex-col gap-4">
      <div className="shrink-0">
        <Tabs tabs={CONTROL_TABS} active={panel} onChange={setPanel} />
      </div>

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
        <p className="text-center text-sm text-destructive-border">
          Capture failed: {captureError}
        </p>
      )}
    </section>
  );
}
