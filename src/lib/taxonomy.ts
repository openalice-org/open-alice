// Pure data/layout math for the "Disciplines" 3-ring taxonomy sunburst wheel
// (TaxonomyView). Ported from the original vanilla-D3 app's taxonomy layer:
// ring radii, the per-scope d3-hierarchy/partition layout, arc fill/label
// geometry, and per-person ring assignment. The jittered per-person position
// this file computes (anchorFor/anchorNodeFor) is no longer rendered as
// visible dots — it now only seeds lib/mosaic.ts's paper-mosaic treemap fill
// (spatial-coherence seed) and the roster's pin-zoom target. See
// TaxonomyView.tsx for the render wiring.
import { hierarchy, partition, type HierarchyRectangularNode } from "d3-hierarchy";
import { arc, type DefaultArcObject } from "d3-shape";
import type { TaxNode, TaxPerson } from "../types";
import { DOMAIN_COLORS, type DomainKey } from "./ternary";

/**
 * 36 of the 45 Nordic institutions in the main dataset have taxonomy data
 * (people_taxonomy.json carries every person, but `tax_path` is only
 * present for universities that had a classified-works corpus at build
 * time — the other 9 have zero or near-zero quantum papers). Hardcoded
 * rather than derived at runtime because taxScopeAllowed (via Rail.tsx/
 * AppState.tsx) gates the Disciplines nav item before the ~22MB taxonomy
 * dataset itself is ever fetched (see useTaxonomyDataset's lazy-load
 * comment) — there's no dataset in hand yet to derive it from. Exact
 * `person.university` values, matching the canonical names
 * lib/institutions.ts and GeoView already use. Country majority-voted from
 * people_taxonomy.json's own per-person `country`, except Nord University
 * (2 people, a single foreign co-author majority-voted it to the wrong
 * country) which is corrected by hand.
 */
export const TAX_UNIS = new Set([
  "Aalborg University",
  "Aalto University",
  "Aarhus University",
  "Chalmers",
  "Copenhagen Business School (CBS)",
  "Gothenburg",
  "KTH",
  "Karolinska Institutet",
  "LUT University",
  "Linköping University",
  "Lund",
  "Nord University",
  "Norwegian University of Life Sciences (NMBU)",
  "Norwegian University of Science and Technology (NTNU)",
  "OsloMet – Oslo Metropolitan University",
  "Reykjavík University",
  "Roskilde University",
  "Stockholm University",
  "Tampere University",
  "Technical University of Denmark (DTU)",
  "UiT The Arctic University of Norway",
  "Umeå University",
  "University of Agder (UiA)",
  "University of Bergen (UiB)",
  "University of Copenhagen",
  "University of Eastern Finland",
  "University of Helsinki",
  "University of Iceland",
  "University of Jyväskylä",
  "University of Oslo (UiO)",
  "University of South-Eastern Norway (USN)",
  "University of Southern Denmark",
  "University of Stavanger (UiS)",
  "University of Turku",
  "Uppsala University",
  "Åbo Akademi University",
  "University of Tartu",
  "Tallinn University of Technology",
  "University of Latvia",
  "Riga Technical University",
  "Vilnius University",
  "Kaunas University of Technology",
  "Center for Physical Sciences and Technology",
  "Nordita",
]);

export const TAX_UNI_COUNTRY = new Map<string, string>([
  ["Aalborg University", "DK"],
  ["Aalto University", "FI"],
  ["Aarhus University", "DK"],
  ["Chalmers", "SE"],
  ["Copenhagen Business School (CBS)", "DK"],
  ["Gothenburg", "SE"],
  ["KTH", "SE"],
  ["Karolinska Institutet", "SE"],
  ["LUT University", "FI"],
  ["Linköping University", "SE"],
  ["Lund", "SE"],
  ["Nord University", "NO"],
  ["Norwegian University of Life Sciences (NMBU)", "NO"],
  ["Norwegian University of Science and Technology (NTNU)", "NO"],
  ["OsloMet – Oslo Metropolitan University", "NO"],
  ["Reykjavík University", "IS"],
  ["Roskilde University", "DK"],
  ["Stockholm University", "SE"],
  ["Tampere University", "FI"],
  ["Technical University of Denmark (DTU)", "DK"],
  ["UiT The Arctic University of Norway", "NO"],
  ["Umeå University", "SE"],
  ["University of Agder (UiA)", "NO"],
  ["University of Bergen (UiB)", "NO"],
  ["University of Copenhagen", "DK"],
  ["University of Eastern Finland", "FI"],
  ["University of Helsinki", "FI"],
  ["University of Iceland", "IS"],
  ["University of Jyväskylä", "FI"],
  ["University of Oslo (UiO)", "NO"],
  ["University of South-Eastern Norway (USN)", "NO"],
  ["University of Southern Denmark", "DK"],
  ["University of Stavanger (UiS)", "NO"],
  ["University of Turku", "FI"],
  ["Uppsala University", "SE"],
  ["Åbo Akademi University", "FI"],
  ["University of Tartu", "EE"],
  ["Tallinn University of Technology", "EE"],
  ["University of Latvia", "LV"],
  ["Riga Technical University", "LV"],
  ["Vilnius University", "LT"],
  ["Kaunas University of Technology", "LT"],
  ["Center for Physical Sciences and Technology", "LT"],
  ["Nordita", "SE"],
]);
export const TAX_COUNTRIES = new Set(TAX_UNI_COUNTRY.values());

/**
 * Whether the Disciplines view is reachable from a given scope. "Nordics"
 * is now allowed too — coverage spans all five Nordic countries (see
 * TAX_UNIS above), so "ALL NORDICS" no longer means "only Swedes" the way
 * it did when this view was Sweden-only.
 */
export function taxScopeAllowed(scope: string): boolean {
  if (scope.startsWith("country:")) return TAX_COUNTRIES.has(scope.slice("country:".length));
  if (scope === "Nordics") return true;
  return TAX_UNIS.has(scope);
}

export type TaxHierarchyNode = HierarchyRectangularNode<TaxNode>;

export interface TaxRings {
  taxR: number;
  r0: number;
  /** index 0 unused; index by node.depth (1 = macro, 2 = meso, 3 = micro) */
  ringIn: number[];
  ringOut: number[];
  cx: number;
  cy: number;
}

/** Ring radii for the wheel, derived from the measured SVG viewport so the
 * wheel resizes with its container instead of a hardcoded size. */
export function computeRings(width: number, height: number): TaxRings {
  const taxR = Math.max(160, Math.min(width, height) / 2 - 104);
  const r0 = taxR * 0.22;
  return {
    taxR,
    r0,
    ringIn: [0, r0, taxR * 0.485, taxR * 0.72],
    ringOut: [0, taxR * 0.485, taxR * 0.72, taxR * 0.955],
    cx: width / 2,
    cy: height / 2,
  };
}

/** A hierarchy node's own path key, e.g. "Physics and Astronomy›Atomic and
 * Molecular Physics, and Optics›Quantum and electron transport phenomena". */
export function taxNodePath(n: { ancestors(): { data: TaxNode }[] }): string {
  return n
    .ancestors()
    .reverse()
    .slice(1)
    .map((a) => a.data.name)
    .join("›");
}

/** Cumulative per-path person counts: every prefix of every person's
 * tax_path gets +1, so a macro/meso node's count already includes its
 * descendants' — buildSunLayout subtracts children back out to get each
 * node's OWN count. */
export function taxCountsForPeople(people: TaxPerson[]): Map<string, number> {
  const counts = new Map<string, number>();
  people.forEach((p) => {
    const path = p.tax_path || [];
    for (let i = 1; i <= path.length; i++) {
      const key = path.slice(0, i).join("›");
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  });
  return counts;
}

/**
 * Builds the partition layout for one scope's population. Sums each node's
 * OWN count (not the corpus-wide `count` field baked into the JSON) so the
 * wheel resizes per scope rather than always showing the full corpus.
 */
export function buildSunLayout(
  taxonomyTree: TaxNode,
  scopedPeople: TaxPerson[],
): { root: TaxHierarchyNode; arcs: TaxHierarchyNode[] } {
  const counts = taxCountsForPeople(scopedPeople);
  const rawRoot = hierarchy(taxonomyTree);
  rawRoot.each((n) => {
    if (n.depth === 0) return;
    const own = counts.get(taxNodePath(n)) || 0;
    const kids = (n.children || []).reduce((s, c) => s + (counts.get(taxNodePath(c)) || 0), 0);
    n.data.__own = Math.max(0, own - kids);
  });
  rawRoot.sum((d) => d.__own || 0);
  const root = partition<TaxNode>().size([2 * Math.PI, 1])(rawRoot);
  // zero-width partition results (x0===x1) render as a degenerate spike —
  // only draw occupied branches.
  const arcs = root.descendants().filter((n) => n.depth > 0 && (n.value ?? 0) > 0);
  return { root, arcs };
}

/** Maps every occupied node's own path key to itself, for anchorNodeFor's
 * walk-up lookup. */
export function buildPathIndex(root: TaxHierarchyNode): Map<string, TaxHierarchyNode> {
  const map = new Map<string, TaxHierarchyNode>();
  root.each((n) => {
    if (n.depth === 0) return;
    map.set(taxNodePath(n), n);
  });
  return map;
}

/** Arc `<path>` geometry for one occupied node, at this scope's ring radii. */
export function arcPathFor(n: TaxHierarchyNode, rings: TaxRings): string | null {
  return arc<TaxHierarchyNode>()
    .startAngle((d) => d.x0)
    .endAngle((d) => d.x1)
    .padAngle(0.0045)
    .innerRadius((d) => rings.ringIn[d.depth])
    .outerRadius((d) => rings.ringOut[d.depth])(n);
}

/** Faint monochrome fill for an occupied arc, alternating slightly
 * lighter/darker by sibling index. */
export function arcFill(n: TaxHierarchyNode): string {
  const base = n.depth === 1 ? 0.026 : n.depth === 2 ? 0.042 : 0.058;
  const siblingIndex = n.parent?.children?.indexOf(n) ?? 0;
  const alpha = base + (siblingIndex % 2 === 1 ? 0.015 : 0);
  return `rgba(24,24,22,${alpha})`;
}

// ---- mosaic content geometry + curved arc labels ---------------------------
//
// The label band sits near an occupied arc's inner edge; the paper-mosaic
// fill (lib/mosaic.ts) occupies the rest of the ring outward from
// contentRingIn. Ported from the original app's sectorBandH/bandD/curved
// textPath idiom — see TaxonomyView.tsx for the render wiring.

/** Height (px) of the label-plate band for a ring depth. */
export function sectorBandH(depth: number): number {
  return depth === 1 ? 18 : depth === 2 ? 16 : 14;
}

/** Inner radius at which an occupied arc's mosaic content should start,
 * leaving room above it (toward the centre) for the label plate band. */
export function contentRingIn(depth: number, ringIn: number[], ringOut: number[]): number {
  return Math.min(ringOut[depth] - 4, ringIn[depth] + sectorBandH(depth) + 3);
}

/** Cartesian [x,y] for a polar coordinate in the wheel's local (centred)
 * space — same convention d3-shape's arc() uses (0 = -y/12 o'clock,
 * clockwise). */
export function polarXY(a: number, r: number): [number, number] {
  return [r * Math.sin(a), -r * Math.cos(a)];
}

/** Generic polar-cell `<path>` geometry for an arbitrary {a0,a1,r0,r1} box —
 * the same generator `arcPathFor` uses, just parameterized directly instead
 * of reading `.x0`/`.x1`/depth off a hierarchy node. Used by the mosaic
 * (islands, paper tiles) and the label-plate band below. */
const cellArc = arc<DefaultArcObject>().cornerRadius(0);
export function cellPath(a0: number, a1: number, r0: number, r1: number, padAngle = 0): string | null {
  return cellArc({ startAngle: a0, endAngle: a1, innerRadius: r0, outerRadius: r1, padAngle });
}

/** Faint paper-toned background band just inside an occupied arc's inner
 * edge, drawn under the curved label so it reads clearly over the mosaic
 * tiles behind it. */
export function sectorBandPath(n: TaxHierarchyNode, rings: TaxRings): string | null {
  const r0 = rings.ringIn[n.depth] + 1.2;
  const r1 = Math.min(rings.ringOut[n.depth] - 2, r0 + sectorBandH(n.depth));
  return cellPath(n.x0, n.x1, r0, r1, 0.002);
}

export interface CurvedLabelGeom {
  /** `d` for the invisible arc <path> the label's <textPath> binds to. */
  pathD: string;
  /** Available arc length in LOCAL (pre-zoom) px at the label's radius —
   * fixed regardless of zoom, since it's measured in the wheel's own
   * un-scaled coordinate space. */
  avail: number;
  depth: number;
  name: string;
}

/** Curved textPath-along-the-arc label GEOMETRY for one occupied node, or
 * null if the arc is too small at the label radius to bother labelling.
 * Direction flips on the lower half of the wheel so the text is never
 * rendered upside-down. Geometry only — depends on the layout/scope, not
 * on zoom, so it's cheap to memoize alongside the rest of the layout. Fit
 * the actual on-screen text size/truncation separately with fitLabelText,
 * called fresh every render with the live zoom level. */
export function curvedLabelGeom(n: TaxHierarchyNode, rings: TaxRings): CurvedLabelGeom | null {
  const rText = rings.ringIn[n.depth] + sectorBandH(n.depth) * 0.56;
  const avail = (n.x1 - n.x0) * rText;
  if (avail < 34) return null;
  const mid = (n.x0 + n.x1) / 2;
  const bottom = mid > Math.PI / 2 && mid < Math.PI * 1.5;
  const pa = bottom ? n.x1 : n.x0;
  const pb = bottom ? n.x0 : n.x1;
  const large = Math.abs(pb - pa) > Math.PI ? 1 : 0;
  const sweep = bottom ? 0 : 1;
  const [x1, y1] = polarXY(pa, rText);
  const [x2, y2] = polarXY(pb, rText);
  const pathD = `M${x1},${y1} A${rText},${rText} 0 ${large} ${sweep} ${x2},${y2}`;
  return { pathD, avail, depth: n.depth, name: n.data.name };
}

/** Base (un-zoomed) font size per ring depth, in the wheel's LOCAL SVG
 * units — matches the depths' relative weight (macro biggest, micro
 * smallest) before any zoom-driven capping kicks in. */
const LABEL_BASE_FS: Record<number, number> = { 1: 12, 2: 10, 3: 8.5 };
/** Once BASE_FS * zoomK would render past this many on-screen px, the
 * LOCAL font size shrinks to hold the on-screen size here instead — so
 * labels read at a comfortable, ~constant size regardless of zoom level
 * rather than growing arbitrarily large as you zoom in. Ported from
 * SPRINT 13's TAX_LABEL_CAP_PX/updateTaxLabelFit. */
const LABEL_CAP_PX = 34;

export interface FittedLabel {
  fontSize: number;
  text: string;
}

/** Resolves a label's on-screen-stable font size and re-truncates its name
 * to fit the freed-up room — call this fresh every render with the live
 * zoom transform's `k`, NOT inside the memoized layout: as you zoom in
 * past the cap, the LOCAL font size shrinks (holding the on-screen size
 * roughly constant), which also shrinks the local character width, so more
 * of a previously-truncated name becomes visible instead of the same "…"
 * just rendering bigger. */
export function fitLabelText(geom: CurvedLabelGeom, zoomK: number): FittedLabel {
  const base = LABEL_BASE_FS[geom.depth] ?? LABEL_BASE_FS[3];
  const fontSize = Math.min(base, LABEL_CAP_PX / Math.max(zoomK, 1e-6));
  const approxCharWidthPx = fontSize * 0.56;
  const maxCh = Math.max(1, Math.floor(geom.avail / approxCharWidthPx));
  const text = geom.name.length > maxCh ? geom.name.slice(0, Math.max(1, maxCh - 1)).trimEnd() + "…" : geom.name;
  return { fontSize, text };
}

/** Stable, DOM-id-safe slug for one node's path key, used to bind a curved
 * label's <textPath> to its invisible arc <path> via #id. */
export function labelPathId(nodePathKey: string): string {
  return "label-path-" + nodePathKey.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

// ---- deterministic per-person jitter -------------------------------------

/** Deterministic pseudo-random hash in [0,1) for (id, salt) — same jitter
 * every render, no Math.random(). FNV-1a. */
export function hash01(id: string, salt: string): number {
  const s = id + salt;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967295;
}

// ---- domain colour ----------------------------------------------------------

const CONF_FLOOR = 0.05;
const CONF_CAP = 0.5;
export const TAX_GREY = "#9a9a92";

function hexToRgbTuple(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Blends hex colour `a` toward hex colour `b` by weight `tb` in [0,1]
 * (0 = pure a, 1 = pure b). Small local replacement for a colour library —
 * the simplest faithful equivalent of the original app's d3.lab pale→deep
 * interpolation. */
export function mixHex(a: string, b: string, tb: number): string {
  const [ar, ag, ab] = hexToRgbTuple(a);
  const [br, bg, bb] = hexToRgbTuple(b);
  const r = Math.round(ar + (br - ar) * tb);
  const g = Math.round(ag + (bg - ag) * tb);
  const bch = Math.round(ab + (bb - ab) * tb);
  return `rgb(${r}, ${g}, ${bch})`;
}

/** Domain colour for one person: pale→deep by confidence, grey when
 * low-confidence or unknown. Prefers the _specter fields when present. */
export function taxColour(p: TaxPerson): string {
  const specter = p.domain_top_specter != null;
  const top = specter ? p.domain_top_specter : p.domain_top;
  const conf = specter ? p.domain_confidence_specter || 0 : p.domain_confidence || 0;
  if (!top || top === "unknown" || conf < CONF_FLOOR) return TAX_GREY;
  const base = DOMAIN_COLORS[top as DomainKey];
  if (!base) return TAX_GREY;
  const t = Math.pow(Math.min(1, conf / CONF_CAP), 0.6);
  return mixHex(base, "#ffffff", 1 - t);
}

// ---- ring assignment and jittered position --------------------------------

/** The deepest ring a person's tax_levels dominance supports — walks the
 * specificity chain while each level's share stays >= 0.5 (fixed threshold,
 * no UI control). */
export function assignedDepth(p: TaxPerson): number {
  const lv = p.tax_levels;
  if (!lv || !lv.length) return p.tax_path.length;
  let depth = 1;
  for (let i = 1; i < lv.length; i++) {
    if ((lv[i].share || 0) >= 0.5) depth = i + 1;
    else break;
  }
  return depth;
}

/** Walks UP from a person's assigned depth until it finds an occupied node
 * in THIS scope's partition — their deepest tax_path entry might carry zero
 * weight here even though the corpus-wide taxonomy names it. */
export function anchorNodeFor(
  p: TaxPerson,
  byPath: Map<string, TaxHierarchyNode>,
  root: TaxHierarchyNode,
): TaxHierarchyNode | null {
  const depth = Math.min(assignedDepth(p), p.tax_path.length);
  for (let i = depth; i >= 1; i--) {
    const nd = byPath.get(p.tax_path.slice(0, i).join("›"));
    if (nd && (nd.value ?? 0) > 0) return nd;
  }
  return root.children?.find((c) => (c.value ?? 0) > 0) ?? null;
}

/** Jittered polar position (local to the wheel's own translated <g>) for one
 * person within their assigned ring cell. Also returns the assigned angle
 * `a` itself (pre-sin/cos) — lib/mosaic.ts's crystalSeed uses it to keep the
 * paper-mosaic treemap spatially coherent with this jittered layout. */
export function anchorFor(
  p: TaxPerson,
  nd: TaxHierarchyNode,
  rings: TaxRings,
  sizeScale: (v: number) => number,
): { x: number; y: number; r: number; a: number } {
  const u = hash01(p.id, "a");
  const v = hash01(p.id, "r");
  const dotR = sizeScale(p.quantum_h_index ?? p.h_index ?? 0);
  const rIn = rings.ringIn[nd.depth];
  const rOut = rings.ringOut[nd.depth];
  const band = rOut - rIn;
  const mid = (rIn + rOut) / 2;
  const half = Math.max(0, Math.min(band * 0.32, band / 2 - dotR));
  const r = mid + (2 * v - 1) * half;
  const span = nd.x1 - nd.x0;
  const aPad = Math.min(span * 0.4, (dotR + 2) / Math.max(1e-6, mid));
  const a = nd.x0 + aPad + u * (span - 2 * aPad);
  return { x: r * Math.sin(a), y: -r * Math.cos(a), r: dotR, a };
}
