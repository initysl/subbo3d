import * as C from "./constants";
import type { World } from "./world";
import { wakeBody } from "./world";

/**
 * A flick, quantised to integers.
 *
 * Quantisation happens here, at the *input* boundary, not later at a network
 * boundary. That is deliberate: it means the local player and a future remote
 * peer feed bit-identical floating-point values into the solver. Deferring it
 * to M2 would surface as a desync only after the input, rules, replay and
 * golden-test layers all depended on the unquantised path.
 *
 * Packs into 8 bytes on the wire.
 */
export interface FlickCommand {
  bodyId: number;
  /** Direction, each component scaled to int16. Renormalised on use. */
  dirX: number;
  dirY: number;
  /** Power, scaled to uint16. */
  power: number;
  /** Loft, scaled to uint8. */
  loft: number;
}

export const DIR_SCALE = 32767;
export const POWER_SCALE = 65535;
export const LOFT_SCALE = 255;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Build a command from a raw aim vector, a normalised power in [0,1] and a
 * normalised loft in [0,1].
 */
export function quantizeFlick(
  bodyId: number,
  aimX: number,
  aimY: number,
  power: number,
  loft: number,
): FlickCommand {
  const len = Math.sqrt(aimX * aimX + aimY * aimY);
  const ux = len > 0 ? aimX / len : 0;
  const uy = len > 0 ? aimY / len : 0;

  return {
    bodyId,
    dirX: Math.round(clamp(ux, -1, 1) * DIR_SCALE),
    dirY: Math.round(clamp(uy, -1, 1) * DIR_SCALE),
    power: Math.round(clamp(power, 0, 1) * POWER_SCALE),
    loft: Math.round(clamp(loft, 0, 1) * LOFT_SCALE),
  };
}

/**
 * Apply a flick to the world.
 *
 * The renormalisation below must be performed identically on every peer —
 * same operations, same order — so it lives here rather than being inlined at
 * call sites.
 */
export function applyFlick(w: World, cmd: FlickCommand): void {
  const x = cmd.dirX / DIR_SCALE;
  const y = cmd.dirY / DIR_SCALE;
  const len2 = x * x + y * y;
  if (len2 === 0) return;

  const inv = 1 / Math.sqrt(len2);
  const speed = (cmd.power / POWER_SCALE) * C.MAX_FLICK_SPEED;

  w.vx[cmd.bodyId] = x * inv * speed;
  w.vy[cmd.bodyId] = y * inv * speed;
  w.pendingLoft[cmd.bodyId] = cmd.loft / LOFT_SCALE;
  wakeBody(w, cmd.bodyId);
}
