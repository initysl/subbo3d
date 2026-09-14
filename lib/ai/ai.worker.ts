/// <reference lib="webworker" />

import { searchBestFlick, type Difficulty } from "./search";
import type { RulesetConfig } from "@/lib/rules/types";
import type { FlickCommand } from "@/lib/sim/input";

/**
 * Worker entry point for the opponent.
 *
 * A candidate takes roughly four milliseconds to play out, so a few hundred
 * of them is most of a second. On the main thread that is a visible freeze
 * mid-game; here it is just the opponent thinking.
 */

export interface AiRequest {
  id: number;
  snapshot: ArrayBuffer;
  cfg: RulesetConfig;
  team: number;
  difficulty: Difficulty;
  seed: number;
}

export interface AiResponse {
  id: number;
  command: FlickCommand | null;
  examined: number;
  elapsedMs: number;
}

self.onmessage = (event: MessageEvent<AiRequest>) => {
  const req = event.data;
  const started = performance.now();

  let command: FlickCommand | null = null;
  let examined = 0;

  try {
    const result = searchBestFlick(
      new Float64Array(req.snapshot),
      req.cfg,
      req.team,
      req.difficulty,
      req.seed,
      () => performance.now(),
    );
    if (result) {
      command = result.command;
      examined = result.examined;
    }
  } catch (err) {
    // A thrown search must not wedge the game: reply with no move and let the
    // controller fall back rather than leaving the turn hanging forever.
    console.error("AI search failed", err);
  }

  const response: AiResponse = {
    id: req.id,
    command,
    examined,
    elapsedMs: performance.now() - started,
  };
  self.postMessage(response);
};
