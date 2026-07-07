"use client";

import { useEffect, useState } from "react";
import { systemTemperature, type SystemThermal } from "@/lib/camera-api";
import { usePolling } from "@/lib/use-polling";

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function currentTemperature(thermal: SystemThermal | null): string {
  const values = thermal ? Object.values(thermal.temperatures) : [];
  if (values.length === 0) return "—";
  return `${Math.max(...values).toFixed(1)} °C`;
}

function batteryLevel(thermal: SystemThermal | null): string {
  if (thermal?.battery_level === null || thermal?.battery_level === undefined) {
    return "—";
  }
  return `${thermal.battery_level}%`;
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs font-bold tracking-wide text-muted uppercase">
        {label}
      </span>
      <span className="font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}

export default function StatusRow() {
  const [now, setNow] = useState<Date | null>(null);
  const [thermal, setThermal] = useState<SystemThermal | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  usePolling(() => {
    systemTemperature()
      .then(setThermal)
      .catch(() => setThermal(null));
  }, 2000);

  return (
    <div className="flex w-full items-center justify-between bg-surface px-4 py-2">
      <StatusItem label="Time" value={now ? formatTime(now) : "—"} />
      <StatusItem label="Battery" value={batteryLevel(thermal)} />
      <StatusItem label="Temp" value={currentTemperature(thermal)} />
    </div>
  );
}
