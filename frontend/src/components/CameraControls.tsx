"use client";

import {
  useEffect,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import {
  capture,
  getControls,
  setControls,
  type CameraControlsState,
} from "@/lib/camera-api";
import Tabs from "@/components/Tabs";

const EXPOSURE_TABS = [
  { id: "auto", label: "Auto" },
  { id: "manual", label: "Manual" },
] as const;

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

export default function CameraControls() {
  const [state, setState] = useState<CameraControlsState>({
    auto_exposure: true,
    iso: 100,
    shutter_us: 10000,
  });
  const [captureBusy, setCaptureBusy] = useState(false);
  const [lastFile, setLastFile] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  useEffect(() => {
    getControls().then(setState).catch(() => {});
  }, []);

  // In auto mode, poll so sliders reflect live AE values.
  useEffect(() => {
    if (!state?.auto_exposure) return;
    const tick = () =>
      getControls()
        .then(setState)
        .catch(() => {});
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [state?.auto_exposure]);

  // Push a change to the backend and adopt the returned (authoritative) state.
  function apply(patch: Partial<CameraControlsState>) {
    setState((prev) => ({ ...prev, ...patch })); // optimistic
    setControls(patch)
      .then(setState)
      .catch(() => {});
  }

  async function onCapture() {
    // The shutter flash on the live preview is driven by the backend's
    // /api/capture/events SSE stream (see CameraPreview), not from here —
    // that's what makes it play identically for the physical shutter button.
    setCaptureBusy(true);
    setCaptureError(null);
    try {
      const { filename } = await capture();
      setLastFile(filename);
    } catch (e) {
      setCaptureError(e instanceof Error ? e.message : String(e));
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

      <button
        onClick={onCapture}
        disabled={captureBusy}
        className="w-full rounded-full bg-blue-600 p-4 font-bold transition hover:bg-blue-500 disabled:opacity-50"
      >
        {captureBusy ? "Capturing…" : "Capture"}
      </button>
    </section>
  );
}
