export const THEMES = ["default", "pastel"] as const;

export type ThemeId = (typeof THEMES)[number];

/** Fallback theme — must match a [data-theme="…"] block in globals.css */
export const DEFAULT_THEME: ThemeId = "default";

export const THEME_STORAGE_KEY = "theme";

export const THEME_OPTIONS: {
  id: ThemeId;
  label: string;
  hint: string;
}[] = [
  { id: "default", label: "Grayscale", hint: "Neutral zinc tones." },
  { id: "pastel", label: "Pastel", hint: "Soft lavender and peach." },
];
