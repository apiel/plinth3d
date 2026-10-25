// Signed distance of a box with some edges and corners rounded, blended where they meet.
// Negative inside. Every rounded edge or corner is a term of the distance; the terms are
// intersected with a smooth maximum, and each term's own creases use a smooth minimum, so the
// joins are sanded smooth instead of leaving a lip.
import type { Vec3 } from './model';

export interface Round {
  edge: string;
  radius: number;
}

/**
 * Smooth maximum. It only blends near the surface: deep inside, where many terms agree, it is the
 * plain maximum, so the blends do not stack up and push the inside outwards.
 */
function smax(a: number, b: number, k: number): number {
  const m = Math.max(a, b);
  const h = Math.max(k - Math.abs(a - b), 0);
  const near = Math.min(Math.max((m + k) / k, 0), 1);
  return m + (near * h * h) / (4 * k);
}

function smin(a: number, b: number, k: number): number {
  return -smax(-a, -b, k);
}

interface EdgeTerm {
  along: number;
  a: number;
  b: number;
  sa: number;
  sb: number;
  r: number;
}

interface CornerTerm {
  sign: [number, number, number];
  // The inner corner of the ball, as a positive offset on each axis (before the corner's sign).
  core: [number, number, number];
  r: number;
  reach: number;
}

/** Returns the distance function for a box of `size` (centred on the origin) with the given rounds. */
export function roundedBoxSdf(size: Vec3, rounds: Round[], blend: number): (x: number, y: number, z: number) => number {
  const half = size.map((v) => v / 2) as Vec3;
  const k = blend;
  const clampRadius = (r: number) => Math.min(Math.max(r, 0.1), Math.min(...size) / 2);

  const edges: EdgeTerm[] = [];
  const corners: CornerTerm[] = [];
  for (const { edge, radius } of rounds) {
    if (edge.startsWith('c:')) {
      const sign = edge.slice(2).split(':').map(Number) as [number, number, number];
      const r = clampRadius(radius);
      corners.push({ sign, core: [half[0] - r, half[1] - r, half[2] - r], r, reach: Math.SQRT2 * r });
    } else {
      const [along, sa, sb] = edge.split(':').map(Number);
      const [a, b] = [0, 1, 2].filter((x) => x !== along);
      edges.push({ along, a, b, sa, sb, r: clampRadius(radius) });
    }
  }

  // Scratch array for the point being tested, so each test allocates nothing.
  const p = [0, 0, 0];
  return (x, y, z) => {
    p[0] = x;
    p[1] = y;
    p[2] = z;
    // The box itself.
    let d = Math.max(Math.abs(x) - half[0], Math.abs(y) - half[1], Math.abs(z) - half[2]);
    for (const e of edges) {
      const u = e.sa * p[e.a] - (half[e.a] - e.r);
      const v = e.sb * p[e.b] - (half[e.b] - e.r);
      // Inside the edge's corner square, outside its round: removed.
      const kept = smin(Math.min(u, v), Math.sqrt(u * u + v * v) - e.r, k);
      d = smax(d, kept, k);
    }
    for (const c of corners) {
      const u0 = c.sign[0] * x - c.core[0];
      const u1 = c.sign[1] * y - c.core[1];
      const u2 = c.sign[2] * z - c.core[2];
      // Inside the corner's octant, outside its ball: removed.
      const inOctant = smin(smin(u0, u1, k), u2, k);
      const ball = Math.sqrt(u0 * u0 + u1 * u1 + u2 * u2) - c.reach;
      d = smax(d, smin(inOctant, ball, k), k);
    }
    return d;
  };
}
