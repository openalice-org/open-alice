import type { Person, TimeWindow } from "../types";

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
