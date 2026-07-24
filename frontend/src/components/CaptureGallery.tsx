"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  captureThumbUrl,
  captureUrl,
  deleteCapture,
  listCaptures,
} from "@/lib/camera-api";
import { errorMessage } from "@/lib/errors";
import { usePolling } from "@/lib/use-polling";
import DragScrollArea from "@/components/DragScrollArea";
import Button from "@/components/_shared/Button";
import {
  CloseIcon,
  DeleteIcon,
} from "@/components/camera-controls/control-tab-icons";

export default function CaptureGallery() {
  const [captures, setCaptures] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Filename of the capture opened full-screen (null = grid view).
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Swipe navigation in the full-screen viewer. On the Pi kiosk a finger swipe
  // arrives as an emulated-mouse drag, so we track pointer events rather than
  // touch events (same reason as use-drag-scroll).
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const SWIPE_MIN = 50; // px of horizontal travel before it counts as a swipe

  const selectedIndex = selected ? captures.indexOf(selected) : -1;

  function showAt(index: number) {
    if (index < 0 || index >= captures.length) return;
    setSelected(captures[index]);
    setConfirmingDelete(false);
  }

  function closeSelected() {
    setSelected(null);
    setConfirmingDelete(false);
  }

  function onViewerPointerDown(e: ReactPointerEvent) {
    swipeStart.current = { x: e.clientX, y: e.clientY };
    swiped.current = false;
  }

  function onViewerPointerUp(e: ReactPointerEvent) {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    // Horizontal intent only, so a vertical drag doesn't flip photos.
    if (Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy)) {
      swiped.current = true; // swallow the trailing click so it doesn't close
      showAt(selectedIndex + (dx < 0 ? 1 : -1));
    }
  }

  function onViewerClick() {
    // A horizontal swipe leaves little vertical travel, so DragScrollArea does
    // not suppress this click — guard it here so a swipe never closes the view.
    if (swiped.current) {
      swiped.current = false;
      return;
    }
    closeSelected();
  }

  function deleteSelected() {
    if (!selected || deleting) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      window.setTimeout(() => setConfirmingDelete(false), 4000);
      return;
    }

    setDeleting(true);
    deleteCapture(selected)
      .then(() => {
        const remaining = captures.filter((name) => name !== selected);
        setCaptures(remaining);
        if (remaining.length === 0) {
          closeSelected();
        } else {
          // Stay enlarged on the photo that slid into the deleted one's slot;
          // clamp to the last when the deleted photo was at the end.
          setSelected(remaining[Math.min(selectedIndex, remaining.length - 1)]);
          setConfirmingDelete(false);
        }
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setDeleting(false));
  }

  usePolling(() => {
    listCaptures()
      .then((names) => {
        setCaptures(names);
        setError(null); // a later successful poll clears a transient failure
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, 3000);

  if (error) {
    return (
      <p className="flex size-full items-center justify-center text-center text-sm text-red-500">
        Captures unavailable: {error}
      </p>
    );
  }

  if (loading) {
    return (
      <p className="flex size-full items-center justify-center text-center text-sm text-stone-500">
        Loading captures…
      </p>
    );
  }

  if (captures.length === 0) {
    return (
      <p className="flex size-full items-center justify-center text-center text-sm text-stone-500">
        No captures yet. Use the Capture button on the Camera tab.
      </p>
    );
  }

  return (
    <DragScrollArea>
      <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {captures.map((filename) => (
          <figure
            key={filename}
            onClick={() => setSelected(filename)}
            className="cursor-pointer overflow-hidden rounded-md border border-stone-300 bg-stone-100"
          >
            <div className="flex aspect-video w-full items-center justify-center bg-stone-200">
              <img
                src={captureThumbUrl(filename)}
                alt={filename}
                loading="lazy"
                decoding="async"
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <figcaption className="truncate px-2 py-1.5 font-mono text-xs text-stone-500">
              {filename}
            </figcaption>
          </figure>
        ))}
      </div>

      {selected && (
        <div
          role="dialog"
          aria-label={selected}
          onClick={onViewerClick}
          onPointerDown={onViewerPointerDown}
          onPointerUp={onViewerPointerUp}
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/95 p-4"
        >
          <div className="relative flex max-h-full max-w-full items-center justify-center">
            <img
              src={captureUrl(selected)}
              alt={selected}
              className="max-h-full max-w-full rounded-md object-contain"
            />
            {/* Positioned inside the image box (not the viewport) so the pills
                sit on the photo's corners, not out on the letterbox. */}
            <span className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[40%] truncate rounded-md bg-stone-900/60 px-3 py-1 font-mono text-xs text-stone-300">
              {selected}
            </span>
            <span className="pointer-events-none absolute right-3 bottom-3 z-10 rounded-md bg-stone-900/60 px-3 py-1 font-mono text-xs text-stone-400">
              {selectedIndex + 1} / {captures.length}
            </span>
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
              <Button
                variant="destructive"
                selected={confirmingDelete}
                disabled={deleting}
                onClick={(event) => {
                  event.stopPropagation();
                  deleteSelected();
                }}
                className="flex w-auto min-w-32 items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <DeleteIcon />
                <span className="translate-y-px">
                  {deleting
                    ? "Deleting…"
                    : confirmingDelete
                      ? "Confirm"
                      : "Delete Photo"}
                </span>
              </Button>
              <Button
                variant="secondary"
                onClick={(event) => {
                  event.stopPropagation();
                  closeSelected();
                }}
                className="flex w-auto min-w-32 items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <CloseIcon />
                <span className="translate-y-px">Tap To Close</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </DragScrollArea>
  );
}
