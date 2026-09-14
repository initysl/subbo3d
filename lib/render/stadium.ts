import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import * as C from "@/lib/sim/constants";
import { createRng, nextFloat, nextUint32, type Rng } from "@/lib/sim/rng";

/**
 * The stadium the table sits in.
 *
 * Entirely procedural, like the rest of the look: a tiered bowl of seats, a
 * crowd built from one instanced figure, and lit hoardings around the pitch.
 * No meshes are loaded from disk.
 *
 * It is also completely static — built once, never touched by `sync()`. The
 * crowd is two `InstancedMesh` draw calls whatever its size, so the cost of
 * another thousand spectators is a thousand matrices at startup and nothing
 * per frame. That is the whole reason the bowl can be this dense.
 *
 * Seeded, so the same crowd appears every time. A stadium that reshuffled
 * itself on every reload would be a distraction, and it makes screenshots
 * comparable between runs.
 */

/** Inner edge of the front row, measured out from the pitch markings. */
const RINGSIDE_X = C.HALF_LENGTH + 0.085;
const RINGSIDE_Z = C.HALF_WIDTH + 0.085;

const TIERS = 9;
/** How far each tier steps back, and how far it climbs. */
const TIER_DEPTH = 0.062;
const TIER_RISE = 0.03;
/** Along-the-row spacing between seats. */
const SEAT_PITCH = 0.05;
/** Fraction of seats with somebody in them. */
const OCCUPANCY = 0.86;

const SEAT_WIDTH = 0.03;
const SPECTATOR_HEIGHT = 0.042;

/**
 * Section colours. Real stands are painted in blocks, and it is the blocks —
 * not the individual seats — that read at this distance, so seats are
 * coloured in runs rather than at random.
 */
const SEAT_COLOURS = [0xb2244a, 0xd8a32a, 0x2c5fa8, 0x8e2f7a, 0x1f7a6b, 0xc2442a];

/** Clothing. Deliberately wider and lighter than the seats, so people pop. */
const SHIRT_COLOURS = [
  0xe8e2d8, 0xd94f3d, 0xf0c040, 0x3a6fb8, 0x2f2f38, 0xe07a3a, 0x7a4fa8, 0x3f9e78, 0xf2f2f2,
  0xa82f4a,
];

const SKIN_COLOURS = [0xf0c8a0, 0xd9a878, 0xa9754e, 0x7a4f33, 0xf5d9bc];

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[nextUint32(rng) % list.length];
}

/**
 * A spectator: shoulders, a head, and nothing else.
 *
 * Thirty or so triangles, because at this scale a spectator is a dozen
 * pixels. Detail here would cost geometry for something no one can resolve;
 * what actually reads is the colour and the fact that the rows are uneven.
 */
function createSpectatorGeometry(): THREE.BufferGeometry {
  const body = new THREE.CapsuleGeometry(0.008, SPECTATOR_HEIGHT * 0.42, 3, 8);
  body.scale(1, 1, 0.8);
  body.translate(0, SPECTATOR_HEIGHT * 0.36, 0);

  const head = new THREE.SphereGeometry(0.0072, 8, 6);
  head.translate(0, SPECTATOR_HEIGHT * 0.78, 0);

  const merged = mergeGeometries([body, head], false);
  body.dispose();
  head.dispose();
  if (!merged) throw new Error("failed to merge spectator geometry");
  merged.computeVertexNormals();
  return merged;
}

/** A seat: a pad and a back, facing +z. */
function createSeatGeometry(): THREE.BufferGeometry {
  const pad = new THREE.BoxGeometry(SEAT_WIDTH, 0.006, 0.026);
  pad.translate(0, 0.003, 0);

  const back = new THREE.BoxGeometry(SEAT_WIDTH, 0.022, 0.006);
  back.translate(0, 0.014, -0.012);

  const merged = mergeGeometries([pad, back], false);
  pad.dispose();
  back.dispose();
  if (!merged) throw new Error("failed to merge seat geometry");
  return merged;
}

interface RowSlot {
  x: number;
  z: number;
  /** Rotation about y that turns the seat to face the pitch. */
  angle: number;
}

/**
 * Walk the rectangle at (hx, hz) and return evenly spaced places to sit,
 * each already turned to face the middle.
 *
 * The corners are left out: seats wrapped around a right angle look wrong,
 * and a real bowl has an aisle there anyway.
 */
function rowSlots(hx: number, hz: number, out: RowSlot[]): void {
  out.length = 0;
  const inset = SEAT_PITCH * 0.5;

  const alongX = Math.max(1, Math.floor((hx * 2 - inset * 2) / SEAT_PITCH));
  for (let i = 0; i <= alongX; i++) {
    const x = -hx + inset + (i / alongX) * (hx * 2 - inset * 2);
    out.push({ x, z: -hz, angle: 0 });
    out.push({ x, z: hz, angle: Math.PI });
  }

  const alongZ = Math.max(1, Math.floor((hz * 2 - inset * 2) / SEAT_PITCH));
  for (let i = 0; i <= alongZ; i++) {
    const z = -hz + inset + (i / alongZ) * (hz * 2 - inset * 2);
    out.push({ x: -hx, z, angle: Math.PI / 2 });
    out.push({ x: hx, z, angle: -Math.PI / 2 });
  }
}

/**
 * The concrete the seats stand on: one stepped ring per tier, merged into a
 * single geometry so the whole bowl structure is one draw call.
 */
function createBowlGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  for (let k = 0; k < TIERS; k++) {
    const hx = RINGSIDE_X + k * TIER_DEPTH;
    const hz = RINGSIDE_Z + k * TIER_DEPTH;
    const top = k * TIER_RISE;
    // Each step is a solid block down to the floor rather than a thin slab:
    // from this camera the riser is visible and a floating step is not.
    const height = top + TIER_RISE;

    for (const s of [-1, 1]) {
      const long = new THREE.BoxGeometry(hx * 2 + TIER_DEPTH * 2, height, TIER_DEPTH);
      long.translate(0, height / 2 - TIER_RISE, s * (hz + TIER_DEPTH / 2));
      parts.push(long);

      const short = new THREE.BoxGeometry(TIER_DEPTH, height, hz * 2);
      short.translate(s * (hx + TIER_DEPTH / 2), height / 2 - TIER_RISE, 0);
      parts.push(short);
    }
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("failed to merge bowl geometry");
  return merged;
}

/**
 * Advertising hoardings, drawn once into a strip texture and wrapped round
 * the pitch.
 *
 * The text is ours. Borrowing a real tournament's branding would make the
 * screenshot a forgery of somebody else's product rather than a picture of
 * this one.
 */
function createHoardingTexture(repeats: number): THREE.CanvasTexture {
  const w = 2048;
  const h = 128;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;

  ctx.fillStyle = "#0d1118";
  ctx.fillRect(0, 0, w, h);

  const slogans = ["SUBBO3D", "TABLE  FOOTBALL", "FISTF  RULES", "FLICK  TO  KICK"];
  const accents = ["#ffd34d", "#4fc3f7", "#ff6b5a", "#9ae66e"];
  const slots = slogans.length * 2;
  const slotW = w / slots;

  for (let i = 0; i < slots; i++) {
    const x = i * slotW;
    ctx.fillStyle = i % 2 === 0 ? "#141a24" : "#0b0f16";
    ctx.fillRect(x, 0, slotW, h);

    // A thin lit edge top and bottom sells these as LED panels more cheaply
    // than any amount of glow on the text itself.
    ctx.fillStyle = accents[i % accents.length];
    ctx.globalAlpha = 0.9;
    ctx.fillRect(x + 6, 8, slotW - 12, 4);
    ctx.fillRect(x + 6, h - 12, slotW - 12, 4);
    ctx.globalAlpha = 1;

    // Fit the text to its panel rather than trusting a fixed size. At 54px
    // the longer slogans ran well past their slot and overlapped the next
    // one, which on the board reads as garbled nonsense rather than as words.
    const text = slogans[i % slogans.length];
    const budget = slotW - 28;
    let size = 60;
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    const width = ctx.measureText(text).width;
    if (width > budget) {
      size = Math.max(18, Math.floor((size * budget) / width));
      ctx.font = `bold ${size}px system-ui, sans-serif`;
    }

    ctx.fillStyle = "#f4f6fb";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + slotW / 2, h / 2 + 2);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.x = repeats;
  tex.anisotropy = 8;
  return tex;
}

export interface Stadium {
  group: THREE.Group;
  dispose(): void;
}

export function createStadium(): Stadium {
  const group = new THREE.Group();
  const rng = createRng(0x5_7ad1_1a);
  const disposables: { dispose(): void }[] = [];

  // --- the bowl ---
  const bowlGeom = createBowlGeometry();
  const bowlMat = new THREE.MeshStandardMaterial({ color: 0x1b1f2a, roughness: 0.92 });
  group.add(new THREE.Mesh(bowlGeom, bowlMat));
  disposables.push(bowlGeom, bowlMat);

  // --- seats and crowd ---
  const slots: RowSlot[] = [];
  const seatRows: { slot: RowSlot; y: number; colour: number }[] = [];

  for (let k = 0; k < TIERS; k++) {
    rowSlots(RINGSIDE_X + k * TIER_DEPTH + TIER_DEPTH * 0.5, RINGSIDE_Z + k * TIER_DEPTH + TIER_DEPTH * 0.5, slots);
    const y = k * TIER_RISE;
    // Colour in runs of a dozen or so: blocks are what read from here, and
    // per-seat randomness would average out into grey mush at this scale.
    let blockColour = pick(rng, SEAT_COLOURS);
    let left = 0;
    for (const slot of slots) {
      if (left === 0) {
        blockColour = pick(rng, SEAT_COLOURS);
        left = 8 + (nextUint32(rng) % 14);
      }
      left--;
      seatRows.push({ slot: { ...slot }, y, colour: blockColour });
    }
  }

  const seatGeom = createSeatGeometry();
  const seatMat = new THREE.MeshStandardMaterial({ roughness: 0.75 });
  const seats = new THREE.InstancedMesh(seatGeom, seatMat, seatRows.length);
  disposables.push(seatGeom, seatMat);

  const specGeom = createSpectatorGeometry();
  const specMat = new THREE.MeshStandardMaterial({ roughness: 0.65 });
  const spectators = new THREE.InstancedMesh(specGeom, specMat, seatRows.length);
  disposables.push(specGeom, specMat);

  const mat4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const colour = new THREE.Color();

  let people = 0;
  for (let i = 0; i < seatRows.length; i++) {
    const { slot, y, colour: seatColour } = seatRows[i];
    quat.setFromAxisAngle(axis, slot.angle);

    pos.set(slot.x, y, slot.z);
    scale.set(1, 1, 1);
    mat4.compose(pos, quat, scale);
    seats.setMatrixAt(i, mat4);
    colour.setHex(seatColour);
    seats.setColorAt(i, colour);

    if (nextFloat(rng) > OCCUPANCY) continue;

    // Height and a little lean, so the rows are not a row of identical pegs.
    const height = 0.86 + nextFloat(rng) * 0.3;
    pos.set(slot.x, y + 0.004, slot.z - 0.004);
    scale.set(0.94 + nextFloat(rng) * 0.14, height, 0.94 + nextFloat(rng) * 0.14);
    quat.setFromAxisAngle(axis, slot.angle + (nextFloat(rng) - 0.5) * 0.5);
    mat4.compose(pos, quat, scale);
    spectators.setMatrixAt(people, mat4);

    colour.setHex(
      nextFloat(rng) < 0.22 ? pick(rng, SKIN_COLOURS) : pick(rng, SHIRT_COLOURS),
    );
    // Darken a share of the crowd: an evenly lit stand looks like a texture,
    // an unevenly lit one looks like people.
    colour.multiplyScalar(0.72 + nextFloat(rng) * 0.38);
    spectators.setColorAt(people, colour);
    people++;
  }
  spectators.count = people;

  seats.instanceMatrix.needsUpdate = true;
  spectators.instanceMatrix.needsUpdate = true;
  group.add(seats, spectators);

  // --- hoardings ---
  const boardHeight = 0.035;
  const boardMat = new THREE.MeshBasicMaterial({ map: createHoardingTexture(1) });
  disposables.push(boardMat);

  for (const [len, x, z, angle] of [
    [RINGSIDE_X * 2, 0, -RINGSIDE_Z, 0],
    [RINGSIDE_X * 2, 0, RINGSIDE_Z, Math.PI],
    [RINGSIDE_Z * 2, -RINGSIDE_X, 0, Math.PI / 2],
    [RINGSIDE_Z * 2, RINGSIDE_X, 0, -Math.PI / 2],
  ] as const) {
    const geom = new THREE.PlaneGeometry(len, boardHeight);
    const mat = boardMat.clone();
    // One pass of the strip per 1.4 m or so. Repeating it more often packs
    // the slogans so tightly that the boards read as a scrolling ticker.
    mat.map = createHoardingTexture(Math.max(1, Math.round(len / 1.4)));
    const board = new THREE.Mesh(geom, mat);
    board.position.set(x, boardHeight / 2, z);
    board.rotation.y = angle;
    group.add(board);
    disposables.push(geom, mat, mat.map);
  }

  // --- back wall, so the top row has something behind it rather than void ---
  const outerX = RINGSIDE_X + TIERS * TIER_DEPTH;
  const outerZ = RINGSIDE_Z + TIERS * TIER_DEPTH;
  const wallHeight = 0.22;
  const wallY = TIERS * TIER_RISE + wallHeight / 2 - 0.03;
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x0e1219, roughness: 1 });
  disposables.push(wallMat);

  // Four inward-facing panels, not a box. A closed box — even a back-sided
  // one — puts its underside between this camera and the pitch, which renders
  // as a completely black screen.
  for (const [len, x, z, angle] of [
    [outerX * 2, 0, -outerZ, 0],
    [outerX * 2, 0, outerZ, Math.PI],
    [outerZ * 2, -outerX, 0, Math.PI / 2],
    [outerZ * 2, outerX, 0, -Math.PI / 2],
  ] as const) {
    const geom = new THREE.PlaneGeometry(len, wallHeight);
    const panel = new THREE.Mesh(geom, wallMat);
    panel.position.set(x, wallY, z);
    panel.rotation.y = angle;
    group.add(panel);
    disposables.push(geom);
  }

  return {
    group,
    dispose() {
      for (const d of disposables) d.dispose();
      seats.dispose();
      spectators.dispose();
    },
  };
}
