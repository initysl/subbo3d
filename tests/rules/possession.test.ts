import { describe, expect, it } from "vitest";
import { Match } from "@/lib/match/Match";
import { Phase } from "@/lib/rules/types";
import { BALL, KEEPER_B, TEAM_A_FIRST, TEAM_B_FIRST } from "@/lib/sim/types";
import { ballInFrontOf, cfg, clearPitch, flickAt, place, runUntilIdle } from "./helpers";

const A1 = TEAM_A_FIRST;
const A2 = TEAM_A_FIRST + 1;
const B1 = TEAM_B_FIRST;

describe("possession and flick limits (FISTF 5.1, 5.2)", () => {
  it("allows three flicks of one figure and refuses the fourth (5.2.1)", () => {
    // Block-flicks off so this isolates the flick counter.
    const match = new Match(cfg({ blockFlickEnabled: false }));
    clearPitch(match);
    place(match, A1, -0.3, 0);
    ballInFrontOf(match, A1, 1);

    for (let i = 1; i <= 3; i++) {
      expect(match.canFlick(A1)).toBe(true);
      expect(match.flick(flickAt(A1, 1, 0, 0.25))).toBe(true);
      runUntilIdle(match);
      expect(match.state.flicksOnCurrentFigure).toBe(i);
      // Keep the ball reachable so possession is retained each time.
      ballInFrontOf(match, A1, 1);
    }

    expect(match.canFlick(A1)).toBe(false);
    expect(match.flick(flickAt(A1, 1, 0, 0.25))).toBe(false);
  });

  it("lets a different figure be flicked once the first is spent (5.2.1a)", () => {
    const match = new Match(cfg({ blockFlickEnabled: false }));
    clearPitch(match);
    place(match, A1, -0.3, 0);
    place(match, A2, -0.3, 0.1);
    ballInFrontOf(match, A1, 1);

    for (let i = 0; i < 3; i++) {
      match.flick(flickAt(A1, 1, 0, 0.25));
      runUntilIdle(match);
      ballInFrontOf(match, A1, 1);
    }

    expect(match.canFlick(A1)).toBe(false);
    expect(match.canFlick(A2)).toBe(true);
  });

  it("loses possession when the flicked figure misses the ball (5.1.2a)", () => {
    const match = new Match(cfg({ blockFlickEnabled: false }));
    clearPitch(match);
    place(match, A1, -0.3, 0);
    place(match, BALL, 0.2, 0.3); // nowhere near the flick

    expect(match.state.attackerTeam).toBe(0);
    match.flick(flickAt(A1, 1, 0, 0.3));
    runUntilIdle(match);

    expect(match.state.touchedBallThisFlick).toBe(false);
    expect(match.state.attackerTeam).toBe(1);
  });

  it("loses possession when the ball strikes a stationary defender (5.1.2b)", () => {
    const match = new Match(cfg({ blockFlickEnabled: false }));
    clearPitch(match);
    place(match, A1, -0.3, 0);
    ballInFrontOf(match, A1, 1);
    place(match, B1, 0.0, 0); // directly in the ball's path, at rest

    match.flick(flickAt(A1, 1, 0, 0.6));
    runUntilIdle(match);

    expect(match.state.attackerTeam).toBe(1);
  });

  it("keeps possession when the flicked figure touches the ball cleanly", () => {
    const match = new Match(cfg({ blockFlickEnabled: false }));
    clearPitch(match);
    place(match, A1, -0.3, 0);
    ballInFrontOf(match, A1, 1);

    match.flick(flickAt(A1, 1, 0, 0.3));
    runUntilIdle(match);

    expect(match.state.touchedBallThisFlick).toBe(false); // cleared on resolve
    expect(match.state.attackerTeam).toBe(0);
  });

  it("loses possession to the defender's goalkeeper (5.1.2b)", () => {
    const match = new Match(cfg({ blockFlickEnabled: false }));
    clearPitch(match);
    place(match, A1, 0.3, 0);
    ballInFrontOf(match, A1, 1);
    place(match, KEEPER_B, 0.5, 0);

    match.flick(flickAt(A1, 1, 0, 0.5));
    runUntilIdle(match);

    expect(match.state.attackerTeam).toBe(1);
  });
});

describe("block-flicks (FISTF 6.2)", () => {
  it("offers the defender a block-flick after an attacking touch (6.2.1)", () => {
    const match = new Match(cfg());
    clearPitch(match);
    place(match, A1, -0.3, 0);
    place(match, B1, 0.1, 0.2);
    ballInFrontOf(match, A1, 1);

    match.flick(flickAt(A1, 1, 0, 0.3));
    runUntilIdle(match);

    expect(match.state.phase).toBe(Phase.BlockFlickOffered);
    // It is the defender's flick, not the attacker's.
    expect(match.canFlick(B1)).toBe(true);
    expect(match.canFlick(A1)).toBe(false);
  });

  it("does not offer one when the attacker missed the ball (6.2.1)", () => {
    const match = new Match(cfg());
    clearPitch(match);
    place(match, A1, -0.3, 0);
    place(match, B1, 0.1, 0.2);
    place(match, BALL, 0.2, 0.35);

    match.flick(flickAt(A1, 1, 0, 0.3));
    runUntilIdle(match);

    expect(match.state.phase).toBe(Phase.AwaitAttackFlick);
  });

  it("resumes play when the block-flick is declined (6.2.3)", () => {
    const match = new Match(cfg());
    clearPitch(match);
    place(match, A1, -0.3, 0);
    place(match, B1, 0.1, 0.2);
    ballInFrontOf(match, A1, 1);

    match.flick(flickAt(A1, 1, 0, 0.3));
    runUntilIdle(match);
    expect(match.state.phase).toBe(Phase.BlockFlickOffered);

    match.skipBlockFlick();
    expect(match.state.phase).toBe(Phase.AwaitAttackFlick);
    expect(match.state.attackerTeam).toBe(0);
  });
});
