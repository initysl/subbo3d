import { DT } from "@/lib/sim/constants";
import type { RulesetConfig } from "../types";

const MINUTES = 60 / DT;

/**
 * Tournament rules, as far as this milestone implements them.
 *
 * Not yet included, and deliberately so: offside (Rule 13), fouls and cards
 * (10), free-flicks (11), penalty-flicks (12) and the spare-goalkeeper (9).
 * Each slots into this same config without changing the state machine.
 */
export const FISTF: RulesetConfig = {
  id: "fistf-5.2",
  maxFlicksPerFigure: 3,
  blockFlickEnabled: true,
  shootingAreaRequired: true,
  flickInsEnabled: true,
  goalFlicksEnabled: true,
  cornerFlicksEnabled: true,
  halfLengthSteps: Math.round(15 * MINUTES),
  halves: 2,
  goalCelebrationSteps: Math.round(2 / DT),
  keeperMode: "auto",
};
