// Per-person paper lists for the 3D paper explorer. Produced by
// open-alice-data/pipeline/build_person_papers.py, sharded by OpenAlex author
// number so opening one person fetches a single ~0.4 MB file.

export const PERSON_PAPER_SHARDS = 64; // keep in sync with build_person_papers.py

export interface PersonPaper {
  /** OpenAlex work number (W123 -> 123). */
  wid: number;
  year: number;
  citations: number;
  /** Total author count on the paper (so coauthors = authors - 1). */
  authors: number;
  /** Triangle position: shares summing to 1. */
  sensing: number;
  communication: number;
  computing: number;
  title: string;
  /** Bare DOI (no https://doi.org/ prefix); empty when OpenAlex has none. */
  doi: string;
}

export type Row = [number, number, number, number, number, number, number, string, string];
type Shard = Record<string, Row[]>;

const shardCache = new Map<number, Promise<Shard>>();

function shardOf(personId: string): number {
  const n = Number(personId.split("/A")[1]);
  return Number.isFinite(n) ? n % PERSON_PAPER_SHARDS : 0;
}

function loadShard(shard: number): Promise<Shard> {
  let p = shardCache.get(shard);
  if (!p) {
    const name = String(shard).padStart(2, "0");
    p = fetch(`data/person_papers/${name}.json`).then((res) => {
      if (!res.ok) throw new Error(`person_papers/${name}.json: HTTP ${res.status}`);
      return res.json() as Promise<Shard>;
    });
    // Don't cache failures — a retry should refetch.
    p.catch(() => shardCache.delete(shard));
    shardCache.set(shard, p);
  }
  return p;
}

/** Per-person raw rows for everyone, merged across all shards (~23 MB; fetched once, then cached). */
let allRows: Promise<Map<string, Row[]>> | null = null;
export function loadAllPersonRows(): Promise<Map<string, Row[]>> {
  if (!allRows) {
    allRows = Promise.all(Array.from({ length: PERSON_PAPER_SHARDS }, (_, i) => loadShard(i))).then((shards) => {
      const m = new Map<string, Row[]>();
      for (const sh of shards) for (const [id, rows] of Object.entries(sh)) m.set(id, rows);
      return m;
    });
    allRows.catch(() => (allRows = null)); // a failed attempt may be retried
  }
  return allRows;
}

/** Mean domain split of the rows published in or after `fromYear`, or null when there are none. */
export function sharesSince(rows: Row[], fromYear: number): { s: number; cm: number; cp: number } | null {
  let n = 0;
  let s = 0;
  let cm = 0;
  let cp = 0;
  for (const r of rows) {
    if (r[1] < fromYear) continue;
    n++;
    s += r[4];
    cm += r[5];
    cp += r[6];
  }
  const sum = s + cm + cp;
  return n && sum > 0 ? { s: s / sum, cm: cm / sum, cp: cp / sum } : null;
}

export async function fetchPersonPapers(personId: string): Promise<PersonPaper[]> {
  const shard = await loadShard(shardOf(personId));
  return (shard[personId] ?? []).map(([wid, year, citations, authors, s, cm, cp, title, doi]) => ({
    wid,
    year,
    citations,
    authors,
    sensing: s / 1000,
    communication: cm / 1000,
    computing: cp / 1000,
    title,
    doi,
  }));
}

export const openAlexWorkUrl = (wid: number) => `https://openalex.org/W${wid}`;
export const doiUrl = (doi: string) => `https://doi.org/${encodeURI(doi)}`;
