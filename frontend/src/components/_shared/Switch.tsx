"use client";

export default function Switch({
  checked,
  onChange,
  // Track width, as a Tailwind class. Defaults to 72px; callers can override
  // it (the knob and ON/OFF text are percentage-based, so they stay centred
  // at any width).
  widthClass = "w-[72px]",
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
      className={`relative h-8 shrink-0 rounded-md border-2 border-stone-300 bg-white ${widthClass}`}
    >
      <span className="absolute inset-0 overflow-hidden rounded-[5px]">
        <span
          aria-hidden
          // translate-y-px on the label: all-caps has no descenders, so a
          // line-box-centred glyph reads slightly high; nudge text down ~1px
          // without moving the orange fill.
          className={`absolute inset-y-0 left-0 flex w-1/2 items-center justify-center bg-orange-500 text-[10px] leading-none font-semibold tracking-wide text-white transition-transform ${
            checked ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <span className="translate-y-px">ON</span>
        </span>
        <span
          aria-hidden
          className={`absolute inset-y-0 right-0 flex w-1/2 items-center justify-center text-[10px] leading-none font-semibold tracking-wide text-stone-400 transition-transform ${
            checked ? "translate-x-full" : "translate-x-0"
          }`}
        >
          <span className="translate-y-px">OFF</span>
        </span>
      </span>
      {/* Center rule only when off — separates the knob half from OFF. */}
      {!checked && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2 z-[1] h-[60%] w-px -translate-x-1/2 -translate-y-1/2 bg-stone-300"
        />
      )}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[5] rounded-[5px] shadow-[inset_0_0_4px_rgb(0_0_0_/_0.2)]"
      />
      <span
        className={`absolute top-1/2 z-10 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_2px_rgb(0_0_0_/_0.2)] transition-all ${
          checked ? "left-3/4 bg-orange-500" : "left-1/4 bg-stone-300"
        }`}
      />
    </button>
  );
}
