import { useEffect, useState } from "react";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  THEMES,
  type ThemeId,
} from "@/lib/theme";

function applyTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
}

// UI theme persisted to localStorage and applied via data-theme on <html>.
export function useStoredTheme() {
  const [theme, setThemeState] = useState<ThemeId>(DEFAULT_THEME);

  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored !== null && (THEMES as readonly string[]).includes(stored)) {
      const id = stored as ThemeId;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setThemeState(id);
      applyTheme(id);
    }
  }, []);

  function setTheme(id: ThemeId) {
    setThemeState(id);
    localStorage.setItem(THEME_STORAGE_KEY, id);
    applyTheme(id);
  }

  return [theme, setTheme] as const;
}
