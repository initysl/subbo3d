import { SNAPSHOT_FLOATS, writeSnapshot } from "@/lib/match/snapshot";
import type { Match } from "@/lib/match/Match";
import type { FlickCommand } from "@/lib/sim/input";
import { DIFFICULTIES, searchBestFlick, type Difficulty } from "./search";
import type { AiRequest, AiResponse } from "./ai.worker";

export type DifficultyName = keyof typeof DIFFICULTIES;

/**
 * Main-thread side of the opponent.
 *
 * Owns the worker, keeps at most one search in flight, and falls back to
 * searching inline if a worker cannot be created — the search itself is pure,
 * so the only cost of the fallback is a brief stall.
 */
export class AiController {
  private worker: Worker | null = null;
  private pending = 0;
  private nextId = 1;
  private readonly buffer = new Float64Array(SNAPSHOT_FLOATS);
  private onResult: ((cmd: FlickCommand | null) => void) | null = null;

  difficulty: Difficulty = DIFFICULTIES.normal;

  constructor() {
    try {
      this.worker = new Worker(new URL("./ai.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (event: MessageEvent<AiResponse>) => {
        // Ignore stale replies: the match has moved on since they were asked.
        if (event.data.id !== this.pending) return;
        this.pending = 0;
        const cb = this.onResult;
        this.onResult = null;
        cb?.(event.data.command);
      };
      this.worker.onerror = () => {
        // Worker is unusable; drop it and take the inline path from here on.
        this.worker?.terminate();
        this.worker = null;
        this.pending = 0;
        const cb = this.onResult;
        this.onResult = null;
        cb?.(null);
      };
    } catch {
      this.worker = null;
    }
  }

  get thinking(): boolean {
    return this.pending !== 0;
  }

  /**
   * Ask for a move. The callback fires once, later, on the main thread.
   * Calling again while a search is in flight is ignored.
   */
  request(match: Match, team: number, onResult: (cmd: FlickCommand | null) => void): void {
    if (this.pending !== 0) return;

    writeSnapshot(match, this.buffer);
    const seed = (Math.random() * 0x7fffffff) | 0;

    if (!this.worker) {
      // No worker: search inline. This stalls the frame, which is why the
      // worker is the normal path, but it keeps the game playable.
      const result = searchBestFlick(this.buffer, match.cfg, team, this.difficulty, seed);
      onResult(result ? result.command : null);
      return;
    }

    const id = this.nextId++;
    this.pending = id;
    this.onResult = onResult;

    // The snapshot is copied rather than transferred: the controller reuses
    // its buffer every turn, and a transfer would detach it.
    const snapshot = this.buffer.slice().buffer;
    const request: AiRequest = {
      id,
      snapshot,
      cfg: match.cfg,
      team,
      difficulty: this.difficulty,
      seed,
    };
    this.worker.postMessage(request, [snapshot]);
  }

  cancel(): void {
    this.pending = 0;
    this.onResult = null;
  }

  dispose(): void {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }
}
