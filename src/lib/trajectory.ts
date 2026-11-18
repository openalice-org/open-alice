import type { PersonPaper } from "./personPapers";

export type TrajectoryWeight = "papers" | "citations";

/** One year of a person's output, collapsed to a single point in the domain triangle. */
export interface YearPoint {
  year: number;
  /** Papers published that year (within the current window). */
  n: number;
  citations: number;
  /** This year's own weighted-average triangle position (shares summing to 1). */
  sensing: number;
  communication: number;
  computing: number;
  /** The same position smoothed with the neighbouring years (what the 3D path draws). */
  smooth: { sensing: number; communication: number; computing: number };
  /** The year's most-cited paper (for the detail card). */
  top: PersonPaper;
}

/**
 * Collapse papers into one point per year: the weighted average of that year's
 * triangle positions. `papers` weights every paper equally; `citations` weights
 * a paper by 1 + its citations, so well-cited work pulls the year toward it.
 * Years with no papers are simply absent (the line bridges the gap).
 */
export function yearlyTrajectory(papers: PersonPaper[], weightBy: TrajectoryWeight): YearPoint[] {
  const byYear = new Map<number, PersonPaper[]>();
  for (const p of papers) {
    if (p.year <= 0) continue;
    const list = byYear.get(p.year);
    if (list) list.push(p);
    else byYear.set(p.year, [p]);
  }
  const out: YearPoint[] = [];
  for (const [year, list] of byYear) {
    let w = 0;
    let s = 0;
    let cm = 0;
    let cp = 0;
    let cites = 0;
    let top = list[0];
    for (const p of list) {
      const wi = weightBy === "citations" ? 1 + p.citations : 1;
      w += wi;
      s += wi * p.sensing;
      cm += wi * p.communication;
      cp += wi * p.computing;
      cites += p.citations;
      if (p.citations > top.citations) top = p;
    }
    const sensing = s / w;
    const communication = cm / w;
    const computing = cp / w;
    out.push({ year, n: list.length, citations: cites, sensing, communication, computing, smooth: { sensing, communication, computing }, top });
  }
  out.sort((a, b) => a.year - b.year);
  return smoothTrajectory(out);
}

// Smoothing kernel over consecutive active years: 50 % this year, 25 % the previous, 25 % the next.
const W_SELF = 0.5;
const W_NEIGHBOUR = 0.25;

/**
 * Pull each year toward its neighbours. "Neighbour" means the previous/next year that has
 * papers (gaps are bridged, as on the path). At either end there is only one neighbour, so
 * the weights are rescaled to sum to 1 (0.5 / 0.25 -> two thirds / one third) rather than
 * shrinking the point toward the origin. Shares stay a convex combination, so they still
 * sum to 1.
 */
function smoothTrajectory(points: YearPoint[]): YearPoint[] {
  return points.map((p, i) => {
    const prev = points[i - 1];
    const next = points[i + 1];
    const wPrev = prev ? W_NEIGHBOUR : 0;
    const wNext = next ? W_NEIGHBOUR : 0;
    const total = W_SELF + wPrev + wNext;
    const mix = (pick: (q: YearPoint) => number) =>
      (W_SELF * pick(p) + (prev ? wPrev * pick(prev) : 0) + (next ? wNext * pick(next) : 0)) / total;
    return {
      ...p,
      smooth: {
        sensing: mix((q) => q.sensing),
        communication: mix((q) => q.communication),
        computing: mix((q) => q.computing),
      },
    };
  });
}
