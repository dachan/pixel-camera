type ButtonGroupItem<T extends string> = {
  id: T;
  label: string;
};

type ButtonGroupProps<T extends string> = {
  items: readonly ButtonGroupItem<T>[];
  active: T;
  onChange: (id: T) => void;
  // When set, the group wraps into rows of this many buttons instead of a
  // single row. Each button's basis is a clean 1/columns of the width (minus
  // the gaps), so the rows stay aligned; grow soaks up sub-pixel rounding.
  columns?: number;
};

// gap-2 between buttons, in rem — used to compute the wrapped basis.
const GAP_REM = 0.5;

export default function ButtonGroup<T extends string>({
  items,
  active,
  onChange,
  columns,
}: ButtonGroupProps<T>) {
  const wrap = columns != null;
  const basis = wrap
    ? `calc((100% - ${(columns - 1) * GAP_REM}rem) / ${columns})`
    : undefined;
  return (
    <div
      className={`flex w-full gap-2 text-xs select-none ${wrap ? "flex-wrap" : ""}`}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          style={basis ? { flexBasis: basis } : undefined}
          className={`${wrap ? "grow" : "flex-1"} truncate rounded-md border border-stone-300 px-4 py-2 text-xs font-semibold transition-all ${
            active === item.id
              ? "bg-stone-50 text-orange-500 shadow-[0_0_2px_rgb(0_0_0_/_0.08)]"
              : "bg-stone-100 text-stone-400 shadow-[0_0_4px_rgb(0_0_0_/_0.16)]"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
