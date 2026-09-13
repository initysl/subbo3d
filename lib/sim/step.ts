import * as C from "./constants";
import { NO_IMPACT, toiCircleCircle, toiWall } from "./collide";
import { applyFriction } from "./friction";
import { updateHeight } from "./height";
import { resolveContact, resolveWall } from "./impulse";
import {
  BALL,
  BODY_COUNT,
  BodyKind,
  FLAG_ACTIVE,
  FLAG_ASLEEP,
  FLAG_OUT_OF_PLAY,
  SimEventKind,
} from "./types";
import type { World } from "./world";

/**
 * THE SIMULATION RATE IS A DETERMINISM INVARIANT.
 *
 * Nothing may ever vary C.DT — not a quality tier, not a slow device, not a
 * slow-motion replay. Render-side interpolation and time scaling are how the
 * presentation layer changes apparent speed. Changing the step rate changes
 * the result, which would break replays and online lockstep.
 */

/** Goal posts, as immovable circles at the mouth of each goal. */
const POST_X = [-C.HALF_LENGTH, -C.HALF_LENGTH, C.HALF_LENGTH, C.HALF_LENGTH];
const POST_Y = [-C.GOAL_WIDTH / 2, C.GOAL_WIDTH / 2, -C.GOAL_WIDTH / 2, C.GOAL_WIDTH / 2];
const POST_COUNT = 4;

const enum ImpactKind {
  None = 0,
  Pair = 1,
  Wall = 2,
  Post = 3,
}

// Scratch for the earliest-impact search. Module-level so the solver never
// allocates; the loop runs thousands of times a second.
let impT = 0;
let impA = -1;
let impB = -1;
let impKind: ImpactKind = ImpactKind.None;
let impNx = 0;
let impNy = 0;

function movable(w: World, i: number): boolean {
  return (w.flags[i] & FLAG_ACTIVE) !== 0 && (w.flags[i] & FLAG_OUT_OF_PLAY) === 0;
}

/** Height above which a body no longer blocks the ball. */
function blockHeight(kind: number): number {
  return kind === BodyKind.Keeper ? C.KEEPER_BLOCK_HEIGHT : C.FIGURE_BLOCK_HEIGHT;
}

/**
 * Find the first contact anywhere in the world within `tMax`.
 *
 * Brute force over all pairs: 23 bodies is 253 pairs, plus walls and posts.
 * A broadphase would save nothing measurable here and would add an
 * ordering-sensitive surface that determinism then has to defend.
 *
 * Iteration order is strictly ascending and ties are broken by first-found,
 * which gives simultaneous events a total order — required for determinism.
 */
function earliestImpact(w: World, tMax: number): boolean {
  impKind = ImpactKind.None;
  impT = tMax;

  // Hoist the typed arrays into locals. Reaching through the World object on
  // every one of the several hundred queries per call is a surprisingly large
  // share of the cost, and this loop is the hottest code in the project.
  const px = w.px;
  const py = w.py;
  const vx = w.vx;
  const vy = w.vy;
  const radius = w.radius;
  const flags = w.flags;

  // Body against body.
  for (let i = 0; i < BODY_COUNT; i++) {
    const fi = flags[i];
    if ((fi & FLAG_ACTIVE) === 0 || (fi & FLAG_OUT_OF_PLAY) !== 0) continue;
    const asleepI = (fi & FLAG_ASLEEP) !== 0;
    const pxi = px[i];
    const pyi = py[i];
    const vxi = vx[i];
    const vyi = vy[i];
    const ri = radius[i];

    for (let j = i + 1; j < BODY_COUNT; j++) {
      const fj = flags[j];
      if ((fj & FLAG_ACTIVE) === 0 || (fj & FLAG_OUT_OF_PLAY) !== 0) continue;
      if (asleepI && (fj & FLAG_ASLEEP) !== 0) continue;

      // Height gating: a lofted ball passes over figures entirely.
      if (i === BALL || j === BALL) {
        const other = i === BALL ? j : i;
        if (w.pz[BALL] >= blockHeight(w.kind[other])) continue;
      }

      const t = toiCircleCircle(
        px[j] - pxi,
        py[j] - pyi,
        vx[j] - vxi,
        vy[j] - vyi,
        ri + radius[j],
        impT,
      );
      if (t !== NO_IMPACT && t < impT) {
        impT = t;
        impA = i;
        impB = j;
        impKind = ImpactKind.Pair;
      }
    }
  }

  // Body against the pitch surround.
  for (let i = 0; i < BODY_COUNT; i++) {
    if (!movable(w, i)) continue;
    if (w.flags[i] & FLAG_ASLEEP) continue;
    const r = w.radius[i];

    for (let axis = 0; axis < 2; axis++) {
      const p = axis === 0 ? w.px[i] : w.py[i];
      const v = axis === 0 ? w.vx[i] : w.vy[i];
      const limit = axis === 0 ? C.HALF_LENGTH : C.HALF_WIDTH;

      for (let s = 0; s < 2; s++) {
        const sign = s === 0 ? 1 : -1;
        const t = toiWall(p, v, limit * sign, r, sign, impT);
        if (t === NO_IMPACT || t >= impT) continue;

        // The goal mouth is a hole in the end wall: a ball heading through it
        // below the crossbar is not deflected, it scores.
        if (axis === 0 && i === BALL) {
          const yAt = w.py[BALL] + w.vy[BALL] * t;
          if (Math.abs(yAt) < C.GOAL_WIDTH / 2 && w.pz[BALL] < C.GOAL_HEIGHT) continue;
        }

        impT = t;
        impA = i;
        impB = -1;
        impKind = ImpactKind.Wall;
        impNx = axis === 0 ? -sign : 0;
        impNy = axis === 0 ? 0 : -sign;
      }
    }
  }

  // Body against a goalpost.
  for (let i = 0; i < BODY_COUNT; i++) {
    if (!movable(w, i)) continue;
    if (w.flags[i] & FLAG_ASLEEP) continue;

    for (let p = 0; p < POST_COUNT; p++) {
      const t = toiCircleCircle(
        POST_X[p] - w.px[i],
        POST_Y[p] - w.py[i],
        -w.vx[i],
        -w.vy[i],
        w.radius[i] + C.POST_RADIUS,
        impT,
      );
      if (t !== NO_IMPACT && t < impT) {
        impT = t;
        impA = i;
        impB = p;
        impKind = ImpactKind.Post;
      }
    }
  }

  return impKind !== ImpactKind.None;
}

function advanceAll(w: World, dt: number): void {
  if (dt <= 0) return;
  for (let i = 0; i < BODY_COUNT; i++) {
    if (!movable(w, i)) continue;
    if (w.flags[i] & FLAG_ASLEEP) continue;
    w.px[i] += w.vx[i] * dt;
    w.py[i] += w.vy[i] * dt;
  }
}

function restitutionFor(ka: number, kb: number): number {
  if (ka === BodyKind.Ball || kb === BodyKind.Ball) return C.E_BASE_BALL;
  return C.E_BASE_BASE;
}

function contactEvent(w: World, a: number, b: number, jn: number): void {
  const ka = w.kind[a];
  const kb = w.kind[b];
  const ballSide = ka === BodyKind.Ball ? a : kb === BodyKind.Ball ? b : -1;

  if (ballSide >= 0) {
    const other = ballSide === a ? b : a;
    const kind =
      w.kind[other] === BodyKind.Keeper ? SimEventKind.KeeperHitBall : SimEventKind.FigureHitBall;
    w.events.emit(kind, other, ballSide, jn, w.px[ballSide], w.py[ballSide], w.pz[ballSide]);
  } else {
    w.events.emit(SimEventKind.FigureHitFigure, a, b, jn, w.px[a], w.py[a], 0);
  }
}

/**
 * Apply the chip. The flicking figure carries a loft value from its command
 * until it next strikes the ball; on contact that becomes vertical velocity.
 *
 * This models the base's bevel riding under the ball. It is frankly a fudge,
 * but it is deterministic, it is one line, and it makes loft something the
 * player aims deliberately rather than something they discover by accident.
 */
function applyLoft(w: World, striker: number, jn: number): void {
  const loft = w.pendingLoft[striker];
  if (loft <= 0) return;
  w.vz[BALL] += C.CHIP_GAIN * loft * jn * w.invMass[BALL];
  w.pendingLoft[striker] = 0;
}

/**
 * Advance every body through `dt`, stopping at each contact in chronological
 * order and resolving it exactly where it happens. Penetration is therefore
 * always zero rather than merely small.
 */
function resolveMotion(w: World, dt: number): void {
  let remaining = dt;

  for (let iter = 0; iter < C.MAX_EVENTS_PER_STEP; iter++) {
    if (!earliestImpact(w, remaining)) {
      advanceAll(w, remaining);
      return;
    }

    advanceAll(w, impT);
    remaining -= impT;

    if (impKind === ImpactKind.Pair) {
      const a = impA;
      const b = impB;
      let nx = w.px[b] - w.px[a];
      let ny = w.py[b] - w.py[a];
      const d = Math.sqrt(nx * nx + ny * ny);
      if (d > 0) {
        nx /= d;
        ny /= d;
      } else {
        // Exactly coincident centres cannot produce a normal. Pick one by
        // index so the choice is reproducible rather than arbitrary.
        nx = 1;
        ny = 0;
      }

      const jn = resolveContact(w, a, b, nx, ny, restitutionFor(w.kind[a], w.kind[b]));
      if (jn > 0) {
        contactEvent(w, a, b, jn);
        if (w.kind[a] === BodyKind.Ball) applyLoft(w, b, jn);
        else if (w.kind[b] === BodyKind.Ball) applyLoft(w, a, jn);
      }
    } else if (impKind === ImpactKind.Wall) {
      const jn = resolveWall(w, impA, impNx, impNy, C.E_WALL);
      if (jn > 0 && impA === BALL) {
        w.events.emit(SimEventKind.BallHitWall, BALL, -1, jn, w.px[BALL], w.py[BALL], w.pz[BALL]);
      }
    } else {
      const i = impA;
      let nx = w.px[i] - POST_X[impB];
      let ny = w.py[i] - POST_Y[impB];
      const d = Math.sqrt(nx * nx + ny * ny);
      if (d > 0) {
        nx /= d;
        ny /= d;
      } else {
        nx = 1;
        ny = 0;
      }
      const jn = resolveWall(w, i, nx, ny, C.E_BALL_POST);
      if (jn > 0 && i === BALL) {
        w.events.emit(SimEventKind.BallHitPost, BALL, impB, jn, w.px[BALL], w.py[BALL], w.pz[BALL]);
      }
    }

    if (remaining <= 0) return;
  }

  // Event budget exhausted. Finish ballistically rather than stalling; with 23
  // circles on an open plane this is not reachable in practice.
  advanceAll(w, remaining);
}

/** Detect the ball leaving play through the goal mouth. */
function checkBallOutOfPlay(w: World): void {
  if (w.flags[BALL] & FLAG_OUT_OF_PLAY) return;
  if (Math.abs(w.px[BALL]) <= C.HALF_LENGTH) return;

  const scored = Math.abs(w.py[BALL]) < C.GOAL_WIDTH / 2 && w.pz[BALL] < C.GOAL_HEIGHT;
  w.events.emit(
    scored ? SimEventKind.BallCrossedGoalLine : SimEventKind.BallLeftPitch,
    BALL,
    w.px[BALL] > 0 ? 1 : 0,
    0,
    w.px[BALL],
    w.py[BALL],
    w.pz[BALL],
  );

  w.flags[BALL] |= FLAG_OUT_OF_PLAY | FLAG_ASLEEP;
  w.vx[BALL] = 0;
  w.vy[BALL] = 0;
  w.vz[BALL] = 0;
}

/**
 * Put slow bodies to sleep, zeroing their velocity.
 *
 * Zeroing rather than merely skipping integration matters: a state hash reads
 * the velocity arrays, so leftover noise in the low bits would show up as a
 * phantom desync.
 */
function updateSleep(w: World): void {
  for (let i = 0; i < BODY_COUNT; i++) {
    if ((w.flags[i] & FLAG_ACTIVE) === 0) continue;
    if (w.flags[i] & FLAG_OUT_OF_PLAY) continue;

    const sp2 = w.vx[i] * w.vx[i] + w.vy[i] * w.vy[i];
    let slow = sp2 < C.REST_SPEED * C.REST_SPEED;
    if (slow && i === BALL) {
      slow = Math.abs(w.vz[i]) < C.REST_VZ && w.pz[i] < C.BALL_AIRBORNE_EPS;
    }

    if (!slow) {
      w.sleepSteps[i] = 0;
      w.flags[i] &= ~FLAG_ASLEEP;
      continue;
    }

    if (w.sleepSteps[i] < 255) w.sleepSteps[i]++;
    if (w.sleepSteps[i] >= C.REST_STEPS) {
      w.flags[i] |= FLAG_ASLEEP;
      w.vx[i] = 0;
      w.vy[i] = 0;
      w.vz[i] = 0;
      w.spin[i] = 0;
    }
  }
}

/** Advance the world by exactly one fixed timestep. */
export function step(w: World): void {
  w.events.clear();
  w.prevX.set(w.px);
  w.prevY.set(w.py);
  w.prevZ.set(w.pz);

  applyFriction(w, C.DT);
  updateHeight(w, C.DT);
  resolveMotion(w, C.DT);
  checkBallOutOfPlay(w);
  updateSleep(w);

  w.step++;
}
