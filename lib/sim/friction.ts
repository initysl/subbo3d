import * as C from "./constants";
import { BALL, BodyKind, FLAG_ACTIVE, FLAG_ASLEEP } from "./types";
import type { World } from "./world";
import { BODY_COUNT } from "./types";

/**
 * Velocity-level friction, applied once at the top of each step.
 *
 * This is the single most important function in the project for game feel. A
 * Subbuteo figure is a weighted plastic hemisphere on felt, which is dry
 * Coulomb friction: deceleration is *constant*, independent of speed, so a
 * figure travels v0^2 / (2*mu*g) and stops crisply. Exponential drag
 * (`v *= 0.98`) decays quickly and then crawls forever, which is the single
 * most common reason flick games feel floaty.
 *
 * Applying friction here — rather than inside the motion solver — is also what
 * keeps motion linear within a step, and therefore time-of-impact exact.
 */
export function applyFriction(w: World, dt: number): void {
  for (let i = 0; i < BODY_COUNT; i++) {
    if ((w.flags[i] & FLAG_ACTIVE) === 0) continue;
    if (w.flags[i] & FLAG_ASLEEP) continue;

    // A ball in flight is not touching the felt.
    if (i === BALL && w.pz[i] > C.BALL_AIRBORNE_EPS) continue;

    const vx = w.vx[i];
    const vy = w.vy[i];
    const sp2 = vx * vx + vy * vy;
    if (sp2 < 1e-12) {
      w.vx[i] = 0;
      w.vy[i] = 0;
      continue;
    }

    const sp = Math.sqrt(sp2);
    const isBall = w.kind[i] === BodyKind.Ball;
    const coulomb = (isBall ? C.MU_BALL : C.MU_BASE) * C.GRAVITY;
    const viscous = (isBall ? C.K_VISC_BALL : C.K_VISC_BASE) * sp;

    let dv = (coulomb + viscous) * dt;
    // Friction may bring a body to rest but must never reverse it.
    if (dv > sp) dv = sp;

    const scale = (sp - dv) / sp;
    w.vx[i] = vx * scale;
    w.vy[i] = vy * scale;
  }
}
