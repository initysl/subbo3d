"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import { DT } from "@/lib/sim/constants";
import { Phase, type MatchState } from "@/lib/rules/types";
import { Hud, type HudState } from "./Hud";

/**
 * `ssr: false` is only allowed inside a Client Component in Next 16, which is
 * why this wrapper exists rather than the page doing the dynamic import.
 */
const GameCanvas = dynamic(() => import("./GameCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-neutral-500">
      Setting out the pitch…
    </div>
  ),
});

function formatClock(steps: number): string {
  const total = Math.floor(steps * DT);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${ss < 10 ? "0" : ""}${ss}`;
}

export function GameShell() {
  const [hud, setHud] = useState<HudState>({
    phase: Phase.AwaitAttackFlick,
    attacker: 0,
    flicksUsed: 0,
    score0: 0,
    score1: 0,
    clock: "0:00",
    half: 1,
    fps: 0,
    drawCalls: 0,
  });
  const skipRef = useRef<(() => void) | null>(null);

  // The canvas calls this a few times a second, never per frame: React stays
  // entirely out of the render loop.
  const onState = useCallback((s: Readonly<MatchState>, fps: number, drawCalls: number) => {
    setHud({
      phase: s.phase,
      attacker: s.attackerTeam,
      flicksUsed: s.flicksOnCurrentFigure,
      score0: s.score0,
      score1: s.score1,
      clock: formatClock(s.clockSteps),
      half: s.half,
      fps,
      drawCalls,
    });
  }, []);

  const onReady = useCallback((skip: () => void) => {
    skipRef.current = skip;
  }, []);

  return (
    <div className="relative h-dvh w-dvw overflow-hidden bg-neutral-900">
      <GameCanvas onState={onState} onReady={onReady} />
      <Hud state={hud} onSkipBlockFlick={() => skipRef.current?.()} />
      <p className="pointer-events-none absolute inset-x-0 bottom-0 p-4 text-center text-xs text-neutral-500">
        Press a figure, drag away from where you want it to go, release.
      </p>
    </div>
  );
}
