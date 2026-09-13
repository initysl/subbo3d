import { describe, expect, it } from "vitest";
import { Match } from "@/lib/match/Match";
import { RestartKind } from "@/lib/rules/types";
import { BALL, TEAM_A_FIRST, TEAM_B_FIRST } from "@/lib/sim/types";
import { ballInFrontOf, cfg, clearPitch, flickAt, place, runUntilIdle } from "./helpers";

const A1 = TEAM_A_FIRST;
const B1 = TEAM_B_FIRST;

// Team 0 attacks +x. The shooting line is at x = 0.3, the goal at x = 0.6.
describe("scoring (FISTF 7)", () => {
  it("awards a goal for a shot taken from inside the shooting-area (7.1.1a)", () => {
    const match = new Match(cfg({ blockFlickEnabled: false }));
    clearPitch(match);
    place(match, A1, 0.38, 0);
    ballInFrontOf(match, A1, 1);

    expect(match.state.ballWasShootableAtShot).toBe(false);
    match.flick(flickAt(A1, 1, 0, 0.6));
    expect(match.state.ballWasShootableAtShot).toBe(true);

    runUntilIdle(match);
    expect(match.state.score0).toBe(1);
    expect(match.state.score1).toBe(0);
  });

  it("refuses a goal shot from outside the shooting-area, giving a goal-flick (7.2.1)", () => {
    const match = new Match(cfg({ blockFlickEnabled: false }));
    clearPitch(match);
    place(match, A1, 0.05, 0);
    ballInFrontOf(match, A1, 1);

    match.flick(flickAt(A1, 1, 0, 1));
    expect(match.state.ballWasShootableAtShot).toBe(false);

    runUntilIdle(match);
    expect(match.state.score0).toBe(0);
    // Possession goes to the defender for the goal-flick.
    expect(match.state.attackerTeam).toBe(1);
  });

  it("counts a goal deflected in off a defender (5.2.2 remark)", () => {
    // A goal after a deflection stands provided the ball was originally shot
    // from completely inside the shooting-area.
    const match = new Match(cfg({ blockFlickEnabled: false }));
    clearPitch(match);
    place(match, A1, 0.36, 0.15);
    ballInFrontOf(match, A1, 1);
    // Just above the ball, deflecting it down towards the goal mouth.
    place(match, B1, 0.45, 0.16);

    match.flick(flickAt(A1, 1, 0, 0.9));
    runUntilIdle(match);

    expect(match.state.score0).toBe(1);
  });

  it("allows a shot from anywhere when the shooting-area rule is off (arcade)", () => {
    const match = new Match(cfg({ blockFlickEnabled: false, shootingAreaRequired: false }));
    clearPitch(match);
    place(match, A1, 0.05, 0);
    ballInFrontOf(match, A1, 1);

    match.flick(flickAt(A1, 1, 0, 1));
    runUntilIdle(match);

    expect(match.state.score0).toBe(1);
  });
});

describe("restarts (FISTF 14, 15, 16)", () => {
  it("gives a flick-in to the team that did not touch it last (14.1.1)", () => {
    const match = new Match(cfg({ blockFlickEnabled: false }));
    clearPitch(match);
    place(match, A1, 0, 0.25);
    place(match, BALL, 0, 0.29);

    expect(match.state.attackerTeam).toBe(0);
    match.flick(flickAt(A1, 0, 1, 0.6));
    runUntilIdle(match);

    // Team 0 knocked it out, so team 1 takes the flick-in.
    expect(match.state.attackerTeam).toBe(1);
    expect(match.state.restartKind).toBe(RestartKind.None); // already applied
    expect(Math.abs(match.world.py[BALL])).toBeLessThan(0.385);
  });

  it("gives a goal-flick when the attacker puts it behind (15.1.1.1)", () => {
    const match = new Match(cfg({ blockFlickEnabled: false }));
    clearPitch(match);
    place(match, A1, 0.4, 0.2);
    ballInFrontOf(match, A1, 1);

    match.flick(flickAt(A1, 1, 0, 0.8));
    runUntilIdle(match);

    // Ball crossed team 1's goal-line wide of the posts: goal-flick to team 1.
    expect(match.state.score0).toBe(0);
    expect(match.state.attackerTeam).toBe(1);
  });

  it("gives a corner when the ball goes behind off a defender (16.1.1)", () => {
    const match = new Match(cfg({ blockFlickEnabled: false }));
    clearPitch(match);
    place(match, A1, 0.36, 0.15);
    ballInFrontOf(match, A1, 1);
    // Just below the ball, so the deflection carries it wide of the posts
    // rather than into the goal.
    place(match, B1, 0.45, 0.135);

    match.flick(flickAt(A1, 1, 0, 0.9));
    runUntilIdle(match);

    expect(match.state.lastDeflectorWasDefender).toBe(true);
    // The attacking team keeps the ball for the corner.
    expect(match.state.attackerTeam).toBe(0);
  });
});
