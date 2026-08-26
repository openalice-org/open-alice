// Small formatting helpers, ported from SPRINT 13's fmtInt-style space grouping.

export function fmtInt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "0";
  return Math.round(n).toLocaleString("en-US").replace(/,/g, " ");
}
