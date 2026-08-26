import { useEffect, useState } from "react";
import type { TaxonomyDataset } from "../types";

interface UseTaxonomyDatasetResult {
  data: TaxonomyDataset | null;
  loading: boolean;
  error: string | null;
}

const TAXONOMY_URL = "data/people_taxonomy.json";

/**
 * Loads the taxonomy dataset (people_taxonomy.json, ~21MB) lazily — this
 * hook is only ever called from TaxonomyView, which only mounts once the
 * user actually reaches the Disciplines view, so the fetch never happens at
 * app boot. Mirrors useDataset.ts's loading/error shape.
 */
export function useTaxonomyDataset(): UseTaxonomyDatasetResult {
  const [data, setData] = useState<TaxonomyDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        const res = await fetch(TAXONOMY_URL);
        if (!res.ok) throw new Error(`Failed to load ${TAXONOMY_URL}: ${res.status}`);
        const json: TaxonomyDataset = await res.json();
        if (cancelled) return;
        setData(json);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load taxonomy dataset");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading, error };
}
