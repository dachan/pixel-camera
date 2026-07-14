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
      className={`relative h-6 w-11 shrink-0 border-2 border-stone-300 transition ${
        checked ? "bg-orange-500" : "bg-stone-200"
      }`}
    >
      <span
        className={`absolute top-0 h-5 w-5 bg-white transition-all ${
          checked ? "left-5" : "left-0"
        }`}
      />
    </button>
  );
}
