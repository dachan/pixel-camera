"use client";

import { setFocus } from "@/lib/camera-api";
import { useFocus, useSetFocus } from "@/lib/focus-context";
import ButtonGroup from "@/components/_shared/ButtonGroup";
import Slider, {
  SliderInput,
} from "@/components/_shared/Slider";

const MODE_TABS = [
  { id: "continuous", label: "Auto" },
  { id: "manual", label: "Manual" },
] as const;

export default function FocusControls() {
  const focus = useFocus();
  const setFocusState = useSetFocus();

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
    return <p className="text-sm text-stone-500">loading…</p>;
  }

  if (!focus.available) {
    return (
      <p className="text-sm text-stone-500">
        This camera has no focus control.
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex shrink-0 items-center justify-center">
        <ButtonGroup
          items={MODE_TABS}
          active={focus.af_mode ?? "continuous"}
          onChange={(id) => applyFocus({ af_mode: id })}
        />
      </div>

      <div className="flex min-h-0 flex-1 justify-around gap-2 overflow-hidden">
        <Slider
          label="Lens"
          value={(focus.lens_position ?? 0).toFixed(2)}
        >
          <SliderInput
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
        </Slider>
      </div>

      <p className="shrink-0 text-center text-xs text-stone-500">
        0 = infinity · higher = closer
      </p>
    </div>
  );
}
