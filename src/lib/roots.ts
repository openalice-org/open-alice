export interface RootPoint {
  x: number;
  y: number;
  z: number;
  year: number;
}

/**
 * Grow a tree through points that are sorted oldest to newest. The first point is the root. Every
 * other point hangs off the nearest point from a strictly earlier year (or, when it shares the
 * root's year and so has none, off the root), which gives branching, root-like lines that only ever
 * grow upward in time. Distance is measured in the floor plane plus a damped height term, so a
 * branch prefers a close paper in space to a merely recent one.
 *
 * Returns, per point, its parent index (-1 for the root alone) and the size of its subtree (itself
 * plus every descendant), which the caller uses to make trunks thicker than twigs.
 */
export function buildRoots(points: RootPoint[], timeWeight = 0.35): { parent: number[]; size: number[] } {
  const n = points.length;
  const parent = new Array<number>(n).fill(-1);
  for (let i = 1; i < n; i++) {
    let best = 0; // nothing earlier: hang off the root
    let bestD = Infinity;
    for (let j = 0; j < i; j++) {
      if (points[j].year >= points[i].year) continue;
      const dx = points[i].x - points[j].x;
      const dz = points[i].z - points[j].z;
      const dy = (points[i].y - points[j].y) * timeWeight;
      const d = dx * dx + dz * dz + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    parent[i] = best;
  }
  const size = new Array<number>(n).fill(1);
  for (let i = n - 1; i >= 0; i--) if (parent[i] >= 0) size[parent[i]] += size[i];
  return { parent, size };
}
