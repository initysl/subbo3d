import * as C from "@/lib/sim/constants";
import type { World } from "@/lib/sim/world";
import { BALL } from "@/lib/sim/types";

/**
 * Team 0 starts in the -x half and attacks +x; team 1 is the mirror. This
 * matches the kick-off formation in `lib/sim/formation.ts`.
 */
export function attackDirection(team: number): number {
  return team === 0 ? 1 : -1;
}

/** The x coordinate of the goal-line the given team is attacking. */
export function defenderGoalX(attackerTeam: number): number {
  return attackDirection(attackerTeam) * C.HALF_LENGTH;
}

/**
 * FISTF 7.1.1a: a goal counts only if the ball "was shot from completely
 * inside the opposing shooting-area". Completely is load-bearing — the whole
 * ball must be past the shooting-line, not just its centre.
 */
export function ballFullyInShootingArea(w: World, attackerTeam: number): boolean {
  const dir = attackDirection(attackerTeam);
  return w.px[BALL] * dir - C.BALL_RADIUS > C.SHOOTING_LINE_X;
}
