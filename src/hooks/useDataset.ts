import { useEffect, useState } from "react";
import type { Dataset, PaperCounts } from "../types";

interface UseDatasetResult {
  dataset: Dataset | null;
  paperCounts: PaperCounts | null;
  loading: boolean;
  error: string | null;
}

const DATA_URL = "data/people_viz.json";
const PAPER_COUNTS_URL = "data/paper_counts_geo.json";

/**
 * Loads both JSON data files on mount. people_viz.json is required — a
 * failure there is a hard error. paper_counts_geo.json is optional — a
 * failure there soft-fails to null (callers fall back to person-summed
 * counts), mirroring SPRINT 13's boot sequence.
 */
export function useDataset(): UseDatasetResult {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [paperCounts, setPaperCounts] = useState<PaperCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        const res = await fetch(DATA_URL);
        if (!res.ok) throw new Error(`Failed to load ${DATA_URL}: ${res.status}`);
        const data: Dataset = await res.json();
        if (cancelled) return;
        setDataset(data);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load dataset");
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(PAPER_COUNTS_URL);
        if (res.ok) {
          const counts: PaperCounts = await res.json();
          if (!cancelled) setPaperCounts(counts);
        }
      } catch {
        // optional file — soft fail, paperCounts stays null
      }

      if (!cancelled) setLoading(false);
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  return { dataset, paperCounts, loading, error };
}
