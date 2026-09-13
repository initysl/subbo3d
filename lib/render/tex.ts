import * as THREE from "three";
import * as C from "@/lib/sim/constants";
import { createRng, nextFloat } from "@/lib/sim/rng";

/**
 * Procedurally generated textures.
 *
 * Nothing here is loaded from disk. Keeping the whole look procedural means
 * there is no art pipeline on the critical path, the transfer size stays at
 * roughly "Next + three", and a designer can later replace a factory rather
 * than untangle the renderer.
 */

/** Pixels across the long axis of the pitch texture. */
const PITCH_TEX_WIDTH = 2048;
const PITCH_TEX_HEIGHT = Math.round(PITCH_TEX_WIDTH * (C.PITCH_WIDTH / C.PITCH_LENGTH));

/** Width of a mown stripe, in metres. */
const STRIPE_WIDTH = 0.1;

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** World metres -> texture pixels. */
function px(x: number): number {
  return ((x + C.HALF_LENGTH) / C.PITCH_LENGTH) * PITCH_TEX_WIDTH;
}
function py(y: number): number {
  return ((y + C.HALF_WIDTH) / C.PITCH_WIDTH) * PITCH_TEX_HEIGHT;
}
function pxLen(m: number): number {
  return (m / C.PITCH_LENGTH) * PITCH_TEX_WIDTH;
}

/**
 * Seeded value noise, drawn as fine per-pixel albedo variation.
 *
 * Felt reads as felt almost entirely through this — not through normal
 * mapping — so it is worth doing at texture resolution and then leaving the
 * lighting model alone.
 */
function drawFeltNoise(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const rng = createRng(0x5bb0_1d);

  // A coarse lattice, bilinearly sampled, gives a soft fibre clump on top of
  // the per-pixel grain.
  const LAT = 64;
  const lattice = new Float64Array(LAT * LAT);
  for (let i = 0; i < lattice.length; i++) lattice[i] = nextFloat(rng);

  const sample = (u: number, v: number): number => {
    const fx = u * LAT;
    const fy = v * LAT;
    const x0 = Math.floor(fx) % LAT;
    const y0 = Math.floor(fy) % LAT;
    const x1 = (x0 + 1) % LAT;
    const y1 = (y0 + 1) % LAT;
    const tx = fx - Math.floor(fx);
    const ty = fy - Math.floor(fy);
    const a = lattice[y0 * LAT + x0] * (1 - tx) + lattice[y0 * LAT + x1] * tx;
    const b = lattice[y1 * LAT + x0] * (1 - tx) + lattice[y1 * LAT + x1] * tx;
    return a * (1 - ty) + b * ty;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const clump = sample(x / w, y / h) - 0.5;
      const grain = nextFloat(rng) - 0.5;
      const delta = clump * 16 + grain * 14;
      d[i] = Math.max(0, Math.min(255, d[i] + delta));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + delta));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + delta));
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Alternating mown stripes. Subtle: they should read as light, not as paint. */
function drawStripes(ctx: CanvasRenderingContext2D, alpha: number): void {
  ctx.save();
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  const stripe = pxLen(STRIPE_WIDTH);
  for (let x = 0; x < PITCH_TEX_WIDTH; x += stripe * 2) {
    ctx.fillRect(x, 0, stripe, PITCH_TEX_HEIGHT);
  }
  ctx.restore();
}

/**
 * The pitch markings, at the dimensions the FISTF equipment rules give
 * (Part III 1.2). Line width is capped at 3 mm by rule 1.1.6.
 */
function drawMarkings(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.82)";
  ctx.lineWidth = Math.max(2, pxLen(0.003));
  ctx.lineCap = "butt";

  // Touchlines and goal-lines.
  ctx.strokeRect(px(-C.HALF_LENGTH), py(-C.HALF_WIDTH), pxLen(C.PITCH_LENGTH), py(C.HALF_WIDTH) - py(-C.HALF_WIDTH));

  // Centre line and circle (1.2.1).
  ctx.beginPath();
  ctx.moveTo(px(0), py(-C.HALF_WIDTH));
  ctx.lineTo(px(0), py(C.HALF_WIDTH));
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px(0), py(0), pxLen(C.CENTRE_CIRCLE_RADIUS), 0, Math.PI * 2);
  ctx.stroke();

  for (const s of [-1, 1]) {
    // Shooting line (1.2.2) — each half split into two equal zones.
    ctx.beginPath();
    ctx.moveTo(px(s * C.SHOOTING_LINE_X), py(-C.HALF_WIDTH));
    ctx.lineTo(px(s * C.SHOOTING_LINE_X), py(C.HALF_WIDTH));
    ctx.stroke();

    // Penalty area (1.2.3) and goal area (1.2.4).
    for (const [depth, width] of [
      [C.PENALTY_AREA_DEPTH, C.PENALTY_AREA_WIDTH],
      [C.GOAL_AREA_DEPTH, C.GOAL_AREA_WIDTH],
    ]) {
      const xEdge = s * (C.HALF_LENGTH - depth);
      ctx.beginPath();
      ctx.moveTo(px(s * C.HALF_LENGTH), py(-width / 2));
      ctx.lineTo(px(xEdge), py(-width / 2));
      ctx.lineTo(px(xEdge), py(width / 2));
      ctx.lineTo(px(s * C.HALF_LENGTH), py(width / 2));
      ctx.stroke();
    }

    // Penalty spot (1.2.3).
    ctx.beginPath();
    ctx.arc(px(s * (C.HALF_LENGTH - C.PENALTY_SPOT_X)), py(0), pxLen(0.004), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.fill();

    // Corner arcs (1.2.5).
    for (const t of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(
        px(s * C.HALF_LENGTH),
        py(t * C.HALF_WIDTH),
        pxLen(C.CORNER_ARC_RADIUS),
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
  }

  ctx.restore();
}

export interface PitchTextures {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  dispose(): void;
}

/**
 * Build the pitch's albedo and roughness maps.
 *
 * The felt, the stripes and the markings are baked into one texture rather
 * than injected into the shader with `onBeforeCompile`. That injection is
 * version-sensitive and is the least portable thing we could rely on; baking
 * gets the same look from a plain MeshStandardMaterial, and the stripes still
 * catch the light differently because they also vary the roughness map.
 */
export function createPitchTextures(): PitchTextures {
  const albedo = makeCanvas(PITCH_TEX_WIDTH, PITCH_TEX_HEIGHT);
  const actx = albedo.getContext("2d", { willReadFrequently: true })!;
  actx.fillStyle = "#2c5f38";
  actx.fillRect(0, 0, PITCH_TEX_WIDTH, PITCH_TEX_HEIGHT);
  drawStripes(actx, 0.035);
  drawFeltNoise(actx, PITCH_TEX_WIDTH, PITCH_TEX_HEIGHT);
  drawMarkings(actx);

  // Roughness: stripes differ mainly in how they catch the key light, and the
  // painted lines are a little shinier than the felt around them.
  const rough = makeCanvas(PITCH_TEX_WIDTH, PITCH_TEX_HEIGHT);
  const rctx = rough.getContext("2d")!;
  rctx.fillStyle = "#ebebeb";
  rctx.fillRect(0, 0, PITCH_TEX_WIDTH, PITCH_TEX_HEIGHT);
  rctx.fillStyle = "rgba(0,0,0,0.06)";
  const stripe = pxLen(STRIPE_WIDTH);
  for (let x = 0; x < PITCH_TEX_WIDTH; x += stripe * 2) {
    rctx.fillRect(x, 0, stripe, PITCH_TEX_HEIGHT);
  }

  const map = new THREE.CanvasTexture(albedo);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const roughnessMap = new THREE.CanvasTexture(rough);
  roughnessMap.anisotropy = 4;

  return {
    map,
    roughnessMap,
    dispose() {
      map.dispose();
      roughnessMap.dispose();
    },
  };
}

/**
 * A soft round blob, used for contact shadows.
 *
 * Cheaper than a shadow map and it reads better for a tabletop toy — and the
 * ball's shadow detaching as it lofts is the clearest cue for ball height.
 */
export function createBlobTexture(): THREE.CanvasTexture {
  const size = 128;
  const c = makeCanvas(size, size);
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(0.55, "rgba(0,0,0,0.28)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

/**
 * A small gradient environment, pre-filtered for the plastic figures.
 *
 * Glossy plastic comes almost entirely from a sharp environment reflection
 * plus a tight specular highlight, so even this crude sky/floor gradient does
 * most of the work.
 */
export function createEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const w = 64;
  const h = 32;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    // Warm ceiling light above, darker room below.
    const r = Math.round(255 * (0.95 - t * 0.62));
    const g = Math.round(255 * (0.93 - t * 0.62));
    const b = Math.round(255 * (0.88 - t * 0.58));
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  const source = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  source.needsUpdate = true;
  source.mapping = THREE.EquirectangularReflectionMapping;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(source).texture;
  pmrem.dispose();
  source.dispose();
  return env;
}
