/**
 * Goalkeeping — FISTF Rule 8.
 *
 * The keeper is not a flickable figure: 8.1.1 puts it on a rod through the
 * back of the goal, and 8.2.1 confines it to the goal-area. What its player
 * may do is *place* it — and 8.1.2 draws the line precisely, forbidding it
 * being "moved rapidly to and fro before the attacking playing figure has
 * touched the ball". So the keeper is positioned between flicks and held
 * still while the ball is in play. That is the whole control model, and it
 * comes from the rulebook rather than from a UX preference.
 *
 * Everything here is pure and allocation-free: it sits inside the determinism
 * boundary, so the keeper's position is part of the state hash and the AI's
 * search sees exactly the keeper the live match has.
 */

import * as C from "@/lib/sim/constants";
import {
  BALL,
  BODY_COUNT,
  FLAG_ACTIVE,
  FLAG_OUT_OF_PLAY,
  KEEPER_A,
  KEEPER_B,
} from "@/lib/sim/types";
import type { World } from "@/lib/sim/world";
import { attackDirection } from "./geometry";

/** Output of a placement query. Callers own the object, so nothing allocates. */
export interface KeeperPos {
  x: number;
  y: number;
}

export function makeKeeperPos(): KeeperPos {
  return { x: 0, y: 0 };
}

/** Body index of a team's goalkeeper. */
export function keeperBody(team: number): number {
  return team === 0 ? KEEPER_A : KEEPER_B;
}

/** The x coordinate of the goal-line a team defends. */
export function ownGoalX(team: number): number {
  return -attackDirection(team) * C.HALF_LENGTH;
}

/**
 * FISTF 8.2.1 — "no part of the goalkeeper may pass or touch the goal-area
 * line". *No part*, so the limits are inset by the keeper's radius rather
 * than merely containing its centre.
 *
 * The goal-line itself is not a goal-area line: a keeper standing on it is
 * in its goal, which is exactly where a keeper belongs.
 */
export const KEEPER_MAX_ADVANCE = C.GOAL_AREA_DEPTH - C.KEEPER_RADIUS;
export const KEEPER_MAX_OFFSET = C.GOAL_AREA_WIDTH / 2 - C.KEEPER_RADIUS;

/** How far off its line the keeper stands when the attack is still distant. */
const KEEPER_MIN_ADVANCE = 0.015;

/**
 * Distance from the goal-line over which the keeper comes out to narrow the
 * angle. The shooting-area depth, because that is the range from which a goal
 * can legally be scored (7.1.1a) and so the only range worth advancing for.
 */
const ADVANCE_RANGE = C.HALF_LENGTH - C.SHOOTING_LINE_X;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Bring any requested position inside the goal-area (8.2.1).
 *
 * One definition, used by the automatic positioner, by manual placement and
 * by the tests — so the three cannot drift apart and let an illegal keeper
 * onto the pitch.
 */
export function clampToGoalArea(
  team: number,
  x: number,
  y: number,
  out: KeeperPos,
): void {
  const dir = attackDirection(team);
  const goalX = ownGoalX(team);
  const advance = clamp((x - goalX) * dir, 0, KEEPER_MAX_ADVANCE);

  out.x = goalX + dir * advance;
  out.y = clamp(y, -KEEPER_MAX_OFFSET, KEEPER_MAX_OFFSET);
}

/**
 * Where `team`'s keeper should stand against the ball's current position.
 *
 * Two ideas, both of them what a real keeper does: stand on the line from the
 * ball to the middle of the goal, and come out as the ball gets closer. The
 * second is what actually saves shots — the keeper is small next to the goal
 * mouth, so the only way it covers a meaningful share of the angle is by
 * narrowing that angle.
 *
 * Deliberately *not* a prediction of where the shot will go. Positioning from
 * where the ball is leaves the keeper beatable by pace and by aiming across
 * it, which is the skill the real game rewards; a keeper that knew the shot
 * in advance would simply be a wall.
 */
export function chooseKeeperPosition(
  w: World,
  team: number,
  out: KeeperPos,
): void {
  const dir = attackDirection(team);
  const goalX = ownGoalX(team);
  const bx = w.px[BALL];
  const by = w.py[BALL];

  // How far up-pitch the ball is from the goal being defended.
  const reach = (bx - goalX) * dir;
  const closeness = clamp(1 - reach / ADVANCE_RANGE, 0, 1);
  const x =
    goalX +
    dir *
      (KEEPER_MIN_ADVANCE +
        closeness * (KEEPER_MAX_ADVANCE - KEEPER_MIN_ADVANCE));

  // Intersect the ball-to-goal-centre line with the keeper's depth. `u` runs
  // from 0 at the ball to 1 at the centre of the goal.
  const span = goalX - bx;
  let y = by;
  if (Math.abs(span) > 1e-9) {
    const u = clamp((x - bx) / span, 0, 1);
    y = by * (1 - u);
  }

  clampToGoalArea(team, x, y, out);
}

/** Is this spot clear of every other body in play? */
function isFree(w: World, keeper: number, x: number, y: number): boolean {
  for (let i = 0; i < BODY_COUNT; i++) {
    if (i === keeper) continue;
    if ((w.flags[i] & FLAG_ACTIVE) === 0) continue;
    if ((w.flags[i] & FLAG_OUT_OF_PLAY) !== 0) continue;

    const dx = w.px[i] - x;
    const dy = w.py[i] - y;
    const sumR = w.radius[i] + w.radius[keeper];
    if (dx * dx + dy * dy < sumR * sumR) return false;
  }
  return true;
}

/** Fractions of the way to the target tried when the target itself is blocked. */
const APPROACH = [1, 0.66, 0.33];

/**
 * Move `team`'s keeper to (x, y), clamped legal, without putting it on top of
 * anything.
 *
 * Overlap matters twice over. The solver assumes bodies start apart, and
 * 8.2.2 makes a keeper placed against a stationary figure in the goal-area a
 * foul in its own right. If the target is occupied the keeper stops short
 * along the way there, and if even that is blocked it simply stays put.
 *
 * Returns the distance moved, which is zero when nothing could be done.
 */
export function positionKeeper(
  w: World,
  team: number,
  x: number,
  y: number,
  scratch: KeeperPos,
): number {
  const keeper = keeperBody(team);
  if ((w.flags[keeper] & FLAG_ACTIVE) === 0) return 0;

  clampToGoalArea(team, x, y, scratch);
  const targetX = scratch.x;
  const targetY = scratch.y;

  const fromX = w.px[keeper];
  const fromY = w.py[keeper];

  for (const f of APPROACH) {
    const tx = fromX + (targetX - fromX) * f;
    const ty = fromY + (targetY - fromY) * f;
    if (!isFree(w, keeper, tx, ty)) continue;

    w.px[keeper] = tx;
    w.py[keeper] = ty;
    // The keeper is placed, not flicked: it arrives at rest. Leaving it
    // asleep keeps `isSettled` true, so placement never extends a resolve.
    w.vx[keeper] = 0;
    w.vy[keeper] = 0;

    const dx = tx - fromX;
    const dy = ty - fromY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  return 0;
}

/**
 * Place `team`'s keeper against the ball, per `chooseKeeperPosition`.
 *
 * Called once as an attacking flick is committed and then left alone for the
 * whole resolve — which is what 8.1.2 permits, and all it permits.
 */
export function autoPositionKeeper(
  w: World,
  team: number,
  scratch: KeeperPos,
): number {
  chooseKeeperPosition(w, team, scratch);
  return positionKeeper(w, team, scratch.x, scratch.y, scratch);
}
