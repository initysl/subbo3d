import * as C from "./constants";
import {
  BALL,
  BODY_COUNT,
  FLAG_ACTIVE,
  KEEPER_A,
  KEEPER_B,
  OUTFIELD_PER_TEAM,
  TEAM_A_FIRST,
  TEAM_B_FIRST,
} from "./types";
import type { World } from "./world";

/**
 * A 4-4-2, given as offsets from a team's own goal line along the attacking
 * direction. Team A defends -x and attacks +x; team B is the mirror.
 */
const OUTFIELD: ReadonlyArray<readonly [number, number]> = [
  [-0.42, -0.27],
  [-0.42, -0.09],
  [-0.42, 0.09],
  [-0.42, 0.27],
  [-0.24, -0.27],
  [-0.24, -0.09],
  [-0.24, 0.09],
  [-0.24, 0.27],
  [-0.09, -0.1],
  [-0.09, 0.1],
];

/** Reset every body to the kickoff formation. */
export function setKickoffFormation(w: World): void {
  for (let i = 0; i < BODY_COUNT; i++) {
    w.vx[i] = 0;
    w.vy[i] = 0;
    w.vz[i] = 0;
    w.spin[i] = 0;
    w.pz[i] = 0;
    w.pendingLoft[i] = 0;
    w.sleepSteps[i] = 0;
    w.flags[i] = FLAG_ACTIVE;
  }

  for (let i = 0; i < OUTFIELD_PER_TEAM; i++) {
    const [x, y] = OUTFIELD[i];
    w.px[TEAM_A_FIRST + i] = x;
    w.py[TEAM_A_FIRST + i] = y;
    w.px[TEAM_B_FIRST + i] = -x;
    w.py[TEAM_B_FIRST + i] = -y;
  }

  const keeperX = C.HALF_LENGTH - 0.02;
  w.px[KEEPER_A] = -keeperX;
  w.py[KEEPER_A] = 0;
  w.px[KEEPER_B] = keeperX;
  w.py[KEEPER_B] = 0;

  w.px[BALL] = 0;
  w.py[BALL] = 0;
  w.pz[BALL] = 0;

  w.prevX.set(w.px);
  w.prevY.set(w.py);
  w.prevZ.set(w.pz);
  w.step = 0;
  w.events.clear();
}
