import { describe, expect, it } from "vitest";
import * as C from "@/lib/sim/constants";
import { setKickoffFormation } from "@/lib/sim/formation";
import { applyFlick, quantizeFlick } from "@/lib/sim/input";
import { createRng, nextFloat, nextSigned, nextUint32 } from "@/lib/sim/rng";
import { totalEnergy } from "@/lib/sim/snapshot";
import { step } from "@/lib/sim/step";
import {
  BALL,
  BODY_COUNT,
  BodyKind,
  FLAG_OUT_OF_PLAY,
  OUTFIELD_PER_TEAM,
  TEAM_A_FIRST,
} from "@/lib/sim/types";
import { createWorld, isSettled, type World } from "@/lib/sim/world";

const POSTS: ReadonlyArray<readonly [number, number]> = [
  [-C.HALF_LENGTH, -C.GOAL_WIDTH / 2],
  [-C.HALF_LENGTH, C.GOAL_WIDTH / 2],
  [C.HALF_LENGTH, -C.GOAL_WIDTH / 2],
  [C.HALF_LENGTH, C.GOAL_WIDTH / 2],
];

function inPlay(w: World, i: number): boolean {
  return (w.flags[i] & FLAG_OUT_OF_PLAY) === 0;
}

function blockHeight(kind: number): number {
  return kind === BodyKind.Keeper ? C.KEEPER_BLOCK_HEIGHT : C.FIGURE_BLOCK_HEIGHT;
}

/**
 * The checks below return a message rather than asserting directly.
 *
 * They run on every body pair of every step of every seed — hundreds of
 * thousands of times — and an assertion library call per pair is orders of
 * magnitude more expensive than the simulation it is checking. Returning the
 * first violation keeps the suite fast and reports exactly the same failures.
 */

/**
 * The solver resolves contacts at their exact time of impact, so bodies should
 * never interpenetrate at all. Any violation means the event budget was
 * exhausted or a time-of-impact query is wrong.
 */
function findOverlap(w: World): string | null {
  for (let i = 0; i < BODY_COUNT; i++) {
    if (!inPlay(w, i)) continue;
    for (let j = i + 1; j < BODY_COUNT; j++) {
      if (!inPlay(w, j)) continue;

      // A lofted ball is deliberately allowed to pass over a figure.
      if (i === BALL || j === BALL) {
        const other = i === BALL ? j : i;
        if (w.pz[BALL] >= blockHeight(w.kind[other])) continue;
      }

      const dx = w.px[j] - w.px[i];
      const dy = w.py[j] - w.py[i];
      const sumR = w.radius[i] + w.radius[j];
      if (dx * dx + dy * dy <= sumR * sumR - 1e-9) {
        return `bodies ${i} and ${j} overlap at step ${w.step}`;
      }
    }
  }
  return null;
}

function findNonFinite(w: World): string | null {
  for (let i = 0; i < BODY_COUNT; i++) {
    const vals = [w.px[i], w.py[i], w.pz[i], w.vx[i], w.vy[i], w.vz[i]];
    for (const v of vals) {
      if (!Number.isFinite(v)) return `body ${i} non-finite at step ${w.step}`;
    }
  }
  return null;
}

function findOutOfBounds(w: World): string | null {
  for (let i = 0; i < BODY_COUNT; i++) {
    if (!inPlay(w, i)) continue;
    if (Math.abs(w.px[i]) > C.HALF_LENGTH + 1e-6) {
      return `body ${i} past the end line at step ${w.step}`;
    }
    if (Math.abs(w.py[i]) > C.HALF_WIDTH + 1e-6) {
      return `body ${i} past the touchline at step ${w.step}`;
    }
  }
  return null;
}

function findPostOverlap(w: World): string | null {
  for (let i = 0; i < BODY_COUNT; i++) {
    if (!inPlay(w, i)) continue;
    for (const [px, py] of POSTS) {
      const dx = w.px[i] - px;
      const dy = w.py[i] - py;
      const sumR = w.radius[i] + C.POST_RADIUS;
      if (dx * dx + dy * dy <= sumR * sumR - 1e-9) {
        return `body ${i} inside a post at step ${w.step}`;
      }
    }
  }
  return null;
}

/** Apply a pseudo-random legal flick and return the body that was flicked. */
function randomFlick(w: World, rng: ReturnType<typeof createRng>, loft: number): number {
  const body = TEAM_A_FIRST + (nextUint32(rng) % (OUTFIELD_PER_TEAM * 2));
  applyFlick(
    w,
    quantizeFlick(body, nextSigned(rng), nextSigned(rng), 0.2 + nextFloat(rng) * 0.8, loft),
  );
  return body;
}

describe("simulation invariants", () => {
  it("never interpenetrates, leaves the pitch, or produces NaN", { timeout: 120_000 }, () => {
    for (let seed = 1; seed <= 40; seed++) {
      const w = createWorld();
      setKickoffFormation(w);
      const rng = createRng(seed);

      for (let turn = 0; turn < 8; turn++) {
        randomFlick(w, rng, 0);

        for (let s = 0; s < C.SETTLE_TIMEOUT_STEPS; s++) {
          step(w);
          const violation =
            findNonFinite(w) ?? findOverlap(w) ?? findOutOfBounds(w) ?? findPostOverlap(w);
          if (violation !== null) {
            throw new Error(`seed ${seed} turn ${turn}: ${violation}`);
          }
          if (isSettled(w)) break;
        }
      }
    }
  });

  it("always settles within the timeout", { timeout: 60_000 }, () => {
    for (let seed = 1; seed <= 40; seed++) {
      const w = createWorld();
      setKickoffFormation(w);
      const rng = createRng(seed);

      for (let turn = 0; turn < 6; turn++) {
        randomFlick(w, rng, nextFloat(rng));

        let steps = 0;
        while (!isSettled(w) && steps < C.SETTLE_TIMEOUT_STEPS) {
          step(w);
          steps++;
        }
        expect(steps).toBeLessThan(C.SETTLE_TIMEOUT_STEPS);
      }
    }
  });

  it("never gains mechanical energy between flicks", { timeout: 120_000 }, () => {
    // The single highest-value assertion in the suite: it catches sign errors
    // in the impulse math, restitution above one, and friction that adds
    // energy instead of removing it. Loft is excluded because the chip
    // deliberately injects vertical velocity at contact.
    for (let seed = 1; seed <= 25; seed++) {
      const w = createWorld();
      setKickoffFormation(w);
      const rng = createRng(seed);

      for (let turn = 0; turn < 5; turn++) {
        randomFlick(w, rng, 0);

        let prev = totalEnergy(w, C.GRAVITY);
        for (let s = 0; s < C.SETTLE_TIMEOUT_STEPS; s++) {
          step(w);
          const now = totalEnergy(w, C.GRAVITY);
          expect(now).toBeLessThanOrEqual(prev + 1e-9);
          prev = now;
          if (isSettled(w)) break;
        }
      }
    }
  });

  it("comes to a complete stop when settled", () => {
    const w = createWorld();
    setKickoffFormation(w);
    const rng = createRng(7);
    randomFlick(w, rng, 0);

    while (!isSettled(w)) step(w);

    for (let i = 0; i < BODY_COUNT; i++) {
      expect(w.vx[i]).toBe(0);
      expect(w.vy[i]).toBe(0);
      expect(w.vz[i]).toBe(0);
    }
  });
});
