import { useEffect, useState } from "react";

// Numeric UI preference persisted to localStorage. Same mount-time adoption
// as useStoredBool/useStoredString — see those for why.
export function useStoredNumber(key: string, initial: number) {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    const stored = localStorage.getItem(key);
    const parsed = stored === null ? null : Number(stored);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (parsed !== null && Number.isFinite(parsed)) setValue(parsed);
  }, [key]);

  function update(next: number) {
    setValue(next);
    localStorage.setItem(key, String(next));
  }

  return [value, update] as const;
}
