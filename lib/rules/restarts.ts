import * as C from "@/lib/sim/constants";
import { setKickoffFormation } from "@/lib/sim/formation";
import { BALL, FLAG_ASLEEP, FLAG_OUT_OF_PLAY } from "@/lib/sim/types";
import type { World } from "@/lib/sim/world";
import { attackDirection } from "./geometry";
import { Phase, RestartKind, type MatchState } from "./types";

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Put the ball where the awarded restart says it goes, and hand possession to
 * the team taking it.
 *
 * FISTF 2.x has detailed rules for repositioning *figures* at a restart too;
 * those are out of scope for this milestone, so only the ball moves.
 */
export function applyRestart(m: MatchState, w: World): void {
  const inset = C.BALL_RADIUS * 2;

  switch (m.restartKind) {
    case RestartKind.FlickOff:
      setKickoffFormation(w);
      break;

    // FISTF 14 — taken from where the ball left the pitch.
    case RestartKind.FlickIn:
      w.px[BALL] = clamp(m.restartX, -C.HALF_LENGTH + inset, C.HALF_LENGTH - inset);
      w.py[BALL] = Math.sign(m.restartY) * (C.HALF_WIDTH - inset);
      break;

    // FISTF 15 — taken from the defending team's goal-area.
    case RestartKind.GoalFlick: {
      const dir = attackDirection(m.restartTeam);
      w.px[BALL] = -dir * (C.HALF_LENGTH - C.GOAL_AREA_DEPTH);
      w.py[BALL] = 0;
      break;
    }

    // FISTF 16 — taken from the corner arc nearest where the ball went out.
    case RestartKind.CornerFlick: {
      const dir = attackDirection(m.restartTeam);
      w.px[BALL] = dir * (C.HALF_LENGTH - C.CORNER_ARC_RADIUS);
      w.py[BALL] = Math.sign(m.restartY || 1) * (C.HALF_WIDTH - C.CORNER_ARC_RADIUS);
      break;
    }

    default:
      break;
  }

  w.pz[BALL] = 0;
  w.vx[BALL] = 0;
  w.vy[BALL] = 0;
  w.vz[BALL] = 0;
  w.flags[BALL] &= ~(FLAG_OUT_OF_PLAY | FLAG_ASLEEP);
  w.sleepSteps[BALL] = 0;

  // A restart is a fresh attack: FISTF 5.2.1(c,d) both reset the flick count.
  m.attackerTeam = m.restartTeam;
  m.lastFlickedBody = -1;
  m.flicksOnCurrentFigure = 0;
  m.touchedBallThisFlick = false;
  m.possessionLost = false;
  m.blockFlickOwed = false;
  m.lastTouchWasDefenderKeeper = false;
  m.restartKind = RestartKind.None;
  m.phase = Phase.AwaitAttackFlick;
}
