"use client";

import type { DifficultyName } from "@/lib/ai/controller";
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

export interface HudProps {
  state: HudState;
  onSkipBlockFlick: () => void;
  /** Team the computer plays, or -1 for hot-seat. */
  aiTeam: number;
  difficulty: DifficultyName;
  onAiTeamChange: (team: number) => void;
  onDifficultyChange: (difficulty: DifficultyName) => void;
}

const DIFFICULTY_NAMES: DifficultyName[] = ["easy", "normal", "hard"];

/** Must match TEAM_COLOURS in lib/render/scene.ts. */
const TEAM_HEX = ["#2f7fd4", "#d4442f"];
const TEAM_NAME = ["BLUE", "RED"];

/**
 * A club crest: a coloured disc with the team's initial.
 *
 * Drawn in CSS rather than fetched. It is two divs, it scales cleanly on any
 * display, and it keeps the promise that this project ships no binary art.
 */
function Crest({ team }: { team: number }) {
  return (
    <span
      className="grid h-9 w-9 place-items-center rounded-full border-2 border-white/25 text-sm font-black text-white/95 shadow-inner"
      style={{ background: `radial-gradient(circle at 35% 30%, ${TEAM_HEX[team]}, #0009)` }}
    >
      {TEAM_NAME[team][0]}
    </span>
  );
}

/**
 * What the game is waiting for, said in one line.
 *
 * The phase is the single thing a player must know at a glance — whose turn
 * it is, and whether something unusual (a block-flick, a goal) is on offer.
 */
function statusFor(state: HudState): { label: string; tone: string } | null {
  switch (state.phase) {
    case Phase.BlockFlickOffered:
      return { label: "BLOCK-FLICK", tone: "bg-amber-400 text-black" };
    case Phase.GoalScored:
      return { label: "GOAL!", tone: "bg-emerald-400 text-black" };
    case Phase.HalfTime:
      return { label: "HALF TIME", tone: "bg-white text-black" };
    case Phase.FullTime:
      return { label: "FULL TIME", tone: "bg-white text-black" };
    case Phase.Resolving:
      return null;
    default:
      return {
        label: `${TEAM_NAME[state.attacker]} TO FLICK`,
        tone: "bg-black/70 text-white",
      };
  }
}

export function Hud({
  state,
  onSkipBlockFlick,
  aiTeam,
  difficulty,
  onAiTeamChange,
  onDifficultyChange,
}: HudProps) {
  const status = statusFor(state);

  return (
    <>
      {/* Scoreboard, centred over the halfway line like a broadcast bug. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-1.5 p-3">
        <div className="flex items-center gap-3 rounded-full border border-white/10 bg-black/65 px-3 py-1.5 shadow-lg backdrop-blur">
          <Crest team={0} />
          <div className="flex items-baseline gap-2 font-mono text-3xl font-bold tabular-nums text-white">
            <span>{state.score0}</span>
            <span className="text-lg text-white/40">:</span>
            <span>{state.score1}</span>
          </div>
          <Crest team={1} />
          <div className="ml-1 border-l border-white/15 pl-3 text-right font-mono text-sm leading-tight text-white/80">
            <div className="tabular-nums">{state.clock}</div>
            <div className="text-[10px] tracking-widest text-white/45">H{state.half}</div>
          </div>
        </div>

        {status && (
          <div
            className={`flex items-center gap-2 rounded-full px-3 py-1 font-mono text-xs font-bold tracking-widest shadow ${status.tone}`}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: TEAM_HEX[state.attacker] }}
            />
            {status.label}
            {state.phase === Phase.AwaitAttackFlick && (
              <span className="font-normal opacity-60">{state.flicksUsed}/3</span>
            )}
          </div>
        )}

        {state.phase === Phase.BlockFlickOffered && (
          <button
            onClick={onSkipBlockFlick}
            className="pointer-events-auto rounded-full bg-amber-500 px-4 py-1.5 text-xs font-bold tracking-wide text-black shadow hover:bg-amber-400"
          >
            SKIP BLOCK-FLICK
          </button>
        )}
      </div>

      {/* Match settings, out of the way in the corner. */}
      <div className="pointer-events-auto absolute left-3 top-3 flex flex-col gap-1.5 font-mono text-[11px]">
        <button
          onClick={() => onAiTeamChange(aiTeam >= 0 ? -1 : 1)}
          className="rounded-full border border-white/10 bg-black/60 px-3 py-1.5 text-white/80 backdrop-blur hover:bg-black/80"
        >
          {aiTeam >= 0 ? "vs computer" : "hot-seat"}
        </button>

        {aiTeam >= 0 && (
          <div className="flex overflow-hidden rounded-full border border-white/10 bg-black/60 backdrop-blur">
            {DIFFICULTY_NAMES.map((name) => (
              <button
                key={name}
                onClick={() => onDifficultyChange(name)}
                className={`px-2.5 py-1.5 ${
                  difficulty === name ? "bg-white text-neutral-900" : "text-white/55 hover:text-white"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-2 left-3 font-mono text-[10px] text-white/30">
        {state.fps.toFixed(0)} fps · {state.drawCalls} draw calls
      </div>
    </>
  );
}
