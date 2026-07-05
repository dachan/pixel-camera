import { useEffect, useRef } from "react";

// Run `fn` immediately and then every `intervalMs`, while `enabled`.
//
// `fn` is kept in a ref so callers can pass inline closures without
// re-arming the interval on every render; only `intervalMs`/`enabled`
// changes restart it.
export function usePolling(
  fn: () => void,
  intervalMs: number,
  enabled = true,
) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    if (!enabled) return;
    const tick = () => fnRef.current();
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
}
