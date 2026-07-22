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
          className={`flex-1 truncate rounded-md border border-stone-300 bg-stone-100 px-4 py-2 text-xs font-semibold transition ${
            active === item.id ? "text-orange-500" : "text-stone-500"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
