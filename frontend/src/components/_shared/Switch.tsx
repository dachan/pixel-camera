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
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-md border border-stone-300 transition ${
        checked ? "bg-orange-500" : "bg-stone-200"
      }`}
    >
      <span
        className={`absolute top-1 h-3.5 w-3.5 rounded-md bg-white transition-all ${
          checked ? "left-6" : "left-1"
        }`}
      />
    </button>
  );
}
