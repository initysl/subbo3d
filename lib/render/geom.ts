import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import * as C from "@/lib/sim/constants";

/**
 * Procedural geometry for the playing pieces.
 *
 * Dimensions follow the FISTF equipment rules (Part III 4.1): a base 1.6-2.1 cm
 * across and 0.5-0.7 cm high, with the whole figure 2.7-3.9 cm tall.
 */

/** Figure total height, within the 2.7-3.9 cm the rules allow. */
const FIGURE_HEIGHT = 0.032;

/**
 * A weighted base with a domed top, plus a simple torso.
 *
 * Merged into one geometry at init so all 22 figures can be drawn by a single
 * InstancedMesh. The origin sits on the felt, so the instance matrix is just
 * the body's position.
 */
export function createFigureGeometry(): THREE.BufferGeometry {
  const r = C.BASE_RADIUS;
  const h = C.BASE_HEIGHT;

  // Lathe profile: flat underside, straight wall, then a dome into the stem.
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(r, 0),
    new THREE.Vector2(r, h * 0.55),
    new THREE.Vector2(r * 0.92, h * 0.82),
    new THREE.Vector2(r * 0.6, h),
    new THREE.Vector2(r * 0.22, h * 1.05),
  ];
  const base = new THREE.LatheGeometry(profile, 24);

  // A real playing figure is a flat silhouette, not a cone: FISTF 4.1.2 puts
  // it at most 1.3 cm across and 0.6 cm thick. Flattening along z is what
  // makes it read as a person from the camera's angle rather than a skittle.
  const bodyHeight = FIGURE_HEIGHT - h;
  const body = new THREE.CapsuleGeometry(0.0048, bodyHeight * 0.62, 4, 12);
  body.scale(1, 1, 0.55);
  body.translate(0, h + bodyHeight * 0.5, 0);

  const head = new THREE.SphereGeometry(0.0036, 12, 10);
  head.scale(1, 1, 0.62);
  head.translate(0, FIGURE_HEIGHT - 0.0032, 0);

  const merged = mergeGeometries([base, body, head], false);
  base.dispose();
  body.dispose();
  head.dispose();
  if (!merged) throw new Error("failed to merge figure geometry");
  merged.computeVertexNormals();
  return merged;
}

export function createBallGeometry(): THREE.BufferGeometry {
  return new THREE.SphereGeometry(C.BALL_RADIUS, 20, 14);
}

/**
 * Goal frame: two posts and a crossbar, at FISTF 2.3 dimensions — posts
 * 12.5 cm apart and 6 cm long, bars no thicker than 5 mm.
 */
export function createGoalGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const r = C.POST_RADIUS;
  const halfMouth = C.GOAL_WIDTH / 2;

  for (const s of [-1, 1]) {
    const post = new THREE.CylinderGeometry(r, r, C.GOAL_HEIGHT, 8);
    post.translate(0, C.GOAL_HEIGHT / 2, s * halfMouth);
    parts.push(post);
  }

  const bar = new THREE.CylinderGeometry(r, r, C.GOAL_WIDTH + r * 2, 8);
  bar.rotateX(Math.PI / 2);
  bar.translate(0, C.GOAL_HEIGHT, 0);
  parts.push(bar);

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("failed to merge goal geometry");
  return merged;
}

/**
 * A coarse net, drawn as line segments across the back of the goal.
 * Cheap, and it stops the goal reading as an empty wireframe box.
 */
export function createNetGeometry(): THREE.BufferGeometry {
  const depth = 0.07;
  const halfMouth = C.GOAL_WIDTH / 2;
  const pts: number[] = [];
  const cols = 7;
  const rows = 4;

  for (let i = 0; i <= cols; i++) {
    const z = -halfMouth + (i / cols) * C.GOAL_WIDTH;
    pts.push(0, C.GOAL_HEIGHT, z, depth, C.GOAL_HEIGHT * 0.55, z);
    pts.push(depth, C.GOAL_HEIGHT * 0.55, z, depth, 0, z);
  }
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const y = C.GOAL_HEIGHT * (1 - t);
    const x = depth * Math.min(1, t * 1.8);
    pts.push(x, y, -halfMouth, x, y, halfMouth);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return g;
}
