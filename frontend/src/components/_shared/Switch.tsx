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
      className={`relative h-7 w-12 shrink-0 transition ${
        checked ? "bg-control-track" : "bg-control-track"
      }`}
    >
      <span
        className={`bg-switch-thumb absolute top-1 h-5 w-5 transition-all ${
          checked ? "left-6" : "left-1"
        }`}
      />
    </button>
  );
}
