"use client";

import { Phase } from "@/lib/rules/types";

export interface HudState {
  phase: Phase;
  attacker: number;
  flicksUsed: number;
  score0: number;
  score1: number;
  clock: string;
  half: number;
  fps: number;
  drawCalls: number;
}

const PHASE_LABEL: Record<number, string> = {
  [Phase.FlickOff]: "flick-off",
  [Phase.AwaitAttackFlick]: "your flick",
  [Phase.Resolving]: "…",
  [Phase.BlockFlickOffered]: "BLOCK-FLICK",
  [Phase.Restart]: "restart",
  [Phase.GoalScored]: "GOAL!",
  [Phase.HalfTime]: "half time",
  [Phase.FullTime]: "full time",
};

export function Hud({ state, onSkipBlockFlick }: { state: HudState; onSkipBlockFlick: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-3 text-neutral-100">
        <div className="rounded-lg bg-black/50 px-3 py-1.5 font-mono text-2xl tabular-nums backdrop-blur">
          <span className="text-sky-400">{state.score0}</span>
          <span className="mx-2 text-neutral-500">–</span>
          <span className="text-red-400">{state.score1}</span>
        </div>

        <div className="rounded-lg bg-black/50 px-3 py-1.5 font-mono text-sm backdrop-blur">
          {state.clock} · H{state.half}
        </div>

        <div
          className={`rounded-lg px-3 py-1.5 font-mono text-sm backdrop-blur ${
            state.phase === Phase.BlockFlickOffered
              ? "bg-amber-500 text-black"
              : state.phase === Phase.GoalScored
                ? "bg-emerald-500 text-black"
                : "bg-black/50"
          }`}
        >
          {PHASE_LABEL[state.phase] ?? "?"}
        </div>

        <div className="rounded-lg bg-black/50 px-3 py-1.5 font-mono text-sm backdrop-blur">
          <span className="text-neutral-400">to play </span>
          <span className={state.attacker === 0 ? "text-sky-400" : "text-red-400"}>
            {state.attacker === 0 ? "blue" : "red"}
          </span>
          <span className="ml-3 text-neutral-400">flicks </span>
          <span>{state.flicksUsed}/3</span>
        </div>

        {state.phase === Phase.BlockFlickOffered && (
          <button
            onClick={onSkipBlockFlick}
            className="pointer-events-auto rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500"
          >
            Skip block-flick
          </button>
        )}
      </div>

      <div className="font-mono text-[11px] text-neutral-500">
        {state.fps.toFixed(0)} fps · {state.drawCalls} draw calls
      </div>
    </div>
  );
}
