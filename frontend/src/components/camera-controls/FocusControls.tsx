"use client";

import { useEffect, useState } from "react";
import { getFocus, setFocus, type FocusState } from "@/lib/camera-api";
import { usePolling } from "@/lib/use-polling";
import Tabs from "@/components/_shared/Tabs";
import VerticalSlider, {
  VerticalSliderInput,
} from "@/components/_shared/VerticalSlider";

const MODE_TABS = [
  { id: "continuous", label: "Auto" },
  { id: "manual", label: "Manual" },
] as const;

export default function FocusControls() {
  const [focus, setFocusState] = useState<FocusState | null>(null);

  useEffect(() => {
    getFocus()
      .then(setFocusState)
      .catch(() => {});
  }, []);

  usePolling(
    () => {
      getFocus()
        .then(setFocusState)
        .catch(() => {});
    },
    1000,
  );

  function applyFocus(patch: {
    af_mode?: "continuous" | "manual";
    lens_position?: number;
  }) {
    setFocusState((prev) => (prev ? { ...prev, ...patch } : prev));
    setFocus(patch)
      .then(setFocusState)
      .catch(() => {});
  }

  if (!focus) {
    return <p className="text-sm text-zinc-500">loading…</p>;
  }

  if (!focus.available) {
    return (
      <p className="text-sm text-zinc-500">
        This camera has no focus control.
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex shrink-0 items-center justify-center">
        <Tabs
          tabs={MODE_TABS}
          active={focus.af_mode ?? "continuous"}
          onChange={(id) => applyFocus({ af_mode: id })}
        />
      </div>

      <div className="flex min-h-0 flex-1 justify-around gap-2 overflow-hidden">
        <VerticalSlider
          label="Lens"
          value={(focus.lens_position ?? 0).toFixed(2)}
        >
          <VerticalSliderInput
            min={focus.min ?? 0}
            max={focus.max ?? 10}
            step={0.05}
            value={focus.lens_position ?? 0}
            disabled={focus.af_mode !== "manual"}
            onChange={(e) =>
              applyFocus({
                af_mode: "manual",
                lens_position: Number(e.target.value),
              })
            }
          />
        </VerticalSlider>
      </div>

      <p className="shrink-0 text-center text-xs text-zinc-500">
        0 = infinity · higher = closer
      </p>
    </div>
  );
}
