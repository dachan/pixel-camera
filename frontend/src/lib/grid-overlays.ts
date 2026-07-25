// Composition grid overlays for the live preview. Every overlay is computed
// in the preview box's actual pixel dimensions (not a fixed aspect ratio),
// so perpendiculars, diagonals, and spirals stay geometrically correct
// whether the sensor is landscape or rotated to portrait.

export const GRID_OVERLAY_ITEMS = [
  { id: "none", label: "None" },
  { id: "thirds", label: "Thirds" },
  { id: "fibonacci", label: "Fibonacci" },
  { id: "harmonic-armature", label: "Harmonic" },
  { id: "golden-triangle", label: "Triangle" },
  { id: "fibonacci-spiral", label: "Spiral" },
  { id: "dynamic-sqrt2", label: "Dynamic" },
  { id: "vanishing-point", label: "Vanishing" },
  { id: "fibonacci-matrix", label: "Matrix" },
  { id: "square-diagonals", label: "Sq Diags" },
  { id: "fibonacci-diagonals", label: "Fib Diags" },
] as const;

export type GridOverlayId = (typeof GRID_OVERLAY_ITEMS)[number]["id"];

export const GRID_OVERLAY_IDS = GRID_OVERLAY_ITEMS.map((item) => item.id);

type Segment = readonly [number, number, number, number];
type Rect = { x: number; y: number; w: number; h: number; dashed?: boolean };

export type GridOverlay = {
  segments: Segment[];
  rects?: Rect[];
  arcs?: string[];
};

const PHI = 1.618033988749895;
const INV_PHI = 0.6180339887498949; // 1 / PHI
const INV_PHI2 = 0.3819660112501051; // 1 - INV_PHI

function thirds(W: number, H: number): Segment[] {
  return [
    [W / 3, 0, W / 3, H],
    [(2 * W) / 3, 0, (2 * W) / 3, H],
    [0, H / 3, W, H / 3],
    [0, (2 * H) / 3, W, (2 * H) / 3],
  ];
}

function fibonacciGrid(W: number, H: number): Segment[] {
  const x1 = W * INV_PHI2;
  const x2 = W * INV_PHI;
  const y1 = H * INV_PHI2;
  const y2 = H * INV_PHI;
  return [
    [x1, 0, x1, H],
    [x2, 0, x2, H],
    [0, y1, W, y1],
    [0, y2, W, y2],
  ];
}

function harmonicArmature(W: number, H: number): Segment[] {
  // The classic armature of the rectangle: both full diagonals, both
  // centrelines, and every corner joined to the midpoint of each of the two
  // sides it does not touch (the eight half-diagonals).
  const midTop: [number, number] = [W / 2, 0];
  const midBottom: [number, number] = [W / 2, H];
  const midLeft: [number, number] = [0, H / 2];
  const midRight: [number, number] = [W, H / 2];

  return [
    // Full diagonals.
    [0, 0, W, H],
    [W, 0, 0, H],
    // Centrelines.
    [W / 2, 0, W / 2, H],
    [0, H / 2, W, H / 2],
    // Half-diagonals: each corner to the midpoints of its two far sides.
    [0, 0, ...midRight],
    [0, 0, ...midBottom],
    [W, 0, ...midLeft],
    [W, 0, ...midBottom],
    [W, H, ...midLeft],
    [W, H, ...midTop],
    [0, H, ...midRight],
    [0, H, ...midTop],
  ];
}

function goldenTriangle(W: number, H: number): Segment[] {
  // Diagonal from bottom-left to top-right, plus a perpendicular dropped
  // from each of the other two corners onto that diagonal.
  const ax = 0;
  const ay = H;
  const dx = W;
  const dy = -H;
  const denom = dx * dx + dy * dy || 1;

  const t1 = (0 * dx + (0 - ay) * dy) / denom; // foot from top-left (0,0)
  const foot1: [number, number] = [ax + t1 * dx, ay + t1 * dy];

  const t2 = ((W - ax) * dx + (H - ay) * dy) / denom; // foot from bottom-right
  const foot2: [number, number] = [ax + t2 * dx, ay + t2 * dy];

  return [
    [0, H, W, 0],
    [0, 0, ...foot1],
    [W, H, ...foot2],
  ];
}

function dynamicSymmetry(W: number, H: number, n: number): Segment[] {
  // Root-N rectangle: N equal columns (the reciprocals), with the whole
  // rectangle's two diagonals plus both diagonals of every column. The
  // crossings of those diagonals are the dynamic-symmetry "eyes".
  const colW = W / n;
  const segments: Segment[] = [
    [0, 0, W, H],
    [W, 0, 0, H],
    [0, H / 2, W, H / 2],
  ];
  for (let i = 0; i < n; i++) {
    const x0 = i * colW;
    const x1 = (i + 1) * colW;
    segments.push([x0, 0, x1, H]);
    segments.push([x1, 0, x0, H]);
    if (i > 0) segments.push([x0, 0, x0, H]);
  }
  return segments;
}

function vanishingPoint(W: number, H: number): Segment[] {
  // A radial fan of evenly spaced angles from the centre, each ray cast out
  // to whichever edge it reaches first.
  const cx = W / 2;
  const cy = H / 2;
  const rays = 16;
  const segments: Segment[] = [];
  for (let i = 0; i < rays; i++) {
    const theta = (2 * Math.PI * i) / rays;
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    // Distance to the nearest vertical / horizontal edge along this ray.
    const tx = Math.abs(dx) < 1e-9 ? Infinity : cx / Math.abs(dx);
    const ty = Math.abs(dy) < 1e-9 ? Infinity : cy / Math.abs(dy);
    const t = Math.min(tx, ty);
    segments.push([cx, cy, cx + dx * t, cy + dy * t]);
  }
  return segments;
}

// Successive golden sections measured in from one edge (φ⁻¹, φ⁻², φ⁻³ …),
// mirrored onto the other edge. Lines pack progressively tighter toward both
// edges of [0,1] and open out toward the middle — the reference "matrix"
// card's framed look. `extra` adds deeper levels for a denser run.
function fibonacciEdgeFractions(extra = 0): number[] {
  const levels = 7 + extra;
  const fromLeft: number[] = [];
  for (let n = 1; n <= levels; n++) fromLeft.push(INV_PHI ** n);
  const fromRight = fromLeft.map((f) => 1 - f);
  return [...fromLeft, ...fromRight].filter((f) => f > 0.004 && f < 0.996);
}

function fibonacciMatrix(W: number, H: number): Segment[] {
  const fracs = fibonacciEdgeFractions();
  // The reference matrix includes a central crosshair, with the mirrored
  // Fibonacci bands expanding outward from it toward both edges.
  const segments: Segment[] = [
    [W / 2, 0, W / 2, H],
    [0, H / 2, W, H / 2],
  ];
  for (const f of fracs) {
    segments.push([W * f, 0, W * f, H]);
  }
  // The frame is wider than it is tall, so the same φ progression yields
  // fewer usable rows than columns; run the vertical axis a level deeper so
  // the cell sizes stay comparable in both directions.
  for (const f of fibonacciEdgeFractions(1)) {
    segments.push([0, H * f, W, H * f]);
  }
  return segments;
}

function squareDiagonals(W: number, H: number): Segment[] {
  // The two largest squares that fit the frame, flush to each end so they
  // overlap in the middle. Only their diagonals are drawn (plus the whole
  // frame's) — the square outlines themselves stay off the viewfinder.
  const side = Math.min(W, H);
  const landscape = W >= H;
  const offset = (landscape ? W : H) - side;

  const squares: Rect[] = landscape
    ? [
        { x: 0, y: 0, w: side, h: side },
        { x: offset, y: 0, w: side, h: side },
      ]
    : [
        { x: 0, y: 0, w: side, h: side },
        { x: 0, y: offset, w: side, h: side },
      ];

  const segments: Segment[] = [
    [0, 0, W, H],
    [W, 0, 0, H],
  ];
  for (const s of squares) {
    segments.push([s.x, s.y, s.x + s.w, s.y + s.h]);
    segments.push([s.x + s.w, s.y, s.x, s.y + s.h]);
  }

  return segments;
}

function fibonacciDiagonals(W: number, H: number): Segment[] {
  // Cut the frame at both golden sections on its long axis, then draw both
  // diagonals of every sub-rectangle those cuts make, plus the frame's own.
  // The sub-rectangles have distinctly different proportions, so their
  // diagonals fan out into a wide star instead of hugging the main diagonal.
  const segments: Segment[] = [
    [0, 0, W, H],
    [W, 0, 0, H],
  ];

  const addBoth = (x0: number, y0: number, x1: number, y1: number) => {
    segments.push([x0, y0, x1, y1]);
    segments.push([x1, y0, x0, y1]);
  };

  if (W >= H) {
    for (const cut of [W * INV_PHI2, W * INV_PHI]) {
      addBoth(0, 0, cut, H);
      addBoth(cut, 0, W, H);
    }
  } else {
    for (const cut of [H * INV_PHI2, H * INV_PHI]) {
      addBoth(0, 0, W, cut);
      addBoth(0, cut, W, H);
    }
  }
  return segments;
}

// The golden spiral only tiles exactly inside a φ:1 rectangle, so inscribe
// the largest one that fits the frame (flush to the right / bottom, leaving
// the leftover strip at the start) and subdivide that. Squares are then cut
// in a fixed left → top → right → bottom rotation, which keeps consecutive
// quarter-arcs meeting end-to-end instead of jumping.
function fibonacciSpiral(W: number, H: number): { rects: Rect[]; arcs: string[] } {
  // Inscribed golden rectangle, matching the frame's orientation.
  let gx: number, gy: number, gw: number, gh: number;
  if (W / H >= PHI) {
    gh = H;
    gw = H * PHI;
    gx = W - gw;
    gy = 0;
  } else {
    gw = W;
    gh = W * PHI;
    if (gh > H) {
      gh = H;
      gw = H / PHI;
    }
    gx = 0;
    gy = H - gh;
  }

  const rects: Rect[] = [{ x: gx, y: gy, w: gw, h: gh }];
  const arcs: string[] = [];

  let x = gx;
  let y = gy;
  let w = gw;
  let h = gh;
  // 0 = left, 1 = top, 2 = right, 3 = bottom.
  let side = w >= h ? 0 : 1;

  for (let i = 0; i < 10 && w > 0.5 && h > 0.5; i++) {
    const s = Math.min(w, h);
    let sq: Rect;
    // Arc endpoints, and the square corner the quarter-circle is centred on.
    let p1: [number, number], p2: [number, number];

    switch (side) {
      case 0: // square at the left, remainder to the right
        sq = { x, y, w: s, h: s };
        p1 = [x, y + s]; // bottom-left
        p2 = [x + s, y]; // top-right  (centre: top-left)
        x += s;
        w -= s;
        break;
      case 1: // square at the top, remainder below
        sq = { x, y, w: s, h: s };
        p1 = [x, y]; // top-left
        p2 = [x + s, y + s]; // bottom-right (centre: top-right)
        y += s;
        h -= s;
        break;
      case 2: // square at the right, remainder to the left
        sq = { x: x + w - s, y, w: s, h: s };
        p1 = [x + w, y]; // top-right
        p2 = [x + w - s, y + s]; // bottom-left (centre: bottom-right)
        w -= s;
        break;
      default: // square at the bottom, remainder above
        sq = { x, y: y + h - s, w: s, h: s };
        p1 = [x + s, y + h]; // bottom-right
        p2 = [x, y + h - s]; // top-left (centre: bottom-left)
        h -= s;
        break;
    }

    rects.push(sq);
    arcs.push(`M ${p1[0]} ${p1[1]} A ${s} ${s} 0 0 1 ${p2[0]} ${p2[1]}`);
    side = (side + 1) % 4;
  }

  return { rects, arcs };
}

export function computeGridOverlay(
  id: GridOverlayId,
  W: number,
  H: number,
): GridOverlay {
  switch (id) {
    case "none":
      return { segments: [] };
    case "thirds":
      return { segments: thirds(W, H) };
    case "fibonacci":
      return { segments: fibonacciGrid(W, H) };
    case "harmonic-armature":
      return { segments: harmonicArmature(W, H) };
    case "golden-triangle":
      return { segments: goldenTriangle(W, H) };
    case "fibonacci-spiral": {
      const { rects, arcs } = fibonacciSpiral(W, H);
      return { segments: [], rects, arcs };
    }
    case "dynamic-sqrt2":
      return { segments: dynamicSymmetry(W, H, 2) };
    case "vanishing-point":
      return { segments: vanishingPoint(W, H) };
    case "fibonacci-matrix":
      return { segments: fibonacciMatrix(W, H) };
    case "square-diagonals":
      return { segments: squareDiagonals(W, H) };
    case "fibonacci-diagonals":
      return { segments: fibonacciDiagonals(W, H) };
  }
}
