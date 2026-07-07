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
import { THEME_OPTIONS } from "@/lib/theme";
import { useStoredTheme } from "@/lib/use-stored-theme";

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

const TILE_ACTIVE =
  "border-selected-border bg-selected text-selected-foreground";
const TILE_INACTIVE =
  "border-border-subtle text-heading hover:border-border-hover hover:text-primary-foreground";
const DESTRUCTIVE_ACTIVE =
  "border-destructive-border bg-destructive text-destructive-foreground";
const DESTRUCTIVE_INACTIVE =
  "border-border-subtle text-heading hover:border-destructive-border hover:text-primary-foreground";

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

  // Same two-tap confirm for the destructive delete-all.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteResult, setDeleteResult] = useState<string | null>(null);
  const [theme, setTheme] = useStoredTheme();
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
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-bold text-heading">Theme</h2>
            <p className="text-sm text-muted">Appearance for the kiosk UI.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {THEME_OPTIONS.map((option) => {
              const active = theme === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setTheme(option.id)}
                  className={`flex flex-col gap-1 border p-3 text-left transition ${
                    active ? TILE_ACTIVE : TILE_INACTIVE
                  }`}
                >
                  <span className="text-sm font-bold">{option.label}</span>
                  <span
                    className={`text-xs ${
                      active ? "text-selected-muted" : "text-muted"
                    }`}
                  >
                    {option.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {thermal && (
          <section className="flex flex-col gap-2">
            <SettingToggle
              title="Thermal throttling"
              description={`Drop the preview to 10 fps when the CPU passes ${Math.round(
                thermal.throttle_at,
              )} °C, to keep the Pi cool.`}
              checked={thermal.throttle_enabled}
              onChange={applyThrottleEnabled}
            />
            {thermal.throttled && (
              <p className="text-sm font-bold text-warning">
                Thermal throttling active — preview limited to 10 fps until the
                Pi cools below {Math.round(thermal.throttle_at - 5)} °C.
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
            <h2 className="text-sm font-bold text-heading">Sensor rotation</h2>
            <p className="text-sm text-muted">
              Rotation applied to the live preview and captured images.
            </p>
          </div>

          {error ? (
            <p className="text-sm text-destructive-border">
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
                      active ? TILE_ACTIVE : TILE_INACTIVE
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
            <h2 className="text-sm font-bold text-heading">Capture quality</h2>
            <p className="text-sm text-muted">
              JPEG quality for saved photos (1–100). Higher means larger files.
            </p>
          </div>
          {quality === null ? (
            <p className="text-sm text-muted">loading…</p>
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
                className="h-2 flex-1 cursor-pointer appearance-none bg-control-track accent-selected"
              />
              <span className="w-8 text-right font-mono text-sm text-foreground">
                {quality}
              </span>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-bold text-heading">Capture format</h2>
            <p className="text-sm text-muted">
              RAW saves an unprocessed .dng for editing. Browsers can&apos;t
              preview DNG, so RAW-only photos won&apos;t appear in the Gallery.
            </p>
          </div>
          {format === null ? (
            <p className="text-sm text-muted">loading…</p>
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
                      active ? TILE_ACTIVE : TILE_INACTIVE
                    }`}
                  >
                    <span className="text-sm font-bold">{f.label}</span>
                    <span
                      className={`text-xs ${
                        active ? "text-selected-muted" : "text-muted"
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
              <h2 className="text-sm font-bold text-heading">Colour tuning</h2>
              <p className="text-sm text-muted">
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
                      active ? TILE_ACTIVE : TILE_INACTIVE
                    }`}
                  >
                    <span className="text-sm font-bold">{option.label}</span>
                    <span
                      className={`text-xs ${
                        active ? "text-selected-muted" : "text-muted"
                      }`}
                    >
                      {option.hint}
                    </span>
                  </button>
                );
              })}
            </div>
            {tuningBusy && (
              <p className="text-sm text-muted">
                Switching tuning — restarting the camera…
              </p>
            )}
          </section>
        )}

        <section className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-bold text-heading">
              Delete all photos
            </h2>
            <p className="text-sm text-muted">
              Remove every capture (JPEG and RAW) from the Pi. This cannot be
              undone.
            </p>
          </div>
          <button
            type="button"
            onClick={onDeleteAllClick}
            className={`border p-4 text-sm font-bold transition ${
              confirmingDelete ? DESTRUCTIVE_ACTIVE : DESTRUCTIVE_INACTIVE
            }`}
          >
            {confirmingDelete
              ? "Tap again to delete everything"
              : "Delete all photos"}
          </button>
          {deleteResult && (
            <p className="text-sm text-muted">{deleteResult}</p>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-bold text-heading">Exit kiosk</h2>
            <p className="text-sm text-muted">
              Close the app and return to the Pi desktop.
            </p>
          </div>
          <button
            type="button"
            onClick={onExitClick}
            className={`border p-4 text-sm font-bold transition ${
              confirmingExit ? DESTRUCTIVE_ACTIVE : DESTRUCTIVE_INACTIVE
            }`}
          >
            {confirmingExit
              ? "Tap again to exit to desktop"
              : "Exit to desktop"}
          </button>
        </section>
      </div>
    </DragScrollArea>
  );
}
