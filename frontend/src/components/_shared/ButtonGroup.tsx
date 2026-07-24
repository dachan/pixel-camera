type ButtonGroupItem<T extends string> = {
  id: T;
  label: string;
};

type ButtonGroupProps<T extends string> = {
  items: readonly ButtonGroupItem<T>[];
  active: T;
  onChange: (id: T) => void;
};

export default function ButtonGroup<T extends string>({
  items,
  active,
  onChange,
}: ButtonGroupProps<T>) {
  return (
    <div className="flex w-full gap-2 text-xs select-none">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={`flex-1 truncate rounded-md border border-stone-300 px-4 py-2 text-xs font-semibold transition-all ${
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
