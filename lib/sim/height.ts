import * as C from "./constants";
import { BALL, SimEventKind } from "./types";
import type { World } from "./world";

/**
 * Advance the ball's vertical axis analytically, outside the horizontal motion
 * solver.
 *
 * Height is the only genuinely three-dimensional part of Subbuteo, and keeping
 * it separate is what lets the rest of the simulation stay a clean 2D problem.
 * It also gives chips their meaning: a ball above FIGURE_BLOCK_HEIGHT simply
 * is not considered for collision against figures, so it sails over them.
 */
export function updateHeight(w: World, dt: number): void {
  const airborne = w.pz[BALL] > 0 || w.vz[BALL] > 0;
  if (!airborne) {
    w.pz[BALL] = 0;
    w.vz[BALL] = 0;
    return;
  }

  w.vz[BALL] -= C.GRAVITY * dt;
  w.pz[BALL] += w.vz[BALL] * dt;

  if (w.pz[BALL] > 0) return;

  w.pz[BALL] = 0;
  const impact = -w.vz[BALL];

  if (impact < C.BALL_VZ_SLEEP) {
    w.vz[BALL] = 0;
    return;
  }

  w.vz[BALL] = impact * C.E_BALL_GROUND;
  // Felt grabs at the ball on each bounce, bleeding horizontal speed.
  const keep = 1 - C.BOUNCE_TANGENT_LOSS;
  w.vx[BALL] *= keep;
  w.vy[BALL] *= keep;

  w.events.emit(SimEventKind.BallBounce, BALL, -1, impact, w.px[BALL], w.py[BALL], 0);
}
