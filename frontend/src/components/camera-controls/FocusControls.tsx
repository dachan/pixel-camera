"use client";

import { setFocus } from "@/lib/camera-api";
import { useFocus, useSetFocus } from "@/lib/focus-context";
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
      {/* No overflow-hidden here (unlike an earlier revision): min-h-0 is what
          actually constrains the slider's height, while clipping cut the top
          2px off the label's lock icon, which sits on a -2px optical nudge.
          Matches the Exposure row, which has the same sliders un-clipped. */}
      <div className="flex min-h-0 flex-1 items-stretch justify-center gap-3">
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
            bottom, so the last label's bottom lands on it.

            The row centres its columns, so the horizontal margins here and on
            the peaking block below are a tuned set, not independent knobs:
            changing one shifts its neighbours by half as much. Measured on the
            Pi's 800x480 screen. */}
        <div className="mr-[17px] ml-[-16px] flex shrink-0 flex-col justify-between pt-11 text-left font-mono text-xs text-stone-500">
          <span>Closer</span>
          <span>Infinity</span>
        </div>

        {/* Right margin keeps this block clear of the panel's right edge on
            the Pi's 800x480 screen, where it was once cut off by 19px. The
            50px nudge is a transform, not a margin, so it shifts this block
            alone — a margin would re-centre the whole row and drag its
            neighbours along. */}
        {onPeakingChange && (
          // Label included in the hit target — see SettingToggle.
          <div
            onClick={() => onPeakingChange(!peaking)}
            className="mr-[6px] flex shrink-0 -translate-x-[50px] cursor-pointer flex-col items-start justify-center gap-2"
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
