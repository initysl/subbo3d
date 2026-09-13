import { describe, expect, it } from "vitest";
import * as C from "@/lib/sim/constants";
import { applyFriction } from "@/lib/sim/friction";
import { BALL, TEAM_A_FIRST } from "@/lib/sim/types";
import { createWorld } from "@/lib/sim/world";
import { setKickoffFormation } from "@/lib/sim/formation";

describe("applyFriction", () => {
  it("removes exactly the Coulomb plus viscous amount in one step", () => {
    const w = createWorld();
    setKickoffFormation(w);
    const i = TEAM_A_FIRST;
    const v0 = 1.5;
    w.vx[i] = v0;

    applyFriction(w, C.DT);

    const expected = v0 - (C.MU_BASE * C.GRAVITY + C.K_VISC_BASE * v0) * C.DT;
    expect(w.vx[i]).toBeCloseTo(expected, 12);
  });

  it("brings a body to rest without ever reversing it", () => {
    const w = createWorld();
    setKickoffFormation(w);
    const i = TEAM_A_FIRST;
    w.vx[i] = 0.001;

    // A step far larger than any real one would overshoot a naive implementation.
    applyFriction(w, 1.0);

    expect(w.vx[i]).toBe(0);
  });

  it("decelerates the ball more gently than a figure", () => {
    const w = createWorld();
    setKickoffFormation(w);
    w.vx[BALL] = 1;
    w.vx[TEAM_A_FIRST] = 1;

    applyFriction(w, C.DT);

    expect(w.vx[BALL]).toBeGreaterThan(w.vx[TEAM_A_FIRST]);
  });

  it("leaves a ball in flight untouched", () => {
    const w = createWorld();
    setKickoffFormation(w);
    w.vx[BALL] = 1;
    w.pz[BALL] = 0.05;

    applyFriction(w, C.DT);

    expect(w.vx[BALL]).toBe(1);
  });

  it("decelerates a figure at constant rate, independent of speed", () => {
    // The defining property of dry Coulomb friction, and the reason a flicked
    // figure stops crisply instead of crawling. Measured with the viscous term
    // subtracted back out.
    const w = createWorld();
    setKickoffFormation(w);
    const i = TEAM_A_FIRST;

    const decelAt = (v: number) => {
      w.vx[i] = v;
      w.vy[i] = 0;
      applyFriction(w, C.DT);
      const lost = (v - w.vx[i]) / C.DT;
      return lost - C.K_VISC_BASE * v;
    };

    expect(decelAt(2.0)).toBeCloseTo(C.MU_BASE * C.GRAVITY, 9);
    expect(decelAt(0.5)).toBeCloseTo(C.MU_BASE * C.GRAVITY, 9);
  });
});
