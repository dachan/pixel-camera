// Composition grid overlays for the live preview. Every overlay is computed
// in the preview box's actual pixel dimensions (not a fixed aspect ratio),
// so perpendiculars, diagonals, and spirals stay geometrically correct
// whether the sensor is landscape or rotated to portrait.

export const GRID_OVERLAY_ITEMS = [
  { id: "none", label: "None" },
  { id: "thirds", label: "Rule of Thirds" },
  { id: "fibonacci", label: "Fibonacci Grid" },
  { id: "harmonic-armature", label: "Harmonic Armature" },
  { id: "golden-triangle", label: "Golden Triangle" },
  { id: "fibonacci-spiral", label: "Golden Spiral" },
  { id: "dynamic-sqrt2", label: "Dynamic Symmetry √2" },
  { id: "vanishing-point", label: "Vanishing Point" },
  { id: "fibonacci-matrix", label: "Fibonacci Matrix" },
  { id: "dynamic-sqrt3", label: "Dynamic Symmetry √3" },
  { id: "square-diagonals", label: "Square Diagonals" },
  { id: "fibonacci-diagonals", label: "Fibonacci Diagonals" },
  { id: "dynamic-sqrt4", label: "Dynamic Symmetry √4" },
] as const;

export type GridOverlayId = (typeof GRID_OVERLAY_ITEMS)[number]["id"];

export const GRID_OVERLAY_IDS = GRID_OVERLAY_ITEMS.map((item) => item.id);

type Segment = readonly [number, number, number, number];
type Rect = { x: number; y: number; w: number; h: number; dashed?: boolean };

export type GridOverlay = {
  segments: Segment[];
  rects?: Rect[];
  arcs?: string[];
  dot?: { x: number; y: number };
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
  // Each corner woven to the two thirds-points on each of its two far
  // sides — a dense interlocking star, not just the plain diagonals.
  const corners: [number, number][] = [
    [0, 0],
    [W, 0],
    [W, H],
    [0, H],
  ];
  const farSidePoints: [number, number][][] = [
    [
      [W, H / 3],
      [W, (2 * H) / 3],
      [W / 3, H],
      [(2 * W) / 3, H],
    ], // for TL: right side + bottom side
    [
      [0, H / 3],
      [0, (2 * H) / 3],
      [W / 3, H],
      [(2 * W) / 3, H],
    ], // for TR: left side + bottom side
    [
      [0, H / 3],
      [0, (2 * H) / 3],
      [W / 3, 0],
      [(2 * W) / 3, 0],
    ], // for BR: left side + top side
    [
      [W, H / 3],
      [W, (2 * H) / 3],
      [W / 3, 0],
      [(2 * W) / 3, 0],
    ], // for BL: right side + top side
  ];
  const segments: Segment[] = [];
  corners.forEach((corner, i) => {
    for (const target of farSidePoints[i]) {
      segments.push([corner[0], corner[1], target[0], target[1]]);
    }
  });
  return segments;
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
  // Root-N rectangle construction: divide into N columns AND N rows, with
  // both diagonals drawn across every column and every row — the woven
  // grid classically used to find dynamic-symmetry diagonals.
  const colW = W / n;
  const rowH = H / n;
  const segments: Segment[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = i * colW;
    const x1 = (i + 1) * colW;
    segments.push([x0, 0, x1, H]);
    segments.push([x1, 0, x0, H]);
    if (i > 0) segments.push([x0, 0, x0, H]);

    const y0 = i * rowH;
    const y1 = (i + 1) * rowH;
    segments.push([0, y0, W, y1]);
    segments.push([0, y1, W, y0]);
    if (i > 0) segments.push([0, y0, W, y0]);
  }
  return segments;
}

function vanishingPoint(W: number, H: number): Segment[] {
  const cx = W / 2;
  const cy = H / 2;
  const targets: [number, number][] = [
    [0, 0],
    [W, 0],
    [W, H],
    [0, H],
    [W / 2, 0],
    [W / 2, H],
    [0, H / 2],
    [W, H / 2],
  ];
  return targets.map(([x, y]) => [cx, cy, x, y]);
}

function fibonacciMatrix(W: number, H: number): Segment[] {
  // Vertical lines follow a phi-ratio fan from the left edge — each one at
  // W·φ⁻ⁿ, so they pack tightly near the edge and spread out further in,
  // matching the reference's lopsided dense-then-sparse grid. Horizontal
  // lines are a plain even row grid.
  const segments: Segment[] = [];
  for (let n = 1; n <= 9; n++) {
    const f = INV_PHI ** n;
    if (f <= 0.001 || f >= 0.999) continue;
    segments.push([W * f, 0, W * f, H]);
  }
  const rows = 6;
  for (let i = 1; i < rows; i++) {
    const y = (H * i) / rows;
    segments.push([0, y, W, y]);
  }
  return segments;
}

function squareDiagonals(
  W: number,
  H: number,
): { segments: Segment[]; rects: Rect[] } {
  // A square centered in the frame (dashed) plus diagonals of both the full
  // rectangle and the inner square, forming the crossed "bowtie" look.
  const side = Math.min(W, H);
  const x = (W - side) / 2;
  const y = (H - side) / 2;
  return {
    segments: [
      [0, 0, W, H],
      [W, 0, 0, H],
      [x, y, x + side, y + side],
      [x + side, y, x, y + side],
    ],
    rects: [{ x, y, w: side, h: side, dashed: true }],
  };
}

function fibonacciDiagonals(W: number, H: number): Segment[] {
  let rectA: Rect;
  let rectB: Rect;
  if (W >= H) {
    const gw = Math.min(W, H * PHI);
    rectA = { x: 0, y: 0, w: gw, h: H };
    rectB = { x: W - gw, y: 0, w: gw, h: H };
  } else {
    const gh = Math.min(H, W * PHI);
    rectA = { x: 0, y: 0, w: W, h: gh };
    rectB = { x: 0, y: H - gh, w: W, h: gh };
  }
  return [
    [rectA.x, rectA.y, rectA.x + rectA.w, rectA.y + rectA.h],
    [rectA.x, rectA.y + rectA.h, rectA.x + rectA.w, rectA.y],
    [rectB.x, rectB.y, rectB.x + rectB.w, rectB.y + rectB.h],
    [rectB.x, rectB.y + rectB.h, rectB.x + rectB.w, rectB.y],
  ];
}

// Nested squares spiralling inward (left, top, right, bottom, repeating),
// each with a quarter-circle arc — the classic golden-spiral construction
// generalized to any rectangle.
function fibonacciSpiral(W: number, H: number): { rects: Rect[]; arcs: string[] } {
  const rects: Rect[] = [];
  const arcs: string[] = [];
  let x = 0;
  let y = 0;
  let w = W;
  let h = H;

  for (let i = 0; i < 7 && w > 1 && h > 1; i++) {
    const s = Math.min(w, h);
    let sqX: number, sqY: number;
    let p1: [number, number], p2: [number, number];

    switch (i % 4) {
      case 0: // cut left column
        sqX = x;
        sqY = y;
        p1 = [x, y];
        p2 = [x + s, y + s];
        x += s;
        w -= s;
        break;
      case 1: // cut top row
        sqX = x;
        sqY = y;
        p1 = [x + s, y];
        p2 = [x, y + s];
        y += s;
        h -= s;
        break;
      case 2: // cut right column
        sqX = x + w - s;
        sqY = y;
        p1 = [x + w - s, y];
        p2 = [x + w, y + s];
        w -= s;
        break;
      default: // cut bottom row
        sqX = x;
        sqY = y + h - s;
        p1 = [x + s, y + h - s];
        p2 = [x, y + h];
        h -= s;
        break;
    }

    rects.push({ x: sqX, y: sqY, w: s, h: s });
    arcs.push(`M ${p1[0]} ${p1[1]} A ${s} ${s} 0 0 1 ${p2[0]} ${p2[1]}`);
  }

  return { rects, arcs };
}

export function computeGridOverlay(
  id: GridOverlayId,
  W: number,
  H: number,
): GridOverlay {
  const center = { x: W / 2, y: H / 2 };
  switch (id) {
    case "none":
      return { segments: [] };
    case "thirds":
      return { segments: thirds(W, H), dot: center };
    case "fibonacci":
      return { segments: fibonacciGrid(W, H), dot: center };
    case "harmonic-armature":
      return { segments: harmonicArmature(W, H) };
    case "golden-triangle":
      return { segments: goldenTriangle(W, H) };
    case "fibonacci-spiral": {
      const { rects, arcs } = fibonacciSpiral(W, H);
      return { segments: [], rects, arcs, dot: center };
    }
    case "dynamic-sqrt2":
      return { segments: dynamicSymmetry(W, H, 2) };
    case "vanishing-point":
      return { segments: vanishingPoint(W, H) };
    case "fibonacci-matrix":
      return { segments: fibonacciMatrix(W, H), dot: center };
    case "dynamic-sqrt3":
      return { segments: dynamicSymmetry(W, H, 3) };
    case "square-diagonals": {
      const { segments, rects } = squareDiagonals(W, H);
      return { segments, rects, dot: center };
    }
    case "fibonacci-diagonals":
      return { segments: fibonacciDiagonals(W, H), dot: center };
    case "dynamic-sqrt4":
      return { segments: dynamicSymmetry(W, H, 4) };
  }
}
