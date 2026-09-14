import { describe, expect, it } from "vitest";
import { Match } from "@/lib/match/Match";
import { hashMatch, readSnapshot, SNAPSHOT_FLOATS, writeSnapshot } from "@/lib/match/snapshot";
import { FISTF } from "@/lib/rules/presets";
import { Phase } from "@/lib/rules/types";
import { quantizeFlick } from "@/lib/sim/input";
import { createRng, nextFloat, nextSigned, nextUint32 } from "@/lib/sim/rng";
import { BODY_COUNT } from "@/lib/sim/types";

/** Play a few flicks so the snapshot is taken from a non-trivial state. */
function advance(match: Match, seed: number, flicks: number): void {
  const rng = createRng(seed);
  for (let f = 0; f < flicks; f++) {
    for (let guard = 0; guard < 20_000; guard++) {
      const p = match.state.phase;
      if (p === Phase.AwaitAttackFlick || p === Phase.BlockFlickOffered || p === Phase.FullTime) {
        break;
      }
      match.step();
    }
    if (match.state.phase === Phase.FullTime) return;

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
    match.flick(
      quantizeFlick(chosen, nextSigned(rng), nextSigned(rng), 0.3 + nextFloat(rng) * 0.7, 0),
    );
  }
}

describe("match snapshots", () => {
  it("restores to an identical hash", () => {
    const source = new Match(FISTF, 0);
    advance(source, 4242, 7);

    const buf = new Float64Array(SNAPSHOT_FLOATS);
    writeSnapshot(source, buf);

    const restored = new Match(FISTF, 0);
    readSnapshot(restored, buf);

    expect(hashMatch(restored)).toBe(hashMatch(source));
  });

  it("continues identically after restoring", () => {
    // The real requirement: a restored match must not merely look equal, it
    // must behave equally. This is what makes searching on a worker's copy
    // meaningful, and later what makes an online reconnect trustworthy.
    const source = new Match(FISTF, 0);
    advance(source, 99, 5);

    const buf = new Float64Array(SNAPSHOT_FLOATS);
    writeSnapshot(source, buf);
    const restored = new Match(FISTF, 0);
    readSnapshot(restored, buf);

    for (let i = 0; i < 2000; i++) {
      source.step();
      restored.step();
      expect(hashMatch(restored)).toBe(hashMatch(source));
    }
  });

  it("captures match state, not just the world", () => {
    // A snapshot that only carried body positions would pass a naive check
    // while silently losing possession, the flick count and the score.
    const source = new Match(FISTF, 0);
    advance(source, 7, 4);
    source.state.score1 = 3;
    source.state.flicksOnCurrentFigure = 2;
    source.state.attackerTeam = 1;

    const buf = new Float64Array(SNAPSHOT_FLOATS);
    writeSnapshot(source, buf);
    const restored = new Match(FISTF, 0);
    readSnapshot(restored, buf);

    expect(restored.state.score1).toBe(3);
    expect(restored.state.flicksOnCurrentFigure).toBe(2);
    expect(restored.state.attackerTeam).toBe(1);
  });

  it("round-trips through a transferable buffer", () => {
    // The worker receives an ArrayBuffer, so the snapshot has to survive
    // being viewed through a fresh Float64Array over transferred bytes.
    const source = new Match(FISTF, 0);
    advance(source, 31, 3);

    const buf = new Float64Array(SNAPSHOT_FLOATS);
    writeSnapshot(source, buf);
    const copy = new Float64Array(buf.buffer.slice(0));

    const restored = new Match(FISTF, 0);
    readSnapshot(restored, copy);
    expect(hashMatch(restored)).toBe(hashMatch(source));
  });
});
