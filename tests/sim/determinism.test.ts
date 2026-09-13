import { describe, expect, it } from "vitest";
import { setKickoffFormation } from "@/lib/sim/formation";
import { applyFlick } from "@/lib/sim/input";
import { hashWorld } from "@/lib/sim/snapshot";
import { step } from "@/lib/sim/step";
import { cloneWorld, createWorld, type World } from "@/lib/sim/world";
import { GOLDEN_FLICKS, GOLDEN_STEPS_PER_FLICK, goldenCommands } from "@/tests/fixtures/golden";

/** Play the golden input log, recording a hash at four checkpoints. */
function playGolden(marksAt: readonly number[]): number[] {
  const w = createWorld();
  setKickoffFormation(w);
  const cmds = goldenCommands();
  const marks: number[] = [];

  for (let f = 0; f < GOLDEN_FLICKS; f++) {
    applyFlick(w, cmds[f]);
    for (let s = 0; s < GOLDEN_STEPS_PER_FLICK; s++) step(w);
    if (marksAt.includes(f)) marks.push(hashWorld(w));
  }
  return marks;
}

const CHECKPOINTS = [0, 5, 11, GOLDEN_FLICKS - 1];

/**
 * Committed state hashes for the golden input log.
 *
 * These are not arbitrary: they pin the exact numerical behaviour of the
 * solver. Any change to the physics, the constants, the order of collision
 * resolution, or the input quantisation will change them.
 *
 * If this test fails, that is the point of it. Do not regenerate these values
 * to make the suite green — work out which change moved them, satisfy yourself
 * it was intended, and then update them in a commit that says so.
 */
const GOLDEN_HASHES = [0x1fa22516, 0xb5c0ef07, 0x6e3aac98, 0xc9475277];

describe("determinism", () => {
  it("produces identical hashes for two runs of the same input log", () => {
    expect(playGolden(CHECKPOINTS)).toEqual(playGolden(CHECKPOINTS));
  });

  it("continues identically from a cloned world", () => {
    const a = createWorld();
    setKickoffFormation(a);
    const cmds = goldenCommands();

    applyFlick(a, cmds[0]);
    for (let s = 0; s < 120; s++) step(a);

    // Fork here: the clone must track the original exactly from this point on,
    // which is what makes replay and, later, rollback-free lockstep safe.
    const b = cloneWorld(a);
    for (let f = 1; f < 6; f++) {
      applyFlick(a, cmds[f]);
      applyFlick(b, cmds[f]);
      for (let s = 0; s < GOLDEN_STEPS_PER_FLICK; s++) {
        step(a);
        step(b);
      }
      expect(hashWorld(b)).toBe(hashWorld(a));
    }
  });

  it("matches the committed golden hashes", () => {
    expect(playGolden(CHECKPOINTS)).toEqual(GOLDEN_HASHES);
  });

  it("is sensitive to a one-bit change in the input", () => {
    // A hash that never changes proves nothing. Perturbing the smallest
    // quantised unit of the first flick must change the outcome.
    const run = (bump: number): number => {
      const w: World = createWorld();
      setKickoffFormation(w);
      const cmds = goldenCommands();
      applyFlick(w, { ...cmds[0], power: cmds[0].power + bump });
      for (let s = 0; s < GOLDEN_STEPS_PER_FLICK; s++) step(w);
      return hashWorld(w);
    };
    expect(run(1)).not.toBe(run(0));
  });
});
