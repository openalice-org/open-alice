import type { Person } from "../types";

/** Match the person fields exposed by the scatter and table search UIs. */
export function matchesPersonSearch(person: Person, query: string): boolean {
  const needle = query.toLowerCase();
  return (
    person.name.toLowerCase().includes(needle) ||
    person.institution.toLowerCase().includes(needle) ||
    (person.topic ?? "").toLowerCase().includes(needle)
  );
}
