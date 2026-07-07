type Tab<T extends string> = {
  id: T;
  label: string;
};

type TabsProps<T extends string> = {
  tabs: readonly Tab<T>[];
  active: T;
  onChange: (id: T) => void;
};

export default function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: TabsProps<T>) {
  return (
    <div className="flex w-full gap-2 text-sm select-none">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`flex-1 truncate rounded-sm border border-stone-300 bg-stone-100 px-4 py-2 font-mono text-sm font-bold transition ${
            active === tab.id
              ? "text-orange-500 shadow-xs brightness-95"
              : "text-stone-500 shadow-lg"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
