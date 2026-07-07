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
    <div className="flex w-full overflow-hidden border border-border-subtle text-sm select-none">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`flex-1 p-4 transition font-bold ${
            active === tab.id
              ? "bg-primary text-primary-foreground"
              : "text-primary hover:text-primary-muted"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
