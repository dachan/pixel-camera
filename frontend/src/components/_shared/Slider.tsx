"use client";

import {
  createContext,
  type InputHTMLAttributes,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

type Orientation = "vertical" | "horizontal";

type SliderLockContextValue = {
  locked: boolean;
  setLocked: (locked: boolean) => void;
};

// Whether press-and-hold can lock this slider. False for a slider sitting in
// an auto mode (focus/shutter/ISO on "A", WB on a preset) — there is no manual
// value to protect, and a lock there would only block the tap that switches
// back to manual. Set on Slider so the label's lock icon and the input agree.
const SliderLockableContext = createContext(true);

// Press-and-hold duration (ms) that toggles a slider's lock.
const LOCK_HOLD_MS = 1000;

// Same zero-offset glow as inactive ButtonGroup buttons.
const THUMB_FACE =
  "bg-[radial-gradient(circle_at_50%_50%,#ffffff_0%,#ffffff_35%,#e7e5e4_100%)] shadow-[0_0_6px_rgb(0_0_0_/_0.24)]";

const SliderLockContext = createContext<SliderLockContextValue | null>(null);

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="relative -top-0.5 block size-3 shrink-0 fill-none stroke-current stroke-2"
    >
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function SliderInput({
  orientation = "vertical",
  className,
  disabled,
  onChange,
  onPointerCancel,
  onPointerDown,
  onPointerLeave,
  onPointerMove,
  onPointerUp,
  onClick,
  onTap,
  thumbContent,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  orientation?: Orientation;
  /** Runs for a press without movement or a completed hold. */
  onTap?: () => void;
  /** Visual content shown inside the slider thumb while it is unlocked. */
  thumbContent?: ReactNode;
}) {
  const vertical = orientation === "vertical";
  const lockContext = useContext(SliderLockContext);
  const lockable = useContext(SliderLockableContext);
  const [standaloneLocked, setStandaloneLocked] = useState(false);
  // A slider that isn't lockable never reads as locked, even if it was locked
  // before switching to auto — otherwise it would be stuck, since
  // press-and-hold (the only way to unlock) is ignored while unlockable. The
  // stored flag is kept, so returning to manual restores the lock.
  const locked = (lockContext?.locked ?? standaloneLocked) && lockable;
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const movedDuringPress = useRef(false);
  const completedHold = useRef(false);
  const min = Number(props.min ?? 0);
  const max = Number(props.max ?? 100);
  const value = Number(props.value ?? min);
  const fraction =
    Number.isFinite(value) && max > min
      ? Math.min(1, Math.max(0, (value - min) / (max - min)))
      : 0;
  // White-balance sliders use an intentionally smaller 32px thumb.
  const thumbSize = className?.includes("thumb]:!size-8") ? 32 : 48;
  const thumbOffset = thumbSize / 2;
  const thumbPosition = vertical
    ? {
        top: `calc(${(1 - fraction) * 100}% + ${
          fraction * thumbSize - thumbOffset
        }px)`,
      }
    : {
        left: `calc(${fraction * 100}% + ${
          thumbOffset - fraction * thumbSize
        }px)`,
      };

  function cancelHold() {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }

  function startHold() {
    // Reset the per-press state on EVERY press, even one that can't lock:
    // these refs gate the tap that switches A/M, so leaving them stale on an
    // unlockable (auto) slider would let one stray move kill tapping for good.
    cancelHold();
    movedDuringPress.current = false;
    completedHold.current = false;
    if (disabled || !lockable) return;
    holdTimer.current = setTimeout(() => {
      completedHold.current = true;
      if (lockContext) {
        lockContext.setLocked(!lockContext.locked);
      } else {
        setStandaloneLocked((current) => !current);
      }
      holdTimer.current = null;
    }, LOCK_HOLD_MS);
  }

  useEffect(() => cancelHold, []);

  return (
    <span
      className={[
        "relative",
        vertical
          ? "flex min-h-0 w-12 flex-1 self-stretch"
          : "block h-12 min-w-0 flex-1",
      ].join(" ")}
    >
      <input
        {...props}
        type="range"
        disabled={disabled}
        onChange={(event) => {
          if (!locked) onChange?.(event);
        }}
        onPointerDown={(event) => {
          startHold();
          onPointerDown?.(event);
        }}
        onPointerMove={(event) => {
          movedDuringPress.current = true;
          cancelHold();
          onPointerMove?.(event);
        }}
        onPointerUp={(event) => {
          cancelHold();
          onPointerUp?.(event);
        }}
        onPointerCancel={(event) => {
          cancelHold();
          onPointerCancel?.(event);
        }}
        onPointerLeave={(event) => {
          cancelHold();
          onPointerLeave?.(event);
        }}
        onClick={(event) => {
          if (!locked && !movedDuringPress.current && !completedHold.current) {
            // Only a tap landing on the thumb itself toggles state (e.g.
            // A/M) — a tap elsewhere on the track is a jump-to-value click,
            // which the browser already applies via the native range input.
            const rect = event.currentTarget.getBoundingClientRect();
            const size = vertical ? rect.height : rect.width;
            // Tap position and thumb centre, both measured from the track's
            // zero-value end (bottom for vertical, left for horizontal). The
            // thumb travels inset by half its width at each end, so its
            // centre is not simply fraction * size — this mirrors the
            // thumbPosition calc above.
            const pos = vertical
              ? rect.bottom - event.clientY
              : event.clientX - rect.left;
            const thumbPos = fraction * (size - thumbSize) + thumbOffset;
            if (Math.abs(pos - thumbPos) <= thumbOffset) {
              onTap?.();
            }
          }
          onClick?.(event);
        }}
        className={[
          "cursor-pointer appearance-none bg-transparent",
          vertical
            ? [
                "block min-h-0 w-12 flex-1 self-stretch",
                "[direction:rtl] [writing-mode:vertical-lr]",
                "[&::-moz-range-track]:h-full [&::-moz-range-track]:w-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:border-0 [&::-moz-range-track]:bg-stone-300",
                "[&::-webkit-slider-runnable-track]:h-full [&::-webkit-slider-runnable-track]:w-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:border-0 [&::-webkit-slider-runnable-track]:bg-stone-300",
                "[&::-moz-range-thumb]:size-12 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent [&::-moz-range-thumb]:shadow-none",
                "[&::-webkit-slider-thumb]:-ml-5.25 [&::-webkit-slider-thumb]:size-12 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:shadow-none",
              ]
            : [
                "block h-12 w-full min-w-0 flex-1",
                "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:w-full [&::-moz-range-track]:rounded-full [&::-moz-range-track]:border-0 [&::-moz-range-track]:bg-stone-300",
                "[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:w-full [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:border-0 [&::-webkit-slider-runnable-track]:bg-stone-300",
                "[&::-moz-range-thumb]:size-12 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent [&::-moz-range-thumb]:shadow-none",
                "[&::-webkit-slider-thumb]:-mt-5.25 [&::-webkit-slider-thumb]:size-12 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:shadow-none",
              ],
          locked && "pointer-events-none opacity-60",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "disabled:[&::-moz-range-thumb]:bg-transparent",
          "disabled:[&::-webkit-slider-thumb]:bg-transparent",
          className,
        ]
          .flat()
          .filter(Boolean)
          .join(" ")}
        {...(vertical
          ? ({ orient: "vertical" } as InputHTMLAttributes<HTMLInputElement>)
          : {})}
      />
      {!locked && (
        <span
          aria-hidden
          style={thumbPosition}
          className={[
            "pointer-events-none absolute z-10 flex items-center justify-center rounded-full font-mono text-xs font-semibold text-stone-700",
            THUMB_FACE,
            vertical
              ? "left-1/2 -translate-x-1/2 -translate-y-1/2"
              : "top-1/2 -translate-x-1/2 -translate-y-1/2",
            thumbSize === 32 ? "size-8" : "size-12",
          ].join(" ")}
        >
          {thumbContent}
        </span>
      )}
      {locked && (
        <button
          type="button"
          aria-label="Slider locked. Press and hold for one second to unlock."
          style={thumbPosition}
          className={[
            "absolute z-20 flex items-center justify-center rounded-full text-stone-800",
            THUMB_FACE,
            vertical
              ? "left-1/2 -translate-x-1/2 -translate-y-1/2"
              : "top-1/2 -translate-x-1/2 -translate-y-1/2",
            thumbSize === 32 ? "size-8" : "size-12",
          ].join(" ")}
          onPointerDown={startHold}
          onPointerUp={cancelHold}
          onPointerCancel={cancelHold}
          onPointerLeave={cancelHold}
          onClick={(event) => event.preventDefault()}
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden
            className="size-5 fill-none stroke-current stroke-2"
          >
            <rect x="5" y="10" width="14" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
        </button>
      )}
    </span>
  );
}

type SliderProps = {
  orientation?: Orientation;
  label?: string;
  value?: ReactNode;
  children: ReactNode;
  defaultLocked?: boolean;
  onLockedChange?: (locked: boolean) => void;
  /** See SliderLockableContext. Pass false while the slider is on auto. */
  lockable?: boolean;
};

export default function Slider({
  orientation = "vertical",
  label,
  value,
  children,
  defaultLocked = false,
  onLockedChange,
  lockable = true,
}: SliderProps) {
  const [storedLocked, setLocked] = useState(defaultLocked);
  function updateLocked(next: boolean) {
    setLocked(next);
    onLockedChange?.(next);
  }
  // An unlockable slider never reads as locked, so it can't get stuck:
  // press-and-hold is the only way to unlock and it's ignored while
  // unlockable. The stored flag survives, restoring the lock on return
  // to manual.
  const locked = storedLocked && lockable;
  const lockContext = { locked: storedLocked, setLocked: updateLocked };

  if (orientation === "horizontal") {
    return (
      <SliderLockableContext value={lockable}>
        <SliderLockContext value={lockContext}>
          <label className="flex w-full min-w-0 items-center gap-3">
            {label != null && (
              <span className="inline-flex w-10 shrink-0 items-center gap-1 font-mono text-[11px] leading-none font-semibold text-stone-400">
                <span className="truncate">{label}</span>
                {locked && <LockIcon />}
              </span>
            )}
            <div className="flex min-h-0 min-w-0 flex-1 items-center">
              {children}
            </div>
            {value != null && (
              <span className="w-10 shrink-0 text-right font-mono text-xs text-stone-700">
                {value}
              </span>
            )}
          </label>
        </SliderLockContext>
      </SliderLockableContext>
    );
  }

  return (
    <SliderLockableContext value={lockable}>
      <SliderLockContext value={lockContext}>
        <label className="flex h-full w-full min-w-0 flex-col items-center gap-4">
          <div className="flex w-full min-w-0 flex-col items-center gap-1">
            {label != null && (
              <span className="inline-flex max-w-full items-center gap-1 text-center font-mono text-[11px] leading-none font-semibold text-stone-400">
                <span className="truncate">{label}</span>
                {locked && <LockIcon />}
              </span>
            )}
            {value != null && (
              <span className="font-mono text-xs text-stone-700">{value}</span>
            )}
          </div>
          <div className="flex h-full min-h-0 w-full justify-center">
            {children}
          </div>
        </label>
      </SliderLockContext>
    </SliderLockableContext>
  );
}
