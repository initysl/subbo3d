import { hashFloat, hashInit, hashInt, POS_QUANTISE, VEL_QUANTISE } from "@/lib/sim/hash";
import { BODY_COUNT } from "@/lib/sim/types";
import type { Match } from "./Match";

/**
 * Hash the whole deterministic core — physics *and* match state.
 *
 * Hashing only the world would leave possession, the flick count, the score
 * and the clock outside the check, which is precisely the class of divergence
 * that is hardest to trace back later.
 */
export function hashMatch(match: Match): number {
  const w = match.world;
  const m = match.state;

  let h = hashInit();
  h = hashInt(h, w.step);

  for (let i = 0; i < BODY_COUNT; i++) {
    h = hashFloat(h, w.px[i], POS_QUANTISE);
    h = hashFloat(h, w.py[i], POS_QUANTISE);
    h = hashFloat(h, w.pz[i], POS_QUANTISE);
    h = hashFloat(h, w.vx[i], VEL_QUANTISE);
    h = hashFloat(h, w.vy[i], VEL_QUANTISE);
    h = hashFloat(h, w.vz[i], VEL_QUANTISE);
    h = hashInt(h, w.flags[i]);
  }

  h = hashInt(h, m.phase);
  h = hashInt(h, m.attackerTeam);
  h = hashInt(h, m.lastFlickedBody);
  h = hashInt(h, m.flicksOnCurrentFigure);
  h = hashInt(h, m.touchedBallThisFlick ? 1 : 0);
  h = hashInt(h, m.possessionLost ? 1 : 0);
  h = hashInt(h, m.blockFlickOwed ? 1 : 0);
  h = hashInt(h, m.ballWasShootableAtShot ? 1 : 0);
  h = hashInt(h, m.lastTouchTeam);
  h = hashInt(h, m.lastDeflectorWasDefender ? 1 : 0);
  h = hashInt(h, m.score0);
  h = hashInt(h, m.score1);
  h = hashInt(h, m.clockSteps);
  h = hashInt(h, m.half);
  h = hashInt(h, m.restartKind);
  h = hashInt(h, m.restartTeam);
  h = hashInt(h, m.pending);
  h = hashInt(h, m.pendingSide);

  // The ruleset is part of the state: two peers running different rules must
  // not silently agree on a hash.
  for (let i = 0; i < match.cfg.id.length; i++) {
    h = hashInt(h, match.cfg.id.charCodeAt(i));
  }

  return h >>> 0;
}
