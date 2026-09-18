import type { AggMode, MapMode } from "../types";

/**
 * Boxplot/hex-density/clusters/patents all share one `aggMode` slot — only
 * one positional overlay is active at a time, and each is only meaningful
 * in certain map projections. Density (hexdensity) and Primary domain
 * (clusters) are both offered from Domains' own config now, so both are
 * Domains-only; Boxplot stays Cartesian-only. Patents is offered from BOTH
 * Axes' and Domains' own config — in Domains it anchors each holder at
 * their Domain-mix ternary position, same as the plain per-point view, and
 * hides everyone without a patent (see ScatterView's patentsActive).
 */
export function aggModeAllowed(agg: AggMode, mapMode: MapMode): boolean {
  switch (agg) {
    case "boxplot":
      return mapMode === "cartesian";
    case "patents":
      return mapMode === "cartesian" || mapMode === "domains";
    case "universities":
      return mapMode === "cartesian" || mapMode === "domains";
    case "hexdensity":
      return mapMode === "domains";
    case "clusters":
      return mapMode === "domains";
    default:
      return true;
  }
}
