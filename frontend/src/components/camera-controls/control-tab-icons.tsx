// Icons for the Exposure / Focus / White Balance control tabs. Drawn as one
// cohesive stroke set (24x24, fill-none, stroke-2, round caps) to match the
// app's other line icons (see Slider's LockIcon/DisabledIcon).

const SVG_CLASS = "size-8 shrink-0 fill-none stroke-current stroke-2";

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
