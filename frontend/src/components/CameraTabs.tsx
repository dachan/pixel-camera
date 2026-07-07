"use client";

import { useState } from "react";
import { CameraPreview } from "@/components/CaptureView";
import CameraControls from "@/components/camera-controls/CameraControls";
import CameraMeta from "@/components/CameraMeta";
import CaptureGallery from "@/components/CaptureGallery";
import CameraSettings from "@/components/CameraSettings";
import Tabs from "@/components/_shared/Tabs";
import { useStoredBool } from "@/lib/use-stored-bool";
import { useReloadOnRestart } from "@/lib/use-reload-on-restart";

const TABS = [
  { id: "camera", label: "Camera" },
  { id: "meta", label: "Meta" },
  { id: "gallery", label: "Gallery" },
  { id: "settings", label: "Settings" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function CameraTabs() {
  // Auto-reload the kiosk after a deploy (backend restart bumps its token).
  useReloadOnRestart();

  const [active, setActive] = useState<TabId>("camera");
  // Rule-of-thirds overlay on the live preview; defaults on, persisted locally.
  const [showGrid, setShowGrid] = useStoredBool("showGrid", true);
  // On-screen Capture button; defaults on. Off is for setups relying solely
  // on the physical GPIO shutter button, to keep the kiosk UI uncluttered.
  const [showCaptureButton, setShowCaptureButton] = useStoredBool(
    "showCaptureButton",
    true,
  );

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4 overflow-hidden px-3">
      <Tabs tabs={TABS} active={active} onChange={setActive} />
      <div className="min-h-0 w-full flex-1 p-3">
        {active === "camera" ? (
          <div className="flex h-full w-full flex-col gap-4">
            <div className="flex min-h-0 w-full flex-1 items-center justify-center">
              <CameraPreview showGrid={showGrid} />
            </div>
            <div className="flex h-80 w-full shrink-0 flex-col">
              <CameraControls showCaptureButton={showCaptureButton} />
            </div>
          </div>
        ) : active === "meta" ? (
          <CameraMeta />
        ) : active === "gallery" ? (
          <CaptureGallery />
        ) : (
          <CameraSettings
            showGrid={showGrid}
            onGridChange={setShowGrid}
            showCaptureButton={showCaptureButton}
            onCaptureButtonChange={setShowCaptureButton}
          />
        )}
      </div>
    </div>
  );
}
