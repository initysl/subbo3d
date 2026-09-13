import * as C from "./constants";
import { SimEventBuffer } from "./events";
import {
  BALL,
  BODY_COUNT,
  BodyKind,
  FLAG_ACTIVE,
  FLAG_ASLEEP,
  KEEPER_A,
  KEEPER_B,
  OUTFIELD_PER_TEAM,
  SPARE_KEEPER_A,
  SPARE_KEEPER_B,
  TEAM_A,
  TEAM_A_FIRST,
  TEAM_B,
  TEAM_B_FIRST,
  TEAM_NONE,
} from "./types";

/**
 * The simulation world: struct-of-arrays, fixed capacity, zero allocation
 * after construction.
 *
 * Float64Array throughout. Doubles are exactly specified in JavaScript, so two
 * machines running the same inputs produce bit-identical arrays — which is the
 * whole basis for replays and, later, online lockstep.
 */
export interface World {
  /** Steps elapsed. Also the simulation's only notion of time. */
  step: number;

  px: Float64Array;
  py: Float64Array;
  /** Height above the felt. Only the ball ever leaves zero. */
  pz: Float64Array;

  vx: Float64Array;
  vy: Float64Array;
  vz: Float64Array;

  /** Scalar spin about the vertical axis. Ball only. */
  spin: Float64Array;

  radius: Float64Array;
  invMass: Float64Array;
  kind: Uint8Array;
  team: Uint8Array;
  flags: Uint8Array;
  sleepSteps: Uint8Array;

  /**
   * Positions at the end of the previous step, kept purely so the renderer can
   * interpolate. Never read by the simulation itself.
   */
  prevX: Float64Array;
  prevY: Float64Array;
  prevZ: Float64Array;

  /** Loft carried by a figure from its flick until it next strikes the ball. */
  pendingLoft: Float64Array;

  events: SimEventBuffer;
}

function f64(): Float64Array {
  return new Float64Array(BODY_COUNT);
}

export function createWorld(): World {
  const w: World = {
    step: 0,
    px: f64(),
    py: f64(),
    pz: f64(),
    vx: f64(),
    vy: f64(),
    vz: f64(),
    spin: f64(),
    radius: f64(),
    invMass: f64(),
    kind: new Uint8Array(BODY_COUNT),
    team: new Uint8Array(BODY_COUNT),
    flags: new Uint8Array(BODY_COUNT),
    sleepSteps: new Uint8Array(BODY_COUNT),
    prevX: f64(),
    prevY: f64(),
    prevZ: f64(),
    pendingLoft: f64(),
    events: new SimEventBuffer(),
  };

  w.kind[BALL] = BodyKind.Ball;
  w.team[BALL] = TEAM_NONE;
  w.radius[BALL] = C.BALL_RADIUS;
  w.invMass[BALL] = 1 / C.BALL_MASS;
  w.flags[BALL] = FLAG_ACTIVE;

  for (let i = 0; i < OUTFIELD_PER_TEAM; i++) {
    for (const [first, team] of [
      [TEAM_A_FIRST, TEAM_A],
      [TEAM_B_FIRST, TEAM_B],
    ] as const) {
      const b = first + i;
      w.kind[b] = BodyKind.Figure;
      w.team[b] = team;
      w.radius[b] = C.BASE_RADIUS;
      w.invMass[b] = 1 / C.BASE_MASS;
      w.flags[b] = FLAG_ACTIVE;
    }
  }

  for (const [k, team] of [
    [KEEPER_A, TEAM_A],
    [KEEPER_B, TEAM_B],
  ] as const) {
    w.kind[k] = BodyKind.Keeper;
    w.team[k] = team;
    w.radius[k] = C.KEEPER_RADIUS;
    w.invMass[k] = 1 / C.KEEPER_MASS;
    w.flags[k] = FLAG_ACTIVE;
  }

  // Spare-goalkeepers (FISTF 4.2, Rule 9). Present in the body layout so their
  // indices are fixed forever, but inactive until Rule 9 is implemented.
  for (const [k, team] of [
    [SPARE_KEEPER_A, TEAM_A],
    [SPARE_KEEPER_B, TEAM_B],
  ] as const) {
    w.kind[k] = BodyKind.Keeper;
    w.team[k] = team;
    w.radius[k] = C.KEEPER_RADIUS;
    w.invMass[k] = 1 / C.KEEPER_MASS;
    w.flags[k] = 0;
  }

  return w;
}

/**
 * Copy `src` into `dst` without allocating. Used for the aim preview and, in
 * M2, for the AI's forward search — both of which run the real solver on a
 * scratch world rather than approximating it.
 */
export function copyWorld(dst: World, src: World): void {
  dst.step = src.step;
  dst.px.set(src.px);
  dst.py.set(src.py);
  dst.pz.set(src.pz);
  dst.vx.set(src.vx);
  dst.vy.set(src.vy);
  dst.vz.set(src.vz);
  dst.spin.set(src.spin);
  dst.radius.set(src.radius);
  dst.invMass.set(src.invMass);
  dst.kind.set(src.kind);
  dst.team.set(src.team);
  dst.flags.set(src.flags);
  dst.sleepSteps.set(src.sleepSteps);
  dst.prevX.set(src.prevX);
  dst.prevY.set(src.prevY);
  dst.prevZ.set(src.prevZ);
  dst.pendingLoft.set(src.pendingLoft);
  dst.events.clear();
}

export function cloneWorld(src: World): World {
  const dst = createWorld();
  copyWorld(dst, src);
  return dst;
}

/** True once every active body has come to rest. */
export function isSettled(w: World): boolean {
  for (let i = 0; i < BODY_COUNT; i++) {
    if ((w.flags[i] & FLAG_ACTIVE) === 0) continue;
    if ((w.flags[i] & FLAG_ASLEEP) === 0) return false;
  }
  return true;
}

/** Hard-stop every body. Used by the settle timeout. */
export function freezeAll(w: World): void {
  for (let i = 0; i < BODY_COUNT; i++) {
    w.vx[i] = 0;
    w.vy[i] = 0;
    w.vz[i] = 0;
    w.spin[i] = 0;
    w.flags[i] |= FLAG_ASLEEP;
  }
}

export function wakeBody(w: World, i: number): void {
  w.flags[i] &= ~FLAG_ASLEEP;
  w.sleepSteps[i] = 0;
}
