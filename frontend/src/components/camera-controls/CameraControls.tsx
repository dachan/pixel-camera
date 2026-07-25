"use client";

import { useState } from "react";
import { capture } from "@/lib/camera-api";
import { errorMessage } from "@/lib/errors";
import Button from "@/components/_shared/Button";
import ExposureControls from "@/components/camera-controls/ExposureControls";
import FocusControls from "@/components/camera-controls/FocusControls";
import GridPicker from "@/components/camera-controls/GridPicker";
import WbControls from "@/components/camera-controls/WbControls";
import {
  CaptureIcon,
  ExposureIcon,
  FocusIcon,
  WhiteBalanceIcon,
} from "@/components/camera-controls/control-tab-icons";
import type { GridOverlayId } from "@/lib/grid-overlays";

// Tab list + active-tab type are shared with CameraTabs, which renders the
// tab selector itself (under the live preview) while this component renders
// the selected panel's content (beside the preview) — so the selector lives
// in a different part of the layout than the content it controls.
export const CONTROL_TABS = [
  { id: "exposure", label: "Exposure", icon: <ExposureIcon /> },
  { id: "focus", label: "Focus", icon: <FocusIcon /> },
  { id: "wb", label: "White Balance", icon: <WhiteBalanceIcon /> },
] as const;

export type ControlTabId = (typeof CONTROL_TABS)[number]["id"];

export default function CameraControls({
  panel,
  showCaptureButton = true,
  focusPeaking = true,
  onFocusPeakingChange,
  gridType,
  onGridTypeChange,
  gridOpacity,
  onGridOpacityChange,
}: {
  panel: ControlTabId;
  showCaptureButton?: boolean;
  focusPeaking?: boolean;
  onFocusPeakingChange?: (next: boolean) => void;
  gridType: GridOverlayId;
  onGridTypeChange: (next: GridOverlayId) => void;
  gridOpacity: number;
  onGridOpacityChange: (next: number) => void;
}) {
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  // The grid picker takes over the Focus panel; leaving Focus (or Camera
  // entirely) should always land back on the normal Focus slider, not a
  // stale picker. Adjusted during render (React's recommended pattern for
  // resetting state on a prop change) rather than in an effect, so the
  // panel never flashes a stale picker before an effect can catch up.
  const [gridPickerOpen, setGridPickerOpen] = useState(false);
  const [trackedPanel, setTrackedPanel] = useState(panel);
  if (panel !== trackedPanel) {
    setTrackedPanel(panel);
    if (panel !== "focus") setGridPickerOpen(false);
  }

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

  const gridPicker = panel === "focus" && gridPickerOpen;

  return (
    <section className="flex h-full w-full flex-col gap-8">
      <div className="min-h-0 flex-1">
        {gridPicker ? (
          <GridPicker
            gridType={gridType}
            onGridTypeChange={onGridTypeChange}
            gridOpacity={gridOpacity}
            onGridOpacityChange={onGridOpacityChange}
            onBack={() => setGridPickerOpen(false)}
          />
        ) : panel === "exposure" ? (
          <ExposureControls />
        ) : panel === "focus" ? (
          <FocusControls
            peaking={focusPeaking}
            onPeakingChange={onFocusPeakingChange}
            onOpenGridPicker={() => setGridPickerOpen(true)}
          />
        ) : (
          <WbControls />
        )}
      </div>

      {/* The picker carries its own Back button, so Capture stands down
          while it is open. */}
      {showCaptureButton && !gridPicker && (
        <Button
          onClick={onCapture}
          disabled={captureBusy}
          className="flex h-10.5 items-center justify-center gap-1.5"
        >
          <CaptureIcon />
          {/* Nudge the label down 1px so it doesn't read high beside the icon. */}
          <span className="translate-y-px">
            {captureBusy ? "Capturing…" : "Capture"}
          </span>
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
