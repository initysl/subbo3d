/**
 * Match rules, from the FISTF Sports Rules of Table Football v5.2
 * (`docs/fistf-rules.pdf`). Rule numbers are cited throughout so every
 * decision can be checked against the source.
 */

export const enum Phase {
  /** Before kick-off, and after a goal or half-time. */
  FlickOff = 0,
  /** Waiting for the attacker to flick (FISTF 5.2). */
  AwaitAttackFlick = 1,
  /** The simulation is running out to rest. */
  Resolving = 2,
  /** The defender is owed a block-flick (FISTF 6.2.1). */
  BlockFlickOffered = 3,
  /** A restart has been awarded and is waiting to be taken. */
  Restart = 4,
  /** Celebration window after a goal. */
  GoalScored = 5,
  HalfTime = 6,
  FullTime = 7,
}

export const enum RestartKind {
  None = 0,
  FlickOff = 1,
  /** FISTF 14 — ball crossed a touchline. */
  FlickIn = 2,
  /** FISTF 15 — ball crossed a goal-line, awarded to the defender. */
  GoalFlick = 3,
  /** FISTF 16 — ball crossed a goal-line off a defender. */
  CornerFlick = 4,
}

export const NO_TEAM = 255;

/**
 * How the goalkeeper is placed (FISTF Rule 8).
 *
 * "auto" positions the defending keeper as each attacking flick is committed
 * and holds it there for the resolve — the placement 8.1.2 allows. "manual"
 * hands the same placement to the defending player during the block-flick
 * window. "off" leaves the keeper standing on its spot, which is mainly of
 * use to tests that want the keeper out of the way.
 */
export type KeeperMode = "auto" | "manual" | "off";

export interface MatchState {
  phase: Phase;
  /** The player in possession of the ball (FISTF 5.1.1). */
  attackerTeam: number;

  lastFlickedBody: number;
  /** FISTF 5.2.1 — no figure may play the ball more than three times running. */
  flicksOnCurrentFigure: number;

  /** Did the flicked attacking figure touch the ball? FISTF 5.1.2a. */
  touchedBallThisFlick: boolean;
  /** Did the ball strike a stationary defender or their keeper? FISTF 5.1.2b. */
  possessionLost: boolean;
  /** FISTF 6.2.1 — earned by each attacking touch of the ball. */
  blockFlickOwed: boolean;

  /**
   * FISTF 7.1.1a — a goal counts only if *the ball* was shot from completely
   * inside the opposing shooting-area. Captured when the flick is committed,
   * because by the time the ball crosses the line everything has moved.
   */
  ballWasShootableAtShot: boolean;

  /** Who touched the ball last, for FISTF 14.1.1. */
  lastTouchTeam: number;
  /** Whether that last touch was a defender's, for FISTF 16.1.1. */
  lastDeflectorWasDefender: boolean;

  /**
   * Whether the most recent touch was by the defending goalkeeper.
   *
   * FISTF 8.1.4 remark 2: the block-flick a keeper's touch earns is withdrawn
   * again if the ball then strikes an attacking figure, so the machine has to
   * remember what touched it last.
   */
  lastTouchWasDefenderKeeper: boolean;

  score0: number;
  score1: number;

  /** Elapsed simulation steps in the current half. */
  clockSteps: number;
  /** 1-based. */
  half: number;

  restartKind: RestartKind;
  restartTeam: number;
  restartX: number;
  restartY: number;

  /**
   * What the ball did during the current resolve, recorded as it happens and
   * acted on once everything comes to rest. Values are from the `Pending` enum
   * in machine.ts.
   */
  pending: number;
  /** Which side of the pitch the ball left by: 0 for -x/-y, 1 for +x/+y. */
  pendingSide: number;

  /** Steps left in the goal celebration before the restart. */
  celebrationSteps: number;
}

export interface RulesetConfig {
  id: string;
  /** FISTF 5.2.1. */
  maxFlicksPerFigure: number;
  /** FISTF 6.2. */
  blockFlickEnabled: boolean;
  /** FISTF 7.1.1a. */
  shootingAreaRequired: boolean;
  /** FISTF 14. */
  flickInsEnabled: boolean;
  /** FISTF 15. */
  goalFlicksEnabled: boolean;
  /** FISTF 16. */
  cornerFlicksEnabled: boolean;
  /** FISTF 3.1.1 — two periods of fifteen minutes. */
  halfLengthSteps: number;
  halves: number;
  /** Steps the goal celebration holds before the restart. */
  goalCelebrationSteps: number;
  /** FISTF 8. */
  keeperMode: KeeperMode;
}
