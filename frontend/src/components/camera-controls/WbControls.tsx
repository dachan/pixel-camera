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
import ButtonGroup from "@/components/_shared/ButtonGroup";
import Slider, { SliderInput } from "@/components/_shared/Slider";

// Colour-tuning tabs (NoIR sensors only), shown at the top of the WB panel.
// "standard" swaps in the filtered variant's tuning so the AWB presets work —
// hence it lives here in the WB panel rather than in Settings.
const TUNING_TABS = [
  { id: "default", label: "NoIR" },
  { id: "standard", label: "Standard" },
] as const;

const MODE_TABS = [
  { id: "auto", label: "Auto" },
  { id: "manual", label: "Manual" },
] as const;

// AWB presets, shown as buttons under the Auto/Manual tabs — each is a
// variant of "auto" (still AWB-driven, not manual gains).
const PRESETS: { id: WhiteBalanceMode; label: string }[] = [
  { id: "incandescent", label: "Incandescent" },
  { id: "tungsten", label: "Tungsten" },
  { id: "fluorescent", label: "Fluorescent" },
  { id: "indoor", label: "Indoor" },
  { id: "daylight", label: "Daylight" },
  { id: "cloudy", label: "Cloudy" },
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
    Promise.all([getWhiteBalance(), getTuning()])
      .then(async ([next, nextTuning]) => {
        setTuning(nextTuning);
        if (nextTuning.tuning === "default" && next.mode !== "manual") {
          const manual = await setWhiteBalance({
            mode: "manual",
            red_gain: next.red_gain,
            blue_gain: next.blue_gain,
          });
          adoptWb(manual);
          return;
        }
        adoptWb(next);
      })
      .catch(() => {});
  }, []);

  function applyTuning(value: "default" | "standard") {
    setTuning((prev) => (prev ? { ...prev, tuning: value } : prev));
    setTuningBusy(true);
    saveTuning({ tuning: value })
      .then(async (t) => {
        setTuning(t);
        // NoIR's greyworld tuning is a manual-gain workflow. Preserve the
        // current live gains when entering it, then expose fixed M controls.
        const next = await getWhiteBalance();
        if (value === "default" && next.mode !== "manual") {
          const manual = await setWhiteBalance({
            mode: "manual",
            red_gain: next.red_gain,
            blue_gain: next.blue_gain,
          });
          adoptWb(manual);
          return;
        }
        adoptWb(next);
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

  function enterAutoWb() {
    setWbAdjust(null);
    applyWb({ mode: "auto" });
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

  const showWbSliders = tuning?.tuning !== "standard" || wb.mode === "manual";

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

      {tuning?.tuning === "standard" && (
        <div className="flex shrink-0 items-center justify-center">
          <ButtonGroup
            items={MODE_TABS}
            active={wb.mode === "manual" ? "manual" : "auto"}
            onChange={(id) =>
              id === "manual" ? enterManualWb() : enterAutoWb()
            }
          />
        </div>
      )}

      {wb.presets_supported && wb.mode !== "manual" && (
        <div className="flex shrink-0 flex-col gap-2">
          <h2 className="text-sm font-semibold text-stone-700">Presets</h2>
          <ButtonGroup
            items={PRESETS}
            active={wb.mode}
            onChange={(mode) => applyWb({ mode })}
            columns={2}
          />
        </div>
      )}

      {showWbSliders && (
        <>
          <div className="flex min-h-0 flex-1 justify-around gap-4">
            {(
              [
                {
                  key: "temp",
                  label: "Temp",
                  gradient:
                    "linear-gradient(to top, #6ab0ff, #f4f4f5, #ffb057)",
                },
                {
                  key: "tint",
                  label: "Tint",
                  gradient:
                    "linear-gradient(to top, #7bd88f, #f4f4f5, #e08ae0)",
                },
              ] as const
            ).map(({ key, label, gradient }) => {
              const adjust = wbAdjust?.[key] ?? 0;
              const manual = wb.mode === "manual";
              return (
                <Slider
                  key={key}
                  label={label}
                  value={Math.round(adjust * 100)}
                  lockable={manual}
                >
                  <div className="relative flex h-full min-h-0 w-12 justify-center">
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 left-1/2 z-0 w-1.5 -translate-x-1/2 rounded-full"
                      style={{ background: gradient }}
                    />
                    <SliderInput
                      min={-100}
                      max={100}
                      step={1}
                      value={Math.round(adjust * 100)}
                      thumbContent="M"
                      onChange={(e) => {
                        if (manual) {
                          adjustWb({ [key]: Number(e.target.value) / 100 });
                        }
                      }}
                      className="relative z-10 [&::-moz-range-track]:!bg-transparent [&::-webkit-slider-runnable-track]:!bg-transparent"
                    />
                  </div>
                </Slider>
              );
            })}
          </div>
          <p className="text-center font-mono text-xs text-stone-700">
            {wb.mode === "manual" ? "Manual Gains" : "Live Gains"} · R{" "}
            {wb.red_gain.toFixed(2)} · B {wb.blue_gain.toFixed(2)}
          </p>
        </>
      )}

      {tuningBusy && (
        <p className="shrink-0 text-center text-xs text-stone-500">
          Restarting camera…
        </p>
      )}
    </div>
  );
}
