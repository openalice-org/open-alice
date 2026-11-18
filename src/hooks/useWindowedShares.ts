import { useEffect, useMemo, useState } from "react";
import type { Person, TimeWindow } from "../types";
import { timeWindowCutoff } from "../lib/people";
import { loadAllPersonRows, sharesSince, type Row } from "../lib/personPapers";

/**
 * For a "last N years" window, shift each person's Sensing/Communication/
 * Computing shares by how their papers inside the window differ from their
 * whole record (per-paper splits come from the person-paper shards), so dots
 * move in the Domains view and the colors/geo mix follow. "all" keeps the
 * published all-time shares.
 *
 * The shards (~23 MB) are fetched the first time a window is chosen. Until they
 * arrive, and for anyone with no quantum paper in the window, the all-time
 * shares are kept.
 */
export function useWindowedShares(people: Person[], window: TimeWindow): Person[] {
  const [rows, setRows] = useState<Map<string, Row[]> | null>(null);

  useEffect(() => {
    if (window === "all" || rows) return;
    let alive = true;
    loadAllPersonRows()
      .then((m) => alive && setRows(m))
      .catch(() => {}); // keep all-time shares if the shards can't be loaded
    return () => {
      alive = false;
    };
  }, [window, rows]);

  return useMemo(() => {
    if (window === "all" || !rows) return people;
    const cutoff = timeWindowCutoff(window);
    return people.map((p) => {
      if (p.sensing_share == null || p.communication_share == null || p.computing_share == null) return p;
      const r = rows.get(p.id) ?? [];
      const win = sharesSince(r, cutoff);
      const all = sharesSince(r, -Infinity);
      if (!win || !all) return p;
      // The published shares weight papers differently from the shard splits, so absolute shard means
      // would jump even for a window that covers everything. Apply only the *shift* the window causes.
      const s = Math.max(0, p.sensing_share + win.s - all.s);
      const cm = Math.max(0, p.communication_share + win.cm - all.cm);
      const cp = Math.max(0, p.computing_share + win.cp - all.cp);
      const sum = s + cm + cp;
      return sum > 0 ? { ...p, sensing_share: s / sum, communication_share: cm / sum, computing_share: cp / sum } : p;
    });
  }, [people, window, rows]);
}
