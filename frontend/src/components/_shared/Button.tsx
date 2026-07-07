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
        "w-full rounded-md bg-orange-500 p-4 font-bold text-white transition hover:bg-orange-600 disabled:opacity-50",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
