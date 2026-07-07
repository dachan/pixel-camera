"use client";

import Switch from "@/components/_shared/Switch";

// One on/off row in Settings: title + description on the left, a switch on
// the right. Sized for touch (the kiosk runs with mouse emulation).
export default function SettingToggle({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-bold text-zinc-300">{title}</h2>
          <p className="text-sm text-zinc-500">{description}</p>
        </div>
        <Switch checked={checked} onChange={onChange} />
      </div>
    </section>
  );
}
