"use client";

import { type ReactNode } from "react";
import { useDragScroll } from "@/lib/use-drag-scroll";

// The standard scrollable tab container: fills the tab, press-and-drag (or
// swipe, via the kiosk's emulated mouse) to scroll. Scrollbars are hidden
// globally in globals.css, so none of that styling is repeated here.
export default function DragScrollArea({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useDragScroll<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`h-full min-h-0 w-full overflow-y-auto touch-pan-y overscroll-contain ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
