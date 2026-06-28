"use client";

import { useEffect, useState } from "react";
import { getOrientation, setOrientation } from "@/lib/camera-api";

// Capture rotations offered in the UI (degrees clockwise).
const ROTATIONS = [0, 90, 180, 270] as const;

export default function CameraSettings() {
  const [rotation, setRotation] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOrientation()
      .then((o) => setRotation(o.rotation))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  function apply(rot: number) {
    setRotation(rot); // optimistic
    setError(null);
    setOrientation({ rotation: rot })
      .then((o) => setRotation(o.rotation))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto">
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
    </div>
  );
}
