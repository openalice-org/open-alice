import type { PaperCounts, Person, TimeWindow } from "../types";

/** Match the person fields exposed by the scatter and table search UIs. */
export function matchesPersonSearch(person: Person, query: string): boolean {
  const needle = query.toLowerCase();
  return (
    person.name.toLowerCase().includes(needle) ||
    person.institution.toLowerCase().includes(needle) ||
    (person.topic ?? "").toLowerCase().includes(needle)
  );
}

/**
 * Narrow people to those active within a recent time window, based purely on
 * the existing first_year/last_year fields (no recompute of stats). "all"
 * keeps everyone, including people with null first_year/last_year. A
 * windowed option ("last5"/"last10") excludes anyone with a null last_year —
 * no year data means we can't confirm activity in the window — and keeps
 * only people whose last_year falls within the last N years counting the
 * current year (currentYear computed at call time, not module load time).
 */
export function filterByTimeWindow(people: Person[], window: TimeWindow): Person[] {
  if (window === "all") return people;
  const years = window === "last5" ? 5 : 10;
  const currentYear = new Date().getFullYear();
  const cutoff = currentYear - years + 1;
  return people.filter((person) => person.last_year != null && person.last_year >= cutoff);
}

/**
 * Picks the distinct paper-count slice matching the current time window
 * (see PaperCounts.last5/last10 — narrowed by each paper's own
 * publication_year, deduped the same way as the "all" counts). "all" keeps
 * the object as-is. A windowed request against a dataset built before
 * last5/last10 existed falls back to null: aggregateGeo (lib/geoAggregate.ts)
 * then sums each remaining person's own quantum_papers instead, which
 * double-counts co-authored work and isn't year-scoped — an approximation,
 * but strictly better than reusing the "all" distinct total across every
 * window (which is what quietly overstated the geo view's paper counts and
 * this replaces).
 */
export function paperCountsForWindow(counts: PaperCounts | null, window: TimeWindow): PaperCounts | null {
  if (!counts || window === "all") return counts;
  return (window === "last5" ? counts.last5 : counts.last10) ?? null;
}
