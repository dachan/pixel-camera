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
        checked ? "bg-selected" : "bg-control-track"
      }`}
    >
      <span
        className={`absolute top-1 h-5 w-5 transition-all ${
          checked ? "bg-selected-foreground left-6" : "bg-switch-thumb left-1"
        }`}
      />
    </button>
  );
}
