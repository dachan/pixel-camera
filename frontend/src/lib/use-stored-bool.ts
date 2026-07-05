import { useEffect, useState } from "react";

// Boolean UI preference persisted to localStorage.
//
// Starts at `initial`, adopts the stored value after mount (localStorage
// isn't available during the static-export prerender), and writes through
// on every change.
export function useStoredBool(key: string, initial: boolean) {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    const stored = localStorage.getItem(key);
    // One-time adoption of the persisted value. Reading in a lazy initializer
    // instead would make the prerendered HTML disagree with the first client
    // render (hydration mismatch), so the post-mount effect is deliberate.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored !== null) setValue(stored === "true");
  }, [key]);

  function update(next: boolean) {
    setValue(next);
    localStorage.setItem(key, String(next));
  }

  return [value, update] as const;
}
