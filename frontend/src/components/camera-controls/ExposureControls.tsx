"use client";

import { useEffect, useState } from "react";
import {
  getControls,
  setControls,
  type CameraControlsState,
} from "@/lib/camera-api";
import { usePolling } from "@/lib/use-polling";
import Tabs from "@/components/_shared/Tabs";
import VerticalSlider, {
  VerticalSliderInput,
} from "@/components/_shared/VerticalSlider";

const MODE_TABS = [
  { id: "auto", label: "Auto" },
  { id: "manual", label: "Manual" },
] as const;

const SHUTTER_STEPS = [
  500, 1000, 2000, 4000, 8000, 10000, 16667, 33333, 66667, 125000, 250000,
  500000, 1000000,
];

function shutterLabel(us: number): string {
  if (us >= 1_000_000) return `${(us / 1_000_000).toFixed(1)}s`;
  return `1/${Math.round(1_000_000 / us)}s`;
}

function nearestShutterIndex(us: number): number {
  let best = 0;
  let bestDiff = Infinity;
  SHUTTER_STEPS.forEach((s, i) => {
    const d = Math.abs(s - us);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  });
  return best;
}

export default function ExposureControls() {
  const [state, setState] = useState<CameraControlsState>({
    auto_exposure: true,
    iso: 100,
    shutter_us: 10000,
  });

  useEffect(() => {
    getControls()
      .then(setState)
      .catch(() => {});
  }, []);

  usePolling(
    () => {
      getControls()
        .then(setState)
        .catch(() => {});
    },
    500,
    state.auto_exposure,
  );

  function apply(patch: Partial<CameraControlsState>) {
    setState((prev) => ({ ...prev, ...patch }));
    setControls(patch)
      .then(setState)
      .catch(() => {});
  }

  const manual = !state.auto_exposure;
  const isoSliderValue = Math.min(
    1600,
    Math.max(100, Math.round(state.iso / 100) * 100),
  );
  const shutterIdx = nearestShutterIndex(state.shutter_us);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex shrink-0 items-center justify-center">
        <Tabs
          tabs={MODE_TABS}
          active={manual ? "manual" : "auto"}
          onChange={(id) => apply({ auto_exposure: id === "auto" })}
        />
      </div>

      <div className="flex h-full justify-around gap-2 overflow-hidden">
        <VerticalSlider label="Shutter" value={shutterLabel(state.shutter_us)}>
          <VerticalSliderInput
            min={0}
            max={SHUTTER_STEPS.length - 1}
            step={1}
            value={shutterIdx}
            disabled={!manual}
            onChange={(e) =>
              apply({ shutter_us: SHUTTER_STEPS[Number(e.target.value)] })
            }
          />
        </VerticalSlider>

        <VerticalSlider label="ISO" value={state.iso}>
          <VerticalSliderInput
            min={100}
            max={1600}
            step={100}
            value={isoSliderValue}
            disabled={!manual}
            onChange={(e) => apply({ iso: Number(e.target.value) })}
          />
        </VerticalSlider>

        <VerticalSlider label="Aperture" value="Fixed">
          <VerticalSliderInput disabled value={0} readOnly />
        </VerticalSlider>
      </div>
    </div>
  );
}
