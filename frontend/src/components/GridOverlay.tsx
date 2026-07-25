import { computeGridOverlay, type GridOverlayId } from "@/lib/grid-overlays";

export default function GridOverlay({
  id,
  width,
  height,
  opacity,
}: {
  id: GridOverlayId;
  width: number;
  height: number;
  /** 0–1. */
  opacity: number;
}) {
  if (id === "none" || width <= 0 || height <= 0 || opacity <= 0) return null;
  const overlay = computeGridOverlay(id, width, height);

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0"
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ opacity }}
      strokeWidth={2}
    >
      {overlay.rects?.map((r, i) => (
        <rect
          key={`r${i}`}
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          fill="none"
          stroke="white"
          strokeDasharray={r.dashed ? "4 3" : undefined}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {overlay.segments.map((s, i) => (
        <line
          key={`l${i}`}
          x1={s[0]}
          y1={s[1]}
          x2={s[2]}
          y2={s[3]}
          stroke="white"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {overlay.arcs?.map((d, i) => (
        <path
          key={`a${i}`}
          d={d}
          fill="none"
          stroke="white"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {overlay.dot && (
        <circle
          cx={overlay.dot.x}
          cy={overlay.dot.y}
          r={Math.max(3, Math.min(width, height) * 0.006)}
          fill="white"
          stroke="none"
        />
      )}
    </svg>
  );
}
