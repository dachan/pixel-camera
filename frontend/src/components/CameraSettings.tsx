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
  setThrottleEnabled,
  resetBatteryLog,
  deleteAllCaptures,
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
  {
    value: "raw+jpeg",
    label: "RAW + JPEG",
    hint: "DNG raw plus a JPEG preview.",
  },
  { value: "jpeg", label: "JPEG", hint: "Compressed photo only." },
  { value: "raw", label: "RAW", hint: "DNG raw only — not shown in Gallery." },
];

// Relative time for the battery min/max log ("2h 15m ago").
function formatAgo(unixSeconds: number): string {
  const deltaS = Date.now() / 1000 - unixSeconds;
  if (deltaS < 60) return "just now";
  const mins = Math.floor(deltaS / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
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

  function applyThrottleEnabled(enabled: boolean) {
    // Optimistic; the 2s temperature polling reconciles with the backend.
    setThermal((prev) =>
      prev ? { ...prev, throttle_enabled: enabled } : prev,
    );
    setThrottleEnabled(enabled).catch((e) => setError(errorMessage(e)));
  }

  function applyTuning(value: "default" | "standard") {
    setTuning((prev) => (prev ? { ...prev, tuning: value } : prev));
    setTuningBusy(true);
    setError(null);
    saveTuning({ tuning: value })
      .then(setTuning)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setTuningBusy(false));
  }

  const [resettingLog, setResettingLog] = useState(false);
  function onResetBatteryLog() {
    setResettingLog(true);
    resetBatteryLog()
      .then(() => systemTemperature().then(setThermal))
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setResettingLog(false));
  }

  // Two-tap confirm so a stray touch doesn't drop out of the kiosk.
  const [confirmingExit, setConfirmingExit] = useState(false);
  function onExitClick() {
    if (!confirmingExit) {
      setConfirmingExit(true);
      window.setTimeout(() => setConfirmingExit(false), 4000);
      return;
    }
    exitKiosk(); // reboots into the desktop; this page goes away
  }

  // Same two-tap confirm for the destructive delete-all.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteResult, setDeleteResult] = useState<string | null>(null);
  function onDeleteAllClick() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setDeleteResult(null);
      window.setTimeout(() => setConfirmingDelete(false), 4000);
      return;
    }
    setConfirmingDelete(false);
    deleteAllCaptures()
      .then((n) => setDeleteResult(`Deleted ${n} photo${n === 1 ? "" : "s"}.`))
      .catch((e) => setDeleteResult(`Delete failed: ${errorMessage(e)}`));
  }

  return (
    <DragScrollArea>
      <div className="flex flex-col gap-6">
        {thermal?.battery_volts !== null && thermal?.battery_volts !== undefined && (
          <section className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-bold text-stone-500">Battery</h2>
              <p className="text-sm text-stone-500">
                Lowest/highest cell voltage ever seen, tracked since{" "}
                {thermal.battery_min
                  ? formatAgo(thermal.battery_min.at)
                  : "just now"}{" "}
                — shows whether it ever recovers or just sits low.
              </p>
            </div>
            <div className="flex flex-col gap-1 border border-gray-300 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-stone-500">Now</span>
                <span className="font-mono font-bold text-stone-100">
                  {thermal.battery_volts.toFixed(2)}V ({thermal.battery_level}
                  %)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Lowest</span>
                <span className="font-mono text-stone-300">
                  {thermal.battery_min
                    ? `${thermal.battery_min.volts.toFixed(2)}V (${thermal.battery_min.percent}%) · ${formatAgo(thermal.battery_min.at)}`
                    : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Highest</span>
                <span className="font-mono text-stone-300">
                  {thermal.battery_max
                    ? `${thermal.battery_max.volts.toFixed(2)}V (${thermal.battery_max.percent}%) · ${formatAgo(thermal.battery_max.at)}`
                    : "—"}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onResetBatteryLog}
              disabled={resettingLog}
              className="self-start border border-gray-300 px-3 py-1.5 text-xs font-bold text-stone-400 transition hover:border-stone-500 hover:text-white disabled:opacity-50"
            >
              {resettingLog ? "Resetting…" : "Reset log"}
            </button>
          </section>
        )}

        {thermal && (
          <section className="flex flex-col gap-2">
            <SettingToggle
              title="Thermal throttling"
              description={`Cap the CPU to 1.5 GHz when it passes ${Math.round(
                thermal.throttle_at,
              )} °C, to keep the Pi cool. Slows captures and the UI while active.`}
              checked={thermal.throttle_enabled}
              onChange={applyThrottleEnabled}
            />
            {thermal.throttled && (
              <p className="text-sm font-bold text-amber-400">
                Thermal throttling active — CPU capped at 1.5 GHz until the Pi
                cools below {Math.round(thermal.throttle_at - 5)} °C.
              </p>
            )}
          </section>
        )}

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
            <h2 className="text-sm font-bold text-stone-500">
              Sensor rotation
            </h2>
            <p className="text-sm text-stone-500">
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
                    className={`border p-4 text-sm font-bold transition disabled:opacity-50 ${
                      active
                        ? "border-blue-500 bg-blue-600 text-white"
                        : "border-gray-300 text-stone-300 hover:border-stone-500 hover:text-white"
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
            <h2 className="text-sm font-bold text-stone-500">
              Capture quality
            </h2>
            <p className="text-sm text-stone-500">
              JPEG quality for saved photos (1–100). Higher means larger files.
            </p>
          </div>
          {quality === null ? (
            <p className="text-sm text-stone-500">loading…</p>
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
                className="h-2 flex-1 cursor-pointer appearance-none bg-stone-700 accent-blue-600"
              />
              <span className="w-8 text-right font-mono text-sm text-stone-100">
                {quality}
              </span>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-bold text-stone-500">Capture format</h2>
            <p className="text-sm text-stone-500">
              RAW saves an unprocessed .dng for editing. Browsers can&apos;t
              preview DNG, so RAW-only photos won&apos;t appear in the Gallery.
            </p>
          </div>
          {format === null ? (
            <p className="text-sm text-stone-500">loading…</p>
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
                    className={`flex flex-col gap-1 border p-3 text-left transition ${
                      active
                        ? "border-blue-500 bg-blue-600 text-white"
                        : "border-gray-300 text-stone-300 hover:border-stone-500 hover:text-white"
                    }`}
                  >
                    <span className="text-sm font-bold">{f.label}</span>
                    <span
                      className={`text-xs ${
                        active ? "text-blue-100" : "text-stone-500"
                      }`}
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
              <h2 className="text-sm font-bold text-stone-500">
                Colour tuning
              </h2>
              <p className="text-sm text-stone-500">
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
                    className={`flex flex-col gap-1 border p-3 text-left transition disabled:opacity-50 ${
                      active
                        ? "border-blue-500 bg-blue-600 text-white"
                        : "border-gray-300 text-stone-300 hover:border-stone-500 hover:text-white"
                    }`}
                  >
                    <span className="text-sm font-bold">{option.label}</span>
                    <span
                      className={`text-xs ${
                        active ? "text-blue-100" : "text-stone-500"
                      }`}
                    >
                      {option.hint}
                    </span>
                  </button>
                );
              })}
            </div>
            {tuningBusy && (
              <p className="text-sm text-stone-500">
                Switching tuning — restarting the camera…
              </p>
            )}
          </section>
        )}

        <section className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-bold text-stone-500">
              Delete all photos
            </h2>
            <p className="text-sm text-stone-500">
              Remove every capture (JPEG and RAW) from the Pi. This cannot be
              undone.
            </p>
          </div>
          <button
            type="button"
            onClick={onDeleteAllClick}
            className={`border p-4 text-sm font-bold transition ${
              confirmingDelete
                ? "border-red-500 bg-red-500 text-white"
                : "border-red-500 text-red-500 hover:border-red-600 hover:text-white"
            }`}
          >
            {confirmingDelete
              ? "Tap again to delete everything"
              : "Delete all photos"}
          </button>
          {deleteResult && (
            <p className="text-sm text-stone-400">{deleteResult}</p>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-bold text-stone-500">Exit kiosk</h2>
            <p className="text-sm text-stone-500">
              Reboot into the Pi desktop for one session. The next reboot
              returns to kiosk mode.
            </p>
          </div>
          <button
            type="button"
            onClick={onExitClick}
            className={`border p-4 text-sm font-bold transition ${
              confirmingExit
                ? "border-red-500 bg-red-500 text-white"
                : "border-red-500 text-red-500 hover:border-red-600 hover:text-white"
            }`}
          >
            {confirmingExit
              ? "Tap again to reboot to desktop"
              : "Exit to desktop"}
          </button>
        </section>
      </div>
    </DragScrollArea>
  );
}
