import { useRef } from "react";
import { health } from "@/lib/camera-api";
import { usePolling } from "@/lib/use-polling";

// Reload the page when the backend restarts (which every deploy does).
//
// The kiosk browser never reloads on its own and isn't under a respawner, so
// a freshly-deployed frontend build would otherwise never appear on screen.
// The health endpoint returns a per-process "started" token; we remember the
// first value seen and reload once it changes. A failed fetch (backend
// momentarily down mid-restart) is ignored — only a successful, *different*
// token triggers the reload, and after reloading the new token becomes the
// baseline so it fires exactly once per restart.
export function useReloadOnRestart(intervalMs = 5000) {
  const firstToken = useRef<number | null>(null);
  usePolling(() => {
    health()
      .then(({ started }) => {
        if (typeof started !== "number") return;
        if (firstToken.current === null) {
          firstToken.current = started;
        } else if (started !== firstToken.current) {
          window.location.reload();
        }
      })
      .catch(() => {});
  }, intervalMs);
}
