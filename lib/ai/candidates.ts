import * as C from "@/lib/sim/constants";
import type { Match } from "@/lib/match/Match";
import { attackDirection } from "@/lib/rules/geometry";
import { BALL, BODY_COUNT } from "@/lib/sim/types";
import { nextFloat, nextSigned, type Rng } from "@/lib/sim/rng";

/**
 * Candidate generation.
 *
 * Sampling aim uniformly at random wastes almost every simulation: most
 * directions send a figure nowhere useful. Candidates are therefore built
 * around the few intentions a human actually has — play the ball, advance it,
 * or get it clear — with jitter around each.
 */

export interface Candidate {
  bodyId: number;
  aimX: number;
  aimY: number;
  power: number;
  loft: number;
}

const POWERS = [0.35, 0.55, 0.78, 1.0];
/** Aim jitter, in radians, applied around each intention. */
const SPREAD = 0.22;

function rotate(x: number, y: number, angle: number): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c];
}

/**
 * Build a pool of plausible flicks for `team`, in the match's current phase.
 *
 * Legality comes from Match.canFlick, so the opponent is bound by the
 * three-flick rule (FISTF 5.2.1) exactly as a human is — it cannot cheat by
 * considering moves the rules forbid.
 */
export function generateCandidates(match: Match, team: number, rng: Rng): Candidate[] {
  const w = match.world;
  const dir = attackDirection(team);
  const out: Candidate[] = [];

  const ballX = w.px[BALL];
  const ballY = w.py[BALL];
  const goalX = dir * C.HALF_LENGTH;

  for (let body = 1; body < BODY_COUNT; body++) {
    if (w.team[body] !== team) continue;
    if (!match.canFlick(body)) continue;

    const bx = w.px[body];
    const by = w.py[body];

    // Intention one: play the ball.
    const toBallX = ballX - bx;
    const toBallY = ballY - by;
    const toBallLen = Math.hypot(toBallX, toBallY) || 1;

    // Intention two: drive toward the opponent's goal from where we are.
    const toGoalX = goalX - bx;
    const toGoalY = 0 - by;
    const toGoalLen = Math.hypot(toGoalX, toGoalY) || 1;

    const intentions: Array<[number, number]> = [
      [toBallX / toBallLen, toBallY / toBallLen],
      [toGoalX / toGoalLen, toGoalY / toGoalLen],
    ];

    // Intention three: a hard clearance when the ball is in our own third —
    // sometimes the right move is simply to get it away.
    if (ballX * dir < -C.SHOOTING_LINE_X) {
      intentions.push([dir, nextSigned(rng) * 0.5]);
    }

    for (const [ix, iy] of intentions) {
      for (const power of POWERS) {
        const [ax, ay] = rotate(ix, iy, nextSigned(rng) * SPREAD);
        out.push({
          bodyId: body,
          aimX: ax,
          aimY: ay,
          power,
          // Loft occasionally, so chips over a crowded midfield are on the
          // table without dominating the pool.
          loft: nextFloat(rng) < 0.12 ? 0.35 + nextFloat(rng) * 0.5 : 0,
        });
      }
    }
  }

  return out;
}

/** Fisher-Yates, so a truncated search still sees a spread of figures. */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(nextFloat(rng) * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}
