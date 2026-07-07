"use client";

import { type ButtonHTMLAttributes } from "react";

export default function Button({
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={[
        "w-full bg-primary p-4 font-bold text-primary-foreground transition hover:bg-primary-hover disabled:opacity-50",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
