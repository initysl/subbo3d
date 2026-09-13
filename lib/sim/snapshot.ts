import { hashFloat, hashInit, hashInt, POS_QUANTISE, VEL_QUANTISE } from "./hash";
import { BODY_COUNT } from "./types";
import type { World } from "./world";

/**
 * Hash the simulation state.
 *
 * Two runs that agree here agree everywhere that matters. This is the check
 * that makes replays trustworthy today and online lockstep viable later, so it
 * is asserted in CI against committed golden values.
 */
export function hashWorld(w: World): number {
  let h = hashInit();
  h = hashInt(h, w.step);

  for (let i = 0; i < BODY_COUNT; i++) {
    h = hashFloat(h, w.px[i], POS_QUANTISE);
    h = hashFloat(h, w.py[i], POS_QUANTISE);
    h = hashFloat(h, w.pz[i], POS_QUANTISE);
    h = hashFloat(h, w.vx[i], VEL_QUANTISE);
    h = hashFloat(h, w.vy[i], VEL_QUANTISE);
    h = hashFloat(h, w.vz[i], VEL_QUANTISE);
    h = hashInt(h, w.flags[i]);
  }

  return h >>> 0;
}

/** Total mechanical energy: kinetic plus gravitational. Used by invariant tests. */
export function totalEnergy(w: World, gravity: number): number {
  let e = 0;
  for (let i = 0; i < BODY_COUNT; i++) {
    if (w.invMass[i] === 0) continue;
    const m = 1 / w.invMass[i];
    const v2 = w.vx[i] * w.vx[i] + w.vy[i] * w.vy[i] + w.vz[i] * w.vz[i];
    e += 0.5 * m * v2 + m * gravity * w.pz[i];
  }
  return e;
}
