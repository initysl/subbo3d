import { Match } from "@/lib/match/Match";
import { readSnapshot, SNAPSHOT_FLOATS, writeSnapshot } from "@/lib/match/snapshot";
import { Phase, type RulesetConfig } from "@/lib/rules/types";
import { quantizeFlick, type FlickCommand } from "@/lib/sim/input";
import { createRng, nextSigned, type Rng } from "@/lib/sim/rng";
import { SETTLE_TIMEOUT_STEPS } from "@/lib/sim/constants";
import { generateCandidates, shuffle, type Candidate } from "./candidates";
import { capture, evaluate } from "./score";

/**
 * The opponent's search.
 *
 * Try candidate flicks, play each one out with the *real* solver, and keep
 * whichever leaves the best position. This is only affordable because the
 * simulation is deterministic, side-effect free and costs microseconds a
 * step — which is precisely why it was written by hand rather than taken
 * off the shelf.
 *
 * Pure and DOM-free, so it runs unchanged in a worker or on the main thread.
 */

export interface Difficulty {
  /** Hard ceiling on candidates examined. */
  maxCandidates: number;
  /** Wall-clock budget. Whichever limit binds first stops the search. */
  budgetMs: number;
  /** Aim noise added to the chosen flick, in radians. */
  aimNoise: number;
  /** Power noise added to the chosen flick. */
  powerNoise: number;
}

export const DIFFICULTIES: Record<"easy" | "normal" | "hard", Difficulty> = {
  // A weaker opponent searches less and aims worse. There is deliberately no
  // separate "dumb" code path: the same search, given less of both.
  easy: { maxCandidates: 24, budgetMs: 220, aimNoise: 0.16, powerNoise: 0.16 },
  normal: { maxCandidates: 90, budgetMs: 520, aimNoise: 0.06, powerNoise: 0.07 },
  hard: { maxCandidates: 260, budgetMs: 1100, aimNoise: 0.015, powerNoise: 0.02 },
};

/** Run a scratch match forward until the turn resolves. */
function playOut(match: Match): void {
  for (let i = 0; i < SETTLE_TIMEOUT_STEPS + 64; i++) {
    const p = match.state.phase;
    if (p === Phase.AwaitAttackFlick || p === Phase.BlockFlickOffered || p === Phase.FullTime) {
      return;
    }
    match.step();
  }
}

export interface SearchResult {
  command: FlickCommand;
  score: number;
  examined: number;
}

/**
 * Choose a flick for `team` from the position in `snapshot`.
 *
 * `now` is injected so the caller decides where time comes from — the worker
 * passes performance.now, and tests pass a counter so results are reproducible.
 */
export function searchBestFlick(
  snapshot: Float64Array,
  cfg: RulesetConfig,
  team: number,
  difficulty: Difficulty,
  seed: number,
  now: () => number = () => performance.now(),
): SearchResult | null {
  const rng: Rng = createRng(seed);
  const scratch = new Match(cfg, 0);

  readSnapshot(scratch, snapshot);
  const before = capture(scratch);
  const pool = shuffle(generateCandidates(scratch, team, rng), rng);
  if (pool.length === 0) return null;

  const started = now();
  let best: Candidate | null = null;
  let bestScore = -Infinity;
  let examined = 0;

  for (const candidate of pool) {
    if (examined >= difficulty.maxCandidates) break;
    if (examined > 0 && now() - started > difficulty.budgetMs) break;

    readSnapshot(scratch, snapshot);
    const applied = scratch.flick(
      quantizeFlick(candidate.bodyId, candidate.aimX, candidate.aimY, candidate.power, candidate.loft),
    );
    // canFlick already filtered the pool, but the rules are the authority.
    if (!applied) continue;

    playOut(scratch);
    const value = evaluate(scratch, team, before);
    examined++;

    if (value > bestScore) {
      bestScore = value;
      best = candidate;
    }
  }

  if (!best) return null;

  // Noise is applied to the *chosen* move rather than during the search, so a
  // weaker opponent still understands the position and simply executes it
  // less precisely — which reads as human error rather than as bad judgement.
  const angle = nextSigned(rng) * difficulty.aimNoise;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const aimX = best.aimX * cos - best.aimY * sin;
  const aimY = best.aimX * sin + best.aimY * cos;
  const power = Math.max(
    0.08,
    Math.min(1, best.power + nextSigned(rng) * difficulty.powerNoise),
  );

  return {
    command: quantizeFlick(best.bodyId, aimX, aimY, power, best.loft),
    score: bestScore,
    examined,
  };
}

/** Convenience for callers holding a live Match rather than bytes. */
export function searchFromMatch(
  match: Match,
  team: number,
  difficulty: Difficulty,
  seed: number,
  now?: () => number,
): SearchResult | null {
  const buf = new Float64Array(SNAPSHOT_FLOATS);
  writeSnapshot(match, buf);
  return searchBestFlick(buf, match.cfg, team, difficulty, seed, now);
}
