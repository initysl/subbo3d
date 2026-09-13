import { describe, expect, it } from "vitest";
import * as C from "@/lib/sim/constants";
import { setKickoffFormation } from "@/lib/sim/formation";
import { applyFlick, quantizeFlick } from "@/lib/sim/input";
import { createRng, nextFloat, nextSigned, nextUint32 } from "@/lib/sim/rng";
import { step } from "@/lib/sim/step";
import { OUTFIELD_PER_TEAM, TEAM_A_FIRST } from "@/lib/sim/types";
import { createWorld } from "@/lib/sim/world";

/**
 * Simulation throughput.
 *
 * Several architectural decisions depend on the simulation being cheap:
 * running the real solver forward to draw a true aim preview, and, in M2, an
 * AI that searches candidate flicks in a worker. If this number collapses,
 * those features stop being affordable — so it is asserted, not just measured.
 *
 * At ~55,000 steps/s the game loop costs about 0.07 ms per frame (four steps),
 * which is negligible. A 90-step aim preview costs ~1.6 ms, so it should be
 * recomputed when the aim changes rather than every frame. The M2 AI is the
 * real constraint: ~480 steps per candidate means a few hundred candidates
 * takes seconds, so candidate count is the difficulty knob and the search must
 * live in a worker.
 */
describe("throughput", () => {
  it("steps far faster than real time", { timeout: 60_000 }, () => {
    const w = createWorld();
    setKickoffFormation(w);
    const rng = createRng(99);

    const TOTAL = 200_000;
    const started = performance.now();

    for (let i = 0; i < TOTAL; i++) {
      // Keep the world busy; an idle world of sleeping bodies is not a
      // meaningful benchmark.
      if (i % 400 === 0) {
        applyFlick(
          w,
          quantizeFlick(
            TEAM_A_FIRST + (nextUint32(rng) % (OUTFIELD_PER_TEAM * 2)),
            nextSigned(rng),
            nextSigned(rng),
            0.4 + nextFloat(rng) * 0.6,
            0,
          ),
        );
      }
      step(w);
    }

    const elapsedMs = performance.now() - started;
    const stepsPerSecond = (TOTAL / elapsedMs) * 1000;
    const realtimeFactor = stepsPerSecond / (1 / C.DT);

    console.info(
      `sim throughput: ${Math.round(stepsPerSecond).toLocaleString()} steps/s ` +
        `(${Math.round(realtimeFactor)}x real time)`,
    );

    // Measured at roughly 55,000 steps/s (about 230x real time) on the
    // development machine. The floor is set well below that so the test
    // catches a genuine regression rather than failing on slower CI hardware.
    expect(stepsPerSecond).toBeGreaterThan(20_000);
  });
});
