"use client";

export default function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
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
      className="relative h-6 w-11 shrink-0 overflow-hidden rounded-md border border-stone-300 bg-white"
    >
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 flex w-1/2 items-center justify-center bg-orange-500 text-[8px] leading-none font-semibold tracking-wide text-white transition-transform ${
          checked ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        ON
      </span>
      <span
        aria-hidden
        className={`absolute inset-y-0 right-0 flex w-1/2 items-center justify-center text-[8px] leading-none font-semibold tracking-wide text-stone-400 transition-transform ${
          checked ? "translate-x-full" : "translate-x-0"
        }`}
      >
        OFF
      </span>
      <span
        className={`absolute top-1/2 left-0.75 z-10 h-3.5 w-3.5 rounded-full bg-orange-500 transition-transform ${
          checked
            ? "translate-x-5.5 -translate-y-1/2"
            : "translate-x-0 -translate-y-1/2"
        }`}
      />
    </button>
  );
}
