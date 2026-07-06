"use client";

import { useEffect, useState, type InputHTMLAttributes, type ReactNode } from "react";
import {
  capture,
  getControls,
  setControls,
  getFocus,
  setFocus,
  getWhiteBalance,
  setWhiteBalance,
  type CameraControlsState,
  type FocusState,
  type WhiteBalanceMode,
  type WhiteBalanceState,
} from "@/lib/camera-api";
import { errorMessage } from "@/lib/errors";
import { usePolling } from "@/lib/use-polling";
import Tabs from "@/components/Tabs";

const CONTROL_TABS = [
  { id: "exposure", label: "Exposure" },
  { id: "focus", label: "Focus" },
  { id: "wb", label: "WB" },
] as const;

type ControlTabId = (typeof CONTROL_TABS)[number]["id"];

const EXPOSURE_TABS = [
  { id: "auto", label: "Auto" },
  { id: "manual", label: "Manual" },
] as const;

const FOCUS_TABS = [
  { id: "continuous", label: "Auto" },
  { id: "manual", label: "Manual" },
] as const;

// White-balance presets offered in the UI, in rough warm→cool order.
const WB_PRESETS: { value: WhiteBalanceMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "incandescent", label: "Incandescent" },
  { value: "tungsten", label: "Tungsten" },
  { value: "fluorescent", label: "Fluorescent" },
  { value: "indoor", label: "Indoor" },
  { value: "daylight", label: "Daylight" },
  { value: "cloudy", label: "Cloudy" },
  { value: "manual", label: "Manual" },
];

// Standard shutter speeds (microseconds) the slider steps through.
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

const VERTICAL_SLIDER_CLASS = [
  "w-12 min-h-0 cursor-pointer appearance-none bg-transparent",
  "[writing-mode:vertical-lr] [direction:rtl]",
  "disabled:cursor-not-allowed disabled:opacity-40",
  "[&::-webkit-slider-runnable-track]:h-full [&::-webkit-slider-runnable-track]:w-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-zinc-700",
  "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-12 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:-ml-[21px]",
  "disabled:[&::-webkit-slider-thumb]:bg-zinc-500",
  "[&::-moz-range-track]:h-full [&::-moz-range-track]:w-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:border-0 [&::-moz-range-track]:bg-zinc-700",
  "[&::-moz-range-thumb]:size-12 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-blue-500",
  "disabled:[&::-moz-range-thumb]:bg-zinc-500",
].join(" ");

function VerticalSlider(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return (
    <input
      {...rest}
      type="range"
      className={[VERTICAL_SLIDER_CLASS, "block flex-1 self-stretch", className]
        .filter(Boolean)
        .join(" ")}
      {...({ orient: "vertical" } as InputHTMLAttributes<HTMLInputElement>)}
    />
  );
}

type SliderControlProps = {
  label: string;
  value: ReactNode;
  children: ReactNode;
};

function SliderControl({ label, value, children }: SliderControlProps) {
  return (
    <label className="flex h-full w-full min-w-0 flex-col items-center gap-4">
      <div className="flex w-full min-w-0 flex-col items-center gap-0.5">
        <span className="w-full truncate text-sm text-center font-bold text-zinc-500">
          {label}
        </span>
        <span className="font-mono text-xs text-zinc-300">{value}</span>
      </div>
      <div className="flex h-full min-h-0 w-full justify-center">
        {children}
      </div>
    </label>
  );
}

export default function CameraControls({
  showCaptureButton = true,
}: {
  showCaptureButton?: boolean;
}) {
  const [panel, setPanel] = useState<ControlTabId>("exposure");
  const [state, setState] = useState<CameraControlsState>({
    auto_exposure: true,
    iso: 100,
    shutter_us: 10000,
  });
  const [focus, setFocusState] = useState<FocusState | null>(null);
  const [wb, setWb] = useState<WhiteBalanceState | null>(null);
  // Manual-WB adjustment state: Temperature/Tint slider positions plus the
  // anchor gains they adjust relative to (what AWB had chosen when manual
  // mode was entered). Null outside manual mode.
  const [wbAdjust, setWbAdjust] = useState<{
    temp: number; // -1 (cool) .. +1 (warm)
    tint: number; // -1 (green) .. +1 (magenta)
    r0: number;
    b0: number;
  } | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  // Adopt fetched WB state; if the camera is already in manual (page load,
  // another client switched it), anchor the sliders at its current gains.
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

  // Refetch on every panel switch: tap-to-focus on the preview can flip the
  // camera from manual to continuous behind this component's back.
  useEffect(() => {
    getFocus().then(setFocusState).catch(() => {});
    getWhiteBalance().then(adoptWb).catch(() => {});
  }, [panel]);

  // In auto mode, poll so sliders reflect live AE values. (State starts in
  // auto, so the first tick doubles as the initial fetch; if the backend is
  // actually in manual mode, that response stops the polling.)
  usePolling(
    () => {
      getControls()
        .then(setState)
        .catch(() => {});
    },
    500,
    state.auto_exposure,
  );

  // Poll focus state whenever the panel is visible — not just in continuous
  // mode. A tap-to-focus on the preview flips the camera to continuous
  // behind this panel's back, and gating the poll on the panel's own
  // (possibly stale) belief meant it could never correct itself.
  usePolling(
    () => {
      getFocus().then(setFocusState).catch(() => {});
    },
    1000,
    panel === "focus",
  );
  usePolling(
    () => {
      getWhiteBalance().then(adoptWb).catch(() => {});
    },
    1000,
    panel === "wb" && wb !== null && wb.mode !== "manual",
  );

  // Push a change to the backend and adopt the returned (authoritative) state.
  function apply(patch: Partial<CameraControlsState>) {
    setState((prev) => ({ ...prev, ...patch })); // optimistic
    setControls(patch)
      .then(setState)
      .catch(() => {});
  }

  function applyFocus(patch: { af_mode?: "continuous" | "manual"; lens_position?: number }) {
    setFocusState((prev) => (prev ? { ...prev, ...patch } : prev)); // optimistic
    setFocus(patch)
      .then(setFocusState)
      .catch(() => {});
  }

  function applyWb(patch: Partial<WhiteBalanceState>) {
    setWb((prev) => (prev ? { ...prev, ...patch } : prev)); // optimistic
    setWhiteBalance(patch)
      .then(setWb)
      .catch(() => {});
  }

  // Temperature/Tint are the perceptual axes of the same two degrees of
  // freedom as the red/blue gains: temp trades red against blue (warm/cool),
  // tint moves both against green (magenta/green). Full deflection doubles/
  // halves the red:blue ratio (temp) or scales both by 1.5x (tint).
  const TEMP_FACTOR = 2.0;
  const TINT_FACTOR = 1.5;

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
    // Anchor at the gains AWB is currently using, so manual starts from a
    // sensible neutral and the sliders sit centred.
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

  async function onCapture() {
    // The shutter flash on the live preview is driven by the backend's
    // /api/capture/events SSE stream (see CameraPreview), not from here —
    // that's what makes it play identically for the physical shutter button.
    setCaptureBusy(true);
    setCaptureError(null);
    try {
      await capture();
    } catch (e) {
      setCaptureError(errorMessage(e));
    } finally {
      setCaptureBusy(false);
    }
  }

  const manual = !state.auto_exposure;
  const isoSliderValue = Math.min(
    1600,
    Math.max(100, Math.round(state.iso / 100) * 100)
  );
  const shutterIdx = nearestShutterIndex(state.shutter_us);

  return (
    <section className="flex flex-col gap-4 h-full">
      <div className="shrink-0">
        <Tabs tabs={CONTROL_TABS} active={panel} onChange={setPanel} />
      </div>

      <div className="min-h-0 flex-1">
        {panel === "exposure" ? (
          <div className="flex h-full flex-col gap-4">
            <div className="flex shrink-0 items-center justify-center">
              <Tabs
                tabs={EXPOSURE_TABS}
                active={manual ? "manual" : "auto"}
                onChange={(id) => apply({ auto_exposure: id === "auto" })}
              />
            </div>

            <div className="flex justify-around h-full overflow-hidden gap-2">
              <SliderControl label="Shutter" value={shutterLabel(state.shutter_us)}>
                <VerticalSlider
                  min={0}
                  max={SHUTTER_STEPS.length - 1}
                  step={1}
                  value={shutterIdx}
                  disabled={!manual}
                  onChange={(e) =>
                    apply({ shutter_us: SHUTTER_STEPS[Number(e.target.value)] })
                  }
                />
              </SliderControl>

              <SliderControl label="ISO" value={state.iso}>
                <VerticalSlider
                  min={100}
                  max={1600}
                  step={100}
                  value={isoSliderValue}
                  disabled={!manual}
                  onChange={(e) => apply({ iso: Number(e.target.value) })}
                />
              </SliderControl>

              <SliderControl label="Aperture" value="Fixed">
                <VerticalSlider disabled value={0} readOnly />
              </SliderControl>
            </div>
          </div>
        ) : panel === "focus" ? (
          !focus ? (
            <p className="text-sm text-zinc-500">loading…</p>
          ) : !focus.available ? (
            <p className="text-sm text-zinc-500">
              This camera has no focus control.
            </p>
          ) : (
            <div className="flex h-full flex-col gap-4">
              <div className="flex shrink-0 items-center justify-center">
                <Tabs
                  tabs={FOCUS_TABS}
                  active={focus.af_mode ?? "continuous"}
                  onChange={(id) => applyFocus({ af_mode: id })}
                />
              </div>

              <div className="flex justify-around h-full overflow-hidden gap-2">
                <SliderControl
                  label="Lens"
                  value={(focus.lens_position ?? 0).toFixed(2)}
                >
                  <VerticalSlider
                    min={focus.min ?? 0}
                    max={focus.max ?? 10}
                    step={0.05}
                    value={focus.lens_position ?? 0}
                    disabled={focus.af_mode !== "manual"}
                    onChange={(e) =>
                      // Always reassert manual: a tap-to-focus on the preview
                      // silently flips the camera to continuous, and a
                      // lens-only update would be ignored there — the slider
                      // would feel dead.
                      applyFocus({
                        af_mode: "manual",
                        lens_position: Number(e.target.value),
                      })
                    }
                  />
                </SliderControl>
              </div>

              <p className="shrink-0 text-center text-xs text-zinc-500">
                0 = infinity · higher = closer
              </p>
            </div>
          )
        ) : !wb ? (
          <p className="text-sm text-zinc-500">loading…</p>
        ) : (
          <div className="flex h-full flex-col gap-3 overflow-y-auto">
            <div className="grid shrink-0 grid-cols-2 gap-2">
              {(wb.presets_supported
                ? WB_PRESETS
                : WB_PRESETS.filter((p) =>
                    ["auto", "manual"].includes(p.value),
                  )
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
                        ? "border-blue-500 bg-blue-600 text-white"
                        : "border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white"
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            {!wb.presets_supported && (
              <p className="shrink-0 text-center text-xs text-zinc-500">
                This NoIR sensor ignores WB presets — use Manual gains to
                shift colour.
              </p>
            )}
            {wb.mode === "manual" && wbAdjust ? (
              <div className="flex flex-col gap-3">
                {(
                  [
                    {
                      key: "temp",
                      label: "Temp",
                      // Drag right = image warmer (amber), left = cooler.
                      gradient:
                        "linear-gradient(to right, #6ab0ff, #f4f4f5, #ffb057)",
                    },
                    {
                      key: "tint",
                      label: "Tint",
                      // Drag right = magenta, left = green.
                      gradient:
                        "linear-gradient(to right, #7bd88f, #f4f4f5, #e08ae0)",
                    },
                  ] as const
                ).map(({ key, label, gradient }) => (
                  <label key={key} className="flex items-center gap-3">
                    <span className="w-8 text-xs font-bold text-zinc-500">
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
                      className="h-2 flex-1 cursor-pointer appearance-none rounded-full accent-blue-600"
                      style={{ background: gradient }}
                    />
                    <span className="w-10 text-right font-mono text-xs text-zinc-100">
                      {Math.round(wbAdjust[key] * 100)}
                    </span>
                  </label>
                ))}
                <p className="text-center font-mono text-xs text-zinc-500">
                  R {wb.red_gain.toFixed(2)} · B {wb.blue_gain.toFixed(2)}
                </p>
              </div>
            ) : (
              <p className="text-center font-mono text-xs text-zinc-500">
                live gains · R {wb.red_gain.toFixed(2)} · B{" "}
                {wb.blue_gain.toFixed(2)}
              </p>
            )}
          </div>
        )}
      </div>

      {showCaptureButton && (
        <button
          onClick={onCapture}
          disabled={captureBusy}
          className="w-full rounded-full bg-blue-600 p-4 font-bold transition hover:bg-blue-500 disabled:opacity-50"
        >
          {captureBusy ? "Capturing…" : "Capture"}
        </button>
      )}
      {captureError && (
        <p className="text-center text-sm text-red-500">
          Capture failed: {captureError}
        </p>
      )}
    </section>
  );
}
