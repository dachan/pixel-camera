"use client";

import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { getFocus, type FocusState } from "@/lib/camera-api";
import { usePolling } from "@/lib/use-polling";

type FocusCtxState = FocusState | null;
type FocusSetter = Dispatch<SetStateAction<FocusCtxState>>;

const FocusContext = createContext<FocusCtxState>(null);
const FocusSetterContext = createContext<FocusSetter>(() => {});

// Single shared poll for /api/camera/focus — FocusControls (the Settings
// panel) and CameraPreview (which needs the live af_mode to show the manual-
// focus peaking overlay) both need this; sharing one poll instead of two
// also means a manual-focus toggle from one is instantly visible in the
// other, not up to 1.5s stale.
export function FocusProvider({ children }: { children: ReactNode }) {
  const [focus, setFocus] = useState<FocusCtxState>(null);
  usePolling(() => {
    getFocus()
      .then(setFocus)
      .catch(() => {});
  }, 1500);
  return (
    <FocusContext.Provider value={focus}>
      <FocusSetterContext.Provider value={setFocus}>
        {children}
      </FocusSetterContext.Provider>
    </FocusContext.Provider>
  );
}

export function useFocus(): FocusCtxState {
  return useContext(FocusContext);
}

export function useSetFocus(): FocusSetter {
  return useContext(FocusSetterContext);
}
