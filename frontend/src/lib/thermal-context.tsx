"use client";

import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { systemTemperature, type SystemThermal } from "@/lib/camera-api";
import { usePolling } from "@/lib/use-polling";

type ThermalState = SystemThermal | null;
type ThermalSetter = Dispatch<SetStateAction<ThermalState>>;

const ThermalContext = createContext<ThermalState>(null);
const ThermalSetterContext = createContext<ThermalSetter>(() => {});

// Single shared poll for /api/system/temperature — StatusRow (always
// mounted) and CameraSettings (Settings tab only) both need this, and were
// previously polling it independently, doubling that traffic whenever
// Settings was open. One poll here; useThermal() reads it, useSetThermal()
// writes it (optimistic updates, forced refresh after an action) so a write
// from Settings is visible everywhere instantly instead of waiting up to 2s
// for the next poll.
export function ThermalProvider({ children }: { children: ReactNode }) {
  const [thermal, setThermal] = useState<ThermalState>(null);
  usePolling(() => {
    systemTemperature()
      .then(setThermal)
      .catch(() => {});
  }, 2000);
  return (
    <ThermalContext.Provider value={thermal}>
      <ThermalSetterContext.Provider value={setThermal}>
        {children}
      </ThermalSetterContext.Provider>
    </ThermalContext.Provider>
  );
}

export function useThermal(): ThermalState {
  return useContext(ThermalContext);
}

export function useSetThermal(): ThermalSetter {
  return useContext(ThermalSetterContext);
}
