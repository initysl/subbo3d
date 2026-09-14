import { hashFloat, hashInit, hashInt, POS_QUANTISE, VEL_QUANTISE } from "@/lib/sim/hash";
import { BODY_COUNT } from "@/lib/sim/types";
import type { MatchState } from "@/lib/rules/types";
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
  h = hashInt(h, m.lastTouchWasDefenderKeeper ? 1 : 0);
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

/**
 * Snapshot serialisation.
 *
 * Everything is written as Float64 into one flat array: the state is small
 * (a couple of kilobytes) and uniform width removes a whole class of offset
 * and int-versus-float mistakes for no meaningful cost.
 *
 * The AI worker needs this, but so will replays and, later, online reconnect.
 */

/** Field names whose MatchState values are numbers. */
type NumberKeys = {
  [K in keyof MatchState]: MatchState[K] extends number ? K : never;
}[keyof MatchState];

/** Field names whose MatchState values are booleans. */
type BooleanKeys = {
  [K in keyof MatchState]: MatchState[K] extends boolean ? K : never;
}[keyof MatchState];

const NUMBER_FIELDS = [
  "phase",
  "attackerTeam",
  "lastFlickedBody",
  "flicksOnCurrentFigure",
  "lastTouchTeam",
  "score0",
  "score1",
  "clockSteps",
  "half",
  "restartKind",
  "restartTeam",
  "restartX",
  "restartY",
  "pending",
  "pendingSide",
  "celebrationSteps",
] as const satisfies readonly NumberKeys[];

const BOOLEAN_FIELDS = [
  "touchedBallThisFlick",
  "possessionLost",
  "blockFlickOwed",
  "ballWasShootableAtShot",
  "lastDeflectorWasDefender",
  "lastTouchWasDefenderKeeper",
] as const satisfies readonly BooleanKeys[];

/**
 * Compile-time completeness check.
 *
 * Add a field to MatchState without listing it above and this stops building.
 * A snapshot that silently omits a field would have the AI searching a subtly
 * different match than the one on screen — the kind of bug that presents as
 * "the opponent plays oddly" rather than as a failure.
 */
type UncoveredField = Exclude<
  keyof MatchState,
  (typeof NUMBER_FIELDS)[number] | (typeof BOOLEAN_FIELDS)[number]
>;
const _allFieldsCovered: UncoveredField extends never ? true : never = true;
void _allFieldsCovered;

/** Per-body values stored, in order. */
const BODY_STRIDE = 12;

export const SNAPSHOT_FLOATS =
  1 + NUMBER_FIELDS.length + BOOLEAN_FIELDS.length + BODY_COUNT * BODY_STRIDE;
export const SNAPSHOT_BYTES = SNAPSHOT_FLOATS * 8;

export function writeSnapshot(match: Match, out: Float64Array): void {
  const w = match.world;
  const m = match.state;
  let k = 0;

  out[k++] = w.step;
  for (const f of NUMBER_FIELDS) out[k++] = m[f];
  for (const f of BOOLEAN_FIELDS) out[k++] = m[f] ? 1 : 0;

  for (let i = 0; i < BODY_COUNT; i++) {
    out[k++] = w.px[i];
    out[k++] = w.py[i];
    out[k++] = w.pz[i];
    out[k++] = w.vx[i];
    out[k++] = w.vy[i];
    out[k++] = w.vz[i];
    out[k++] = w.spin[i];
    out[k++] = w.pendingLoft[i];
    out[k++] = w.kind[i];
    out[k++] = w.team[i];
    out[k++] = w.flags[i];
    out[k++] = w.sleepSteps[i];
  }
}

export function readSnapshot(match: Match, src: Float64Array): void {
  const w = match.world;
  const m = match.state;
  let k = 0;

  w.step = src[k++];
  // The key is a union whose value types differ (Phase, RestartKind, plain
  // number), so TypeScript narrows the assignment target to their
  // intersection and rejects a number. The round trip is sound by
  // construction — each value came from that same field in writeSnapshot —
  // so the write is done through a widened view.
  const numeric = m as unknown as Record<string, number>;
  const boolean = m as unknown as Record<string, boolean>;
  for (const f of NUMBER_FIELDS) numeric[f] = src[k++];
  for (const f of BOOLEAN_FIELDS) boolean[f] = src[k++] !== 0;

  for (let i = 0; i < BODY_COUNT; i++) {
    w.px[i] = src[k++];
    w.py[i] = src[k++];
    w.pz[i] = src[k++];
    w.vx[i] = src[k++];
    w.vy[i] = src[k++];
    w.vz[i] = src[k++];
    w.spin[i] = src[k++];
    w.pendingLoft[i] = src[k++];
    w.kind[i] = src[k++];
    w.team[i] = src[k++];
    w.flags[i] = src[k++];
    w.sleepSteps[i] = src[k++];
  }

  // Interpolation history is presentation-only and not worth serialising;
  // seeding it from the restored positions just avoids a one-frame streak.
  w.prevX.set(w.px);
  w.prevY.set(w.py);
  w.prevZ.set(w.pz);
  w.events.clear();
  match.resetResolveCounter();
}
