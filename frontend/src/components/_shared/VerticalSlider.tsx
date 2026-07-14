"use client";

import { type InputHTMLAttributes, type ReactNode } from "react";

export function VerticalSliderInput(
  props: InputHTMLAttributes<HTMLInputElement>,
) {
  const { className, ...rest } = props;
  return (
    <input
      {...rest}
      type="range"
      className={[
        [
          "block min-h-0 w-12 flex-1 self-stretch bg-transparent",
          "slider-shadow cursor-pointer appearance-none",
          "[direction:rtl] [writing-mode:vertical-lr]",
        ],
        [
          "[&::-moz-range-track]:h-full [&::-moz-range-track]:w-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:border-0 [&::-moz-range-track]:bg-stone-300",
          "rounded-full [&::-webkit-slider-runnable-track]:h-full [&::-webkit-slider-runnable-track]:w-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-stone-300",
        ],
        [
          "[&::-moz-range-thumb]:size-12 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-stone-100",
          "[&::-webkit-slider-thumb]:ml-[-21px] [&::-webkit-slider-thumb]:size-12 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-stone-100",
        ],
        [
          "disabled:cursor-not-allowed disabled:opacity-50",
          "disabled:[&::-moz-range-thumb]:bg-stone-100",
          "disabled:[&::-webkit-slider-thumb]:bg-stone-100",
        ],
        className,
      ]
        .flat()
        .filter(Boolean)
        .join(" ")}
      {...({ orient: "vertical" } as InputHTMLAttributes<HTMLInputElement>)}
    />
  );
}

type VerticalSliderProps = {
  label: string;
  value: ReactNode;
  children: ReactNode;
};

export default function VerticalSlider({
  label,
  value,
  children,
}: VerticalSliderProps) {
  return (
    <label className="flex h-full w-full min-w-0 flex-col items-center gap-4">
      <div className="flex w-full min-w-0 flex-col items-center">
        <span className="w-full truncate text-center font-mono text-sm font-semibold text-gray-500">
          {label}
        </span>
        <span className="font-mono text-xs text-gray-500">{value}</span>
      </div>
      <div className="flex h-full min-h-0 w-full justify-center">
        {children}
      </div>
    </label>
  );
}
