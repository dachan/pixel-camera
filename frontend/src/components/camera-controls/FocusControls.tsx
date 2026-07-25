"use client";

import { useApplyFocus, useFocus } from "@/lib/focus-context";
import Slider, { SliderInput } from "@/components/_shared/Slider";
import Switch from "@/components/_shared/Switch";

export default function FocusControls({
  peaking = true,
  onPeakingChange,
}: {
  peaking?: boolean;
  onPeakingChange?: (next: boolean) => void;
}) {
  const focus = useFocus();
  const applyFocus = useApplyFocus();

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
      {/* No overflow-hidden here (unlike an earlier revision): min-h-0 is what
          actually constrains the slider's height, while clipping cut the top
          2px off the label's lock icon, which sits on a -2px optical nudge.
          Matches the Exposure row, which has the same sliders un-clipped. */}
      <div className="relative flex min-h-0 flex-1 items-stretch justify-start gap-3">
        {/* Fixed-width column: Slider's root is w-full, so left unbounded it
            would stretch and shove the side columns to the panel edges. */}
        <div className="flex w-16 shrink-0 justify-center">
          <Slider
            label="Lens"
            value={(focus.lens_position ?? 0).toFixed(2)}
            lockable={focus.af_mode === "manual"}
          >
            <SliderInput
              min={focus.min ?? 0}
              max={focus.max ?? 10}
              step={0.05}
              value={focus.lens_position ?? 0}
              thumbContent={focus.af_mode === "manual" ? "M" : "A"}
              onTap={() =>
                applyFocus({
                  af_mode: focus.af_mode === "manual" ? "continuous" : "manual",
                })
              }
              onChange={(e) => {
                if (focus.af_mode === "manual") {
                  applyFocus({
                    af_mode: "manual",
                    lens_position: Number(e.target.value),
                  });
                }
              }}
            />
          </Slider>
        </div>

        {/* Track-end labels, right of the track. The lens position is a
            dioptre value: 0 sits at the bottom of the slider and focuses at
            infinity, higher values at the top focus closer.

            Both labels sit entirely within the track's height rather than
            straddling its ends: pt-11 (44px) drops the first label's top onto
            the track top, clearing the Slider's two-line label/value header
            plus its gap-4, and the column's own bottom is already the track
            bottom, so the last label's bottom lands on it. */}
        <div className="mr-4.25 -ml-4 flex shrink-0 flex-col justify-between pt-11 text-left font-mono text-xs text-stone-500">
          <span>Closer</span>
          <span>Infinity</span>
        </div>

        {/* Centered in the panel horizontally (and vertically) so it sits in
            the middle of the focus column rather than beside the slider.
            Label included in the hit target — see SettingToggle. */}
        {onPeakingChange && (
          <div
            onClick={() => onPeakingChange(!peaking)}
            className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center gap-2"
          >
            <span className="font-mono text-xs leading-none font-semibold text-stone-500">
              Focus Peaking
            </span>
            <Switch checked={peaking} onChange={onPeakingChange} />
          </div>
        )}
      </div>
    </div>
  );
}
