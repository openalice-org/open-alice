import { useEffect, useState } from "react";
import type { Collaborations, Dataset, PaperCounts, PatentLinks } from "../types";

interface UseDatasetResult {
  dataset: Dataset | null;
  paperCounts: PaperCounts | null;
  patentLinks: PatentLinks | null;
  collaborations: Collaborations | null;
  loading: boolean;
  error: string | null;
}

const DATA_URL = "data/people_viz.json";
const PAPER_COUNTS_URL = "data/paper_counts_geo.json";
const PATENT_LINKS_URL = "data/patent_links.json";
const COLLABORATIONS_URL = "data/collaborations.json";

/**
 * Loads all JSON data files on mount. people_viz.json is required — a
 * failure there is a hard error. paper_counts_geo.json, patent_links.json,
 * and collaborations.json are optional — a failure on any of them soft-fails
 * to null (callers fall back to person-only info), mirroring SPRINT 13's
 * boot sequence.
 */
export function useDataset(): UseDatasetResult {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [paperCounts, setPaperCounts] = useState<PaperCounts | null>(null);
  const [patentLinks, setPatentLinks] = useState<PatentLinks | null>(null);
  const [collaborations, setCollaborations] = useState<Collaborations | null>(null);
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

      try {
        const res = await fetch(PATENT_LINKS_URL);
        if (res.ok) {
          const links: PatentLinks = await res.json();
          if (!cancelled) setPatentLinks(links);
        }
      } catch {
        // optional file — soft fail, patentLinks stays null
      }

      try {
        const res = await fetch(COLLABORATIONS_URL);
        if (res.ok) {
          const collabs: Collaborations = await res.json();
          if (!cancelled) setCollaborations(collabs);
        }
      } catch {
        // optional file — soft fail, collaborations stays null
      }

      if (!cancelled) setLoading(false);
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  return { dataset, paperCounts, patentLinks, collaborations, loading, error };
}
