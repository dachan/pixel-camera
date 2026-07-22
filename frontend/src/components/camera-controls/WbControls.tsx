"use client";

import { useEffect, useState } from "react";
import {
  getWhiteBalance,
  setWhiteBalance,
  getTuning,
  setTuning as saveTuning,
  type CameraTuning,
  type WhiteBalanceMode,
  type WhiteBalanceState,
} from "@/lib/camera-api";
import { usePolling } from "@/lib/use-polling";
import Button from "@/components/_shared/Button";
import ButtonGroup from "@/components/_shared/ButtonGroup";
import Slider, { SliderInput } from "@/components/_shared/Slider";

// Colour-tuning tabs (NoIR sensors only), shown at the top of the WB panel.
// "standard" swaps in the filtered variant's tuning so the AWB presets work —
// hence it lives here in the WB panel rather than in Settings.
const TUNING_TABS = [
  { id: "default", label: "NoIR" },
  { id: "standard", label: "Standard" },
] as const;

// Same Auto/Manual tab pair as Exposure and Focus, so all three panels look
// consistent — Auto and Manual always sit beside each other, never mixed in
// with the preset buttons below.
const MODE_TABS = [
  { id: "auto", label: "Auto" },
  { id: "manual", label: "Manual" },
] as const;

// AWB presets, shown as buttons under the Auto/Manual tabs — each is a
// variant of "auto" (still AWB-driven, not manual gains).
const PRESETS: { value: WhiteBalanceMode; label: string }[] = [
  { value: "incandescent", label: "Incandescent" },
  { value: "tungsten", label: "Tungsten" },
  { value: "fluorescent", label: "Fluorescent" },
  { value: "indoor", label: "Indoor" },
  { value: "daylight", label: "Daylight" },
  { value: "cloudy", label: "Cloudy" },
];

const TEMP_FACTOR = 2.0;
const TINT_FACTOR = 1.5;

export default function WbControls() {
  const [wb, setWb] = useState<WhiteBalanceState | null>(null);
  const [tuning, setTuning] = useState<CameraTuning | null>(null);
  const [tuningBusy, setTuningBusy] = useState(false);
  const [wbAdjust, setWbAdjust] = useState<{
    temp: number;
    tint: number;
    r0: number;
    b0: number;
  } | null>(null);

  function adoptWb(next: WhiteBalanceState) {
    setWb(next);
    if (next.mode === "manual") {
      setWbAdjust(
        (prev) =>
          prev ?? { temp: 0, tint: 0, r0: next.red_gain, b0: next.blue_gain },
      );
    } else {
      setWbAdjust(null);
    }
  }

  useEffect(() => {
    getWhiteBalance()
      .then(adoptWb)
      .catch(() => {});
    getTuning()
      .then(setTuning)
      .catch(() => {});
  }, []);

  function applyTuning(value: "default" | "standard") {
    setTuning((prev) => (prev ? { ...prev, tuning: value } : prev));
    setTuningBusy(true);
    saveTuning({ tuning: value })
      .then((t) => {
        setTuning(t);
        // Switching tuning flips presets_supported — refetch WB to reflect it.
        return getWhiteBalance().then(adoptWb);
      })
      .catch(() => {})
      .finally(() => setTuningBusy(false));
  }

  usePolling(
    () => {
      getWhiteBalance()
        .then(adoptWb)
        .catch(() => {});
    },
    1500,
    wb !== null && wb.mode !== "manual",
  );

  function applyWb(patch: Partial<WhiteBalanceState>) {
    setWb((prev) => (prev ? { ...prev, ...patch } : prev));
    setWhiteBalance(patch)
      .then(setWb)
      .catch(() => {});
  }

  function wbGainsFor(adjust: NonNullable<typeof wbAdjust>) {
    const kTemp = Math.pow(TEMP_FACTOR, adjust.temp);
    const kTint = Math.pow(TINT_FACTOR, adjust.tint);
    const clamp = (v: number) => Math.min(8, Math.max(0.1, v));
    return {
      red_gain: clamp(adjust.r0 * kTemp * kTint),
      blue_gain: clamp((adjust.b0 / kTemp) * kTint),
    };
  }

  function enterManualWb() {
    if (!wb) return;
    const anchor = { temp: 0, tint: 0, r0: wb.red_gain, b0: wb.blue_gain };
    setWbAdjust(anchor);
    applyWb({ mode: "manual", ...wbGainsFor(anchor) });
  }

  function adjustWb(patch: { temp?: number; tint?: number }) {
    if (!wbAdjust) return;
    const next = { ...wbAdjust, ...patch };
    setWbAdjust(next);
    applyWb(wbGainsFor(next));
  }

  if (!wb) {
    return <p className="text-sm text-stone-500">loading…</p>;
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      {tuning?.available && (
        <div className="flex shrink-0 items-center justify-center">
          <ButtonGroup
            items={TUNING_TABS}
            active={tuning.tuning}
            onChange={applyTuning}
          />
        </div>
      )}

      <div className="flex shrink-0 items-center justify-center">
        <ButtonGroup
          items={MODE_TABS}
          active={wb.mode === "manual" ? "manual" : "auto"}
          onChange={(id) =>
            id === "manual" ? enterManualWb() : applyWb({ mode: "auto" })
          }
        />
      </div>

      {wb.presets_supported && wb.mode !== "manual" && (
        <div className="flex shrink-0 flex-col gap-2">
          <h2 className="text-sm font-semibold text-stone-700">Presets</h2>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((preset) => {
              const active = wb.mode === preset.value;
              return (
                <Button
                  key={preset.value}
                  variant="secondary"
                  selected={active}
                  onClick={() => applyWb({ mode: preset.value })}
                >
                  {preset.label}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {!wb.presets_supported && (
        <p className="shrink-0 text-center text-xs text-stone-500">
          This NoIR sensor ignores WB presets — use Manual gains to shift
          colour.
        </p>
      )}
      {wb.mode === "manual" && wbAdjust ? (
        <div className="flex flex-col gap-3">
          {(
            [
              {
                key: "temp",
                label: "Temp",
                gradient:
                  "linear-gradient(to right, #6ab0ff, #f4f4f5, #ffb057)",
              },
              {
                key: "tint",
                label: "Tint",
                gradient:
                  "linear-gradient(to right, #7bd88f, #f4f4f5, #e08ae0)",
              },
            ] as const
          ).map(({ key, label, gradient }) => (
            <Slider
              key={key}
              orientation="horizontal"
              label={label}
              value={Math.round(wbAdjust[key] * 100)}
            >
              {/* One-off gradient track: painted behind a transparent range track. */}
              <div className="relative flex h-12 min-w-0 flex-1 items-center">
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-1/2 z-0 h-1.5 -translate-y-1/2 rounded-full"
                  style={{ background: gradient }}
                />
                <SliderInput
                  orientation="horizontal"
                  min={-100}
                  max={100}
                  step={1}
                  value={Math.round(wbAdjust[key] * 100)}
                  onChange={(e) =>
                    adjustWb({ [key]: Number(e.target.value) / 100 })
                  }
                  className="relative z-10 [&::-moz-range-track]:!bg-transparent [&::-webkit-slider-runnable-track]:!bg-transparent [&::-moz-range-thumb]:!size-8 [&::-moz-range-thumb]:!bg-stone-100 [&::-webkit-slider-thumb]:!-mt-3.25 [&::-webkit-slider-thumb]:!size-8 [&::-webkit-slider-thumb]:!bg-stone-100"
                />
              </div>
            </Slider>
          ))}
          <p className="text-center font-mono text-xs text-stone-700">
            R {wb.red_gain.toFixed(2)} · B {wb.blue_gain.toFixed(2)}
          </p>
        </div>
      ) : (
        <p className="text-center font-mono text-xs text-stone-700">
          live gains · R {wb.red_gain.toFixed(2)} · B {wb.blue_gain.toFixed(2)}
        </p>
      )}

      {tuningBusy && (
        <p className="shrink-0 text-center text-xs text-stone-500">
          Restarting camera…
        </p>
      )}
    </div>
  );
}
