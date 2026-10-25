// Marching cubes that only looks near the surface. A coarse pass finds the blocks of cells the
// surface can pass through, and only those are sampled finely. The lookup tables are the ones in
// three's MarchingCubes, so the triangles face outwards in the same way.
import { edgeTable as edgeTableTyped, triTable as triTableTyped } from 'three/examples/jsm/objects/MarchingCubes.js';

// Three's typings call these arrays of arrays, but they are flat tables of numbers.
const edgeTable = edgeTableTyped as unknown as Int32Array;
const triTable = triTableTyped as unknown as Int32Array;

export type Distance = (x: number, y: number, z: number) => number;

export interface SurfaceMesh {
  vertices: Float32Array;
  triangles: Uint32Array;
}

/** Cells along one side of a block. */
const BLOCK = 8;

// The cube's corners as offsets, in the order the tables expect.
const CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];

// The cube's edges: the two corners each joins, the axis it runs along, and its lower corner.
const EDGES: { from: number; to: number; axis: number; low: number }[] = [
  { from: 0, to: 1, axis: 0, low: 0 },
  { from: 1, to: 2, axis: 1, low: 1 },
  { from: 3, to: 2, axis: 0, low: 3 },
  { from: 0, to: 3, axis: 1, low: 0 },
  { from: 4, to: 5, axis: 0, low: 4 },
  { from: 5, to: 6, axis: 1, low: 5 },
  { from: 7, to: 6, axis: 0, low: 7 },
  { from: 4, to: 7, axis: 1, low: 4 },
  { from: 0, to: 4, axis: 2, low: 0 },
  { from: 1, to: 5, axis: 2, low: 1 },
  { from: 2, to: 6, axis: 2, low: 2 },
  { from: 3, to: 7, axis: 2, low: 3 },
];

/**
 * The surface where `distance` is zero, inside the box of half-sizes `half` (centred on the origin,
 * with room around it). Negative distance is inside. `voxel` is the size of one cell.
 */
export function polygonizeNearSurface(distance: Distance, half: [number, number, number], voxel: number): SurfaceMesh {
  const counts = half.map((h) => Math.ceil((2 * h) / voxel)) as [number, number, number];
  const origin = half.map((h) => -h) as [number, number, number];
  const [nx, ny, nz] = counts;
  const pointIndex = (i: number, j: number, k: number) => (i * (ny + 1) + j) * (nz + 1) + k;

  const vertexIds = new Map<number, number>();
  const vertices: number[] = [];
  const triangles: number[] = [];

  const values = new Float64Array((BLOCK + 1) ** 3);
  const blockSize = BLOCK * voxel;
  // The surface lies within a block when the distance at its centre is under half its diagonal.
  // The distance is only roughly a distance, so allow some slack.
  const reach = 0.866 * blockSize * 1.25 + voxel;

  for (let bi = 0; bi < nx; bi += BLOCK) {
    for (let bj = 0; bj < ny; bj += BLOCK) {
      for (let bk = 0; bk < nz; bk += BLOCK) {
        const centre = distance(
          origin[0] + (bi + BLOCK / 2) * voxel,
          origin[1] + (bj + BLOCK / 2) * voxel,
          origin[2] + (bk + BLOCK / 2) * voxel,
        );
        if (Math.abs(centre) > reach) continue;

        // Sample the block's corners finely.
        for (let i = 0; i <= BLOCK; i++) {
          for (let j = 0; j <= BLOCK; j++) {
            for (let k = 0; k <= BLOCK; k++) {
              values[(i * (BLOCK + 1) + j) * (BLOCK + 1) + k] = distance(
                origin[0] + (bi + i) * voxel,
                origin[1] + (bj + j) * voxel,
                origin[2] + (bk + k) * voxel,
              );
            }
          }
        }

        for (let i = 0; i < BLOCK && bi + i < nx; i++) {
          for (let j = 0; j < BLOCK && bj + j < ny; j++) {
            for (let k = 0; k < BLOCK && bk + k < nz; k++) {
              let cube = 0;
              const corner = new Array<number>(8);
              for (let c = 0; c < 8; c++) {
                const v = values[((i + CORNERS[c][0]) * (BLOCK + 1) + (j + CORNERS[c][1])) * (BLOCK + 1) + (k + CORNERS[c][2])];
                corner[c] = v;
                // Outside the surface sets the bit.
                if (v > 0) cube |= 1 << c;
              }
              const bits = edgeTable[cube];
              if (bits === 0) continue;

              const edgeVertex = new Array<number>(12);
              for (let e = 0; e < 12; e++) {
                if (!(bits & (1 << e))) continue;
                const { from, to, axis, low } = EDGES[e];
                const gi = bi + i + CORNERS[low][0];
                const gj = bj + j + CORNERS[low][1];
                const gk = bk + k + CORNERS[low][2];
                const key = pointIndex(gi, gj, gk) * 3 + axis;
                let id = vertexIds.get(key);
                if (id === undefined) {
                  const a = corner[from];
                  const b = corner[to];
                  const t = a / (a - b);
                  const pa = CORNERS[from];
                  const pb = CORNERS[to];
                  id = vertices.length / 3;
                  vertexIds.set(key, id);
                  vertices.push(
                    origin[0] + (bi + i + pa[0] + t * (pb[0] - pa[0])) * voxel,
                    origin[1] + (bj + j + pa[1] + t * (pb[1] - pa[1])) * voxel,
                    origin[2] + (bk + k + pa[2] + t * (pb[2] - pa[2])) * voxel,
                  );
                }
                edgeVertex[e] = id;
              }

              const base = cube << 4;
              for (let t = 0; triTable[base + t] !== -1; t += 3) {
                const a = edgeVertex[triTable[base + t]];
                const b = edgeVertex[triTable[base + t + 1]];
                const c = edgeVertex[triTable[base + t + 2]];
                if (a !== b && b !== c && a !== c) triangles.push(a, b, c);
              }
            }
          }
        }
      }
    }
  }
  return { vertices: new Float32Array(vertices), triangles: new Uint32Array(triangles) };
}
