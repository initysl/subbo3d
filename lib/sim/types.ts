/** Body kinds. Stored in a Uint8Array, so these are plain numbers. */
export const enum BodyKind {
  Ball = 0,
  Figure = 1,
  Keeper = 2,
}

/** Body flag bits. */
export const FLAG_ACTIVE = 1 << 0;
export const FLAG_ASLEEP = 1 << 1;
export const FLAG_OUT_OF_PLAY = 1 << 2;

export const TEAM_A = 0;
export const TEAM_B = 1;
export const TEAM_NONE = 255;

/**
 * Canonical body layout. These indices are part of the wire format: a flick
 * command names a body by index, so both peers must agree on what index 7 is.
 * Never reorder.
 */
export const BALL = 0;
export const OUTFIELD_PER_TEAM = 10;
export const TEAM_A_FIRST = 1;
export const TEAM_B_FIRST = TEAM_A_FIRST + OUTFIELD_PER_TEAM;
export const KEEPER_A = TEAM_B_FIRST + OUTFIELD_PER_TEAM;
export const KEEPER_B = KEEPER_A + 1;
/**
 * FISTF 4.2: each player uses ten field figures, one goalkeeper *and one
 * spare-goalkeeper*.
 *
 * The spare-goalkeeper is not playable until Rule 9 is implemented, so these
 * bodies start inactive. Their indices are reserved now because body indices
 * are part of the wire format — renumbering them later would silently
 * invalidate every recorded match and desync any online game.
 */
export const SPARE_KEEPER_A = KEEPER_B + 1;
export const SPARE_KEEPER_B = SPARE_KEEPER_A + 1;
export const BODY_COUNT = SPARE_KEEPER_B + 1;

/** Kinds of contact the solver can report. */
export const enum ContactKind {
  BodyBody = 0,
  Wall = 1,
  Post = 2,
}

/** Events emitted by the simulation for the rules, audio and effects layers. */
export const enum SimEventKind {
  FigureHitBall = 0,
  FigureHitFigure = 1,
  BallHitWall = 2,
  BallHitPost = 3,
  BallBounce = 4,
  /** Between the posts and under the crossbar — a goal, subject to Rule 7. */
  BallEnteredGoal = 5,
  /** Across a goal-line but not into the goal (FISTF 15/16). */
  BallOutGoalLine = 6,
  /** Across a touchline (FISTF 14). */
  BallOutTouchline = 7,
  KeeperHitBall = 8,
}

/** `meta` bit: body `a` was at rest when the contact happened. */
export const META_A_STATIONARY = 1 << 0;
/** `meta` bit: body `b` was at rest when the contact happened. */
export const META_B_STATIONARY = 1 << 1;

export interface SimEvent {
  kind: SimEventKind;
  /** Primary body index, or -1. */
  a: number;
  /** Secondary body index, or -1. */
  b: number;
  /** Contact impulse magnitude, used to scale audio and effects. */
  impulse: number;
  /** Contact location. */
  x: number;
  y: number;
  z: number;
  /**
   * Bitfield of META_* flags. FISTF 5.1.2b turns on whether the defending
   * figure the ball struck was stationary, so the solver has to record it at
   * the moment of contact — by the time the rules run, velocities have moved on.
   */
  meta: number;
}
