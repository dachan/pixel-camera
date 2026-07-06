"use client";

import { useEffect, useState } from "react";
import {
  getOrientation,
  setOrientation,
  getQuality,
  setQuality as saveQuality,
  getFormat,
  setFormat as saveFormat,
  getTuning,
  setTuning as saveTuning,
  systemTemperature,
  exitKiosk,
  type CameraTuning,
  type CaptureFormatValue,
  type SystemThermal,
} from "@/lib/camera-api";
import { errorMessage } from "@/lib/errors";
import { usePolling } from "@/lib/use-polling";
import DragScrollArea from "@/components/DragScrollArea";
import SettingToggle from "@/components/SettingToggle";

// Capture rotations offered in the UI (degrees clockwise).
const ROTATIONS = [0, 90, 180, 270] as const;

// Capture formats offered in the UI, with friendly labels + descriptions.
const FORMATS: { value: CaptureFormatValue; label: string; hint: string }[] = [
  { value: "raw+jpeg", label: "RAW + JPEG", hint: "DNG raw plus a JPEG preview." },
  { value: "jpeg", label: "JPEG", hint: "Compressed photo only." },
  { value: "raw", label: "RAW", hint: "DNG raw only — not shown in Gallery." },
];

// Friendlier names for known thermal-zone labels.
function tempLabel(raw: string): string {
  if (raw === "cpu-thermal") return "CPU";
  return raw;
}

export default function CameraSettings({
  showGrid,
  onGridChange,
  showCaptureButton,
  onCaptureButtonChange,
}: {
  showGrid: boolean;
  onGridChange: (next: boolean) => void;
  showCaptureButton: boolean;
  onCaptureButtonChange: (next: boolean) => void;
}) {
  const [rotation, setRotation] = useState<number | null>(null);
  const [quality, setQuality] = useState<number | null>(null);
  const [format, setFormat] = useState<CaptureFormatValue | null>(null);
  const [tuning, setTuning] = useState<CameraTuning | null>(null);
  const [tuningBusy, setTuningBusy] = useState(false);
  const [thermal, setThermal] = useState<SystemThermal | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOrientation()
      .then((o) => setRotation(o.rotation))
      .catch((e) => setError(errorMessage(e)));
    getQuality()
      .then((q) => setQuality(q.quality))
      .catch((e) => setError(errorMessage(e)));
    getFormat()
      .then((f) => setFormat(f.format))
      .catch((e) => setError(errorMessage(e)));
    getTuning()
      .then(setTuning)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  usePolling(() => {
    systemTemperature()
      .then(setThermal)
      .catch(() => setThermal(null));
  }, 2000);

  function apply(rot: number) {
    setRotation(rot); // optimistic
    setError(null);
    setOrientation({ rotation: rot })
      .then((o) => setRotation(o.rotation))
      .catch((e) => setError(errorMessage(e)));
  }

  // Commit the quality to the backend (called on release, not every drag tick).
  function commitQuality(q: number) {
    setError(null);
    saveQuality({ quality: q })
      .then((s) => setQuality(s.quality))
      .catch((e) => setError(errorMessage(e)));
  }

  function applyFormat(f: CaptureFormatValue) {
    setFormat(f); // optimistic
    setError(null);
    saveFormat({ format: f })
      .then((s) => setFormat(s.format))
      .catch((e) => setError(errorMessage(e)));
  }

  function applyTuning(value: "default" | "standard") {
    // No optimistic update: the camera pipeline rebuild takes a few seconds,
    // so show a busy state until the backend confirms.
    setTuningBusy(true);
    setError(null);
    saveTuning({ tuning: value })
      .then(setTuning)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setTuningBusy(false));
  }

  // Two-tap confirm so a stray touch doesn't drop out of the kiosk.
  const [confirmingExit, setConfirmingExit] = useState(false);
  function onExitClick() {
    if (!confirmingExit) {
      setConfirmingExit(true);
      window.setTimeout(() => setConfirmingExit(false), 4000);
      return;
    }
    exitKiosk(); // closes the browser; this page goes away
  }

  return (
    <DragScrollArea>
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-zinc-300">Temperature</h2>
          {thermal === null ? (
            <p className="text-sm text-zinc-500">loading…</p>
          ) : Object.keys(thermal.temperatures).length === 0 ? (
            <p className="text-sm text-zinc-500">unavailable on this host</p>
          ) : (
            <dl className="flex flex-col gap-1">
              {Object.entries(thermal.temperatures).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 text-sm">
                  <dt className="text-zinc-400">{tempLabel(k)}</dt>
                  <dd
                    className={`font-mono ${
                      v >= thermal.throttle_at
                        ? "text-amber-400"
                        : "text-zinc-100"
                    }`}
                  >
                    {v.toFixed(1)} °C
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {thermal?.throttled && (
            <p className="text-sm font-bold text-amber-400">
              Thermal throttling active — preview limited to 10 fps until the
              Pi cools below {Math.round(thermal.throttle_at - 5)} °C.
            </p>
          )}
        </section>

        <SettingToggle
          title="Rule-of-thirds grid"
          description="Composition grid overlaid on the live preview."
          checked={showGrid}
          onChange={onGridChange}
        />

        <SettingToggle
          title="On-screen capture button"
          description="Shutter button on the Camera tab. Turn off if you're only using the physical shutter button."
          checked={showCaptureButton}
          onChange={onCaptureButtonChange}
        />

        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-bold text-zinc-300">Sensor rotation</h2>
            <p className="text-sm text-zinc-500">
              Rotation applied to the live preview and captured images.
            </p>
          </div>

          {error ? (
            <p className="text-sm text-red-500">
              Orientation unavailable: {error}
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {ROTATIONS.map((rot) => {
                const active = rotation === rot;
                return (
                  <button
                    key={rot}
                    type="button"
                    onClick={() => apply(rot)}
                    disabled={rotation === null}
                    className={`rounded-xl border p-4 text-sm font-bold transition disabled:opacity-50 ${
                      active
                        ? "border-blue-500 bg-blue-600 text-white"
                        : "border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white"
                    }`}
                  >
                    {rot}°
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-bold text-zinc-300">Capture quality</h2>
            <p className="text-sm text-zinc-500">
              JPEG quality for saved photos (1–100). Higher means larger files.
            </p>
          </div>
          {quality === null ? (
            <p className="text-sm text-zinc-500">loading…</p>
          ) : (
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={1}
                max={100}
                step={1}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                onPointerUp={(e) =>
                  commitQuality(Number((e.target as HTMLInputElement).value))
                }
                onKeyUp={(e) =>
                  commitQuality(Number((e.target as HTMLInputElement).value))
                }
                className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-700 accent-blue-600"
              />
              <span className="w-8 text-right font-mono text-sm text-zinc-100">
                {quality}
              </span>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-bold text-zinc-300">Capture format</h2>
            <p className="text-sm text-zinc-500">
              RAW saves an unprocessed .dng for editing. Browsers can&apos;t
              preview DNG, so RAW-only photos won&apos;t appear in the Gallery.
            </p>
          </div>
          {format === null ? (
            <p className="text-sm text-zinc-500">loading…</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {FORMATS.map((f) => {
                const active = format === f.value;
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => applyFormat(f.value)}
                    title={f.hint}
                    className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition ${
                      active
                        ? "border-blue-500 bg-blue-600 text-white"
                        : "border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white"
                    }`}
                  >
                    <span className="text-sm font-bold">{f.label}</span>
                    <span
                      className={`text-xs ${active ? "text-blue-100" : "text-zinc-500"}`}
                    >
                      {f.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {tuning?.available && (
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-bold text-zinc-300">Colour tuning</h2>
              <p className="text-sm text-zinc-500">
                How this NoIR sensor interprets colour. Switching restarts the
                camera for a few seconds.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  {
                    value: "default",
                    label: "NoIR",
                    hint: "Native greyworld AWB. WB presets disabled.",
                  },
                  {
                    value: "standard",
                    label: "Standard colour",
                    hint: "WB presets work — colours assume an IR-cut filter.",
                  },
                ] as const
              ).map((option) => {
                const active = tuning.tuning === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => applyTuning(option.value)}
                    disabled={tuningBusy}
                    className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition disabled:opacity-50 ${
                      active
                        ? "border-blue-500 bg-blue-600 text-white"
                        : "border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white"
                    }`}
                  >
                    <span className="text-sm font-bold">{option.label}</span>
                    <span
                      className={`text-xs ${active ? "text-blue-100" : "text-zinc-500"}`}
                    >
                      {option.hint}
                    </span>
                  </button>
                );
              })}
            </div>
            {tuningBusy && (
              <p className="text-sm text-zinc-500">
                Switching tuning — restarting the camera…
              </p>
            )}
          </section>
        )}

        <section className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-bold text-zinc-300">Exit kiosk</h2>
            <p className="text-sm text-zinc-500">
              Close the app and return to the Pi desktop.
            </p>
          </div>
          <button
            type="button"
            onClick={onExitClick}
            className={`rounded-xl border p-4 text-sm font-bold transition ${
              confirmingExit
                ? "border-red-500 bg-red-600 text-white"
                : "border-zinc-700 text-zinc-300 hover:border-red-500 hover:text-white"
            }`}
          >
            {confirmingExit ? "Tap again to exit to desktop" : "Exit to desktop"}
          </button>
        </section>
      </div>
    </DragScrollArea>
  );
}
