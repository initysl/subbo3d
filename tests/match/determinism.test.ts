import { describe, expect, it } from "vitest";
import { Match } from "@/lib/match/Match";
import { hashMatch } from "@/lib/match/snapshot";
import { ARCADE, FISTF } from "@/lib/rules/presets";
import { Phase } from "@/lib/rules/types";
import { quantizeFlick } from "@/lib/sim/input";
import { createRng, nextFloat, nextSigned, nextUint32 } from "@/lib/sim/rng";
import { BODY_COUNT } from "@/lib/sim/types";

/**
 * Play a scripted match and record a hash at each checkpoint.
 *
 * The hash covers physics *and* match state, so this is what proves the whole
 * deterministic core — possession, flick counts, score, clock included —
 * reproduces exactly. Without it, an online game would desync on match state
 * while the physics looked perfectly healthy.
 */
function playScripted(seed: number, flicks: number): number[] {
  const match = new Match(FISTF, 0);
  const rng = createRng(seed);
  const marks: number[] = [];

  for (let f = 0; f < flicks; f++) {
    // Advance to a point where someone may act.
    for (let guard = 0; guard < 20_000; guard++) {
      const p = match.state.phase;
      if (p === Phase.AwaitAttackFlick || p === Phase.BlockFlickOffered) break;
      if (p === Phase.FullTime) break;
      match.step();
    }
    if (match.state.phase === Phase.FullTime) break;

    // Pick the first legal body, scanning from a seeded offset.
    const start = 1 + (nextUint32(rng) % (BODY_COUNT - 1));
    let chosen = -1;
    for (let k = 0; k < BODY_COUNT - 1; k++) {
      const body = 1 + ((start - 1 + k) % (BODY_COUNT - 1));
      if (match.canFlick(body)) {
        chosen = body;
        break;
      }
    }
    if (chosen < 0) {
      match.skipBlockFlick();
      continue;
    }

    match.flick(quantizeFlick(chosen, nextSigned(rng), nextSigned(rng), 0.3 + nextFloat(rng) * 0.7, 0));
    marks.push(hashMatch(match));
  }

  // Settle fully before the final mark.
  for (let guard = 0; guard < 20_000 && match.state.phase === Phase.Resolving; guard++) {
    match.step();
  }
  marks.push(hashMatch(match));
  return marks;
}

describe("match determinism", () => {
  it("replays a scripted match bit-identically", () => {
    expect(playScripted(12345, 40)).toEqual(playScripted(12345, 40));
  });

  it("diverges for a different seed", () => {
    expect(playScripted(1, 20)).not.toEqual(playScripted(2, 20));
  });

  it("includes match state in the hash, not just physics", () => {
    // Two matches with identical worlds but a different score must not agree.
    const a = new Match(FISTF, 0);
    const b = new Match(FISTF, 0);
    expect(hashMatch(a)).toBe(hashMatch(b));

    b.state.score1 += 1;
    expect(hashMatch(a)).not.toBe(hashMatch(b));
  });

  it("includes the ruleset id, so mismatched rules cannot agree", () => {
    const a = new Match(FISTF, 0);
    const b = new Match(ARCADE, 0);
    expect(hashMatch(a)).not.toBe(hashMatch(b));
  });
});
