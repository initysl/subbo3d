import * as C from "@/lib/sim/constants";
import { SimEventKind } from "@/lib/sim/types";
import type { SimEventBuffer } from "@/lib/sim/events";
import type { AudioEngine } from "./engine";
import { playImpact, playWhistle } from "./synth";

/**
 * Turns simulation events into sound.
 *
 * Strictly a sink: it reads the event buffer and never writes to the
 * simulation. Pitch and gain come from the contact impulse, so a firm strike
 * and a gentle nudge sound genuinely different rather than triggering the
 * same sample at the same volume.
 */

/** Impulses below this are inaudible clutter — resting contacts, mostly. */
const MIN_IMPULSE = 0.0004;
/** Impulse that counts as a full-power hit, for normalising gain. */
const LOUD_IMPULSE = 0.006;

function norm(impulse: number): number {
  return Math.min(1, impulse / LOUD_IMPULSE);
}

/** Stereo position from the across-pitch coordinate. */
function panOf(y: number): number {
  return Math.max(-1, Math.min(1, y / C.HALF_WIDTH)) * 0.6;
}

export function playSimEvents(engine: AudioEngine, events: SimEventBuffer): void {
  for (let i = 0; i < events.count; i++) {
    const e = events.at(i);
    const pan = panOf(e.y);

    switch (e.kind) {
      case SimEventKind.FigureHitBall:
      case SimEventKind.KeeperHitBall: {
        // Plastic on hollow plastic: bright, short, barely any body.
        const t = norm(e.impulse);
        if (t < MIN_IMPULSE) break;
        playImpact(engine, {
          freq: 1500 + t * 900,
          q: 5,
          decay: 0.05 + t * 0.05,
          gain: 0.05 + t * 0.32,
          pan,
          body: 0.02 + t * 0.05,
        });
        break;
      }

      case SimEventKind.FigureHitFigure: {
        // Two weighted bases meeting: duller, with more weight under it.
        const t = norm(e.impulse);
        if (e.impulse < MIN_IMPULSE) break;
        playImpact(engine, {
          freq: 420 + t * 260,
          q: 2.2,
          decay: 0.07 + t * 0.07,
          gain: 0.04 + t * 0.26,
          pan,
          body: 0.05 + t * 0.12,
        });
        break;
      }

      case SimEventKind.BallBounce: {
        // The felt is dead, so a bounce is mostly a soft thump.
        const t = Math.min(1, e.impulse / 1.2);
        if (t < 0.04) break;
        playImpact(engine, {
          freq: 300 + t * 260,
          q: 1.4,
          decay: 0.05 + t * 0.05,
          gain: 0.03 + t * 0.18,
          pan,
          body: 0.03 + t * 0.08,
        });
        break;
      }

      case SimEventKind.BallHitWall: {
        const t = norm(e.impulse);
        playImpact(engine, {
          freq: 700 + t * 400,
          q: 3,
          decay: 0.06,
          gain: 0.03 + t * 0.2,
          pan,
          body: 0.04,
        });
        break;
      }

      case SimEventKind.BallHitPost: {
        // A post is the one genuinely resonant thing on the table.
        const t = norm(e.impulse);
        playImpact(engine, {
          freq: 1900,
          q: 16,
          decay: 0.34,
          gain: 0.1 + t * 0.3,
          pan,
          body: 0.03,
        });
        break;
      }

      case SimEventKind.BallEnteredGoal:
        // Net ripple: broad, soft, quickly gone.
        playImpact(engine, { freq: 900, q: 0.8, decay: 0.3, gain: 0.16, pan });
        playWhistle(engine, 0.4);
        break;

      case SimEventKind.BallOutTouchline:
      case SimEventKind.BallOutGoalLine:
        playWhistle(engine, 0.16);
        break;

      default:
        break;
    }
  }
}
