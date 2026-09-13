import { SimEventKind } from "./types";
import type { World } from "./world";
import { MU_CONTACT } from "./constants";
import { wakeBody } from "./world";

/**
 * Resolve a contact between two bodies at their exact time of impact.
 *
 * Because contacts are resolved *at* impact rather than after penetration, the
 * usual machinery of a discrete solver — Baumgarte bias, positional slop,
 * warm starting — is simply absent. That absence is the main reason a bespoke
 * solver is worth writing for this game: those are exactly the knobs that make
 * a generic engine feel mushy and leak non-determinism.
 *
 * Returns the magnitude of the normal impulse, for scaling audio and effects.
 */
export function resolveContact(
  w: World,
  a: number,
  b: number,
  nx: number,
  ny: number,
  restitution: number,
): number {
  const invA = w.invMass[a];
  const invB = w.invMass[b];
  const invSum = invA + invB;
  if (invSum === 0) return 0;

  const rvx = w.vx[b] - w.vx[a];
  const rvy = w.vy[b] - w.vy[a];

  const vn = rvx * nx + rvy * ny;
  if (vn > 0) return 0;

  // Normal impulse.
  const jn = (-(1 + restitution) * vn) / invSum;

  // Tangential impulse, clamped by Coulomb friction. This is what turns a
  // glancing hit into a deflection rather than a clean bounce, and it is where
  // most of the skill in aiming comes from.
  const tx = -ny;
  const ty = nx;
  const vt = rvx * tx + rvy * ty;
  let jt = -vt / invSum;
  const jtMax = MU_CONTACT * jn;
  if (jt > jtMax) jt = jtMax;
  else if (jt < -jtMax) jt = -jtMax;

  const ix = jn * nx + jt * tx;
  const iy = jn * ny + jt * ty;

  w.vx[a] -= ix * invA;
  w.vy[a] -= iy * invA;
  w.vx[b] += ix * invB;
  w.vy[b] += iy * invB;

  wakeBody(w, a);
  wakeBody(w, b);

  return jn;
}

/**
 * Reflect a body off an immovable boundary. The wall has infinite mass, so
 * this is a direct reflection rather than a shared impulse.
 */
export function resolveWall(
  w: World,
  i: number,
  nx: number,
  ny: number,
  restitution: number,
): number {
  const vn = w.vx[i] * nx + w.vy[i] * ny;
  if (vn > 0) return 0;

  const jn = -(1 + restitution) * vn;
  const tx = -ny;
  const ty = nx;
  const vt = w.vx[i] * tx + w.vy[i] * ty;

  let jt = -vt;
  const jtMax = MU_CONTACT * jn;
  if (jt > jtMax) jt = jtMax;
  else if (jt < -jtMax) jt = -jtMax;

  w.vx[i] += jn * nx + jt * tx;
  w.vy[i] += jn * ny + jt * ty;

  wakeBody(w, i);
  return jn / w.invMass[i];
}

export { SimEventKind };
