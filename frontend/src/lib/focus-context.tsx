"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getFocus,
  setFocus as setFocusApi,
  type FocusState,
} from "@/lib/camera-api";
import { usePolling } from "@/lib/use-polling";

type FocusCtxState = FocusState | null;
type FocusPatch = { af_mode?: "continuous" | "manual"; lens_position?: number };

const FocusContext = createContext<FocusCtxState>(null);
const ApplyFocusContext = createContext<(patch: FocusPatch) => void>(() => {});

// After a user write, ignore poll results for this long. A getFocus that was
// already in flight when the user toggled carries the pre-write af_mode; left
// unguarded it lands late and reverts the control — and that revert re-arms the
// next poll, so the thumb flip-flops between M and A "by itself" until it
// happens to settle. The window also covers the brief lag before the camera
// commits the change on the Pi.
const SETTLE_MS = 1000;

// Single shared poll for /api/camera/focus — FocusControls (the Focus panel)
// and CameraPreview (which needs the live af_mode to show the focus-peaking
// overlay) both read it; sharing one poll means a mode change from one is
// instantly visible in the other, not up to 1.5s stale. Writes go through
// applyFocus so the poll can't clobber them (see SETTLE_MS).
export function FocusProvider({ children }: { children: ReactNode }) {
  const [focus, setFocus] = useState<FocusCtxState>(null);
  // Guards that stop the periodic poll from overwriting a fresh user write.
  const inflight = useRef(0); // user writes currently POSTing
  const settleUntil = useRef(0); // ignore poll results until this timestamp

  const applyFocus = useCallback((patch: FocusPatch) => {
    inflight.current += 1;
    settleUntil.current = Date.now() + SETTLE_MS;
    // Optimistic: reflect the change immediately, before the POST round-trips.
    setFocus((prev) => (prev ? { ...prev, ...patch } : prev));
    setFocusApi(patch)
      .then((next) => setFocus(next))
      .catch(() => {})
      .finally(() => {
        inflight.current -= 1;
        settleUntil.current = Date.now() + SETTLE_MS;
      });
  }, []);

  usePolling(() => {
    getFocus()
      .then((next) => {
        if (inflight.current > 0 || Date.now() < settleUntil.current) return;
        setFocus(next);
      })
      .catch(() => {});
  }, 1500);

  return (
    <FocusContext.Provider value={focus}>
      <ApplyFocusContext.Provider value={applyFocus}>
        {children}
      </ApplyFocusContext.Provider>
    </FocusContext.Provider>
  );
}

export function useFocus(): FocusCtxState {
  return useContext(FocusContext);
}

export function useApplyFocus(): (patch: FocusPatch) => void {
  return useContext(ApplyFocusContext);
}
