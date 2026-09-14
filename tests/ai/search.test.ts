import { describe, expect, it } from "vitest";
import { Match } from "@/lib/match/Match";
import { DIFFICULTIES, searchFromMatch } from "@/lib/ai/search";
import { FISTF } from "@/lib/rules/presets";
import { Phase } from "@/lib/rules/types";
import { quantizeFlick } from "@/lib/sim/input";
import { createRng, nextFloat, nextSigned, nextUint32 } from "@/lib/sim/rng";
import { BODY_COUNT } from "@/lib/sim/types";

/**
 * Tests use a synthetic clock so the time budget never makes a result depend
 * on how loaded the machine is. Candidate count is then the only limit.
 */
function fixedClock(): () => number {
  let t = 0;
  return () => (t += 0.01);
}

/** Advance until someone may act, or the match ends. */
function toDecision(match: Match): Phase {
  for (let i = 0; i < 40_000; i++) {
    const p = match.state.phase;
    if (p === Phase.AwaitAttackFlick || p === Phase.BlockFlickOffered || p === Phase.FullTime) {
      return p;
    }
    match.step();
  }
  return match.state.phase;
}

/** A baseline opponent: legal, but choosing with no judgement at all. */
function randomMove(match: Match, team: number, rng: ReturnType<typeof createRng>): boolean {
  const start = 1 + (nextUint32(rng) % (BODY_COUNT - 1));
  for (let k = 0; k < BODY_COUNT - 1; k++) {
    const body = 1 + ((start - 1 + k) % (BODY_COUNT - 1));
    if (match.world.team[body] !== team) continue;
    if (!match.canFlick(body)) continue;
    return match.flick(
      quantizeFlick(body, nextSigned(rng), nextSigned(rng), 0.3 + nextFloat(rng) * 0.7, 0),
    );
  }
  return false;
}

describe("AI search", () => {
  it("returns a legal move", () => {
    const match = new Match(FISTF, 0);
    toDecision(match);

    const result = searchFromMatch(match, 0, DIFFICULTIES.normal, 1, fixedClock());
    expect(result).not.toBeNull();
    expect(match.canFlick(result!.command.bodyId)).toBe(true);
    expect(match.flick(result!.command)).toBe(true);
  });

  it("only ever proposes moves the rules allow", { timeout: 120_000 }, () => {
    // The opponent is bound by FISTF 5.2.1 exactly as a human is; it must
    // never propose a fourth flick of the same figure.
    const match = new Match(FISTF, 0);
    const clock = fixedClock();

    for (let turn = 0; turn < 60; turn++) {
      const phase = toDecision(match);
      if (phase === Phase.FullTime) break;

      const team = phase === Phase.BlockFlickOffered ? 1 - match.state.attackerTeam : match.state.attackerTeam;
      const result = searchFromMatch(match, team, DIFFICULTIES.easy, turn + 1, clock);
      if (!result) {
        match.skipBlockFlick();
        continue;
      }
      expect(match.canFlick(result.command.bodyId)).toBe(true);
      expect(match.flick(result.command)).toBe(true);
    }
  });

  it("plays a full match against itself without deadlocking", { timeout: 180_000 }, () => {
    const match = new Match({ ...FISTF, halfLengthSteps: 6_000, halves: 1 }, 0);
    const clock = fixedClock();
    let moves = 0;

    for (let i = 0; i < 400; i++) {
      const phase = toDecision(match);
      if (phase === Phase.FullTime) break;

      const team = phase === Phase.BlockFlickOffered ? 1 - match.state.attackerTeam : match.state.attackerTeam;
      const result = searchFromMatch(match, team, DIFFICULTIES.easy, i + 1, clock);
      if (!result) {
        match.skipBlockFlick();
        continue;
      }
      match.flick(result.command);
      moves++;
    }

    expect(moves).toBeGreaterThan(20);
    expect(match.state.phase).toBe(Phase.FullTime);
  });

  it("beats an opponent that picks at random", { timeout: 180_000 }, () => {
    // The honest measure of whether the search is doing anything at all. If a
    // scored opponent cannot out-play a random one, the scoring is wrong and
    // no amount of extra breadth will help.
    //
    // Run at `easy` deliberately: the weakest setting still wins every game
    // and concedes nothing, which is stronger evidence than a narrow win at
    // `normal` — and it costs CI a third of the time.
    let searcherAdvantage = 0;

    for (let game = 0; game < 6; game++) {
      const match = new Match({ ...FISTF, halfLengthSteps: 9_000, halves: 1 }, 0);
      const rng = createRng(1000 + game);
      const clock = fixedClock();
      // Team 0 searches, team 1 plays at random.
      for (let i = 0; i < 500; i++) {
        const phase = toDecision(match);
        if (phase === Phase.FullTime) break;

        const team =
          phase === Phase.BlockFlickOffered ? 1 - match.state.attackerTeam : match.state.attackerTeam;

        if (team === 0) {
          const result = searchFromMatch(match, 0, DIFFICULTIES.easy, game * 100 + i, clock);
          if (!result) match.skipBlockFlick();
          else match.flick(result.command);
        } else if (!randomMove(match, 1, rng)) {
          match.skipBlockFlick();
        }
      }
      searcherAdvantage += match.state.score0 - match.state.score1;
    }

    // Measured at +8 across these six games, winning or drawing every one.
    expect(searcherAdvantage).toBeGreaterThan(3);
  });
});
