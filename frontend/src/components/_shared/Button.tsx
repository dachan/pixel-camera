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
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS;
  selected?: boolean;
}) {
  return (
    <button
      type={type}
      className={[
        "w-full rounded-md border px-4 py-2 text-xs font-semibold shadow-[0_0_4px_rgb(0_0_0_/_0.24)] transition-all disabled:opacity-50",
        VARIANTS[variant],
        variant === "secondary" && selected && "!text-orange-500",
        variant === "destructive" && selected && "!bg-red-500 !text-white",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {/* Plain-text labels sit ~1px high in their line box; nudge down so they
          read vertically centred. Element children (e.g. an icon + label) lay
          themselves out and are passed through untouched. */}
      {typeof children === "string" ? (
        <span className="inline-block translate-y-px">{children}</span>
      ) : (
        children
      )}
    </button>
  );
}
