import { describe, expect, it } from "vitest";
import * as C from "@/lib/sim/constants";
import { Match } from "@/lib/match/Match";
import {
  chooseKeeperPosition,
  clampToGoalArea,
  keeperBody,
  KEEPER_MAX_ADVANCE,
  KEEPER_MAX_OFFSET,
  makeKeeperPos,
  ownGoalX,
  positionKeeper,
} from "@/lib/rules/keeper";
import { attackDirection } from "@/lib/rules/geometry";
import { Phase, type KeeperMode } from "@/lib/rules/types";
import {
  BALL,
  KEEPER_A,
  KEEPER_B,
  SimEventKind,
  TEAM_A_FIRST,
} from "@/lib/sim/types";
import {
  cfg,
  clearPitch,
  flickAt,
  place,
  runUntilIdle,
  shootAt,
} from "./helpers";

const A1 = TEAM_A_FIRST;
const A2 = TEAM_A_FIRST + 1;

/** Floating-point slack, far below anything the rules care about. */
const EPS = 1e-9;

/**
 * FISTF 8.2.1 — no part of the keeper may pass or touch the goal-area line.
 * Returns a description of the breach, or null.
 */
function illegal(team: number, x: number, y: number): string | null {
  const advance = (x - ownGoalX(team)) * attackDirection(team);
  if (advance < -EPS) return `behind its own goal-line: advance ${advance}`;
  if (advance > KEEPER_MAX_ADVANCE + EPS)
    return `past the goal-area line: advance ${advance}`;
  if (Math.abs(y) > KEEPER_MAX_OFFSET + EPS)
    return `outside the goal-area: y ${y}`;
  return null;
}

describe("keeper placement (FISTF 8.2.1)", () => {
  it("clamps every requested position into the goal-area", () => {
    // Exhaustive over a grid that runs well outside the pitch, rather than a
    // handful of samples: this is the check that a manual placement can never
    // put an illegal keeper on the table, so it should not depend on luck.
    const out = makeKeeperPos();
    const breaches: string[] = [];

    for (let team = 0; team <= 1; team++) {
      for (let x = -1.2; x <= 1.2; x += 0.017) {
        for (let y = -0.8; y <= 0.8; y += 0.011) {
          clampToGoalArea(team, x, y, out);
          const bad = illegal(team, out.x, out.y);
          if (bad) breaches.push(`team ${team} (${x}, ${y}) -> ${bad}`);
        }
      }
    }

    expect(breaches.slice(0, 5)).toEqual([]);
  });

  it("leaves a position that is already legal alone", () => {
    const out = makeKeeperPos();
    const x = ownGoalX(0) + attackDirection(0) * 0.03;
    clampToGoalArea(0, x, 0.04, out);
    expect(out.x).toBeCloseTo(x, 12);
    expect(out.y).toBeCloseTo(0.04, 12);
  });

  it("chooses a legal position wherever the ball is", () => {
    const match = new Match(cfg());
    const out = makeKeeperPos();
    const breaches: string[] = [];

    for (let team = 0; team <= 1; team++) {
      for (let x = -C.HALF_LENGTH; x <= C.HALF_LENGTH; x += 0.013) {
        for (let y = -C.HALF_WIDTH; y <= C.HALF_WIDTH; y += 0.009) {
          match.world.px[BALL] = x;
          match.world.py[BALL] = y;
          chooseKeeperPosition(match.world, team, out);
          const bad = illegal(team, out.x, out.y);
          if (bad) breaches.push(`team ${team}, ball (${x}, ${y}) -> ${bad}`);
        }
      }
    }

    expect(breaches.slice(0, 5)).toEqual([]);
  });

  it("comes out to meet a close attack and drops back for a distant one", () => {
    const match = new Match(cfg());
    const out = makeKeeperPos();
    const dir = attackDirection(1); // team 1 defends +x.

    match.world.px[BALL] = -0.2;
    match.world.py[BALL] = 0;
    chooseKeeperPosition(match.world, 1, out);
    const far = (out.x - ownGoalX(1)) * dir;

    match.world.px[BALL] = 0.52;
    chooseKeeperPosition(match.world, 1, out);
    const near = (out.x - ownGoalX(1)) * dir;

    expect(near).toBeGreaterThan(far);
    expect(near).toBeLessThanOrEqual(KEEPER_MAX_ADVANCE + EPS);
  });

  it("never places the keeper on top of another body", () => {
    const match = new Match(cfg());
    clearPitch(match);
    const keeper = keeperBody(1);
    place(match, keeper, C.HALF_LENGTH - 0.02, 0);

    // A defender standing exactly where the keeper is asked to go. Barging it
    // aside would both break the solver's no-overlap assumption and, under
    // 8.2.2, be a foul in its own right.
    const target = { x: C.HALF_LENGTH - 0.05, y: 0.04 };
    place(match, A1, target.x, target.y);

    const scratch = makeKeeperPos();
    positionKeeper(match.world, 1, target.x, target.y, scratch);

    const dx = match.world.px[keeper] - match.world.px[A1];
    const dy = match.world.py[keeper] - match.world.py[A1];
    const sumR = match.world.radius[keeper] + match.world.radius[A1];
    expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(sumR);
  });
});

describe("the keeper is not a flickable figure (FISTF 8.1.1)", () => {
  it("refuses to flick either keeper, in either phase", () => {
    const match = new Match(cfg());
    runUntilIdle(match);
    expect(match.state.phase).toBe(Phase.AwaitAttackFlick);
    expect(match.canFlick(KEEPER_A)).toBe(false);
    expect(match.canFlick(KEEPER_B)).toBe(false);
    expect(match.flick(flickAt(KEEPER_A, 1, 0, 1))).toBe(false);
  });
});

/** Shoot at the goal from a grid of positions and count what goes in. */
function shootingSession(mode: KeeperMode): { goals: number; shots: number } {
  let goals = 0;
  let shots = 0;

  for (const bx of [0.34, 0.42, 0.5]) {
    for (const by of [-0.2, -0.1, 0, 0.1, 0.2]) {
      for (const ty of [-0.05, -0.025, 0, 0.025, 0.05]) {
        for (const power of [0.7, 1]) {
          const match = new Match(
            cfg({ blockFlickEnabled: false, keeperMode: mode }),
          );
          clearPitch(match);
          // Both sessions start with the keeper on its spot, so the only
          // difference between them is whether it is allowed to move.
          place(match, KEEPER_B, C.HALF_LENGTH - 0.02, 0);
          if (!shootAt(match, A1, bx, by, C.HALF_LENGTH, ty, power)) continue;

          runUntilIdle(match);
          shots++;
          if (match.state.score0 > 0) goals++;
        }
      }
    }
  }

  return { goals, shots };
}

describe("goalkeeping actually keeps goal", () => {
  it("concedes materially fewer goals than a keeper that cannot move", () => {
    // The point of the feature, stated as a measurement. A keeper that is
    // merely present and legal would pass every other test in this file.
    const still = shootingSession("off");
    const keeping = shootingSession("auto");

    expect(still.shots).toBe(keeping.shots);
    expect(still.goals).toBeGreaterThan(0);
    expect(keeping.goals).toBeLessThan(still.goals * 0.8);
  });
});

describe("goalkeeper manipulation (FISTF 8.1.2)", () => {
  it("holds its position for the whole resolve once the flick is committed", () => {
    const match = new Match(cfg({ blockFlickEnabled: false }));
    clearPitch(match);
    place(match, KEEPER_B, C.HALF_LENGTH - 0.02, 0);
    shootAt(match, A1, 0.4, 0.05, C.HALF_LENGTH, 0, 1);

    const keeper = keeperBody(1);
    const x = match.world.px[keeper];
    const y = match.world.py[keeper];

    let moved = 0;
    for (let i = 0; i < 4000 && match.state.phase === Phase.Resolving; i++) {
      match.step();
      if (match.world.px[keeper] !== x || match.world.py[keeper] !== y) moved++;
    }

    // Not "moved less than a little": 8.1.2 means it does not move at all,
    // and a keeper on a rod is not shoved aside by the ball either.
    expect(moved).toBe(0);
  });

  it("takes up its position as the flick is committed, not before", () => {
    const match = new Match(cfg({ blockFlickEnabled: false }));
    clearPitch(match);
    place(match, KEEPER_B, C.HALF_LENGTH - 0.02, 0.06);

    const keeper = keeperBody(1);
    const before = match.world.py[keeper];
    shootAt(match, A1, 0.4, -0.2, C.HALF_LENGTH, 0, 0.8);

    expect(match.world.py[keeper]).not.toBe(before);
    expect(
      illegal(1, match.world.px[keeper], match.world.py[keeper]),
    ).toBeNull();
  });

  it("leaves the keeper where it stands when placement is off", () => {
    const match = new Match(
      cfg({ blockFlickEnabled: false, keeperMode: "off" }),
    );
    clearPitch(match);
    place(match, KEEPER_B, C.HALF_LENGTH - 0.02, 0.06);
    shootAt(match, A1, 0.4, -0.2, C.HALF_LENGTH, 0, 0.8);

    expect(match.world.py[keeperBody(1)]).toBe(0.06);
  });
});

describe("manual placement", () => {
  it("is refused unless the ruleset hands the keeper to its player", () => {
    const match = new Match(cfg());
    runUntilIdle(match);
    expect(match.placeKeeper(C.HALF_LENGTH - 0.03, 0.02)).toBe(false);
  });

  it("clamps an illegal request rather than refusing it", () => {
    const match = new Match(cfg({ keeperMode: "manual" }));
    runUntilIdle(match);

    // Halfway up the pitch, which is nowhere near legal.
    expect(match.placeKeeper(0, 0.3)).toBe(true);

    const keeper = keeperBody(1);
    expect(
      illegal(1, match.world.px[keeper], match.world.py[keeper]),
    ).toBeNull();
  });

  it("places the defending keeper, never the attacker's", () => {
    const match = new Match(cfg({ keeperMode: "manual" }));
    runUntilIdle(match);
    const before = match.world.py[keeperBody(0)];

    match.placeKeeper(C.HALF_LENGTH - 0.03, 0.05);

    expect(match.world.py[keeperBody(0)]).toBe(before);
    expect(match.world.py[keeperBody(1)]).toBeCloseTo(0.05, 12);
  });
});

/** Step a resolve out, recording who touched the ball in order. */
function touchSequence(match: Match): string[] {
  const seq: string[] = [];
  for (let i = 0; i < 4000 && match.state.phase === Phase.Resolving; i++) {
    match.step();
    const ev = match.world.events;
    for (let k = 0; k < ev.count; k++) {
      const e = ev.at(k);
      if (e.kind === SimEventKind.KeeperHitBall) seq.push("keeper");
      else if (e.kind === SimEventKind.FigureHitBall) seq.push(`figure${e.a}`);
    }
  }
  return seq;
}

describe("a keeper's touch earns a block-flick (FISTF 8.1.4)", () => {
  it("offers the defender a block-flick after a save", () => {
    // Placement off, so the save comes from a keeper put exactly where this
    // scenario needs it rather than from wherever the automatic placement
    // happens to choose.
    const match = new Match(cfg({ keeperMode: "off" }));
    clearPitch(match);
    place(match, KEEPER_B, C.HALF_LENGTH - 0.02, 0);
    shootAt(match, A1, 0.45, 0.06, C.HALF_LENGTH - 0.02, 0, 0.8);

    const seq = touchSequence(match);
    expect(seq).toContain("keeper");

    // Saved, so the attacker has lost the ball — and 8.1.4 gives the defender
    // a flick to clear it rather than leaving them to wait for possession.
    expect(match.state.possessionLost).toBe(true);
    expect(match.state.blockFlickOwed).toBe(true);
    expect(match.state.phase).toBe(Phase.BlockFlickOffered);
  });

  it("withdraws it if the ball then strikes an attacking figure (8.1.4 remark 2)", () => {
    const match = new Match(cfg({ keeperMode: "off" }));
    clearPitch(match);
    place(match, KEEPER_B, C.HALF_LENGTH - 0.02, 0);
    // Positioned on the path the keeper's deflection actually takes; the
    // assertion on the touch order below is what keeps this honest if the
    // physics ever moves.
    place(match, A2, 0.535, 0.071);
    shootAt(match, A1, 0.45, 0.06, C.HALF_LENGTH - 0.02, 0.01, 0.8);

    const seq = touchSequence(match);
    const keeperTouch = seq.indexOf("keeper");
    expect(keeperTouch).toBeGreaterThanOrEqual(0);
    expect(seq[keeperTouch + 1]).toBe(`figure${A2}`);

    expect(match.state.blockFlickOwed).toBe(false);
    expect(match.state.phase).toBe(Phase.AwaitAttackFlick);
  });
});
