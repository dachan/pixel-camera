"use client";

import { useStoredTheme } from "@/lib/use-stored-theme";

// Applies the persisted theme on load (no UI).
export default function ThemeInit() {
  useStoredTheme();
  return null;
}
