import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import * as C from "@/lib/sim/constants";
import { BALL, BODY_COUNT, BodyKind, FLAG_ACTIVE, FLAG_OUT_OF_PLAY, TEAM_A } from "@/lib/sim/types";
import type { World } from "@/lib/sim/world";
import {
  createBallGeometry,
  createFigureGeometry,
  createGoalGeometry,
  createNetGeometry,
  NET_DEPTH,
} from "./geom";
import { createBlobTexture, createEnvironment, createPitchTextures } from "./tex";
import { TiltShiftShader } from "./passes/tiltShift";
import { Shake, Trail, Wobble } from "./fx";
import type { SimEventBuffer } from "@/lib/sim/events";
import { SimEventKind } from "@/lib/sim/types";

/**
 * The 3D presentation layer.
 *
 * It reads the simulation and never writes to it. The simulation runs at a
 * fixed step; this interpolates between the last two states purely for
 * display, and that interpolation never feeds back — the step rate is a
 * determinism invariant.
 *
 * Coordinate mapping, stated once: the sim is a plane with `x` along the
 * pitch, `y` across it and `z` as height. three.js is y-up, so
 * `three(x, y, z) = sim(x, z, y)`. One unit is one metre in both.
 */

const TEAM_COLOURS = [0x2f7fd4, 0xd4442f];
const KEEPER_COLOURS = [0x7fd1ff, 0xffc98a];

const MAX_AIM_POINTS = 128;

export interface Scene3D {
  sync(world: World, alpha: number, dt: number): void;
  /**
   * Drain one step's simulation events into the visual effects. Must be
   * called straight after each Match.step(), because the event buffer is
   * cleared at the start of the next one.
   */
  observeEvents(events: SimEventBuffer, world: World): void;
  render(): void;
  resize(width: number, height: number): void;
  /** Map a pointer position to pitch coordinates, or null if it misses. */
  screenToPitch(clientX: number, clientY: number): { x: number; y: number } | null;
  /**
   * Predicted paths for the flicked figure and the ball, in sim coordinates
   * as flat [x, y, ...] pairs.
   */
  setAim(figurePoints: readonly number[], ballPoints: readonly number[]): void;
  setSelected(body: number): void;
  readonly drawCalls: number;
  dispose(): void;
}

export interface SceneOptions {
  /** Suppresses camera shake. Haptics are gated by the caller separately. */
  reducedMotion?: boolean;
}

export function createScene(canvas: HTMLCanvasElement, options: SceneOptions = {}): Scene3D {
  const reducedMotion = options.reducedMotion === true;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // EffectComposer issues several renders per frame and each one resets the
  // counter, so the default reading reports only the final pass.
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15171b);

  // A long lens is the single strongest miniature cue: 30 degrees reads as a
  // portrait lens and makes the pitch look like an object, not a world.
  const V_FOV = 30;
  /** Camera elevation above the felt, in radians from horizontal. */
  const TILT = THREE.MathUtils.degToRad(50);
  const camera = new THREE.PerspectiveCamera(V_FOV, 1, 0.02, 8);

  /**
   * Pull the camera back far enough that the whole pitch fits, whatever the
   * viewport shape. Hard-coding a position frames correctly on one screen and
   * crops the goals on every other one — phones especially.
   */
  function frameCamera(aspect: number): void {
    const vFov = THREE.MathUtils.degToRad(V_FOV);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    // Margins leave a little felt visible outside the touchlines. The pitch is
    // tilted away from the camera, so its across-pitch extent is foreshortened
    // on screen — ignoring that pulls the camera much further back than the
    // shot actually needs and leaves the pitch marooned in empty space.
    // The goals stand *behind* the goal-lines, so the shot has to hold the
    // pitch plus a net's depth at each end. Framing to the pitch alone cropped
    // both goals off the sides of the screen.
    const needH = (C.HALF_LENGTH + NET_DEPTH) * 1.04;
    const needV = (C.PITCH_WIDTH / 2) * Math.cos(TILT) * 1.35;
    const dist = Math.max(needH / Math.tan(hFov / 2), needV / Math.tan(vFov / 2));
    camera.position.set(0, dist * Math.sin(TILT), dist * Math.cos(TILT));
    camera.lookAt(0, 0, 0);
  }
  frameCamera(1.5);

  const env = createEnvironment(renderer);
  scene.environment = env;

  // --- lighting: one warm key, plus a soft fill ---
  const key = new THREE.DirectionalLight(0xfff0dc, 2.1);
  key.position.set(-0.6, 1.1, 0.5);
  scene.add(key);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x20241c, 0.55));

  // --- table the pitch sits on ---
  const table = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 4),
    new THREE.MeshStandardMaterial({ color: 0x241c16, roughness: 0.85 }),
  );
  table.rotation.x = -Math.PI / 2;
  table.position.y = -0.004;
  scene.add(table);

  // --- pitch ---
  const pitchTex = createPitchTextures();
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(C.PITCH_LENGTH, C.PITCH_WIDTH),
    new THREE.MeshStandardMaterial({
      map: pitchTex.map,
      roughnessMap: pitchTex.roughnessMap,
      roughness: 0.95,
      metalness: 0,
    }),
  );
  pitch.rotation.x = -Math.PI / 2;
  scene.add(pitch);

  // --- goals ---
  const goalGeom = createGoalGeometry();
  const netGeom = createNetGeometry();
  const goalMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.35 });
  const netMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 });
  const goals: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(goalGeom, goalMat);
    const net = new THREE.LineSegments(netGeom, netMat);
    // The net geometry runs from the goal-line outwards, so it follows the
    // sign of the goal it belongs to — negating it puts the net on the pitch.
    net.scale.x = s;
    g.add(frame, net);
    g.position.x = s * C.HALF_LENGTH;
    goals.push(g);
    scene.add(g);
  }

  // --- figures: one instanced mesh for all 22 ---
  const figureGeom = createFigureGeometry();
  const figureMat = new THREE.MeshStandardMaterial({
    roughness: 0.22,
    metalness: 0,
    envMapIntensity: 0.9,
  });
  const figures = new THREE.InstancedMesh(figureGeom, figureMat, BODY_COUNT);
  figures.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  figures.count = 0;
  scene.add(figures);

  // --- ball ---
  const ball = new THREE.Mesh(
    createBallGeometry(),
    new THREE.MeshStandardMaterial({ color: 0xfdfdfd, roughness: 0.3, envMapIntensity: 1.1 }),
  );
  scene.add(ball);

  // --- contact shadows ---
  const blobTex = createBlobTexture();
  const shadows = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: blobTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
    }),
    BODY_COUNT,
  );
  shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shadows.renderOrder = 1;
  shadows.count = 0;
  scene.add(shadows);

  // --- aim preview ---
  // Two lines, because until the figure actually reaches the ball the ball's
  // predicted path is a single point: while aiming, the useful line is the
  // one showing where the figure is going.
  function makeAimLine(colour: number, opacity: number, height: number) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_AIM_POINTS * 3), 3));
    const line = new THREE.Line(
      geom,
      new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity }),
    );
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    return { geom, line, height };
  }
  const figureAim = makeAimLine(0x8ec9ff, 0.7, 0.006);
  const ballAim = makeAimLine(0xffffff, 0.9, 0.004);

  const selectRing = new THREE.Mesh(
    new THREE.RingGeometry(C.BASE_RADIUS * 1.25, C.BASE_RADIUS * 1.5, 24),
    new THREE.MeshBasicMaterial({ color: 0xffe680, transparent: true, opacity: 0.9 }),
  );
  selectRing.rotation.x = -Math.PI / 2;
  selectRing.position.y = 0.0012;
  selectRing.visible = false;
  scene.add(selectRing);

  // --- post-processing ---
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const tilt = new ShaderPass(TiltShiftShader);
  tilt.uniforms.uBand.value = 0.32;
  tilt.uniforms.uStrength.value = 1.3;
  composer.addPass(tilt);
  composer.addPass(new OutputPass());

  // Scratch objects, allocated once. Nothing in sync() may allocate.
  const mat4 = new THREE.Matrix4();
  const scaleOne = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  const colour = new THREE.Color();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ballSpin = new THREE.Quaternion();
  const spinAxis = new THREE.Vector3();
  const deltaSpin = new THREE.Quaternion();
  // Dedicated scratch for the shadow transform: sharing `pos` and `spinAxis`
  // across two purposes in one loop iteration is a bug waiting to happen.
  const shadowScale = new THREE.Vector3();
  const flatAxis = new THREE.Vector3(1, 0, 0);
  const flatQuat = new THREE.Quaternion();
  const focusProbe = new THREE.Vector3();
  const wobbleQuat = new THREE.Quaternion();

  const wobble = new Wobble();
  const shake = new Shake();
  const trail = new Trail();
  scene.add(trail.line);

  const baseCamPos = camera.position.clone();
  let lastBallX = 0;
  let lastBallZ = 0;
  let selected = -1;

  function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  function sync(world: World, alpha: number, dt: number): void {
    wobble.update(dt);
    shake.update(dt);

    let figureCount = 0;
    let shadowCount = 0;

    for (let i = 0; i < BODY_COUNT; i++) {
      const active =
        (world.flags[i] & FLAG_ACTIVE) !== 0 && (world.flags[i] & FLAG_OUT_OF_PLAY) === 0;
      if (!active) continue;

      const x = lerp(world.prevX[i], world.px[i], alpha);
      const y = lerp(world.prevY[i], world.py[i], alpha);
      const z = lerp(world.prevZ[i], world.pz[i], alpha);

      if (i === BALL) {
        ball.position.set(x, C.BALL_RADIUS + z, y);

        // Roll the ball by how far it actually moved. Presentation only.
        const dx = x - lastBallX;
        const dz = y - lastBallZ;
        const dist = Math.hypot(dx, dz);
        if (dist > 1e-6) {
          spinAxis.set(dz, 0, -dx).normalize();
          deltaSpin.setFromAxisAngle(spinAxis, dist / C.BALL_RADIUS);
          ballSpin.premultiply(deltaSpin);
          ball.quaternion.copy(ballSpin);
        }
        trail.push(
          x,
          C.BALL_RADIUS + z,
          y,
          Math.hypot(world.vx[BALL], world.vy[BALL]),
        );
        lastBallX = x;
        lastBallZ = y;
      } else {
        wobble.applyTo(i, wobbleQuat);
        mat4.compose(pos.set(x, 0, y), wobbleQuat, scaleOne);
        figures.setMatrixAt(figureCount, mat4);
        const team = world.team[i] === TEAM_A ? 0 : 1;
        colour.setHex(
          world.kind[i] === BodyKind.Keeper ? KEEPER_COLOURS[team] : TEAM_COLOURS[team],
        );
        figures.setColorAt(figureCount, colour);
        figureCount++;
      }

      // Contact shadow: it grows and fades as the ball lifts, which is the
      // clearest cue the player gets for ball height.
      const lift = i === BALL ? z : 0;
      const spread = world.radius[i] * 2 * (1 + lift * 5);
      mat4.compose(
        pos.set(x + lift * 0.25, 0.0008, y + lift * 0.2),
        flatQuat.setFromAxisAngle(flatAxis, -Math.PI / 2),
        shadowScale.set(spread, spread, 1),
      );
      shadows.setMatrixAt(shadowCount, mat4);
      shadowCount++;
    }

    figures.count = figureCount;
    figures.instanceMatrix.needsUpdate = true;
    if (figures.instanceColor) figures.instanceColor.needsUpdate = true;
    shadows.count = shadowCount;
    shadows.instanceMatrix.needsUpdate = true;

    if (selected >= 0) {
      selectRing.position.x = lerp(world.prevX[selected], world.px[selected], alpha);
      selectRing.position.z = lerp(world.prevY[selected], world.py[selected], alpha);
    }

    // Shake is applied as a camera offset rather than a scene transform, so
    // it never disturbs picking, which unprojects through the same camera.
    camera.position.set(
      baseCamPos.x + shake.offsetX(),
      baseCamPos.y + shake.offsetY(),
      baseCamPos.z,
    );

    // Keep the sharp band on the ball, so focus follows the action.
    focusProbe.copy(ball.position).project(camera);
    tilt.uniforms.uFocus.value = THREE.MathUtils.clamp(focusProbe.y * 0.5 + 0.5, 0.15, 0.85);
  }

  return {
    sync,
    observeEvents(events: SimEventBuffer, world: World) {
      for (let i = 0; i < events.count; i++) {
        const e = events.at(i);
        switch (e.kind) {
          case SimEventKind.FigureHitBall:
          case SimEventKind.KeeperHitBall:
          case SimEventKind.FigureHitFigure: {
            // Rock the struck bodies away from where the contact happened.
            // The event carries the contact point, so the direction is that
            // point relative to the body's own centre.
            const dx = e.x - world.px[e.a];
            const dz = e.y - world.py[e.a];
            const len = Math.hypot(dx, dz) || 1;
            wobble.kick(e.a, e.impulse, dx / len, dz / len);
            if (e.b >= 0 && e.kind === SimEventKind.FigureHitFigure) {
              wobble.kick(e.b, e.impulse, -dx / len, -dz / len);
            }
            if (!reducedMotion) shake.add(e.impulse * 0.35);
            break;
          }
          case SimEventKind.BallHitPost:
            if (!reducedMotion) shake.add(0.004);
            break;
          case SimEventKind.BallEnteredGoal:
            if (!reducedMotion) shake.add(0.006);
            break;
          default:
            break;
        }
      }
    },
    render() {
      renderer.info.reset();
      composer.render();
    },
    resize(width: number, height: number) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
        frameCamera(camera.aspect);
      baseCamPos.copy(camera.position);
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
      tilt.uniforms.uResolution.value.set(width, height);
    },
    screenToPitch(clientX: number, clientY: number) {
      const rect = canvas.getBoundingClientRect();
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1),
      );
      raycaster.setFromCamera(ndc, camera);
      const { origin, direction } = raycaster.ray;
      // The pitch is the plane y = 0, so this is two divisions, not a raycast
      // against 22 instanced meshes.
      if (Math.abs(direction.y) < 1e-8) return null;
      const t = -origin.y / direction.y;
      if (t <= 0) return null;
      return { x: origin.x + direction.x * t, y: origin.z + direction.z * t };
    },
    setAim(figurePoints: readonly number[], ballPoints: readonly number[]) {
      for (const [target, points] of [
        [figureAim, figurePoints],
        [ballAim, ballPoints],
      ] as const) {
        const n = Math.min(points.length / 2, MAX_AIM_POINTS);
        // A path shorter than two points, or one that never leaves its start,
        // would draw as a degenerate speck — hide it instead.
        if (n < 2) {
          target.line.visible = false;
          continue;
        }
        const attr = target.geom.getAttribute("position") as THREE.BufferAttribute;
        const arr = attr.array as Float32Array;
        for (let i = 0; i < n; i++) {
          arr[i * 3] = points[i * 2];
          arr[i * 3 + 1] = target.height;
          arr[i * 3 + 2] = points[i * 2 + 1];
        }
        attr.needsUpdate = true;
        target.geom.setDrawRange(0, n);
        const moved =
          Math.hypot(arr[(n - 1) * 3] - arr[0], arr[(n - 1) * 3 + 2] - arr[2]) > C.BALL_RADIUS;
        target.line.visible = moved;
      }
    },
    setSelected(body: number) {
      selected = body;
      selectRing.visible = body >= 0;
    },
    get drawCalls() {
      return renderer.info.render.calls;
    },
    dispose() {
      // Strict Mode double-invokes effects in dev, so an incomplete teardown
      // here means two live WebGL contexts and a leaked first one.
      composer.dispose();
      trail.dispose();
      pitchTex.dispose();
      blobTex.dispose();
      env.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
    },
  };
}
