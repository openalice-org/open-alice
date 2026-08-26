// The "paper mosaic" fill for the Disciplines sunburst wheel: a recursive
// binary-split treemap of "islands" inside each occupied arc — one island per
// author on a university wheel, one per UNIVERSITY on the country wheel —
// with each island further tiled into a grid of small colour-washed "paper"
// rectangles. Ported from SPRINT 13's index.html (drawSunBlocks' island/tile
// assembly). See TaxonomyView.tsx for the render wiring and hover/click
// interactions, and lib/taxonomy.ts for the ring/label geometry this builds
// on top of (contentRingIn, cellPath, hash01, mixHex).
import { cellPath, contentRingIn, hash01, mixHex, taxNodePath, type TaxHierarchyNode, type TaxRings } from "./taxonomy";
import { DOMAIN_COLORS, type DomainKey } from "./ternary";
import type { DomainProbs, TaxPerson } from "../types";

/** Synthetic per-arc entry the country wheel collapses a university's people
 * into, so the mosaic shows one island per university instead of one per
 * author. Shaped closely enough like a TaxPerson that the same tile/hover
 * code needs no parallel path. */
export interface UniAggregateOwner {
  isUni: true;
  id: string; // "uni::" + university name
  name: string;
  university: string;
  /** How many of this university's people fall under THIS specific arc. */
  people: number;
  /** How many of this university's quantum papers fall under THIS arc. */
  quantum_papers: number;
  domain_probs_specter: DomainProbs;
  domain_top_specter: string;
  domain_confidence_specter: number;
  /** Wheel-wide totals for this university, for the "X of Y" hover card. */
  totalPeople: number;
  totalPapers: number;
  /** Name of the specific arc/subfield this aggregate belongs to — the hover
   * card names it directly ("Quantum papers on {arcName}") since a
   * university's papers/people are only ever THIS arc's share. */
  arcName: string;
}

export type MosaicOwner = TaxPerson | UniAggregateOwner;

export function isUniOwner(o: MosaicOwner): o is UniAggregateOwner {
  return (o as UniAggregateOwner).isUni === true;
}

/** Per-person anchor info lib/mosaic.ts needs from TaxonomyView's anchorFor
 * pass: the assigned angle (for spatial-coherence seeding) and the set of
 * ancestor arc nodes the person counts toward — the arc-node equivalent of
 * the original's `t.node.ancestors().includes(nd)`, precomputed once as a
 * Set (via TaxHierarchyNode.ancestors()) so assignedEntriesForArc doesn't
 * re-walk the hierarchy per arc. */
export interface AnchorEntry {
  a: number;
  ancestorSet: Set<TaxHierarchyNode>;
}

interface MosaicEntry {
  owner: TaxPerson;
  w: number;
  seed: number;
}

interface AggregatedEntry {
  owner: MosaicOwner;
  w: number;
  seed: number;
}

interface Box {
  a0: number;
  a1: number;
  r0: number;
  r1: number;
}

export interface MosaicIsland {
  id: string;
  ownerId: string;
  owner: MosaicOwner;
  /** Boundary path — stroked (not filled) as the hover "hot" outline. */
  d: string;
}

export interface MosaicTile {
  id: string;
  ownerId: string;
  owner: MosaicOwner;
  fill: string;
  d: string;
}

export interface MosaicResult {
  islands: MosaicIsland[];
  tiles: MosaicTile[];
}

const OTHER_KEY = "other" as const;
type ProbKey = DomainKey | typeof OTHER_KEY;
const PROB_KEYS: ProbKey[] = ["computing", "communication", "sensing", "other"];

/** Domain-probability lookup for a mosaic owner: prefers the `_specter`
 * fields when present — the same precedence `taxColour` uses for real
 * people. A synthetic university aggregate always carries its blended
 * `_specter`-shaped probs from `uniAggregateEntries`, so it's read directly. */
export function domainProbsOf(owner: MosaicOwner): DomainProbs {
  if (isUniOwner(owner)) return owner.domain_probs_specter;
  return owner.domain_top_specter != null ? owner.domain_probs_specter : owner.domain_probs;
}

function aggWeight(p: TaxPerson): number {
  return Math.max(0, Math.round(+(p.quantum_papers || 0)));
}

function crystalSeed(p: TaxPerson, nd: TaxHierarchyNode, anchorOf: Map<string, AnchorEntry>): number {
  const t = anchorOf.get(p.id);
  const local = t && nd.x1 > nd.x0 ? (t.a - nd.x0) / (nd.x1 - nd.x0) : hash01(p.id, "seed");
  return Math.max(0, Math.min(1, local * 0.72 + hash01(p.id, taxNodePath(nd)) * 0.28));
}

function compareByName(a: { owner: { name: string } }, b: { owner: { name: string } }): number {
  return a.owner.name < b.owner.name ? -1 : a.owner.name > b.owner.name ? 1 : 0;
}

/** Every scoped person whose anchor ancestor chain includes this arc node,
 * seeded/sorted for stable, spatially-coherent treemap ordering. */
function assignedEntriesForArc(
  nd: TaxHierarchyNode,
  scopedPeople: TaxPerson[],
  anchorOf: Map<string, AnchorEntry>,
): MosaicEntry[] {
  const out: MosaicEntry[] = [];
  scopedPeople.forEach((p) => {
    const t = anchorOf.get(p.id);
    const w = aggWeight(p);
    if (!t || w <= 0 || !t.ancestorSet.has(nd)) return;
    out.push({ owner: p, w, seed: crystalSeed(p, nd, anchorOf) });
  });
  out.sort((a, b) => a.seed - b.seed || compareByName(a, b));
  return out;
}

/** Country wheel only: collapse per-person entries into one synthetic entry
 * per university. `totals` is each university's wheel-wide {people, papers}
 * (over ALL its people with a taxonomy home, not just this one arc) so the
 * hover card can show "here of total". */
function uniAggregateEntries(
  entries: MosaicEntry[],
  totals: Map<string, { people: number; papers: number }>,
  arcName: string,
): AggregatedEntry[] {
  interface Group {
    uni: string;
    w: number;
    seed: number;
    people: number;
    papers: number;
    probs: Record<ProbKey, number>;
  }
  const byUni = new Map<string, Group>();
  entries.forEach((e) => {
    const uni = e.owner.university || e.owner.institution || "Unknown";
    let g = byUni.get(uni);
    if (!g) {
      g = { uni, w: 0, seed: e.seed, people: 0, papers: 0, probs: { computing: 0, communication: 0, sensing: 0, other: 0 } };
      byUni.set(uni, g);
    }
    g.w += e.w;
    g.seed = Math.min(g.seed, e.seed);
    g.people += 1;
    g.papers += +(e.owner.quantum_papers || 0);
    const pr = domainProbsOf(e.owner);
    PROB_KEYS.forEach((k) => {
      g.probs[k] += (pr[k] || 0) * e.w;
    });
  });

  const out: AggregatedEntry[] = [];
  byUni.forEach((g) => {
    const total = PROB_KEYS.reduce((s, k) => s + g.probs[k], 0) || 1;
    const probs = { computing: 0, communication: 0, sensing: 0, other: 0 };
    PROB_KEYS.forEach((k) => {
      probs[k] = g.probs[k] / total;
    });
    const top = PROB_KEYS.reduce((a, b) => (probs[b] > probs[a] ? b : a));
    const tot = totals.get(g.uni);
    const owner: UniAggregateOwner = {
      isUni: true,
      id: "uni::" + g.uni,
      name: g.uni,
      university: g.uni,
      people: g.people,
      quantum_papers: g.papers,
      domain_probs_specter: probs,
      domain_top_specter: top === "other" ? "unknown" : top,
      domain_confidence_specter: probs[top] || 0,
      totalPeople: tot?.people ?? g.people,
      totalPapers: tot?.papers ?? g.papers,
      arcName,
    };
    out.push({ owner, w: g.w, seed: g.seed });
  });
  out.sort((a, b) => a.seed - b.seed || compareByName(a, b));
  return out;
}

/** Index whose cumulative weight is closest to half the total — the treemap
 * split point. */
function splitIndex(entries: AggregatedEntry[]): number {
  const half = (entries.reduce((s, e) => s + e.w, 0) || 1) / 2;
  let acc = 0;
  let best = 1;
  let bestErr = Infinity;
  for (let i = 0; i < entries.length - 1; i++) {
    acc += entries[i].w;
    const err = Math.abs(acc - half);
    if (err < bestErr) {
      bestErr = err;
      best = i + 1;
    }
  }
  return best;
}

interface RawIsland extends Box {
  ownerId: string;
  owner: MosaicOwner;
}

/** Recursive binary-split treemap: one box per entry, alternating angular
 * (along the arc) vs radial (across ring thickness) split direction based on
 * which keeps the resulting cells closer to square. */
function layoutAuthorIslands(entries: AggregatedEntry[], box: Box, depth = 0): RawIsland[] {
  if (!entries.length) return [];
  if (entries.length === 1) {
    return [{ ownerId: entries[0].owner.id, owner: entries[0].owner, ...box }];
  }
  const total = entries.reduce((s, e) => s + e.w, 0) || 1;
  const cut = splitIndex(entries);
  const left = entries.slice(0, cut);
  const right = entries.slice(cut);
  const frac = Math.max(0.035, Math.min(0.965, (left.reduce((s, e) => s + e.w, 0) || 0) / total));
  const midR = (box.r0 + box.r1) / 2;
  const arcWidth = Math.max(1e-6, (box.a1 - box.a0) * midR);
  const radialHeight = Math.max(1e-6, box.r1 - box.r0);
  const almostSquare = Math.abs(arcWidth - radialHeight) / Math.max(arcWidth, radialHeight) < 0.3;
  const splitAngular = almostSquare ? depth % 2 === 0 : arcWidth >= radialHeight;
  if (splitAngular) {
    const am = box.a0 + (box.a1 - box.a0) * frac;
    return layoutAuthorIslands(left, { ...box, a1: am }, depth + 1).concat(
      layoutAuthorIslands(right, { ...box, a0: am }, depth + 1),
    );
  }
  const rm = box.r0 + (box.r1 - box.r0) * frac;
  return layoutAuthorIslands(left, { ...box, r1: rm }, depth + 1).concat(
    layoutAuthorIslands(right, { ...box, r0: rm }, depth + 1),
  );
}

/** Small gap between neighbouring islands, in local px (radial) / radians
 * (angular, scaled by mid-radius so it reads as a consistent px gap). */
function islandInset(island: Box, gap = 2.25): Box {
  const mid = Math.max(1, (island.r0 + island.r1) / 2);
  const da = Math.min((island.a1 - island.a0) * 0.22, gap / mid);
  const dr = Math.min((island.r1 - island.r0) * 0.22, gap);
  return { a0: island.a0 + da, a1: island.a1 - da, r0: island.r0 + dr, r1: island.r1 - dr };
}

/** Smaller gap between individual paper tiles within an island. */
function tileInset(t: Box, gap = 0.11): Box {
  const mid = Math.max(1, (t.r0 + t.r1) / 2);
  const da = Math.min((t.a1 - t.a0) * 0.18, gap / mid);
  const dr = Math.min((t.r1 - t.r0) * 0.18, gap);
  return { a0: t.a0 + da, a1: t.a1 - da, r0: t.r0 + dr, r1: t.r1 - dr };
}

interface RawTile extends Box {
  id: string;
}

/** Tiles one island into a grid of small fixed-ish-size "paper" rectangles;
 * tile size scales with the wheel's overall radius (`taxR`). */
function paperTilesForIsland(island: Box, taxR: number, idPrefix: string): RawTile[] {
  const band = island.r1 - island.r0;
  const span = island.a1 - island.a0;
  if (band <= 0 || span <= 0) return [];
  const tileH = Math.max(5.8, Math.min(9.5, taxR / 42));
  const tileW = tileH * 1.55;
  const rows = Math.max(1, Math.round(band / tileH));
  const tiles: RawTile[] = [];
  for (let row = 0; row < rows; row++) {
    const rr0 = island.r0 + (band * row) / rows;
    const rr1 = island.r0 + (band * (row + 1)) / rows;
    const cols = Math.max(1, Math.round((span * ((rr0 + rr1) / 2)) / tileW));
    for (let col = 0; col < cols; col++) {
      tiles.push({
        id: `${idPrefix}::${row}::${col}`,
        a0: island.a0 + (span * col) / cols,
        a1: island.a0 + (span * (col + 1)) / cols,
        r0: rr0,
        r1: rr1,
      });
    }
  }
  return tiles;
}

/** Deterministic weighted-random domain pick for one tile index, so a mixed
 * island shows a speckled blend of tile colours rather than one flat wash. */
function paperDomain(owner: MosaicOwner, i: number): ProbKey {
  const probs = domainProbsOf(owner);
  const weights: [ProbKey, number][] = PROB_KEYS.map((k) => [k, probs[k] || 0]);
  const total = weights.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) return "other";
  const u = hash01(owner.id, "paper-domain" + i) * total;
  let acc = 0;
  for (const [k, w] of weights) {
    acc += w;
    if (u <= acc) return k;
  }
  return "other";
}

/** Plain grey at a target lightness (0-100), used for "other"/no-domain
 * tiles. See paperColour's doc comment for the LAB-vs-RGB tradeoff. */
function grayAtLightness(l: number): string {
  const v = Math.max(0, Math.min(255, Math.round((l / 100) * 255)));
  return `rgb(${v}, ${v}, ${v})`;
}

/**
 * Paper tile fill: a pale, per-tile lightness-jittered wash of its domain
 * colour (or a light jittered grey for "other"/no-domain tiles).
 *
 * The original app computed this in CIE LAB space (d3.lab) for perceptually
 * even pale/deep interpolation. This port intentionally stays in plain RGB —
 * blending straight toward white by a fraction derived from the target
 * lightness — reusing lib/taxonomy.ts's `mixHex`, the exact same pale-wash
 * approximation `taxColour` already uses for the (now-hidden) dot fill. That
 * keeps one colour system for the whole view instead of introducing
 * `d3-color`/`d3-interpolate` for this one call site; the visual difference
 * versus true LAB is a few percent of perceptual evenness across hues, not
 * something that reads as wrong at this tile size.
 */
function paperColour(owner: MosaicOwner, i: number): string {
  const dom = paperDomain(owner, i);
  if (dom === "other") {
    const l = 75 + (hash01(owner.id, "paper-grey" + i) - 0.5) * 8;
    return grayAtLightness(l);
  }
  const base = DOMAIN_COLORS[dom];
  const jitter = (hash01(owner.id, "paper-light" + i) - 0.5) * 12;
  const targetLightness = Math.max(0, Math.min(100, 66 + jitter));
  return mixHex(base, "#ffffff", targetLightness / 100);
}

/**
 * Assembles the full paper-mosaic tile set (+ island boundary outlines) for
 * every occupied arc in the current layout. Pure and memoizable — pass this
 * the whole scope's inputs once per layout/scope change, never per hover
 * (TaxonomyView.tsx keys its useMemo accordingly; hover only changes which
 * already-built tiles render dimmed/highlighted).
 */
export function buildMosaic(
  arcs: TaxHierarchyNode[],
  scopedPeople: TaxPerson[],
  anchorOf: Map<string, AnchorEntry>,
  rings: TaxRings,
  isCountryWheel: boolean,
  uniTotals: Map<string, { people: number; papers: number }>,
): MosaicResult {
  const islands: MosaicIsland[] = [];
  const tiles: MosaicTile[] = [];

  arcs.forEach((nd) => {
    const pathKey = taxNodePath(nd);
    const entries = assignedEntriesForArc(nd, scopedPeople, anchorOf);
    if (!entries.length) return;
    const aggregated: AggregatedEntry[] = isCountryWheel ? uniAggregateEntries(entries, uniTotals, nd.data.name) : entries;
    if (!aggregated.length) return;

    const box: Box = {
      a0: nd.x0,
      a1: nd.x1,
      r0: contentRingIn(nd.depth, rings.ringIn, rings.ringOut),
      r1: rings.ringOut[nd.depth],
    };
    const rawIslands = layoutAuthorIslands(aggregated, box);

    rawIslands.forEach((island, islandIdx) => {
      const inset = islandInset(island);
      if (inset.a1 <= inset.a0 || inset.r1 <= inset.r0) return;
      const islandD = cellPath(inset.a0, inset.a1, inset.r0, inset.r1);
      const islandId = `${pathKey}::${islandIdx}::${island.ownerId}`;
      if (islandD) islands.push({ id: islandId, ownerId: island.ownerId, owner: island.owner, d: islandD });

      const rawTiles = paperTilesForIsland(inset, rings.taxR, islandId);
      rawTiles.forEach((t, i) => {
        const insetTile = tileInset(t);
        if (insetTile.a1 <= insetTile.a0 || insetTile.r1 <= insetTile.r0) return;
        const tileD = cellPath(insetTile.a0, insetTile.a1, insetTile.r0, insetTile.r1);
        if (!tileD) return;
        tiles.push({
          id: t.id,
          ownerId: island.ownerId,
          owner: island.owner,
          fill: paperColour(island.owner, i),
          d: tileD,
        });
      });
    });
  });

  return { islands, tiles };
}
