"use client";

import { useEffect, useRef } from "react";
import * as C from "@/lib/sim/constants";
import { Match } from "@/lib/match/Match";
import { FISTF } from "@/lib/rules/presets";
import type { MatchState } from "@/lib/rules/types";
import { applyFlick, quantizeFlick } from "@/lib/sim/input";
import { step } from "@/lib/sim/step";
import { BALL } from "@/lib/sim/types";
import { copyWorld, createWorld, isSettled } from "@/lib/sim/world";
import { dragToAim, flickableBodies, pickBody } from "@/lib/input/flick";
import { createScene, type Scene3D } from "@/lib/render/scene";

/**
 * The only module that pulls in three.js.
 *
 * Keeping the import here, behind a dynamic `ssr: false` boundary in
 * GameShell, means three lands in its own lazy chunk and the marketing page
 * never pays for it.
 */

const PREVIEW_STEPS = 300;
const PREVIEW_SAMPLE = 4;

export interface GameCanvasProps {
  /** Called a few times a second with HUD state. Never per frame. */
  onState: (state: Readonly<MatchState>, fps: number, drawCalls: number) => void;
  /** Receives a function that declines the owed block-flick. */
  onReady: (skipBlockFlick: () => void) => void;
}

export default function GameCanvas({ onState, onReady }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onStateRef = useRef(onState);
  const onReadyRef = useRef(onReady);

  // Kept in a ref and synced in an effect rather than assigned during render:
  // the render loop must not re-create itself just because a callback
  // identity changed, and refs may not be written while rendering.
  useEffect(() => {
    onStateRef.current = onState;
    onReadyRef.current = onReady;
  }, [onState, onReady]);

  useEffect(() => {
    const canvasOrNull = canvasRef.current;
    if (!canvasOrNull) return;
    const canvas: HTMLCanvasElement = canvasOrNull;

    let scene: Scene3D;
    try {
      scene = createScene(canvas);
    } catch (err) {
      console.error("Failed to create the 3D scene", err);
      return;
    }

    const match = new Match(FISTF, 0);
    const world = match.world;
    const scratch = createWorld();
    const candidates = flickableBodies();
    const previewBall: number[] = [];
    const previewFigure: number[] = [];

    onReadyRef.current(() => match.skipBlockFlick());

    const drag = { active: false, body: -1, startX: 0, startY: 0, curX: 0, curY: 0 };

    let accumulator = 0;
    let last = performance.now();
    // Seeded at a sane value and ignored on the very first frame, whose dt is
    // meaningless and otherwise reports tens of thousands of fps.
    let fps = 60;
    let firstFrame = true;
    let hudDue = 0;
    let raf = 0;

    function resize() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w > 0 && h > 0) scene.resize(w, h);
    }

    /**
     * Run the real solver forward on a scratch world so the preview shows the
     * true path, bounces and collisions included, rather than an arc.
     */
    function rebuildPreview() {
      previewBall.length = 0;
      previewFigure.length = 0;
      if (!drag.active || drag.body < 0) {
        scene.setAim(previewFigure, previewBall);
        return;
      }
      const aim = dragToAim(drag.curX - drag.startX, drag.curY - drag.startY);
      if (!aim.valid) {
        scene.setAim(previewFigure, previewBall);
        return;
      }

      const body = drag.body;
      copyWorld(scratch, world);
      applyFlick(scratch, quantizeFlick(body, aim.aimX, aim.aimY, aim.power, 0));
      for (let s = 0; s < PREVIEW_STEPS; s++) {
        step(scratch);
        if (s % PREVIEW_SAMPLE === 0) {
          previewBall.push(scratch.px[BALL], scratch.py[BALL]);
          previewFigure.push(scratch.px[body], scratch.py[body]);
        }
        if (isSettled(scratch)) break;
      }
      scene.setAim(previewFigure, previewBall);
    }

    function onPointerDown(e: PointerEvent) {
      const hit = scene.screenToPitch(e.clientX, e.clientY);
      if (!hit) return;
      const body = pickBody(world, hit.x, hit.y, candidates);
      if (body < 0 || !match.canFlick(body)) return;

      canvas.setPointerCapture(e.pointerId);
      drag.active = true;
      drag.body = body;
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      drag.curX = e.clientX;
      drag.curY = e.clientY;
      scene.setSelected(body);
      rebuildPreview();
      e.preventDefault();
    }

    function onPointerMove(e: PointerEvent) {
      if (!drag.active) return;
      drag.curX = e.clientX;
      drag.curY = e.clientY;
      rebuildPreview();
      e.preventDefault();
    }

    function onPointerUp(e: PointerEvent) {
      if (!drag.active) return;
      const aim = dragToAim(drag.curX - drag.startX, drag.curY - drag.startY);
      if (aim.valid) {
        match.flick(quantizeFlick(drag.body, aim.aimX, aim.aimY, aim.power, 0));
      }
      drag.active = false;
      drag.body = -1;
      previewBall.length = 0;
      previewFigure.length = 0;
      scene.setAim(previewFigure, previewBall);
      scene.setSelected(-1);
      e.preventDefault();
    }

    function frame(now: number) {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (firstFrame) firstFrame = false;
      else fps = fps * 0.9 + (1 / Math.max(dt, 1e-6)) * 0.1;

      // The clock is counted in simulation steps, so it only keeps real time
      // if the steps keep coming — step every frame whatever the phase.
      accumulator += dt;
      let steps = 0;
      while (accumulator >= C.DT && steps < 8) {
        match.step();
        accumulator -= C.DT;
        steps++;
      }
      if (steps >= 8) accumulator = 0;

      scene.sync(world, accumulator / C.DT);
      scene.render();

      if (now >= hudDue) {
        hudDue = now + 150;
        onStateRef.current(match.state, fps, scene.drawCalls);
      }

      raf = requestAnimationFrame(frame);
    }

    const onResize = () => resize();
    resize();
    window.addEventListener("resize", onResize);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      scene.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="block h-full w-full touch-none select-none" />;
}
