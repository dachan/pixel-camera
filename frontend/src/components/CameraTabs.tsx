"use client";

import { useState } from "react";
import { CameraPreview } from "@/components/CaptureView";
import CameraControls from "@/components/CameraControls";
import CameraMeta from "@/components/CameraMeta";
import CaptureGallery from "@/components/CaptureGallery";
import CameraSettings from "@/components/CameraSettings";
import Tabs from "@/components/Tabs";

const TABS = [
  { id: "camera", label: "Camera" },
  { id: "meta", label: "Meta" },
  { id: "gallery", label: "Gallery" },
  { id: "settings", label: "Settings" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function CameraTabs() {
  const [active, setActive] = useState<TabId>("camera");

  return (
    <div className="flex w-full flex-1 flex-col gap-3 overflow-hidden">
      <Tabs tabs={TABS} active={active} onChange={setActive} />

      <div className="min-h-0 flex-1 w-full">
        {active === "camera" ? (
          <div className="flex gap-4 w-full h-full">
            <div className="w-2/3 flex items-center justify-center overflow-hidden h-full">
              <CameraPreview />
            </div>
            <div className="w-1/3">
              <CameraControls />
            </div>
          </div>
        ) : active === "meta" ? (
          <CameraMeta />
        ) : active === "gallery" ? (
          <CaptureGallery />
        ) : (
          <CameraSettings />
        )}
      </div>
    </div>
  );
}
