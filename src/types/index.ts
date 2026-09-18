// Core data shapes for the Nordic quantum researchers dataset.
// Mirrors the shape of public/data/people_viz.json and paper_counts_geo.json.

export interface Person {
  id: string;
  name: string;
  institution: string;
  university: string;
  country: string;
  topic: string;
  x: number;
  y: number;
  quantum_h_index: number | null;
  global_h_index: number | null;
  h_index: number | null;
  total_papers: number;
  quantum_papers: number;
  total_patents: number;
  quantum_patents: number;
  first_year: number | null;
  last_year: number | null;
  sensing_share?: number | null;
  communication_share?: number | null;
  computing_share?: number | null;
  example_titles?: string[];
  /** Per-year {papers, citations} over quantum-corpus papers only, keyed by
   * year as a string (e.g. "2021"). Optional and possibly absent/empty —
   * added after the initial schema, so data built before this field existed
   * won't have it. */
  yearly?: Record<string, { papers: number; citations: number }>;
  /** This person's own SE-inventor/uni-applicant filtered patents (the same
   * set `total_patents` counts) — from SPRINT 13's build_author_patents.py.
   * Absent (not just empty) for datasets built before this field existed;
   * possibly empty even when `total_patents` > 0 (a handful of counted
   * patents have no matched per-record detail). */
  patents?: PatentRecord[];
  /** OpenAlex ids folded into this record by the splink dedup experiment
   * (experiments/dedup-splink) — the same real person had been split across
   * several OpenAlex author profiles. Present only on a merged record. */
  merged_from?: string[];
}

export interface PatentRecord {
  epo_id: string;
  jurisdiction: string;
  doc_number: string;
  kind: string;
  /** 0 when the publication year couldn't be resolved. */
  year: number;
  title: string;
  /** Espacenet search-by-publication-number link. */
  link: string;
}

export interface AxisMeta {
  neg: string;
  pos: string;
  field: string;
  desc: string;
}

export interface DatasetMeta {
  axes: {
    x: AxisMeta;
    y: AxisMeta;
  };
  universities: string[];
  [key: string]: unknown;
}

export interface Dataset {
  meta: DatasetMeta;
  people: Person[];
}

export interface DomainShares {
  computing: number;
  communication: number;
  sensing: number;
}

/** Distinct-paper shape shared by the top-level ("all") counts and each
 * windowed slice below — a paper co-authored across institutions/countries
 * is counted once per institution/country it touches, never once per
 * author (see SPRINT 13's build_paper_counts.py). */
export interface PaperCountsWindow {
  by_country: Record<string, number>;
  by_institution: Record<string, number>;
  domain_by_country: Record<string, DomainShares>;
  domain_by_institution: Record<string, DomainShares>;
  total: number;
}

export interface PaperCounts {
  by_country: Record<string, number>;
  by_institution: Record<string, number>;
  domain_by_country: Record<string, DomainShares>;
  domain_by_institution: Record<string, DomainShares>;
  total: number;
  /** Same distinct-paper counts narrowed to papers published in the last
   * 5/10 years — added after the initial schema, so older data files won't
   * have these. Filtered by each PAPER's own publication_year (not a
   * person's activity span), matching TimeWindow's "last5"/"last10". */
  last5?: PaperCountsWindow;
  last10?: PaperCountsWindow;
}

export type GlassesMode = "constant" | "quantum_h_index" | "global_h_index";
export type MapMode = "cartesian" | "domains" | "taxonomy" | "geo" | "list";
export type AggMode = "none" | "boxplot" | "hexdensity" | "clusters" | "patents" | "universities";
export type BoxOrient = "h" | "v";
// Geo's own config: which magnitude drives a node's resting circle size.
export type GeoSizeMetric = "papers" | "people" | "citations";
// Global time-window filter: narrows people by first_year/last_year across every view.
export type TimeWindow = "all" | "last5" | "last10";

// ---- Disciplines (taxonomy sunburst) view ---------------------------------
// Mirrors the shape of public/data/people_taxonomy.json.

export type TaxLevel = "macro" | "meso" | "micro";

export interface TaxNode {
  name: string;
  level?: TaxLevel;
  count?: number;
  children?: TaxNode[];
  /** Layout-computed scratch field populated by lib/taxonomy.ts's
   * buildSunLayout: this node's own person count within the current scope.
   * Not present in the source JSON. */
  __own?: number;
}

export interface DomainProbs {
  computing: number;
  communication: number;
  sensing: number;
  other: number;
}

export interface TaxPerson extends Person {
  tax_path: string[];
  tax_levels: { name: string; level: TaxLevel; share: number }[];
  tax_evidence: number;
  domain_probs: DomainProbs;
  domain_top: string | null;
  domain_confidence: number;
  domain_evidence: number;
  domain_probs_specter: DomainProbs;
  domain_top_specter: string | null;
  domain_confidence_specter: number;
  domain_evidence_specter: number;
}

export interface TaxonomyDataset {
  taxonomy: TaxNode;
  people: TaxPerson[];
}

// ---- Cross-person linking data (patents co-invention, collaborations) -----
// Mirrors the shape of public/data/patent_links.json and
// public/data/collaborations.json. Both are optional/soft-fail datasets.

/** epo_id -> other tracked people who share that same patent (only patents
 * with 2+ known tracked inventors are present at all). */
export type PatentLinks = Record<string, { id: string; name: string }[]>;

export interface CollaborationEntry {
  top_coauthors: { id: string; name: string; papers: number }[];
  top_institutions: { name: string; papers: number }[];
}

/** person openalex id -> their top quantum-corpus collaborators. */
export type Collaborations = Record<string, CollaborationEntry>;
