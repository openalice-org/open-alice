import type { DomainShares, Person } from "../types";

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
  slices: DomainShares;
}

/**
 * Rolls up a group of people into people/papers counts plus a domain-share
 * breakdown, weighted by each person's quantum paper count — mirrors
 * SPRINT 13's geoAggregatesByUni/geoAggregatesByCountry. Prefers precomputed
 * distinct values (from paper_counts_geo.json) when available; falls back to
 * summing person-level fields otherwise.
 */
export function aggregateGeo(members: Person[], distinctPapers?: number, distinctSlices?: DomainShares): GeoAggregate {
  let summedPapers = 0;
  const slices: DomainShares = { computing: 0, communication: 0, sensing: 0 };
  members.forEach((p) => {
    const papers = p.quantum_papers || 0;
    summedPapers += papers;
    if (p.computing_share != null && p.communication_share != null && p.sensing_share != null) {
      slices.computing += papers * p.computing_share;
      slices.communication += papers * p.communication_share;
      slices.sensing += papers * p.sensing_share;
    }
  });
  const papersDistinct = distinctPapers != null;
  return {
    people: members.length,
    papers: papersDistinct ? distinctPapers! : summedPapers,
    papersDistinct,
    slices: distinctSlices ?? slices,
  };
}
