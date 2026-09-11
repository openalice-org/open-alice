import type { DomainShares, Person, TimeWindow } from "../types";
import { timeWindowCutoff } from "./people";

export const DOMAIN_ORDER: (keyof DomainShares)[] = ["computing", "communication", "sensing"];
export const DOMAIN_LABELS: Record<keyof DomainShares, string> = {
  computing: "Computing",
  communication: "Communication",
  sensing: "Sensing",
};
// Deliberately achromatic (dark/mid/light shades, not red/green/blue) so the
// geo map doesn't compete with the scatter view's colour language — ported
// from SPRINT 13's GEO_SHADES.
export const DOMAIN_SHADES: Record<keyof DomainShares, string> = {
  computing: "#3a3a37",
  communication: "#7a7a74",
  sensing: "#b7b7b1",
};

export interface GeoAggregate {
  people: number;
  papers: number;
  /** true when `papers` came from the precomputed distinct-paper file rather
   *  than a person-summed fallback (which double-counts co-authored work). */
  papersDistinct: boolean;
  /** At window "all": summed h-index (quantum, falling back to overall)
   *  across members — the closest citation-impact proxy the dataset has,
   *  same field ScatterView already labels "Corpus influence". h-index is a
   *  whole-career metric with no per-year breakdown, so it can't itself be
   *  narrowed to a window. At "last5"/"last10": summed per-year citations
   *  (from Person.yearly) restricted to years in the window instead — a
   *  different metric than the "all" h-index sum, but one that actually
   *  shrinks with the window rather than silently staying whole-career
   *  (the same bug windowed paper counts had before they got a real
   *  distinct-per-window source). Still person-summed, so still double-
   *  counts a co-authored paper's citations once per co-author — no distinct
   *  per-window citation source exists yet, unlike papers'
   *  paper_counts_geo.json. */
  citations: number;
  /** true when `citations` used the windowed per-year sum (member missing
   *  `yearly` falls back to their whole-career h-index even in that case). */
  citationsWindowed: boolean;
  slices: DomainShares;
  /** Same per-domain breakdown as `slices`, but weighted by each member's
   *  citation contribution (the same value summed into `citations`) instead
   *  of their paper count — lets the aid panel show a citations-by-domain
   *  split when Geo is sized by citations. Always person-summed: unlike
   *  `slices` there's no precomputed distinct source to prefer, so this
   *  double-counts a co-authored paper's citations once per co-author the
   *  same way the plain `citations` total does. */
  citationSlices: DomainShares;
}

function windowedCitations(p: Person, cutoff: number): number | null {
  if (!p.yearly) return null;
  let sum = 0;
  for (const [year, v] of Object.entries(p.yearly)) {
    if (Number(year) >= cutoff) sum += v.citations;
  }
  return sum;
}

/**
 * Rolls up a group of people into people/papers counts plus a domain-share
 * breakdown, weighted by each person's quantum paper count — mirrors
 * SPRINT 13's geoAggregatesByUni/geoAggregatesByCountry. Prefers precomputed
 * distinct values (from paper_counts_geo.json) when available; falls back to
 * summing person-level fields otherwise.
 */
export function aggregateGeo(
  members: Person[],
  distinctPapers?: number,
  distinctSlices?: DomainShares,
  window: TimeWindow = "all",
): GeoAggregate {
  let summedPapers = 0;
  let summedCitations = 0;
  let citationsWindowed = false;
  const cutoff = window === "all" ? null : timeWindowCutoff(window);
  const slices: DomainShares = { computing: 0, communication: 0, sensing: 0 };
  const citationSlices: DomainShares = { computing: 0, communication: 0, sensing: 0 };
  members.forEach((p) => {
    const papers = p.quantum_papers || 0;
    summedPapers += papers;
    const windowed = cutoff != null ? windowedCitations(p, cutoff) : null;
    const personCitations = windowed ?? (p.quantum_h_index ?? p.h_index ?? 0);
    summedCitations += personCitations;
    if (windowed != null) citationsWindowed = true;
    if (p.computing_share != null && p.communication_share != null && p.sensing_share != null) {
      slices.computing += papers * p.computing_share;
      slices.communication += papers * p.communication_share;
      slices.sensing += papers * p.sensing_share;
      citationSlices.computing += personCitations * p.computing_share;
      citationSlices.communication += personCitations * p.communication_share;
      citationSlices.sensing += personCitations * p.sensing_share;
    }
  });
  const papersDistinct = distinctPapers != null;
  return {
    people: members.length,
    papers: papersDistinct ? distinctPapers! : summedPapers,
    papersDistinct,
    citations: summedCitations,
    citationsWindowed,
    slices: distinctSlices ?? slices,
    citationSlices,
  };
}
