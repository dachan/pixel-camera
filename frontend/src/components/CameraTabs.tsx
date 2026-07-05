"use client";

import { useState } from "react";
import { CameraPreview } from "@/components/CaptureView";
import CameraControls from "@/components/CameraControls";
import CameraMeta from "@/components/CameraMeta";
import CaptureGallery from "@/components/CaptureGallery";
import CameraSettings from "@/components/CameraSettings";
import Tabs from "@/components/Tabs";
import { useStoredBool } from "@/lib/use-stored-bool";

const TABS = [
  { id: "camera", label: "Camera" },
  { id: "meta", label: "Meta" },
  { id: "gallery", label: "Gallery" },
  { id: "settings", label: "Settings" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function CameraTabs() {
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
    <div className="flex w-full flex-1 flex-col gap-3 overflow-hidden">
      <Tabs tabs={TABS} active={active} onChange={setActive} />

      <div className="min-h-0 flex-1 w-full">
        {active === "camera" ? (
          <div className="flex gap-4 w-full h-full">
            <div className="w-2/3 flex items-center justify-center overflow-hidden h-full">
              <CameraPreview showGrid={showGrid} />
            </div>
            <div className="w-1/3">
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
