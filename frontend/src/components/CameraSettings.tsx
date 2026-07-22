"use client";

import { useEffect, useState } from "react";
import {
  getOrientation,
  setOrientation,
  getQuality,
  setQuality as saveQuality,
  getFormat,
  setFormat as saveFormat,
  systemTemperature,
  setThrottleEnabled,
  resetBatteryLog,
  deleteAllCaptures,
  exitKiosk,
  type CaptureFormatValue,
} from "@/lib/camera-api";
import { errorMessage } from "@/lib/errors";
import { useThermal, useSetThermal } from "@/lib/thermal-context";
import DragScrollArea from "@/components/DragScrollArea";
import SettingToggle from "@/components/SettingToggle";
import Button from "@/components/_shared/Button";
import ButtonGroup from "@/components/_shared/ButtonGroup";
import Slider, { SliderInput } from "@/components/_shared/Slider";

// Capture rotations offered in the UI (degrees clockwise).
const ROTATION_ITEMS = [
  { id: "0", label: "0°" },
  { id: "90", label: "90°" },
  { id: "180", label: "180°" },
  { id: "270", label: "270°" },
] as const;

// Capture formats offered in the UI.
const FORMAT_ITEMS = [
  { id: "raw+jpeg", label: "RAW + JPEG" },
  { id: "jpeg", label: "JPEG" },
  { id: "raw", label: "RAW" },
] as const satisfies readonly {
  id: CaptureFormatValue;
  label: string;
}[];

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
  // Shared with StatusRow via context — one poll for both, not two.
  const thermal = useThermal();
  const setThermal = useSetThermal();
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
  }, []);

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
        {error && (
          <p className="text-sm text-red-500">Settings unavailable: {error}</p>
        )}

        {thermal?.battery_volts !== null &&
          thermal?.battery_volts !== undefined && (
            <section className="flex flex-col gap-2 text-stone-500">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-stone-700">Battery</h2>
                <button
                  type="button"
                  onClick={onResetBatteryLog}
                  disabled={resettingLog}
                  className="text-xs font-semibold text-red-500 transition disabled:opacity-50"
                >
                  {resettingLog ? "Resetting…" : "Reset Log"}
                </button>
              </div>
              <div className="flex flex-col gap-1 text-xs">
                <div className="flex justify-between">
                  <span>Now</span>
                  <span className="font-mono font-semibold text-stone-700">
                    {thermal.battery_volts.toFixed(2)}V ({thermal.battery_level}
                    %)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Lowest</span>
                  <span className="font-mono text-stone-700">
                    {thermal.battery_min
                      ? `${thermal.battery_min.volts.toFixed(2)}V (${thermal.battery_min.percent}%) · ${formatAgo(thermal.battery_min.at)}`
                      : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Highest</span>
                  <span className="font-mono text-stone-700">
                    {thermal.battery_max
                      ? `${thermal.battery_max.volts.toFixed(2)}V (${thermal.battery_max.percent}%) · ${formatAgo(thermal.battery_max.at)}`
                      : "—"}
                  </span>
                </div>
              </div>
            </section>
          )}

        {thermal && (
          <section className="flex flex-col gap-2">
            <SettingToggle
              title="Thermal Throttling"
              description={`Cap the CPU to 1.5 GHz and the live preview to 15fps when it passes ${Math.round(
                thermal.throttle_at,
              )} °C, to keep the Pi cool. Slows captures and the UI while active.`}
              checked={thermal.throttle_enabled}
              onChange={applyThrottleEnabled}
            />
            {thermal.throttled && (
              <p className="text-sm font-semibold text-amber-400">
                Thermal throttling active — CPU capped at 1.5 GHz and preview
                at 15fps until the Pi cools below{" "}
                {Math.round(thermal.throttle_at - 5)} °C.
              </p>
            )}
          </section>
        )}

        <SettingToggle
          title="Rule-Of-Thirds Grid"
          description="Composition grid overlaid on the live preview."
          checked={showGrid}
          onChange={onGridChange}
        />

        <SettingToggle
          title="On-Screen Capture Button"
          description="Shutter button on the Camera tab. Turn off if you're only using the physical shutter button."
          checked={showCaptureButton}
          onChange={onCaptureButtonChange}
        />

        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-stone-700">
              Sensor Rotation
            </h2>
            <p className="text-xs text-stone-500">
              Rotation applied to the live preview and captured images.
            </p>
          </div>

          {rotation === null ? (
            <p className="text-xs text-stone-500">loading…</p>
          ) : (
            <ButtonGroup
              items={ROTATION_ITEMS}
              active={String(rotation) as (typeof ROTATION_ITEMS)[number]["id"]}
              onChange={(id) => apply(Number(id))}
            />
          )}
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-stone-700">
              Capture Quality
            </h2>
            <p className="text-xs text-stone-500">
              JPEG quality for saved photos (1–100). Higher means larger files.
            </p>
          </div>
          {quality === null ? (
            <p className="text-xs text-stone-500">loading…</p>
          ) : (
            <Slider orientation="horizontal" value={quality}>
              <SliderInput
                orientation="horizontal"
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
              />
            </Slider>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-stone-700">
              Capture Format
            </h2>
            <p className="text-xs text-stone-500">
              RAW saves an unprocessed .dng for editing. Browsers can&apos;t
              preview DNG, so RAW-only photos won&apos;t appear in the Gallery.
            </p>
          </div>
          {format === null ? (
            <p className="text-xs text-stone-500">loading…</p>
          ) : (
            <ButtonGroup
              items={FORMAT_ITEMS}
              active={format}
              onChange={applyFormat}
            />
          )}
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-stone-700">
              Delete All Photos
            </h2>
            <p className="text-xs text-stone-500">
              Remove every capture (JPEG and RAW) from the Pi. This cannot be
              undone.
            </p>
          </div>
          <Button
            variant="destructive"
            selected={confirmingDelete}
            onClick={onDeleteAllClick}
          >
            {confirmingDelete
              ? "Tap Again To Delete Everything"
              : "Delete All Photos"}
          </Button>
          {deleteResult && (
            <p className="text-xs text-stone-500">{deleteResult}</p>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-stone-700">Exit Kiosk</h2>
            <p className="text-xs text-stone-500">
              Reboot into the Pi desktop for one session. The next reboot
              returns to kiosk mode.
            </p>
          </div>
          <Button
            variant="destructive"
            selected={confirmingExit}
            onClick={onExitClick}
          >
            {confirmingExit
              ? "Tap Again To Reboot To Desktop"
              : "Exit To Desktop"}
          </Button>
        </section>
      </div>
    </DragScrollArea>
  );
}
