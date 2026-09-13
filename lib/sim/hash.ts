/**
 * FNV-1a state hashing, used to detect divergence between two runs.
 *
 * Floats are quantised to integers before hashing so that differences far
 * below anything observable do not register as a desync. This is the check
 * that keeps M2 lockstep netcode honest.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Positions are hashed to micrometre resolution, velocities to mm/s. */
export const POS_QUANTISE = 1e6;
export const VEL_QUANTISE = 1e3;

export function hashInit(): number {
  return FNV_OFFSET;
}

export function hashInt(h: number, value: number): number {
  let acc = h;
  const v = value | 0;
  for (let shift = 0; shift < 32; shift += 8) {
    acc ^= (v >>> shift) & 0xff;
    acc = Math.imul(acc, FNV_PRIME);
  }
  return acc >>> 0;
}

/**
 * Hash a float by truncating toward zero at the given scale. Truncation is an
 * exact operation, unlike rounding modes that vary by implementation.
 */
export function hashFloat(h: number, value: number, scale: number): number {
  return hashInt(h, Math.trunc(value * scale));
}
