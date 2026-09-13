import { describe, expect, it } from "vitest";
import * as C from "@/lib/sim/constants";
import { setKickoffFormation } from "@/lib/sim/formation";
import { applyFlick, quantizeFlick } from "@/lib/sim/input";
import { createRng, nextFloat, nextSigned, nextUint32 } from "@/lib/sim/rng";
import { step } from "@/lib/sim/step";
import { BALL, BODY_COUNT, OUTFIELD_PER_TEAM, TEAM_A_FIRST } from "@/lib/sim/types";
import { createWorld, isSettled, type World } from "@/lib/sim/world";

/**
 * Game-feel benchmarks.
 *
 * These are not correctness tests — the solver can be perfectly correct and
 * still no fun. They pin the handful of measurable properties that decide
 * whether the game plays like Subbuteo, so that tuning one constant cannot
 * quietly wreck the balance of another.
 *
 * The bounds are deliberately wide. They are a guard against regression, not a
 * substitute for playing it: anything inside them still has to be judged by
 * hand in the debug lab.
 */

const F = TEAM_A_FIRST;

function isolate(w: World, keep: readonly number[]): void {
  for (let i = 0; i < BODY_COUNT; i++) {
    if (!keep.includes(i)) w.flags[i] = 0;
  }
}

function runToRest(w: World): number {
  let steps = 0;
  while (!isSettled(w) && steps < C.SETTLE_TIMEOUT_STEPS) {
    step(w);
    steps++;
  }
  return steps;
}

/** Total distance each body actually travels, not straight-line displacement. */
function strike(power: number): { figure: number; ball: number } {
  const w = createWorld();
  setKickoffFormation(w);
  isolate(w, [F, BALL]);
  // Start near one end so the ball has the length of the pitch to run into.
  w.px[BALL] = -C.HALF_LENGTH + 0.06;
  w.py[BALL] = 0;
  w.px[F] = w.px[BALL] - (C.BASE_RADIUS + C.BALL_RADIUS + 0.03);
  w.py[F] = 0;

  let ball = 0;
  let figure = 0;
  applyFlick(w, quantizeFlick(F, 1, 0, power, 0));

  for (let s = 0; s < C.SETTLE_TIMEOUT_STEPS && !isSettled(w); s++) {
    const bx = w.px[BALL];
    const by = w.py[BALL];
    const fx = w.px[F];
    const fy = w.py[F];
    step(w);
    ball += Math.hypot(w.px[BALL] - bx, w.py[BALL] - by);
    figure += Math.hypot(w.px[F] - fx, w.py[F] - fy);
  }
  return { figure, ball };
}

describe("game feel", () => {
  it("sends a max-power flick roughly two thirds of the pitch", () => {
    // Far enough that a flick matters, short enough that the pitch still feels
    // big and positioning is worth something.
    const w = createWorld();
    setKickoffFormation(w);
    isolate(w, [F]);
    w.px[F] = -C.HALF_LENGTH + 0.05;
    w.py[F] = 0;

    const x0 = w.px[F];
    applyFlick(w, quantizeFlick(F, 1, 0, 1, 0));
    runToRest(w);

    const fraction = (w.px[F] - x0) / C.PITCH_LENGTH;
    expect(fraction).toBeGreaterThan(0.5);
    expect(fraction).toBeLessThan(0.75);
  });

  it("sends the ball meaningfully further than the figure that struck it", () => {
    // If the ball barely outruns the figure the game is a shoving match; if it
    // outruns it enormously, every touch is a wild clearance.
    for (const power of [0.5, 1.0]) {
      const { figure, ball } = strike(power);
      const ratio = ball / figure;
      expect(ratio).toBeGreaterThan(2);
      expect(ratio).toBeLessThan(3.5);
    }
  });

  it("keeps a full-power strike inside the pitch", () => {
    // A hard shot should be a powerful clearance, not something that crosses
    // the whole pitch — otherwise position and passing stop mattering.
    const { ball } = strike(1.0);
    expect(ball).toBeLessThan(C.PITCH_LENGTH * 0.85);
  });

  it("settles turns quickly enough to keep the game moving", () => {
    // Long settles kill pacing more than anything else, so this guards the
    // distribution rather than a single case.
    const times: number[] = [];
    for (let seed = 1; seed <= 200; seed++) {
      const w = createWorld();
      setKickoffFormation(w);
      const rng = createRng(seed);
      const body = TEAM_A_FIRST + (nextUint32(rng) % (OUTFIELD_PER_TEAM * 2));
      applyFlick(
        w,
        quantizeFlick(body, nextSigned(rng), nextSigned(rng), 0.2 + nextFloat(rng) * 0.8, 0),
      );
      times.push(runToRest(w) * C.DT);
    }
    times.sort((a, b) => a - b);

    expect(times[Math.floor(times.length * 0.5)]).toBeLessThan(1.0);
    expect(times[times.length - 1]).toBeLessThan(2.0);
  });
});
