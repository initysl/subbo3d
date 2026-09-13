/**
 * Time-of-impact queries.
 *
 * Friction and gravity are applied as velocity impulses at the top of each
 * step, so within the motion solver every body travels in a straight line at
 * constant velocity. That is what reduces time-of-impact to an exact
 * quadratic — one `sqrt`, no transcendentals, and no penetration to correct
 * afterwards.
 */

/** Sentinel for "these never touch within the time window". */
export const NO_IMPACT = -1;

/**
 * Time of impact between two moving circles.
 *
 * `dx, dy` is the position of B relative to A, `wx, wy` the velocity of B
 * relative to A, and `sumR` the sum of the radii.
 */
export function toiCircleCircle(
  dx: number,
  dy: number,
  wx: number,
  wy: number,
  sumR: number,
  tMax: number,
): number {
  // Approaching only. This also rejects the majority of pairs before any
  // multiplication beyond the dot product, which is why the brute-force
  // O(n^2) scan is affordable.
  const b = dx * wx + dy * wy;
  if (b >= 0) return NO_IMPACT;

  const c = dx * dx + dy * dy - sumR * sumR;
  // Already overlapping and still closing: resolve immediately. In a world
  // that starts separated this can only arise from the initial formation.
  if (c < 0) return 0;

  const a = wx * wx + wy * wy;
  if (a === 0) return NO_IMPACT;

  const disc = b * b - a * c;
  if (disc < 0) return NO_IMPACT;

  const t = (-b - Math.sqrt(disc)) / a;
  if (t < 0 || t > tMax) return NO_IMPACT;
  return t;
}

/**
 * Time of impact between a moving circle and an axis-aligned boundary plane.
 *
 * `p` and `v` are the body's coordinate and velocity along the axis normal to
 * the plane, `limit` the plane's coordinate, and `sign` +1 for the upper
 * boundary and -1 for the lower one.
 */
export function toiWall(
  p: number,
  v: number,
  limit: number,
  radius: number,
  sign: number,
  tMax: number,
): number {
  const closing = v * sign;
  if (closing <= 0) return NO_IMPACT;

  const surface = limit - radius * sign;
  const gap = (surface - p) * sign;
  if (gap <= 0) return 0;

  const t = gap / closing;
  if (t > tMax) return NO_IMPACT;
  return t;
}
