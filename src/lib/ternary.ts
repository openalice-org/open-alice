// Pure math for the "Domains" ternary (barycentric) projection.
// Ported from SPRINT 13/index.html's projectOf()/drawTriangleChrome().
import type { Person } from "../types";

// Corners in unit space [0,1]x[0,1]: A=top=SENSING, B=bottom-left=COMMUNICATION,
// C=bottom-right=COMPUTING.
export const TRI = {
  A: [0.5, 0.1] as [number, number],
  B: [0.2, 0.86] as [number, number],
  C: [0.8, 0.86] as [number, number],
};

export const DOMAIN_COLORS = {
  computing: "#c0392b",
  communication: "#3bbf73",
  sensing: "#2563c4",
};

// Brighter, more saturated variant of the above — used only by the Domains
// ternary view (per-point blend below, and the Primary domain cluster
// glyphs) rather than DOMAIN_COLORS itself, which stays muted for the
// Disciplines sunburst/paper-mosaic's quieter chrome.
export const DOMAIN_COLORS_VIVID = {
  computing: "#ef4444",
  communication: "#22c55e",
  sensing: "#3b82f6",
};

// Primary-domain glyphs intentionally sit one step quieter than the blended
// Domain Mix points, so the two modes stay distinct without competing.
export const DOMAIN_COLORS_PRIMARY = {
  computing: "#e85b5b",
  communication: "#34b96c",
  sensing: "#538bdc",
};

export type DomainKey = keyof typeof DOMAIN_COLORS;

// Canonical ordering, used to build a stable pair id (e.g. "sensing-communication")
// regardless of which of the two came out on top for a given person.
export const DOMAIN_ORDER: DomainKey[] = ["sensing", "communication", "computing"];

export function hasShares(p: Person): boolean {
  return (
    p.sensing_share != null && p.communication_share != null && p.computing_share != null
  );
}

/** Argmax of a person's three domain shares, or null if they have no share data. */
export function dominantDomainOf(p: Person): DomainKey | null {
  if (!hasShares(p)) return null;
  const pairs: [DomainKey, number][] = [
    ["sensing", p.sensing_share || 0],
    ["communication", p.communication_share || 0],
    ["computing", p.computing_share || 0],
  ];
  pairs.sort((a, b) => b[1] - a[1]);
  return pairs[0][0];
}

/**
 * The two domains a person straddles when no single one clearly dominates
 * (top two shares within THRESHOLD of each other), in canonical DOMAIN_ORDER
 * — or null when one domain clearly leads. Drives the Primary domain view's
 * zebra-striped "boundary" glyph.
 */
export function boundaryPairOf(p: Person, threshold = 0.05): [DomainKey, DomainKey] | null {
  if (!hasShares(p)) return null;
  const pairs: [DomainKey, number][] = [
    ["sensing", p.sensing_share || 0],
    ["communication", p.communication_share || 0],
    ["computing", p.computing_share || 0],
  ];
  pairs.sort((a, b) => b[1] - a[1]);
  if (pairs[0][1] - pairs[1][1] > threshold) return null;
  const [a, b] = [pairs[0][0], pairs[1][0]];
  return DOMAIN_ORDER.indexOf(a) < DOMAIN_ORDER.indexOf(b) ? [a, b] : [b, a];
}

/** Barycentric unit-space coordinate [0,1]x[0,1] for a person with domain shares. */
export function ternaryUnit(p: Person): { ux: number; uy: number } {
  let s = p.sensing_share ?? 0;
  let c = p.communication_share ?? 0;
  let m = p.computing_share ?? 0;
  const sum = s + c + m;
  if (sum > 0) {
    s /= sum;
    c /= sum;
    m /= sum;
  }
  const ux = s * TRI.A[0] + c * TRI.B[0] + m * TRI.C[0];
  const uy = s * TRI.A[1] + c * TRI.B[1] + m * TRI.C[1];
  return { ux, uy };
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function boostSaturation(r: number, g: number, b: number, factor: number): [number, number, number] {
  const midpoint = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
  const boost = (channel: number) => Math.max(0, Math.min(255, midpoint + (channel - midpoint) * factor));
  return [boost(r), boost(g), boost(b)];
}

/**
 * Weighted RGB blend of the three vivid domain colours by a person's shares.
 * A plain linear blend of these three hues goes muddy/grey right at the
 * centroid (equal shares) — so on top of the blend, this also lightens
 * toward white the closer the shares are to perfectly even, keeping a pure
 * saturated colour at each corner but a bright, not grey, middle.
 */
export function domainColorOf(p: Person): string {
  let s = p.sensing_share ?? 0;
  let c = p.communication_share ?? 0;
  let m = p.computing_share ?? 0;
  const sum = s + c + m;
  if (sum > 0) {
    s /= sum;
    c /= sum;
    m /= sum;
  } else {
    return "var(--point)";
  }
  const cs = hexToRgb(DOMAIN_COLORS_VIVID.sensing);
  const cc = hexToRgb(DOMAIN_COLORS_VIVID.communication);
  const cm = hexToRgb(DOMAIN_COLORS_VIVID.computing);
  let r = cs[0] * s + cc[0] * c + cm[0] * m;
  let g = cs[1] * s + cc[1] * c + cm[1] * m;
  let b = cs[2] * s + cc[2] * c + cm[2] * m;
  [r, g, b] = boostSaturation(r, g, b, 1.3);
  // Keep every corner and most of each edge fully saturated. Whitening begins
  // only in the centre core, where all three domains have meaningful weight.
  // It reaches its maximum only at the equal-share centroid.
  const evenness = Math.min(s, c, m) * 3;
  const centerCore = Math.max(0, (evenness - 0.7) / 0.3);
  const whiteBoost = Math.pow(centerCore, 2.4) * 0.55;
  r += (255 - r) * whiteBoost;
  g += (255 - g) * whiteBoost;
  b += (255 - b) * whiteBoost;
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}
