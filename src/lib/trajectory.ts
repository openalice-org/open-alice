import type { PersonPaper } from "./personPapers";

export type TrajectoryWeight = "papers" | "citations";

/** One year of a person's output, collapsed to a single point in the domain triangle. */
export interface YearPoint {
  year: number;
  /** Papers published that year (within the current window). */
  n: number;
  citations: number;
  /** Weighted-average triangle position (shares summing to 1). */
  sensing: number;
  communication: number;
  computing: number;
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
    out.push({ year, n: list.length, citations: cites, sensing: s / w, communication: cm / w, computing: cp / w, top });
  }
  return out.sort((a, b) => a.year - b.year);
}
