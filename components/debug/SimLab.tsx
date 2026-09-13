"use client";

import { useEffect, useRef, useState } from "react";
import * as C from "@/lib/sim/constants";
import { setKickoffFormation } from "@/lib/sim/formation";
import { applyFlick, quantizeFlick } from "@/lib/sim/input";
import { step } from "@/lib/sim/step";
import {
  BALL,
  BODY_COUNT,
  BodyKind,
  FLAG_ACTIVE,
  FLAG_OUT_OF_PLAY,
  TEAM_A,
} from "@/lib/sim/types";
import { copyWorld, createWorld, isSettled } from "@/lib/sim/world";
import { dragToAim, flickableBodies, pickBody } from "@/lib/input/flick";

/**
 * The feel lab.
 *
 * Deliberately ugly and deliberately 2D. Game feel is the highest risk in the
 * project and it cannot be unit tested — it has to be judged by hitting things
 * and watching. This exists so that judgement is not gated behind the 3D
 * pipeline: it iterates in milliseconds, it shows the numbers that matter, and
 * because it shares lib/input with the real game, everything learned here
 * transfers directly.
 */

const PREVIEW_STEPS = 300;
const PREVIEW_SAMPLE = 4;

interface Hud {
  settled: boolean;
  settleTime: number;
  power: number;
  selected: number;
  /** Microseconds of solver time per simulated step. */
  simUs: number;
  fps: number;
}

export default function SimLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState<Hud>({
    settled: true,
    settleTime: 0,
    power: 0,
    selected: -1,
    simUs: 0,
    fps: 0,
  });
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    const canvasOrNull = canvasRef.current;
    if (!canvasOrNull) return;
    const ctxOrNull = canvasOrNull.getContext("2d");
    if (!ctxOrNull) return;

    // Rebound after the guards so the nested draw and input functions below
    // see non-nullable types.
    const canvas: HTMLCanvasElement = canvasOrNull;
    const ctx: CanvasRenderingContext2D = ctxOrNull;

    // --- engine state, all local to this effect ---
    // Keeping it here rather than in refs means React's Strict Mode
    // double-mount tears down a complete engine and builds a fresh one, which
    // is exactly what we want to be robust against.
    const world = createWorld();
    setKickoffFormation(world);
    const scratch = createWorld();

    const candidates = flickableBodies();
    const previewBall: number[] = [];
    const previewFigure: number[] = [];

    const drag = {
      active: false,
      body: -1,
      startX: 0,
      startY: 0,
      curX: 0,
      curY: 0,
    };

    let accumulator = 0;
    let lastFrame = performance.now();
    let settleSteps = 0;
    let running = false;
    // Browser timers are clamped well above the cost of a single step, so
    // per-frame measurement reads as zero. Accumulate over a window instead
    // and report per-step cost, which is the number that actually matters.
    let simTimeAccum = 0;
    let simStepsAccum = 0;
    let simUs = 0;
    let fps = 0;
    let hudDue = 0;
    let raf = 0;

    // --- coordinate mapping ---
    let scale = 1;
    const toScreenX = (x: number) => (x + C.HALF_LENGTH) * scale;
    const toScreenY = (y: number) => (y + C.HALF_WIDTH) * scale;

    function resize() {
      const cssWidth = canvas.clientWidth;
      const cssHeight = cssWidth * (C.PITCH_WIDTH / C.PITCH_LENGTH);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      canvas.style.height = `${cssHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      scale = cssWidth / C.PITCH_LENGTH;
    }

    function pointerToWorld(e: PointerEvent): { x: number; y: number } {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) / scale - C.HALF_LENGTH,
        y: (e.clientY - rect.top) / scale - C.HALF_WIDTH,
      };
    }

    /**
     * Run the *real* simulation forward on a scratch copy to draw the true
     * predicted path, including bounces and collisions.
     *
     * Almost no flick game does this — they draw an approximated arc — and it
     * is only affordable because the solver is cheap and side-effect free.
     */
    function rebuildPreview() {
      previewBall.length = 0;
      previewFigure.length = 0;
      if (!drag.active || drag.body < 0) return;

      const aim = dragToAim(drag.curX - drag.startX, drag.curY - drag.startY);
      if (!aim.valid) return;

      copyWorld(scratch, world);
      applyFlick(scratch, quantizeFlick(drag.body, aim.aimX, aim.aimY, aim.power, 0));

      for (let s = 0; s < PREVIEW_STEPS; s++) {
        step(scratch);
        if (s % PREVIEW_SAMPLE === 0) {
          previewBall.push(scratch.px[BALL], scratch.py[BALL]);
          previewFigure.push(scratch.px[drag.body], scratch.py[drag.body]);
        }
        if (isSettled(scratch)) break;
      }
    }

    // --- input ---
    function onPointerDown(e: PointerEvent) {
      const { x, y } = pointerToWorld(e);
      const body = pickBody(world, x, y, candidates);
      if (body < 0) return;

      canvas.setPointerCapture(e.pointerId);
      drag.active = true;
      drag.body = body;
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      drag.curX = e.clientX;
      drag.curY = e.clientY;
      rebuildPreview();
      e.preventDefault();
    }

    function onPointerMove(e: PointerEvent) {
      if (!drag.active) return;
      // Only the latest position matters for a slingshot, so there is nothing
      // to gain from coalesced events here.
      drag.curX = e.clientX;
      drag.curY = e.clientY;
      rebuildPreview();
      e.preventDefault();
    }

    function onPointerUp(e: PointerEvent) {
      if (!drag.active) return;
      const aim = dragToAim(drag.curX - drag.startX, drag.curY - drag.startY);
      if (aim.valid) {
        applyFlick(world, quantizeFlick(drag.body, aim.aimX, aim.aimY, aim.power, 0));
        settleSteps = 0;
        running = true;
      }
      drag.active = false;
      drag.body = -1;
      previewBall.length = 0;
      previewFigure.length = 0;
      e.preventDefault();
    }

    // --- drawing ---
    function drawPitch() {
      const w = C.PITCH_LENGTH * scale;
      const h = C.PITCH_WIDTH * scale;

      ctx.fillStyle = "#1b3a24";
      ctx.fillRect(0, 0, w, h);

      // Mown stripes, purely so motion across the pitch is readable.
      ctx.fillStyle = "rgba(255,255,255,0.028)";
      const stripe = 0.1 * scale;
      for (let x = 0; x < w; x += stripe * 2) ctx.fillRect(x, 0, stripe, h);

      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

      // Halfway line and centre circle.
      ctx.beginPath();
      ctx.moveTo(toScreenX(0), 0);
      ctx.lineTo(toScreenX(0), h);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(toScreenX(0), toScreenY(0), 0.09 * scale, 0, Math.PI * 2);
      ctx.stroke();

      // Shooting lines: a goal only counts from inside these.
      ctx.strokeStyle = "rgba(255,220,120,0.5)";
      ctx.setLineDash([6, 5]);
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(toScreenX(sx * C.SHOOTING_LINE_X), 0);
        ctx.lineTo(toScreenX(sx * C.SHOOTING_LINE_X), h);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Goals.
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 3;
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(toScreenX(sx * C.HALF_LENGTH), toScreenY(-C.GOAL_WIDTH / 2));
        ctx.lineTo(toScreenX(sx * C.HALF_LENGTH), toScreenY(C.GOAL_WIDTH / 2));
        ctx.stroke();
      }
      ctx.lineWidth = 1;
    }

    function drawPreview() {
      if (previewBall.length < 4) return;

      const strokePath = (pts: number[], colour: string, dash: number[]) => {
        ctx.strokeStyle = colour;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(toScreenX(pts[0]), toScreenY(pts[1]));
        for (let i = 2; i < pts.length; i += 2) {
          ctx.lineTo(toScreenX(pts[i]), toScreenY(pts[i + 1]));
        }
        ctx.stroke();
        ctx.setLineDash([]);
      };

      strokePath(previewFigure, "rgba(120,200,255,0.75)", [4, 3]);
      strokePath(previewBall, "rgba(255,255,255,0.85)", []);
    }

    function drawSlingshot() {
      if (!drag.active || drag.body < 0) return;
      const aim = dragToAim(drag.curX - drag.startX, drag.curY - drag.startY);
      if (!aim.valid) return;

      const ox = toScreenX(world.px[drag.body]);
      const oy = toScreenY(world.py[drag.body]);
      const len = 0.02 * scale + aim.power * 0.14 * scale;

      ctx.strokeStyle = "rgba(255,120,120,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + aim.aimX * len, oy + aim.aimY * len);
      ctx.stroke();

      ctx.strokeStyle = `rgba(255,${Math.round(200 - aim.power * 160)},80,0.9)`;
      ctx.beginPath();
      ctx.arc(ox, oy, C.BASE_RADIUS * scale + 4, -Math.PI / 2, -Math.PI / 2 + aim.power * Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    function drawBodies() {
      // Contact shadows first, so they sit under everything.
      for (let i = 0; i < BODY_COUNT; i++) {
        if ((world.flags[i] & FLAG_ACTIVE) === 0) continue;
        if (world.flags[i] & FLAG_OUT_OF_PLAY) continue;
        const lift = i === BALL ? world.pz[i] : 0;
        const r = world.radius[i] * scale * (1 + lift * 6);
        ctx.fillStyle = `rgba(0,0,0,${0.35 / (1 + lift * 40)})`;
        ctx.beginPath();
        ctx.ellipse(
          toScreenX(world.px[i]) + 1.5,
          toScreenY(world.py[i]) + 2.5,
          r,
          r * 0.85,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }

      for (let i = 0; i < BODY_COUNT; i++) {
        if ((world.flags[i] & FLAG_ACTIVE) === 0) continue;
        if (world.flags[i] & FLAG_OUT_OF_PLAY) continue;

        const x = toScreenX(world.px[i]);
        // A lofted ball is drawn raised, so height is readable at a glance.
        const y = toScreenY(world.py[i]) - (i === BALL ? world.pz[i] * scale * 1.5 : 0);
        const r = world.radius[i] * scale;

        if (world.kind[i] === BodyKind.Ball) {
          ctx.fillStyle = "#fdfdfd";
        } else if (world.kind[i] === BodyKind.Keeper) {
          ctx.fillStyle = world.team[i] === TEAM_A ? "#7fd1ff" : "#ffc98a";
        } else {
          ctx.fillStyle = world.team[i] === TEAM_A ? "#2f7fd4" : "#d4442f";
        }

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();

        if (i === drag.body) {
          ctx.strokeStyle = "#ffe680";
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.lineWidth = 1;
        }
      }
    }

    // --- loop ---
    function frame(now: number) {
      const dt = Math.min((now - lastFrame) / 1000, 0.1);
      lastFrame = now;
      fps = fps * 0.9 + (1 / Math.max(dt, 1e-6)) * 0.1;

      if (running) {
        accumulator += dt;
        const simStart = performance.now();
        let steps = 0;
        while (accumulator >= C.DT && steps < 8) {
          step(world);
          settleSteps++;
          accumulator -= C.DT;
          steps++;
          if (isSettled(world)) {
            running = false;
            accumulator = 0;
            break;
          }
        }
        if (steps >= 8) accumulator = 0;
        simTimeAccum += performance.now() - simStart;
        simStepsAccum += steps;
      } else {
        accumulator = 0;
      }

      drawPitch();
      drawPreview();
      drawBodies();
      drawSlingshot();

      // React is updated a few times a second, never per frame.
      if (now >= hudDue) {
        hudDue = now + 150;
        if (simStepsAccum > 0) {
          simUs = (simTimeAccum * 1000) / simStepsAccum;
          simTimeAccum = 0;
          simStepsAccum = 0;
        }
        const aim = drag.active
          ? dragToAim(drag.curX - drag.startX, drag.curY - drag.startY)
          : null;
        setHud({
          settled: !running,
          settleTime: settleSteps * C.DT,
          power: aim?.valid ? aim.power : 0,
          selected: drag.body,
          simUs,
          fps,
        });
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
    };
  }, [resetKey]);

  return (
    <div className="mx-auto w-full max-w-5xl p-4 text-neutral-200">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-lg font-semibold">Feel lab</h1>
        <button
          onClick={() => setResetKey((k) => k + 1)}
          className="rounded bg-neutral-700 px-3 py-1 text-sm hover:bg-neutral-600"
        >
          Reset
        </button>
      </div>

      <canvas
        ref={canvasRef}
        className="w-full touch-none select-none rounded-lg shadow-lg"
      />

      <p className="mt-3 text-sm text-neutral-400">
        Press a figure, drag <em>away</em> from where you want it to go, release. The white line
        is the ball&rsquo;s real predicted path, simulated forward with the same solver &mdash;
        not an approximation.
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-xs sm:grid-cols-3">
        <Stat label="state" value={hud.settled ? "settled" : "running"} />
        <Stat label="settle" value={`${hud.settleTime.toFixed(2)}s`} />
        <Stat label="power" value={hud.power.toFixed(2)} />
        <Stat label="body" value={hud.selected < 0 ? "—" : String(hud.selected)} />
        <Stat label="sim/step" value={`${hud.simUs.toFixed(1)}\u00b5s`} />
        <Stat label="fps" value={hud.fps.toFixed(0)} />
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-neutral-800 py-0.5">
      <dt className="text-neutral-500">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
