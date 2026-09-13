import { DT } from "@/lib/sim/constants";
import type { RulesetConfig } from "../types";

const MINUTES = 60 / DT;

/**
 * A looser preset for casual play: flick any figure as often as you like,
 * shoot from anywhere, no block-flicks to wait for.
 *
 * It is a different object, not a different code path — the state machine
 * contains no rule constants of its own.
 */
export const ARCADE: RulesetConfig = {
  id: "arcade",
  maxFlicksPerFigure: Number.MAX_SAFE_INTEGER,
  blockFlickEnabled: false,
  shootingAreaRequired: false,
  flickInsEnabled: true,
  goalFlicksEnabled: true,
  cornerFlicksEnabled: true,
  halfLengthSteps: Math.round(5 * MINUTES),
  halves: 2,
  goalCelebrationSteps: Math.round(1.5 / DT),
};
