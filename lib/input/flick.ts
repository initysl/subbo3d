import { BASE_RADIUS } from "@/lib/sim/constants";
import { BODY_COUNT, FLAG_ACTIVE, FLAG_OUT_OF_PLAY } from "@/lib/sim/types";
import type { World } from "@/lib/sim/world";

/**
 * Input helpers shared by the debug lab and, later, the 3D renderer.
 *
 * These live outside the determinism boundary on purpose: they turn messy
 * pointer input into the clean numbers that `quantizeFlick` then freezes into
 * an integer command. Everything downstream of that is deterministic.
 */

/** Drag length, in pixels, that corresponds to full power. */
export const MAX_DRAG_PX = 160;
/** Below this the drag is treated as a mis-tap rather than a flick. */
export const MIN_DRAG_PX = 8;

/**
 * Shapes the drag-to-power curve.
 *
 * Below 1 this lifts the bottom of the range. Measurement showed that powers
 * under about 0.3 barely move the ball — the figure loses most of its energy
 * to friction before it arrives — so a linear mapping wastes the first third
 * of the drag on flicks that do nothing.
 */
export const POWER_GAMMA = 0.8;

/** How far from a figure's centre a press still counts as selecting it. */
export const PICK_RADIUS = BASE_RADIUS * 2.2;

export interface Aim {
  aimX: number;
  aimY: number;
  power: number;
  /** False when the drag is too short to be a deliberate flick. */
  valid: boolean;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Convert a slingshot drag into an aim direction and power.
 *
 * `dx, dy` is the drag in pixels, measured from the figure toward the pointer.
 * The figure travels *opposite* the drag, like pulling back a catapult.
 *
 * Power comes from drag length rather than release velocity. Release velocity
 * would be hostage to the pointer's sample rate — a 60Hz trackpad and a 240Hz
 * mouse would produce different power for the same physical gesture, which is
 * unfixable and unfair — and it cannot be previewed, which would ruin the
 * learnability of a game whose whole skill is aiming.
 */
export function dragToAim(dx: number, dy: number, maxDragPx = MAX_DRAG_PX): Aim {
  const len = Math.hypot(dx, dy);
  if (len < MIN_DRAG_PX) {
    return { aimX: 0, aimY: 0, power: 0, valid: false };
  }
  const t = clamp01(len / maxDragPx);
  return {
    aimX: -dx / len,
    aimY: -dy / len,
    power: Math.pow(t, POWER_GAMMA),
    valid: true,
  };
}

/**
 * Nearest selectable body to a point, in world coordinates.
 *
 * Deliberately not a raycast against rendered meshes: the pitch is a plane, so
 * a nearest-centre search over 23 bodies is exact, costs nothing, and works
 * identically in the 2D lab and the 3D game — which means the input layer is
 * shared and testable from the start.
 */
export function pickBody(
  w: World,
  x: number,
  y: number,
  candidates: readonly number[],
  radius = PICK_RADIUS,
): number {
  let best = -1;
  let bestDist2 = radius * radius;

  for (const i of candidates) {
    if ((w.flags[i] & FLAG_ACTIVE) === 0) continue;
    if (w.flags[i] & FLAG_OUT_OF_PLAY) continue;
    const dx = w.px[i] - x;
    const dy = w.py[i] - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      best = i;
    }
  }
  return best;
}

/** Every outfield figure and keeper, for picking. */
export function flickableBodies(): number[] {
  const out: number[] = [];
  for (let i = 1; i < BODY_COUNT; i++) out.push(i);
  return out;
}
