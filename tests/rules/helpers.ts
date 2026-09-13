import * as C from "@/lib/sim/constants";
import { quantizeFlick, type FlickCommand } from "@/lib/sim/input";
import { BALL, FLAG_ACTIVE } from "@/lib/sim/types";
import { Match } from "@/lib/match/Match";
import { FISTF } from "@/lib/rules/presets";
import { Phase, type RulesetConfig } from "@/lib/rules/types";

export function cfg(overrides: Partial<RulesetConfig> = {}): RulesetConfig {
  return { ...FISTF, ...overrides };
}

/** Move a body, clearing its motion so setups are reproducible. */
export function place(match: Match, body: number, x: number, y: number): void {
  const w = match.world;
  w.px[body] = x;
  w.py[body] = y;
  w.pz[body] = 0;
  w.vx[body] = 0;
  w.vy[body] = 0;
  w.vz[body] = 0;
  w.flags[body] = FLAG_ACTIVE;
  w.sleepSteps[body] = 0;
}

/** Park every figure far away so a scenario only contains what it sets up. */
export function clearPitch(match: Match): void {
  const w = match.world;
  for (let i = 1; i < w.flags.length; i++) w.flags[i] = 0;
}

/** Put the ball just in front of `body`, `dir` being +1 or -1 along x. */
export function ballInFrontOf(match: Match, body: number, dir: number): void {
  const w = match.world;
  place(match, BALL, w.px[body] + dir * (C.BASE_RADIUS + C.BALL_RADIUS + 0.02), w.py[body]);
}

export function flickAt(body: number, dirX: number, dirY: number, power: number): FlickCommand {
  return quantizeFlick(body, dirX, dirY, power, 0);
}

/** Step until the match is waiting for input again (or the period ends). */
export function runUntilIdle(match: Match, maxSteps = 20_000): number {
  let n = 0;
  while (n < maxSteps) {
    const p = match.state.phase;
    if (
      p === Phase.AwaitAttackFlick ||
      p === Phase.BlockFlickOffered ||
      p === Phase.HalfTime ||
      p === Phase.FullTime
    ) {
      break;
    }
    match.step();
    n++;
  }
  return n;
}
