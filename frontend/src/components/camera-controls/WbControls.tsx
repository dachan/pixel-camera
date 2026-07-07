"use client";

import { useEffect, useState } from "react";
import {
  getWhiteBalance,
  setWhiteBalance,
  type WhiteBalanceMode,
  type WhiteBalanceState,
} from "@/lib/camera-api";
import { usePolling } from "@/lib/use-polling";

const PRESETS: { value: WhiteBalanceMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "incandescent", label: "Incandescent" },
  { value: "tungsten", label: "Tungsten" },
  { value: "fluorescent", label: "Fluorescent" },
  { value: "indoor", label: "Indoor" },
  { value: "daylight", label: "Daylight" },
  { value: "cloudy", label: "Cloudy" },
  { value: "manual", label: "Manual" },
];

const TEMP_FACTOR = 2.0;
const TINT_FACTOR = 1.5;

export default function WbControls() {
  const [wb, setWb] = useState<WhiteBalanceState | null>(null);
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
  }, []);

  usePolling(
    () => {
      getWhiteBalance()
        .then(adoptWb)
        .catch(() => {});
    },
    1000,
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
    return <p className="text-sm text-muted">loading…</p>;
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      <div className="grid shrink-0 grid-cols-2 gap-2">
        {(wb.presets_supported
          ? PRESETS
          : PRESETS.filter((p) => ["auto", "manual"].includes(p.value))
        ).map((preset) => {
          const active = wb.mode === preset.value;
          return (
            <button
              key={preset.value}
              type="button"
              onClick={() =>
                preset.value === "manual"
                  ? enterManualWb()
                  : applyWb({ mode: preset.value })
              }
              className={`rounded-xl border p-2.5 text-xs font-bold transition ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-primary-border text-primary hover:border-border-hover hover:text-primary-foreground"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {!wb.presets_supported && (
        <p className="shrink-0 text-center text-xs text-muted">
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
            <label key={key} className="flex items-center gap-3">
              <span className="w-8 text-xs font-bold text-muted">
                {label}
              </span>
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                value={Math.round(wbAdjust[key] * 100)}
                onChange={(e) =>
                  adjustWb({ [key]: Number(e.target.value) / 100 })
                }
                className="h-2 flex-1 cursor-pointer appearance-none accent-selected"
                style={{ background: gradient }}
              />
              <span className="w-10 text-right font-mono text-xs text-foreground">
                {Math.round(wbAdjust[key] * 100)}
              </span>
            </label>
          ))}
          <p className="text-center font-mono text-xs text-muted">
            R {wb.red_gain.toFixed(2)} · B {wb.blue_gain.toFixed(2)}
          </p>
        </div>
      ) : (
        <p className="text-center font-mono text-xs text-muted">
          live gains · R {wb.red_gain.toFixed(2)} · B {wb.blue_gain.toFixed(2)}
        </p>
      )}
    </div>
  );
}
