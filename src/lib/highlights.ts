import type { PersonPaper } from "./personPapers";

/** The most-cited papers of each year, per year. */
export const HIGHLIGHTS_PER_YEAR = 3;
/** Upper bound on the highlights shown at once, so a long career stays readable. */
export const HIGHLIGHTS_MAX = 60;

/**
 * The papers a person's trajectory runs through: the top few most-cited papers of every year
 * (every year keeps its single best paper, even with no citations, so the thread never breaks;
 * extra papers need at least one citation). If that is more than `max`, the least-cited extras go
 * first. Sorted oldest to newest, most cited first within a year.
 */
export function pickHighlights(papers: PersonPaper[], perYear = HIGHLIGHTS_PER_YEAR, max = HIGHLIGHTS_MAX): PersonPaper[] {
  const byYear = new Map<number, PersonPaper[]>();
  for (const p of papers) {
    if (p.year <= 0) continue;
    const list = byYear.get(p.year);
    if (list) list.push(p);
    else byYear.set(p.year, [p]);
  }
  const best: PersonPaper[] = []; // each year's single best paper
  const extra: PersonPaper[] = []; // the runners-up that earned a citation
  const rank = (a: PersonPaper, b: PersonPaper) => b.citations - a.citations || a.wid - b.wid;
  for (const list of byYear.values()) {
    list.sort(rank);
    best.push(list[0]);
    for (const p of list.slice(1, perYear)) if (p.citations > 0) extra.push(p);
  }
  extra.sort(rank);
  const keep = [...best, ...extra.slice(0, Math.max(0, max - best.length))];
  return keep.sort((a, b) => a.year - b.year || rank(a, b));
}
