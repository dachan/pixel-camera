"use client";

export default function Switch({
  checked,
  onChange,
  // Track width, as a Tailwind class. Defaults to the standard w-14; callers
  // can widen it (the knob and ON/OFF text are percentage-based, so they stay
  // centred at any width).
  widthClass = "w-14",
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  widthClass?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      // Callers make their label/description a hit target by toggling from a
      // wrapper click; stop here so a tap on the switch itself doesn't also
      // fire that handler and toggle twice.
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
      className={`relative h-8 shrink-0 rounded-md border border-stone-300 bg-white ${widthClass}`}
    >
      <span className="absolute inset-0 overflow-hidden rounded-[5px]">
        <span
          aria-hidden
          // pt-[2px]: the all-caps label has no descenders, so a line-box-
          // centred glyph reads as slightly high; the padding nudges it down
          // ~1px. On the flex container it shifts the text without moving the
          // orange background fill (which spans the full padding box).
          className={`absolute inset-y-0 left-0 flex w-1/2 items-center justify-center bg-orange-500 pt-[2px] text-[10px] leading-none font-semibold tracking-wide text-white transition-transform ${
            checked ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          ON
        </span>
        <span
          aria-hidden
          // pt-[2px]: see the ON label above — nudges the caps down ~1px.
          className={`absolute inset-y-0 right-0 flex w-1/2 items-center justify-center pt-[2px] text-[10px] leading-none font-semibold tracking-wide text-stone-400 transition-transform ${
            checked ? "translate-x-full" : "translate-x-0"
          }`}
        >
          OFF
        </span>
      </span>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[5] rounded-[5px] shadow-[inset_0_0_4px_rgb(0_0_0_/_0.2)]"
      />
      <span
        className={`absolute top-1/2 z-10 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-orange-500 shadow-[0_0_2px_rgb(0_0_0_/_0.24)] transition-all ${
          checked ? "left-3/4" : "left-1/4"
        }`}
      />
    </button>
  );
}
