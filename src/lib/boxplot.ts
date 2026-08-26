// Boxplot aggregation math, ported from SPRINT 13/index.html's
// boxStats()/computeBoxBins()/boxGeom() (Cartesian-only view: equal-width
// bins along one axis, each summarizing the distribution of the other axis
// as a classic Tukey box-and-whisker).
import { quantile } from "d3-array";
import type { ScaleLinear } from "d3-scale";

export const BOX_ROWS = 5; // horizontal orientation: equal-width rows, binned by y
export const BOX_COLS = 7; // vertical orientation: equal-width columns, binned by x
export const BOX_THICK_FRAC = 0.62; // box thickness as a fraction of its bin band

export interface BoxStats {
  q1: number;
  median: number;
  q3: number;
  whiskerLo: number;
  whiskerHi: number;
  outliers: number[];
}

/** Classic 1.5xIQR Tukey stats. `values` must be pre-sorted ascending. */
export function boxStats(values: number[]): BoxStats {
  const q1 = quantile(values, 0.25) as number;
  const median = quantile(values, 0.5) as number;
  const q3 = quantile(values, 0.75) as number;
  const iqr = q3 - q1;
  const fenceLo = q1 - 1.5 * iqr;
  const fenceHi = q3 + 1.5 * iqr;
  let whiskerLo = q1;
  let whiskerHi = q3;
  const outliers: number[] = [];
  values.forEach((v) => {
    if (v < fenceLo || v > fenceHi) outliers.push(v);
    else {
      if (v < whiskerLo) whiskerLo = v;
      if (v > whiskerHi) whiskerHi = v;
    }
  });
  return { q1, median, q3, whiskerLo, whiskerHi, outliers };
}

export interface BoxBin {
  index: number;
  stats: BoxStats;
  binLo: number;
  binHi: number;
  binCenter: number;
}

/**
 * Buckets `items` into `binCount` equal-width bins across `binDomain`
 * (NOT quantile bins) using `binValueOf`, then computes Tukey stats over
 * `summaryValueOf` for each occupied bin. Empty bins come back as `null`.
 */
export function computeBoxBins<T>(
  items: T[],
  binValueOf: (item: T) => number,
  summaryValueOf: (item: T) => number,
  binDomain: readonly [number, number],
  binCount: number,
): (BoxBin | null)[] {
  const [lo, hi] = binDomain;
  const binW = (hi - lo) / binCount;
  const buckets: number[][] = Array.from({ length: binCount }, () => []);
  items.forEach((item) => {
    const v = binValueOf(item);
    let i = Math.floor((v - lo) / binW);
    if (i < 0) i = 0;
    else if (i >= binCount) i = binCount - 1;
    buckets[i].push(summaryValueOf(item));
  });
  return buckets.map((values, i) => {
    if (!values.length) return null;
    values.sort((a, b) => a - b);
    return {
      index: i,
      stats: boxStats(values),
      binLo: lo + i * binW,
      binHi: lo + (i + 1) * binW,
      binCenter: lo + (i + 0.5) * binW,
    };
  });
}

/** Pixel-space geometry for one bin's box glyph, generic over orientation.
 * `horiz` bins the y-axis into rows and summarizes x (BOX_ROWS); the
 * non-horiz case bins the x-axis into columns and summarizes y (BOX_COLS). */
export interface BoxGeom {
  rectX: number;
  rectY: number;
  rectW: number;
  rectH: number;
  medianX1: number;
  medianY1: number;
  medianX2: number;
  medianY2: number;
  whiskerLoX1: number;
  whiskerLoY1: number;
  whiskerLoX2: number;
  whiskerLoY2: number;
  whiskerHiX1: number;
  whiskerHiY1: number;
  whiskerHiX2: number;
  whiskerHiY2: number;
  capLoX1: number;
  capLoY1: number;
  capLoX2: number;
  capLoY2: number;
  capHiX1: number;
  capHiY1: number;
  capHiX2: number;
  capHiY2: number;
  outliers: { x: number; y: number }[];
}

export function boxGeom(
  bin: BoxBin,
  horiz: boolean,
  xScale: ScaleLinear<number, number>,
  yScale: ScaleLinear<number, number>,
): BoxGeom {
  const { q1, median, q3, whiskerLo, whiskerHi, outliers } = bin.stats;
  if (horiz) {
    const cy = yScale(bin.binCenter);
    const thick = Math.abs(yScale(bin.binLo) - yScale(bin.binHi)) * BOX_THICK_FRAC;
    const x1 = xScale(q1);
    const x2 = xScale(q3);
    const xMed = xScale(median);
    const xWLo = xScale(whiskerLo);
    const xWHi = xScale(whiskerHi);
    return {
      rectX: Math.min(x1, x2),
      rectY: cy - thick / 2,
      rectW: Math.abs(x2 - x1),
      rectH: thick,
      medianX1: xMed,
      medianY1: cy - thick / 2,
      medianX2: xMed,
      medianY2: cy + thick / 2,
      whiskerLoX1: xWLo,
      whiskerLoY1: cy,
      whiskerLoX2: x1,
      whiskerLoY2: cy,
      whiskerHiX1: x2,
      whiskerHiY1: cy,
      whiskerHiX2: xWHi,
      whiskerHiY2: cy,
      capLoX1: xWLo,
      capLoY1: cy - thick * 0.25,
      capLoX2: xWLo,
      capLoY2: cy + thick * 0.25,
      capHiX1: xWHi,
      capHiY1: cy - thick * 0.25,
      capHiX2: xWHi,
      capHiY2: cy + thick * 0.25,
      outliers: outliers.map((v) => ({ x: xScale(v), y: cy })),
    };
  }
  const cx = xScale(bin.binCenter);
  const thick = Math.abs(xScale(bin.binLo) - xScale(bin.binHi)) * BOX_THICK_FRAC;
  const y1 = yScale(q1);
  const y2 = yScale(q3);
  const yMed = yScale(median);
  const yWLo = yScale(whiskerLo);
  const yWHi = yScale(whiskerHi);
  return {
    rectX: cx - thick / 2,
    rectY: Math.min(y1, y2),
    rectW: thick,
    rectH: Math.abs(y2 - y1),
    medianX1: cx - thick / 2,
    medianY1: yMed,
    medianX2: cx + thick / 2,
    medianY2: yMed,
    whiskerLoX1: cx,
    whiskerLoY1: yWLo,
    whiskerLoX2: cx,
    whiskerLoY2: y1,
    whiskerHiX1: cx,
    whiskerHiY1: y2,
    whiskerHiX2: cx,
    whiskerHiY2: yWHi,
    capLoX1: cx - thick * 0.25,
    capLoY1: yWLo,
    capLoX2: cx + thick * 0.25,
    capLoY2: yWLo,
    capHiX1: cx - thick * 0.25,
    capHiY1: yWHi,
    capHiX2: cx + thick * 0.25,
    capHiY2: yWHi,
    outliers: outliers.map((v) => ({ x: cx, y: yScale(v) })),
  };
}
