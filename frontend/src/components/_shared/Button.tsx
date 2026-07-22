"use client";

import { type ButtonHTMLAttributes } from "react";

const VARIANTS = {
  primary: "border-stone-300 bg-orange-500 text-white",
  secondary: "border-stone-300 bg-stone-100 text-stone-500",
  destructive: "border-red-500 bg-stone-100 text-red-500",
} as const;

export default function Button({
  className,
  type = "button",
  variant = "primary",
  selected = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS;
  selected?: boolean;
}) {
  return (
    <button
      type={type}
      className={[
        "w-full rounded-md border px-4 py-2 text-xs font-semibold transition disabled:opacity-50",
        VARIANTS[variant],
        variant === "secondary" && selected && "!text-orange-500",
        variant === "destructive" && selected && "!bg-red-500 !text-white",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
