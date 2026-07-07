"use client";

import { type InputHTMLAttributes, type ReactNode } from "react";

const VERTICAL_SLIDER_CLASS = [
  "w-12 min-h-0 cursor-pointer appearance-none bg-transparent",
  "[writing-mode:vertical-lr] [direction:rtl]",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "[&::-webkit-slider-runnable-track]:h-full [&::-webkit-slider-runnable-track]:w-1.5 [&::-webkit-slider-runnable-track]: [&::-webkit-slider-runnable-track]:bg-gray-300",
  "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-12 [&::-webkit-slider-thumb]: [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-gray-500 [&::-webkit-slider-thumb]:-ml-[21px]",
  "disabled:[&::-webkit-slider-thumb]:bg-gray-500",
  "[&::-moz-range-track]:h-full [&::-moz-range-track]:w-1.5 [&::-moz-range-track]: [&::-moz-range-track]:border-0 [&::-moz-range-track]:bg-gray-500",
  "[&::-moz-range-thumb]:size-12 [&::-moz-range-thumb]: [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-gray-500",
  "disabled:[&::-moz-range-thumb]:bg-gray-500",
].join(" ");

export function VerticalSliderInput(
  props: InputHTMLAttributes<HTMLInputElement>,
) {
  const { className, ...rest } = props;
  return (
    <input
      {...rest}
      type="range"
      className={[VERTICAL_SLIDER_CLASS, "block flex-1 self-stretch", className]
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
      <div className="flex w-full min-w-0 flex-col items-center gap-0.5">
        <span className="w-full truncate text-center text-sm font-bold text-gray-500">
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
