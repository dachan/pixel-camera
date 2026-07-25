// Shared app icons (camera controls, Capture, gallery actions). Drawn as one
// cohesive stroke set (24x24, fill-none, thin stroke, round caps) to match the
// app's other line icons (see Slider's LockIcon/DisabledIcon). Any new icon
// should reuse SVG_CLASS so it stays part of the family.

const SVG_CLASS = "size-6 shrink-0 fill-none stroke-current stroke-[1.5]";

// Exposure compensation: a square split by a diagonal, + in the upper triangle
// and − in the lower one.
export function ExposureIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      strokeLinecap="round"
      strokeLinejoin="round"
      className={SVG_CLASS}
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <line x1="6" y1="18" x2="18" y2="6" />
      <line x1="7.5" y1="9" x2="10.5" y2="9" />
      <line x1="9" y1="7.5" x2="9" y2="10.5" />
      <line x1="13.5" y1="15" x2="16.5" y2="15" />
    </svg>
  );
}

// Focus: four corner brackets around a centre point.
export function FocusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      strokeLinecap="round"
      strokeLinejoin="round"
      className={SVG_CLASS}
    >
      <path d="M4 8.5V6.5A2.5 2.5 0 0 1 6.5 4H8.5" />
      <path d="M15.5 4H17.5A2.5 2.5 0 0 1 20 6.5V8.5" />
      <path d="M20 15.5V17.5A2.5 2.5 0 0 1 17.5 20H15.5" />
      <path d="M8.5 20H6.5A2.5 2.5 0 0 1 4 17.5V15.5" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

// Delete: a trash can (the gallery's Delete Photo action).
export function DeleteIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      strokeLinecap="round"
      strokeLinejoin="round"
      className={SVG_CLASS}
    >
      <line x1="4.5" y1="7" x2="19.5" y2="7" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4H13.5A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="M6.5 7 7.4 19.4A1.6 1.6 0 0 0 9 21H15A1.6 1.6 0 0 0 16.6 19.4L17.5 7" />
      <line x1="10" y1="10.5" x2="10" y2="17.5" />
      <line x1="14" y1="10.5" x2="14" y2="17.5" />
    </svg>
  );
}

// Close: an X (the gallery's Tap To Close action).
export function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      strokeLinecap="round"
      strokeLinejoin="round"
      className={SVG_CLASS}
    >
      <line x1="5.5" y1="5.5" x2="18.5" y2="18.5" />
      <line x1="18.5" y1="5.5" x2="5.5" y2="18.5" />
    </svg>
  );
}

// Capture: a camera (the shutter action on the Capture button).
export function CaptureIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      strokeLinecap="round"
      strokeLinejoin="round"
      className={SVG_CLASS}
    >
      <path d="M4.5 8.5A1.75 1.75 0 0 1 6.25 6.75H8L9.25 4.75H14.75L16 6.75H17.75A1.75 1.75 0 0 1 19.5 8.5V17A1.75 1.75 0 0 1 17.75 18.75H6.25A1.75 1.75 0 0 1 4.5 17Z" />
      <circle cx="12" cy="12.75" r="3.25" />
    </svg>
  );
}

// Composition grid: a rounded frame divided by rule-of-thirds lines (the
// "choose a grid" entry point on the Focus panel).
export function GridIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      strokeLinecap="round"
      strokeLinejoin="round"
      className={SVG_CLASS}
    >
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <line x1="9.5" y1="4.5" x2="9.5" y2="19.5" />
      <line x1="14.5" y1="4.5" x2="14.5" y2="19.5" />
      <line x1="3.5" y1="9.5" x2="20.5" y2="9.5" />
      <line x1="3.5" y1="14.5" x2="20.5" y2="14.5" />
    </svg>
  );
}

// Back: a left-pointing chevron (returns from the grid picker to Focus).
export function BackIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      strokeLinecap="round"
      strokeLinejoin="round"
      className={SVG_CLASS}
    >
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </svg>
  );
}

// White balance: a sun (the camera convention for a colour-temperature preset).
export function WhiteBalanceIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      strokeLinecap="round"
      strokeLinejoin="round"
      className={SVG_CLASS}
    >
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2.5" x2="12" y2="4.5" />
      <line x1="12" y1="19.5" x2="12" y2="21.5" />
      <line x1="2.5" y1="12" x2="4.5" y2="12" />
      <line x1="19.5" y1="12" x2="21.5" y2="12" />
      <line x1="5.6" y1="5.6" x2="7" y2="7" />
      <line x1="17" y1="17" x2="18.4" y2="18.4" />
      <line x1="5.6" y1="18.4" x2="7" y2="17" />
      <line x1="17" y1="7" x2="18.4" y2="5.6" />
    </svg>
  );
}
