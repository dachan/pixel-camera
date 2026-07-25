import { useEffect, useState } from "react";

// String UI preference persisted to localStorage, constrained to a set of
// valid values (falls back to `initial` if the stored value isn't one of
// them — e.g. after a code change removes an old option).
//
// Same mount-time adoption as useStoredBool: localStorage isn't available
// during the static-export prerender, so the stored value is read after
// mount rather than in a lazy initializer, to avoid a hydration mismatch.
export function useStoredString<T extends string>(
  key: string,
  initial: T,
  validValues: readonly T[],
) {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    const stored = localStorage.getItem(key);
    if (stored !== null && (validValues as readonly string[]).includes(stored)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValue(stored as T);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function update(next: T) {
    setValue(next);
    localStorage.setItem(key, next);
  }

  return [value, update] as const;
}
