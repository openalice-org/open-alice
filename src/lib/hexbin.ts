// Hex-density aggregation math, ported from SPRINT 13/index.html's
// hexRadius()/hexbinCells()/hexagonPath()/hexAlpha() — a hand-rolled
// pointy-top hexbin (no d3-hexbin dependency), binning already-projected
// screen positions into a fixed-count honeycomb across the plot width.

const HEX_COLS = 24; // hexes across the plot width (fixed count, drives the grain)
const HEX_MIN_A = 0.12; // fill-opacity for a 1-person cell
const HEX_MAX_A = 0.92; // fill-opacity for the densest cell

/** Hex radius from a fixed hexes-across-the-plot count: dx = r*sqrt(3), HEX_COLS*dx = plotWidthPx. */
export function hexRadius(plotWidthPx: number): number {
  return Math.max(6, plotWidthPx / (HEX_COLS * Math.sqrt(3)));
}

export interface HexItem {
  cx: number;
  cy: number;
  colorRgb: [number, number, number];
}

export interface HexCell {
  id: string;
  count: number;
  x: number;
  y: number;
  sumR: number;
  sumG: number;
  sumB: number;
}

/** Bins items into pointy-top hex cells (d3-hexbin's nearest-centre algorithm, inlined). */
export function hexbinCells(items: HexItem[], r: number): HexCell[] {
  const dx = r * 2 * Math.sin(Math.PI / 3); // centre spacing along x
  const dy = r * 1.5; // centre spacing along y (rows)
  const byId = new Map<string, HexCell>();
  for (const it of items) {
    const py = it.cy / dy;
    let pi = Math.round(py);
    const px = it.cx / dx - (pi & 1) * 0.5;
    let pj = Math.round(px);
    const py1 = py - pi;
    if (Math.abs(py1) * 3 > 1) {
      // nearer the neighbouring cell?
      const px1 = px - pj;
      const pi2 = pi + (py < pi ? -1 : 1);
      const pj2 = pj + (px < pj ? -1 : 1);
      const px2 = px - pj2;
      const py2 = py - pi2;
      if (px1 * px1 + py1 * py1 > px2 * px2 + py2 * py2) {
        pi = pi2 + (pi & 1 ? 1 : 0);
        pj = pj2;
      }
    }
    const id = pi + "-" + pj;
    let cell = byId.get(id);
    if (!cell) {
      cell = { id, count: 0, x: (pj + (pi & 1) * 0.5) * dx, y: pi * dy, sumR: 0, sumG: 0, sumB: 0 };
      byId.set(id, cell);
    }
    cell.count++;
    cell.sumR += it.colorRgb[0];
    cell.sumG += it.colorRgb[1];
    cell.sumB += it.colorRgb[2];
  }
  return [...byId.values()];
}

/** Pointy-top hexagon path centred at local origin, radius r (drawn via a translate). */
export function hexagonPath(r: number): string {
  let d = "";
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30); // pointy-top: first vertex up
    const x = r * Math.cos(a);
    const y = r * Math.sin(a);
    d += (i === 0 ? "M" : "L") + x.toFixed(2) + "," + y.toFixed(2);
  }
  return d + "Z";
}

/** count -> fill-opacity, linear ramp between HEX_MIN_A and HEX_MAX_A. */
export function hexAlpha(count: number, maxCount: number): number {
  if (maxCount <= 1) return HEX_MAX_A;
  return HEX_MIN_A + (HEX_MAX_A - HEX_MIN_A) * ((count - 1) / (maxCount - 1));
}

/** "rgb(r, g, b)" (as returned by domainColorOf) -> an [r,g,b] tuple. */
export function cssRgbToTuple(css: string): [number, number, number] {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(css);
  if (!m) return [93, 93, 88]; // var(--point) fallback, matches index.css's --point
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
