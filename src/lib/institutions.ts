// Derives the institution picker's option list (grouped by country, with
// "ALL OF <country>" and "ALL NORDICS" sentinel rows) from the loaded people,
// mirroring SPRINT 13's getUniversityOptions().
import type { Person } from "../types";

export const COUNTRY_ORDER = ["SE", "NO", "DK", "IS", "FI", "EE", "LV", "LT"];
export const COUNTRY_LABELS: Record<string, string> = {
  SE: "Sweden",
  NO: "Norway",
  DK: "Denmark",
  IS: "Iceland",
  FI: "Finland",
  EE: "Estonia",
  LV: "Latvia",
  LT: "Lithuania",
};

export const NORDICS_SCOPE = "Nordics";

export function isGeoScope(scope: string): boolean {
  return scope === NORDICS_SCOPE || scope.startsWith("country:");
}

export function countryOfScope(scope: string): string | null {
  return scope.startsWith("country:") ? scope.slice("country:".length) : null;
}

/** Filter people by the same Nordics, country, or university scope used by the picker. */
export function peopleForScope(people: Person[], scope: string, universityCountries: Map<string, string>): Person[] {
  if (scope === NORDICS_SCOPE) return people;
  if (scope.startsWith("country:")) {
    const country = countryOfScope(scope);
    return people.filter((person) => universityCountries.get(person.university) === country);
  }
  return people.filter((person) => person.university === scope);
}

/**
 * `people[].institution` is the person's own OpenAlex-listed affiliation —
 * noisy (a Nordic university's roster includes foreign co-authors under
 * their own foreign institution) and spans ~350 distinct values across the
 * dataset. `people[].university` is the canonical corpus-match key instead:
 * always one of the ~36 real Nordic universities present in this data, even
 * when that person's own `country`/`institution` disagrees (e.g. university
 * "KTH" with country "CN" for a Chinese co-author matched into KTH's quantum
 * corpus). Scope filtering and the geo map key off `university`; only the
 * tooltip/table display text uses the longer `institution` string.
 *
 * A university's *country* isn't in the data directly either, so it's
 * derived as the majority `country` among its own people (robust against
 * the odd foreign co-author; matches SPRINT 13's UNI_GEO/COUNTRY_ORDER
 * grouping).
 */
export function universityCountryMap(people: Person[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  people.forEach((p) => {
    let byCountry = counts.get(p.university);
    if (!byCountry) {
      byCountry = new Map();
      counts.set(p.university, byCountry);
    }
    byCountry.set(p.country, (byCountry.get(p.country) ?? 0) + 1);
  });

  const result = new Map<string, string>();
  counts.forEach((byCountry, university) => {
    let topCountry = "";
    let topCount = 0;
    byCountry.forEach((n, cc) => {
      if (n > topCount) {
        topCount = n;
        topCountry = cc;
      }
    });
    if (COUNTRY_ORDER.includes(topCountry)) {
      result.set(university, topCountry);
    }
  });
  return result;
}

/** University names, ordered by country appearance in COUNTRY_ORDER, then name. */
export function institutionsByCountry(people: Person[]): Map<string, string[]> {
  const uniCountry = universityCountryMap(people);
  const byCountry = new Map<string, Set<string>>();
  uniCountry.forEach((cc, university) => {
    if (!byCountry.has(cc)) byCountry.set(cc, new Set());
    byCountry.get(cc)!.add(university);
  });
  const result = new Map<string, string[]>();
  byCountry.forEach((set, cc) => {
    result.set(cc, [...set].sort((a, b) => a.localeCompare(b)));
  });
  return result;
}

/**
 * Flat, ordered list of picker rows: for each country in COUNTRY_ORDER, its
 * institutions followed by a "country:<CC>" sentinel row, then a final
 * "Nordics" sentinel row for the whole picker.
 */
export function getInstitutionOptions(people: Person[]): string[] {
  const byCountry = institutionsByCountry(people);
  const options: string[] = [];
  COUNTRY_ORDER.forEach((cc) => {
    const unis = byCountry.get(cc);
    if (!unis || !unis.length) return;
    options.push(...unis, "country:" + cc);
  });
  options.push(NORDICS_SCOPE);
  return options;
}

export function labelForScope(scope: string): string {
  if (scope === NORDICS_SCOPE) return "ALL NEW NORDICS";
  if (scope.startsWith("country:")) {
    const cc = scope.slice("country:".length);
    return "ALL OF " + (COUNTRY_LABELS[cc] ?? cc).toUpperCase();
  }
  return scope;
}
