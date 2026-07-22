"use client";

import {
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

type Orientation = "vertical" | "horizontal";

export function SliderInput({
  orientation = "vertical",
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  orientation?: Orientation;
}) {
  const vertical = orientation === "vertical";

  return (
    <input
      {...props}
      type="range"
      className={[
        "cursor-pointer appearance-none bg-transparent",
        vertical
          ? [
              "block min-h-0 w-12 flex-1 self-stretch",
              "[direction:rtl] [writing-mode:vertical-lr]",
              "[&::-moz-range-track]:h-full [&::-moz-range-track]:w-1.5 [&::-moz-range-track]:rounded-md [&::-moz-range-track]:border-0 [&::-moz-range-track]:bg-stone-300",
              "[&::-webkit-slider-runnable-track]:h-full [&::-webkit-slider-runnable-track]:w-1.5 [&::-webkit-slider-runnable-track]:rounded-md [&::-webkit-slider-runnable-track]:border-0 [&::-webkit-slider-runnable-track]:bg-stone-300",
              "[&::-moz-range-thumb]:size-12 [&::-moz-range-thumb]:rounded-md [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-stone-100",
              "[&::-webkit-slider-thumb]:-ml-5.25 [&::-webkit-slider-thumb]:size-12 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-md [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-stone-100",
            ]
          : [
              "block h-12 w-full min-w-0 flex-1",
              "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:w-full [&::-moz-range-track]:rounded-md [&::-moz-range-track]:border-0 [&::-moz-range-track]:bg-stone-300",
              "[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:w-full [&::-webkit-slider-runnable-track]:rounded-md [&::-webkit-slider-runnable-track]:border-0 [&::-webkit-slider-runnable-track]:bg-stone-300",
              "[&::-moz-range-thumb]:size-12 [&::-moz-range-thumb]:rounded-md [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-stone-100",
              "[&::-webkit-slider-thumb]:-mt-5.25 [&::-webkit-slider-thumb]:size-12 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-md [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-stone-100",
            ],
        "disabled:cursor-not-allowed disabled:opacity-50",
        "disabled:[&::-moz-range-thumb]:bg-stone-100",
        "disabled:[&::-webkit-slider-thumb]:bg-stone-100",
        className,
      ]
        .flat()
        .filter(Boolean)
        .join(" ")}
      {...(vertical
        ? ({ orient: "vertical" } as InputHTMLAttributes<HTMLInputElement>)
        : {})}
    />
  );
}

type SliderProps = {
  orientation?: Orientation;
  label?: string;
  value?: ReactNode;
  children: ReactNode;
};

export default function Slider({
  orientation = "vertical",
  label,
  value,
  children,
}: SliderProps) {
  if (orientation === "horizontal") {
    return (
      <label className="flex w-full min-w-0 items-center gap-3">
        {label != null && (
          <span className="w-8 shrink-0 truncate font-mono text-xs font-semibold text-stone-500">
            {label}
          </span>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 items-center">
          {children}
        </div>
        {value != null && (
          <span className="w-10 shrink-0 text-right font-mono text-xs text-stone-700">
            {value}
          </span>
        )}
      </label>
    );
  }

  return (
    <label className="flex h-full w-full min-w-0 flex-col items-center gap-4">
      <div className="flex w-full min-w-0 flex-col items-center">
        {label != null && (
          <span className="w-full truncate text-center font-mono text-sm font-semibold text-stone-500">
            {label}
          </span>
        )}
        {value != null && (
          <span className="font-mono text-xs text-stone-700">{value}</span>
        )}
      </div>
      <div className="flex h-full min-h-0 w-full justify-center">
        {children}
      </div>
    </label>
  );
}
