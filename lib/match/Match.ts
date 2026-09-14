import type { FlickCommand } from "@/lib/sim/input";
import { SETTLE_TIMEOUT_STEPS } from "@/lib/sim/constants";
import { step as simStep } from "@/lib/sim/step";
import { createWorld, freezeAll, isSettled, type World } from "@/lib/sim/world";
import {
  canFlick,
  commitAttackFlick,
  commitBlockFlick,
  createMatchState,
  observeStep,
  onSettled,
  skipBlockFlick,
  startMatch,
} from "@/lib/rules/machine";
import { applyRestart } from "@/lib/rules/restarts";
import { Phase, RestartKind, type MatchState, type RulesetConfig } from "@/lib/rules/types";

/**
 * The composition root for the deterministic core.
 *
 * Match owns both the physics world and the match state, and is the only way
 * to advance either. That is deliberate: if match state — possession, flick
 * count, score, clock — lived outside the snapshot, it is exactly what would
 * desync an online game later, and the physics would get the blame.
 */
export class Match {
  readonly world: World;
  readonly state: MatchState;
  readonly cfg: RulesetConfig;

  private resolveSteps = 0;

  constructor(cfg: RulesetConfig, kickOffTeam = 0) {
    this.cfg = cfg;
    this.world = createWorld();
    this.state = createMatchState();
    startMatch(this.state, this.world, kickOffTeam);
  }

  /**
   * Advance by exactly one fixed timestep.
   *
   * The clock advances on every step, not only while the ball is moving:
   * FISTF 3.1.1's fifteen minutes are wall-clock minutes including thinking
   * time. Counting them in fixed steps keeps that deterministic — no wall
   * clock is ever read inside this boundary.
   */
  step(): void {
    const m = this.state;
    const w = this.world;

    if (m.phase === Phase.FullTime) return;

    switch (m.phase) {
      case Phase.Resolving: {
        simStep(w);
        observeStep(m, w, this.cfg);
        this.resolveSteps++;

        if (isSettled(w) || this.resolveSteps >= SETTLE_TIMEOUT_STEPS) {
          if (!isSettled(w)) freezeAll(w);
          this.resolveSteps = 0;
          onSettled(m, w, this.cfg);
        }
        break;
      }

      case Phase.GoalScored:
        m.celebrationSteps--;
        if (m.celebrationSteps <= 0) applyRestart(m, w);
        break;

      case Phase.Restart:
        applyRestart(m, w);
        break;

      default:
        break;
    }

    if (m.phase === Phase.HalfTime) return;
    m.clockSteps++;

    // End the period only between flicks. FISTF 7.1.1b lets a goal stand if
    // the figure was flicked before the end signal, so cutting a resolve short
    // would wrongly disallow it.
    if (m.clockSteps >= this.cfg.halfLengthSteps && m.phase === Phase.AwaitAttackFlick) {
      m.phase = m.half >= this.cfg.halves ? Phase.FullTime : Phase.HalfTime;
    }
  }

  /**
   * Clear the settle counter. Called when state is restored from a snapshot,
   * since the counter belongs to the resolve that was in flight, not to the
   * state being loaded.
   */
  resetResolveCounter(): void {
    this.resolveSteps = 0;
  }

  /** Begin the second half, with the flick-off going to the other team. */
  beginNextHalf(): void {
    const m = this.state;
    if (m.phase !== Phase.HalfTime) return;
    m.half++;
    m.clockSteps = 0;
    m.restartTeam = m.half % 2 === 0 ? 1 : 0;
    m.restartKind = RestartKind.FlickOff;
    applyRestart(m, this.world);
  }

  canFlick(body: number): boolean {
    return canFlick(this.state, this.world, body, this.cfg);
  }

  /** Take the flick appropriate to the current phase. Returns false if illegal. */
  flick(cmd: FlickCommand): boolean {
    if (this.state.phase === Phase.BlockFlickOffered) {
      return commitBlockFlick(this.state, this.world, cmd, this.cfg);
    }
    return commitAttackFlick(this.state, this.world, cmd, this.cfg);
  }

  /** Decline the owed block-flick (FISTF 6.2.3 — it lapses after five seconds). */
  skipBlockFlick(): void {
    skipBlockFlick(this.state);
  }
}
