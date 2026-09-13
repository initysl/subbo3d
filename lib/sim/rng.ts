/**
 * Seeded xorshift128 PRNG.
 *
 * The simulation must never call Math.random: two machines replaying the same
 * input log have to produce bit-identical state. Everything here is integer
 * arithmetic, which is exactly specified in JavaScript.
 */

export interface Rng {
  a: number;
  b: number;
  c: number;
  d: number;
}

export function createRng(seed: number): Rng {
  // Scramble the seed so that small, similar seeds still give unrelated streams.
  let s = seed | 0;
  const next = () => {
    s = (s ^ (s << 13)) | 0;
    s = (s ^ (s >>> 17)) | 0;
    s = (s ^ (s << 5)) | 0;
    return s;
  };
  return { a: next() || 1, b: next() || 2, c: next() || 3, d: next() || 4 };
}

export function cloneRng(r: Rng): Rng {
  return { a: r.a, b: r.b, c: r.c, d: r.d };
}

/** Next raw 32-bit value. */
export function nextUint32(r: Rng): number {
  const t = (r.a ^ (r.a << 11)) | 0;
  r.a = r.b;
  r.b = r.c;
  r.c = r.d;
  r.d = (r.d ^ (r.d >>> 19) ^ (t ^ (t >>> 8))) | 0;
  return r.d >>> 0;
}

/** Next value in [0, 1). Division by a power of two is exact. */
export function nextFloat(r: Rng): number {
  return nextUint32(r) / 4294967296;
}

/** Next value in [-1, 1). */
export function nextSigned(r: Rng): number {
  return nextFloat(r) * 2 - 1;
}
