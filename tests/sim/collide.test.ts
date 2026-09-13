import { describe, expect, it } from "vitest";
import { NO_IMPACT, toiCircleCircle, toiWall } from "@/lib/sim/collide";

describe("toiCircleCircle", () => {
  it("finds the exact impact time for a head-on approach", () => {
    // B sits 1.0 to the right of A, closing at 2 m/s, radii summing to 0.2.
    // Surfaces meet after (1.0 - 0.2) / 2 = 0.4 s.
    expect(toiCircleCircle(1, 0, -2, 0, 0.2, 1)).toBeCloseTo(0.4, 12);
  });

  it("reports no impact when the pair is separating", () => {
    expect(toiCircleCircle(1, 0, 2, 0, 0.2, 1)).toBe(NO_IMPACT);
  });

  it("reports no impact when the pair is stationary", () => {
    expect(toiCircleCircle(1, 0, 0, 0, 0.2, 1)).toBe(NO_IMPACT);
  });

  it("reports no impact beyond the time window", () => {
    expect(toiCircleCircle(1, 0, -2, 0, 0.2, 0.3)).toBe(NO_IMPACT);
  });

  it("misses a pair that passes by outside the combined radius", () => {
    // Offset by 0.5 on y, sum of radii 0.2 — they never touch.
    expect(toiCircleCircle(1, 0.5, -2, 0, 0.2, 10)).toBe(NO_IMPACT);
  });

  it("resolves immediately when already overlapping and still closing", () => {
    expect(toiCircleCircle(0.1, 0, -1, 0, 0.2, 1)).toBe(0);
  });

  it("never returns NaN for a grazing approach", () => {
    // Passing at exactly the touching distance is the numerically nastiest case.
    for (let k = -6; k <= 6; k++) {
      const offset = 0.2 + k * 1e-9;
      const t = toiCircleCircle(1, offset, -2, 0, 0.2, 10);
      expect(Number.isNaN(t)).toBe(false);
    }
  });
});

describe("toiWall", () => {
  it("finds the impact time against an upper boundary", () => {
    // At x = 0 moving +1 m/s, wall at 0.5, radius 0.1 → surface at 0.4 → 0.4 s.
    expect(toiWall(0, 1, 0.5, 0.1, 1, 1)).toBeCloseTo(0.4, 12);
  });

  it("finds the impact time against a lower boundary", () => {
    expect(toiWall(0, -1, -0.5, 0.1, -1, 1)).toBeCloseTo(0.4, 12);
  });

  it("reports no impact when moving away from the wall", () => {
    expect(toiWall(0, -1, 0.5, 0.1, 1, 1)).toBe(NO_IMPACT);
  });

  it("reports no impact beyond the time window", () => {
    expect(toiWall(0, 1, 0.5, 0.1, 1, 0.2)).toBe(NO_IMPACT);
  });
});
