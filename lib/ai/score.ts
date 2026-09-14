import * as C from "@/lib/sim/constants";
import { BALL } from "@/lib/sim/types";
import type { Match } from "@/lib/match/Match";
import { attackDirection } from "@/lib/rules/geometry";

/**
 * Position evaluation.
 *
 * Search breadth is cheap — the solver runs at microseconds a step — but
 * judgement is not, so this file is where the opponent's strength actually
 * lives. Weights are kept together and named so they can be tuned by playing
 * rather than by reading the search.
 */

export const WEIGHTS = {
  goalScored: 1000,
  goalConceded: 1400,
  keptPossession: 140,
  /** Per metre the ball advanced toward the opponent's goal. */
  ballAdvanced: 260,
  /** Ball left somewhere it can be shot from next turn (FISTF 7.1.2). */
  ballShootable: 90,
  /** Ball left in our own shooting area, where it is dangerous. */
  ballInOwnThird: 70,
  /** Ball put out of play, handing the opponent a restart. */
  concededRestart: 50,
};

export interface Position {
  ballX: number;
  score0: number;
  score1: number;
}

export function capture(match: Match): Position {
  return {
    ballX: match.world.px[BALL],
    score0: match.state.score0,
    score1: match.state.score1,
  };
}

/** Evaluate the current position from `team`'s point of view. */
export function evaluate(match: Match, team: number, before: Position): number {
  const m = match.state;
  const dir = attackDirection(team);
  let value = 0;

  const scoredBefore = team === 0 ? before.score0 : before.score1;
  const scoredNow = team === 0 ? m.score0 : m.score1;
  const concededBefore = team === 0 ? before.score1 : before.score0;
  const concededNow = team === 0 ? m.score1 : m.score0;

  value += (scoredNow - scoredBefore) * WEIGHTS.goalScored;
  value -= (concededNow - concededBefore) * WEIGHTS.goalConceded;

  // Possession is the engine of the whole game under FISTF 5.1.2: keep
  // touching the ball and the turn never ends.
  if (m.attackerTeam === team) value += WEIGHTS.keptPossession;

  const ballX = match.world.px[BALL];
  value += (ballX - before.ballX) * dir * WEIGHTS.ballAdvanced;

  // Being able to shoot next turn is worth more than raw distance, because
  // a goal is only legal from inside the shooting area.
  const forward = ballX * dir;
  if (forward > C.SHOOTING_LINE_X) value += WEIGHTS.ballShootable;
  else if (forward < -C.SHOOTING_LINE_X) value -= WEIGHTS.ballInOwnThird;

  // A restart to the opponent is a turnover by another name.
  if (m.restartKind !== 0 && m.restartTeam !== team) value -= WEIGHTS.concededRestart;

  return value;
}
