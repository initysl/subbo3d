import { applyFlick, quantizeFlick, type FlickCommand } from "@/lib/sim/input";
import { createRng, nextFloat, nextSigned, nextUint32 } from "@/lib/sim/rng";
import { OUTFIELD_PER_TEAM, TEAM_A_FIRST } from "@/lib/sim/types";
import type { World } from "@/lib/sim/world";

/** Steps allowed for each flick to play out in the golden match. */
export const GOLDEN_STEPS_PER_FLICK = 600;
export const GOLDEN_FLICKS = 24;
export const GOLDEN_SEED = 20260913;

/**
 * A fixed sequence of flicks, generated from a seeded PRNG so the fixture is
 * reproducible without committing a large data file. This is the input log
 * that the determinism test replays.
 */
export function goldenCommands(): FlickCommand[] {
  const rng = createRng(GOLDEN_SEED);
  const out: FlickCommand[] = [];
  for (let i = 0; i < GOLDEN_FLICKS; i++) {
    out.push(
      quantizeFlick(
        TEAM_A_FIRST + (nextUint32(rng) % (OUTFIELD_PER_TEAM * 2)),
        nextSigned(rng),
        nextSigned(rng),
        0.25 + nextFloat(rng) * 0.75,
        nextFloat(rng) < 0.25 ? nextFloat(rng) : 0,
      ),
    );
  }
  return out;
}

export function applyGoldenFlick(w: World, cmds: readonly FlickCommand[], index: number): void {
  applyFlick(w, cmds[index]);
}
