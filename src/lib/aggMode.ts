import type { AggMode, MapMode } from "../types";

/**
 * Boxplot/hex-density/clusters all share one `aggMode` slot — only one
 * positional overlay is active at a time, and each is only meaningful in
 * certain map projections. Density (hexdensity) and Primary domain
 * (clusters) are both offered from Domains' own config now, so both are
 * Domains-only; Boxplot stays Cartesian-only.
 */
export function aggModeAllowed(agg: AggMode, mapMode: MapMode): boolean {
  switch (agg) {
    case "boxplot":
      return mapMode === "cartesian";
    case "hexdensity":
      return mapMode === "domains";
    case "clusters":
      return mapMode === "domains";
    default:
      return true;
  }
}
