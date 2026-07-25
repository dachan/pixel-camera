import { type ReactNode } from "react";

type ButtonGroupItem<T extends string> = {
  id: T;
  label: string;
  // Optional leading icon, rendered before the label.
  icon?: ReactNode;
};

type ButtonGroupProps<T extends string> = {
  items: readonly ButtonGroupItem<T>[];
  active: T;
  onChange: (id: T) => void;
  // When set, lay out as a CSS grid with this many equal columns instead of
  // a single flex row. minmax(0, 1fr) lets long labels truncate instead of
  // blowing the column count.
  columns?: number;
  // Extra classes applied to every button (e.g. a shared height with Capture).
  buttonClassName?: string;
};

export default function ButtonGroup<T extends string>({
  items,
  active,
  onChange,
  columns,
  buttonClassName,
}: ButtonGroupProps<T>) {
  const wrap = columns != null;
  return (
    <div
      className={
        wrap
          ? "grid w-full gap-2 text-xs select-none"
          : "flex w-full gap-2 text-xs select-none"
      }
      style={wrap ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={[
            `${wrap ? "min-w-0" : "flex-1"} flex items-center justify-center gap-1.5 rounded-md border border-stone-300 px-3 py-2 text-xs font-semibold transition-all`,
            active === item.id
              ? "bg-stone-50 text-orange-500 shadow-[0_0_2px_rgb(0_0_0_/_0.08)]"
              : "bg-stone-100 text-stone-400 shadow-[0_0_4px_rgb(0_0_0_/_0.16)]",
            buttonClassName,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {item.icon}
          {/* The descenderless labels sit ~1px high in their line box; nudge
              down so they read centred (matches the Button component). */}
          <span
            className={`min-w-0 translate-y-px ${wrap ? "text-center leading-tight text-balance" : "truncate"}`}
          >
            {item.label}
          </span>
        </button>
      ))}
    </div>
  );
}
