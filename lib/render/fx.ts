import * as THREE from "three";
import { BODY_COUNT } from "@/lib/sim/types";

/**
 * Render-side effects.
 *
 * All of this sits on top of the simulation transform and never feeds back
 * into it — the figures are exactly where the solver says they are, they
 * just lean about a bit on the way.
 */

/** Spring stiffness and damping for the base wobble. */
const WOBBLE_K = 950;
const WOBBLE_C = 17;
/** Radians of tilt per unit of contact impulse. */
const WOBBLE_GAIN = 260;
const WOBBLE_MAX = 0.42;

/**
 * A damped rotational spring per figure.
 *
 * A weighted base rocking on its dome after a hit is the Subbuteo signature,
 * and it is the cheapest tactility in the whole effects list: about forty
 * lines for something the eye reads instantly.
 */
export class Wobble {
  private readonly tiltX = new Float32Array(BODY_COUNT);
  private readonly tiltZ = new Float32Array(BODY_COUNT);
  private readonly velX = new Float32Array(BODY_COUNT);
  private readonly velZ = new Float32Array(BODY_COUNT);
  private readonly euler = new THREE.Euler();

  /** `dx, dz` is the direction the impact pushed the figure, in three-space. */
  kick(body: number, impulse: number, dx: number, dz: number): void {
    if (body < 0 || body >= BODY_COUNT) return;
    const k = impulse * WOBBLE_GAIN;
    // Tipping the top toward +x is a negative rotation about z, and toward
    // +z a positive rotation about x.
    this.velZ[body] -= dx * k;
    this.velX[body] += dz * k;
  }

  update(dt: number): void {
    // Clamped so a pathological frame cannot make the spring explode.
    const h = Math.min(dt, 1 / 30);
    for (let i = 0; i < BODY_COUNT; i++) {
      if (this.tiltX[i] === 0 && this.velX[i] === 0 && this.tiltZ[i] === 0 && this.velZ[i] === 0) {
        continue;
      }
      this.velX[i] += (-WOBBLE_K * this.tiltX[i] - WOBBLE_C * this.velX[i]) * h;
      this.velZ[i] += (-WOBBLE_K * this.tiltZ[i] - WOBBLE_C * this.velZ[i]) * h;
      this.tiltX[i] = THREE.MathUtils.clamp(this.tiltX[i] + this.velX[i] * h, -WOBBLE_MAX, WOBBLE_MAX);
      this.tiltZ[i] = THREE.MathUtils.clamp(this.tiltZ[i] + this.velZ[i] * h, -WOBBLE_MAX, WOBBLE_MAX);

      // Snap to rest so settled figures stop costing anything.
      if (Math.abs(this.tiltX[i]) < 1e-4 && Math.abs(this.velX[i]) < 1e-3) {
        this.tiltX[i] = 0;
        this.velX[i] = 0;
      }
      if (Math.abs(this.tiltZ[i]) < 1e-4 && Math.abs(this.velZ[i]) < 1e-3) {
        this.tiltZ[i] = 0;
        this.velZ[i] = 0;
      }
    }
  }

  applyTo(body: number, out: THREE.Quaternion): void {
    if (this.tiltX[body] === 0 && this.tiltZ[body] === 0) {
      out.identity();
      return;
    }
    this.euler.set(this.tiltX[body], 0, this.tiltZ[body]);
    out.setFromEuler(this.euler);
  }

  reset(): void {
    this.tiltX.fill(0);
    this.tiltZ.fill(0);
    this.velX.fill(0);
    this.velZ.fill(0);
  }
}

/**
 * Impulse-driven camera shake.
 *
 * Kept deliberately small: at this scale a big shake reads as a broken camera
 * rather than a hard hit, and it makes the pitch harder to read.
 */
export class Shake {
  private amp = 0;
  private t = 0;

  add(amount: number): void {
    this.amp = Math.min(0.012, this.amp + amount);
  }

  update(dt: number): void {
    this.t += dt;
    this.amp *= Math.exp(-9 * dt);
    if (this.amp < 1e-5) this.amp = 0;
  }

  offsetX(): number {
    return this.amp === 0 ? 0 : Math.sin(this.t * 71) * this.amp;
  }

  offsetY(): number {
    return this.amp === 0 ? 0 : Math.sin(this.t * 53 + 1.7) * this.amp * 0.7;
  }
}

const TRAIL_POINTS = 26;
/** Metres between trail samples — about a 10 cm ribbon at full length. */
const TRAIL_SPACING = 0.004;

/**
 * A short ribbon behind the ball.
 *
 * It communicates speed and curve at a glance, and replaces motion blur
 * entirely — a velocity-buffer blur would cost several milliseconds to say
 * the same thing less clearly at this scale.
 */
export class Trail {
  readonly line: THREE.Line;
  private readonly positions: Float32Array;
  private readonly geom: THREE.BufferGeometry;
  private readonly mat: THREE.LineBasicMaterial;
  private filled = 0;

  constructor() {
    this.positions = new Float32Array(TRAIL_POINTS * 3);
    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    this.line = new THREE.Line(this.geom, this.mat);
    this.line.frustumCulled = false;
  }

  /**
   * Append a point, but only once the ball has actually travelled.
   *
   * Sampling per frame would make the trail's length depend on frame rate —
   * long and sparse at 30fps, short and dense at 120. Sampling by distance
   * gives the same ribbon on every machine.
   */
  push(x: number, y: number, z: number, speed: number): void {
    const head = (TRAIL_POINTS - 1) * 3;
    const moved = Math.hypot(x - this.positions[head], z - this.positions[head + 2]);
    if (this.filled > 0 && moved < TRAIL_SPACING) {
      this.fade(speed);
      return;
    }

    // Shift the ring along by one and append. At 26 points this is cheaper
    // than the bookkeeping a real ring buffer would need in the draw call.
    this.positions.copyWithin(0, 3);
    const i = (TRAIL_POINTS - 1) * 3;
    this.positions[i] = x;
    this.positions[i + 1] = y;
    this.positions[i + 2] = z;

    if (this.filled < TRAIL_POINTS) {
      this.filled++;
      // Until the buffer fills, collapse the unused head onto the ball so the
      // trail does not streak in from the origin.
      for (let k = 0; k < TRAIL_POINTS - this.filled; k++) {
        this.positions[k * 3] = x;
        this.positions[k * 3 + 1] = y;
        this.positions[k * 3 + 2] = z;
      }
    }

    const attr = this.geom.getAttribute("position") as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.fade(speed);
  }

  /** Opacity tracks speed, so a slow roll leaves nothing behind it. */
  private fade(speed: number): void {
    const target = THREE.MathUtils.clamp((speed - 0.12) / 1.1, 0, 0.75);
    this.mat.opacity += (target - this.mat.opacity) * 0.25;
    this.line.visible = this.mat.opacity > 0.01;
  }

  dispose(): void {
    this.geom.dispose();
    this.mat.dispose();
  }
}
