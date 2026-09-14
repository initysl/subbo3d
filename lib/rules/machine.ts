import { applyFlick, type FlickCommand } from "@/lib/sim/input";
import { BodyKind, FLAG_ACTIVE, META_A_STATIONARY, SimEventKind } from "@/lib/sim/types";
import type { World } from "@/lib/sim/world";
import { ballFullyInShootingArea } from "./geometry";
import { autoPositionKeeper, makeKeeperPos, positionKeeper } from "./keeper";
import { applyRestart } from "./restarts";
import { NO_TEAM, Phase, RestartKind, type MatchState, type RulesetConfig } from "./types";

/**
 * Scratch for keeper placement. Module-level because `commitAttackFlick` runs
 * many thousands of times a second inside the AI's search, and the rules layer
 * allocates nothing once a match is under way.
 */
const keeperScratch = makeKeeperPos();

/** What the ball did to end the current resolve, decided at settle time. */
const enum Pending {
  None = 0,
  Goal = 1,
  OutGoalLine = 2,
  OutTouchline = 3,
}

export function createMatchState(): MatchState {
  return {
    phase: Phase.FlickOff,
    attackerTeam: 0,
    lastFlickedBody: -1,
    flicksOnCurrentFigure: 0,
    touchedBallThisFlick: false,
    possessionLost: false,
    blockFlickOwed: false,
    ballWasShootableAtShot: false,
    lastTouchTeam: NO_TEAM,
    lastDeflectorWasDefender: false,
    lastTouchWasDefenderKeeper: false,
    score0: 0,
    score1: 0,
    clockSteps: 0,
    half: 1,
    restartKind: RestartKind.None,
    restartTeam: 0,
    restartX: 0,
    restartY: 0,
    pending: Pending.None,
    pendingSide: 0,
    celebrationSteps: 0,
  };
}

/** Begin the match with a flick-off to the given team (FISTF 4). */
export function startMatch(m: MatchState, w: World, team: number): void {
  m.restartKind = RestartKind.FlickOff;
  m.restartTeam = team;
  applyRestart(m, w);
  m.score0 = 0;
  m.score1 = 0;
  m.clockSteps = 0;
  m.half = 1;
}

/**
 * FISTF 5.2.1 — a figure may not play the ball more than three times running.
 *
 * The rulebook punishes an illegal flick with a free-flick, because a human
 * can physically take one. A digital game can simply refuse it, which is what
 * this does; free-flicks (Rule 11) are not implemented in this milestone.
 */
export function canFlick(
  m: MatchState,
  w: World,
  body: number,
  cfg: RulesetConfig,
): boolean {
  if (m.phase !== Phase.AwaitAttackFlick && m.phase !== Phase.BlockFlickOffered) return false;
  if ((w.flags[body] & FLAG_ACTIVE) === 0) return false;

  // The goalkeeper is not a flickable figure. FISTF 8.1.1 puts it on a rod
  // held from behind the goal, and 8.2.1 forbids any part of it passing the
  // goal-area line — so sending it upfield is not a bad move, it is an
  // illegal one. Rod manipulation (Rule 8) is not implemented yet, so for now
  // the keeper simply stands in goal.
  if (w.kind[body] === BodyKind.Keeper) return false;

  const wantTeam = m.phase === Phase.BlockFlickOffered ? 1 - m.attackerTeam : m.attackerTeam;
  if (w.team[body] !== wantTeam) return false;

  if (m.phase === Phase.BlockFlickOffered) return true;
  if (body !== m.lastFlickedBody) return true;
  return m.flicksOnCurrentFigure < cfg.maxFlicksPerFigure;
}

/** Commit an attacking flick and begin resolving it. */
export function commitAttackFlick(
  m: MatchState,
  w: World,
  cmd: FlickCommand,
  cfg: RulesetConfig,
): boolean {
  if (!canFlick(m, w, cmd.bodyId, cfg)) return false;

  m.flicksOnCurrentFigure = cmd.bodyId === m.lastFlickedBody ? m.flicksOnCurrentFigure + 1 : 1;
  m.lastFlickedBody = cmd.bodyId;

  // FISTF 7.1.1a is about where *the ball* was when it was shot, so it has to
  // be sampled now — everything will have moved by the time it crosses a line.
  m.ballWasShootableAtShot = ballFullyInShootingArea(w, m.attackerTeam);

  m.touchedBallThisFlick = false;
  m.possessionLost = false;
  m.blockFlickOwed = false;
  m.lastTouchWasDefenderKeeper = false;
  m.pending = Pending.None;
  m.phase = Phase.Resolving;

  // FISTF 8.1.2 — the keeper may be placed, but not worked to and fro once
  // the flick is under way. So the defending keeper takes up its position at
  // the moment of the flick and holds it for the whole resolve.
  if (cfg.keeperMode === "auto") autoPositionKeeper(w, 1 - m.attackerTeam, keeperScratch);

  applyFlick(w, cmd);
  return true;
}

/**
 * Place the defending keeper by hand (FISTF 8.2.1), for `keeperMode: manual`.
 *
 * Offered in the block-flick window, which is the defender's existing turn to
 * act — no new phase, and nothing that lets the keeper be fiddled with while
 * the ball is moving. Returns false if the placement was not allowed.
 */
export function placeKeeper(
  m: MatchState,
  w: World,
  x: number,
  y: number,
  cfg: RulesetConfig,
): boolean {
  if (cfg.keeperMode !== "manual") return false;
  if (m.phase !== Phase.BlockFlickOffered && m.phase !== Phase.AwaitAttackFlick) return false;

  positionKeeper(w, 1 - m.attackerTeam, x, y, keeperScratch);
  return true;
}

/** Take the block-flick the defender is owed (FISTF 6.2.1). */
export function commitBlockFlick(
  m: MatchState,
  w: World,
  cmd: FlickCommand,
  cfg: RulesetConfig,
): boolean {
  if (m.phase !== Phase.BlockFlickOffered) return false;
  if (!canFlick(m, w, cmd.bodyId, cfg)) return false;

  m.blockFlickOwed = false;
  m.phase = Phase.Resolving;
  applyFlick(w, cmd);
  return true;
}

/** Decline the block-flick. FISTF 6.2.3 lets it lapse after five seconds. */
export function skipBlockFlick(m: MatchState): void {
  if (m.phase !== Phase.BlockFlickOffered) return;
  m.blockFlickOwed = false;
  resolvePossession(m);
}

/**
 * Read the simulation events produced by the step just taken.
 *
 * Called once per step while resolving, so it must stay allocation-free.
 */
export function observeStep(m: MatchState, w: World, cfg: RulesetConfig): void {
  const events = w.events;

  for (let i = 0; i < events.count; i++) {
    const e = events.at(i);

    switch (e.kind) {
      case SimEventKind.FigureHitBall:
      case SimEventKind.KeeperHitBall: {
        const toucher = e.a;
        const team = w.team[toucher];
        const isKeeper = e.kind === SimEventKind.KeeperHitBall;
        const afterKeeperSave = m.lastTouchWasDefenderKeeper;

        m.lastTouchTeam = team;
        m.lastDeflectorWasDefender = team !== m.attackerTeam;
        m.lastTouchWasDefenderKeeper = isKeeper && team !== m.attackerTeam;

        if (team === m.attackerTeam) {
          if (toucher === m.lastFlickedBody) {
            m.touchedBallThisFlick = true;
            // FISTF 6.2.1 — each attacking touch earns the defender a block-flick.
            if (cfg.blockFlickEnabled) m.blockFlickOwed = true;
          } else if (isKeeper) {
            // FISTF 8.1.3 — a keeper's touch is playing the ball like any
            // other, so the attacker's own keeper both renews the allowance
            // and earns the defender a block-flick under 8.1.4.
            m.flicksOnCurrentFigure = 0;
            if (cfg.blockFlickEnabled) m.blockFlickOwed = true;
          } else {
            // FISTF 5.2.1b — the ball touching another attacking figure
            // renews the flicked figure's allowance.
            m.flicksOnCurrentFigure = 0;
            // FISTF 8.1.4 remark 2 — a block-flick earned by the defender's
            // own keeper is withdrawn if the ball then strikes an attacking
            // figure. The defender has had their deflection; play goes on.
            if (afterKeeperSave) m.blockFlickOwed = false;
          }
        } else if (isKeeper || (e.meta & META_A_STATIONARY) !== 0) {
          // FISTF 5.1.2b — only a *stationary* defending figure, or the
          // defender's goalkeeper, takes possession. A moving one does not.
          m.possessionLost = true;

          // FISTF 8.1.4 — every touch by the goalkeeper, "even when the
          // goalkeeper simply deflects a shot", allows the defender a
          // block-flick. Saving and then clearing is one of the sequences the
          // game would otherwise be missing entirely.
          if (isKeeper && cfg.blockFlickEnabled) m.blockFlickOwed = true;
        }
        break;
      }

      case SimEventKind.BallEnteredGoal:
        m.pending = Pending.Goal;
        m.pendingSide = e.b;
        m.restartX = e.x;
        m.restartY = e.y;
        break;

      case SimEventKind.BallOutGoalLine:
        m.pending = Pending.OutGoalLine;
        m.pendingSide = e.b;
        m.restartX = e.x;
        m.restartY = e.y;
        break;

      case SimEventKind.BallOutTouchline:
        m.pending = Pending.OutTouchline;
        m.pendingSide = e.b;
        m.restartX = e.x;
        m.restartY = e.y;
        break;

      default:
        break;
    }
  }
}

function award(m: MatchState, kind: RestartKind, team: number): void {
  m.restartKind = kind;
  m.restartTeam = team;
  m.phase = Phase.Restart;
}

/** FISTF 5.1.2 — decide whether the attacker keeps the ball. */
function resolvePossession(m: MatchState): void {
  const keeps = m.touchedBallThisFlick && !m.possessionLost;
  if (!keeps) {
    m.attackerTeam = 1 - m.attackerTeam;
    m.lastFlickedBody = -1;
    m.flicksOnCurrentFigure = 0;
  }
  m.touchedBallThisFlick = false;
  m.possessionLost = false;
  m.lastTouchWasDefenderKeeper = false;
  m.phase = Phase.AwaitAttackFlick;
}

/** Called once the world has come to rest. Decides what happens next. */
export function onSettled(m: MatchState, w: World, cfg: RulesetConfig): void {
  switch (m.pending) {
    case Pending.Goal: {
      const valid = !cfg.shootingAreaRequired || m.ballWasShootableAtShot;
      if (valid) {
        // The ball crossed the line on side `pendingSide`; that side's owner concedes.
        const scorer = m.pendingSide === 1 ? 0 : 1;
        if (scorer === 0) m.score0++;
        else m.score1++;
        m.restartTeam = 1 - scorer;
        m.restartKind = RestartKind.FlickOff;
        m.celebrationSteps = cfg.goalCelebrationSteps;
        m.phase = Phase.GoalScored;
      } else {
        // FISTF 7.2.1 — a goal not scored per 7.1 becomes a goal-flick.
        award(m, RestartKind.GoalFlick, m.pendingSide === 1 ? 1 : 0);
      }
      m.pending = Pending.None;
      return;
    }

    case Pending.OutGoalLine: {
      const defendingTeam = m.pendingSide === 1 ? 1 : 0;

      // FISTF 16.1.1.1 — a deflection off a defending figure or the defending
      // goalkeeper forces a corner, but only for a ball played from inside the
      // shooting-area. FISTF 8.1.3 is the same rule read from the other end: a
      // keeper deflecting an *irregular* shot behind gives a goal-flick to its
      // own player, not a corner to the attacker.
      //
      // 16.1.1.1 also requires an outfield deflector to have been completely
      // inside the shooting-area. Where the deflector stood is not recorded
      // yet, so that half of the condition is still missing.
      const regularShot = !cfg.shootingAreaRequired || m.ballWasShootableAtShot;
      if (cfg.cornerFlicksEnabled && m.lastDeflectorWasDefender && regularShot) {
        award(m, RestartKind.CornerFlick, 1 - defendingTeam);
      } else {
        award(m, RestartKind.GoalFlick, defendingTeam);
      }
      m.pending = Pending.None;
      return;
    }

    case Pending.OutTouchline: {
      // FISTF 14.1.1 — awarded to whoever did *not* touch it last.
      const to = m.lastTouchTeam === NO_TEAM ? 1 - m.attackerTeam : 1 - m.lastTouchTeam;
      award(m, RestartKind.FlickIn, to);
      m.pending = Pending.None;
      return;
    }

    default:
      break;
  }

  if (m.blockFlickOwed && cfg.blockFlickEnabled) {
    m.phase = Phase.BlockFlickOffered;
    return;
  }
  resolvePossession(m);
}

export { Pending };
