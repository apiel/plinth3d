// Geometry for Plinth3D: manifold primitives, boolean results and STL export.
// Internal coordinates are Y-up (as in three.js). STL export converts to
// Z-up, which is what slicers expect.

import Module, { type Manifold, type ManifoldToplevel, type Mat4 } from 'manifold-3d';
// Import the WASM file's URL explicitly. Without this, the dev server can serve
// its HTML fallback instead, and the engine never loads.
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { Shape, Vec3 } from './model';

const DEG_TO_RAD = Math.PI / 180;
const CYLINDER_SEGMENTS = 64;
const SPHERE_SEGMENTS = 48;

let enginePromise: Promise<ManifoldToplevel> | null = null;

/** Loads the WebAssembly geometry engine once and reuses it. */
export function loadEngine(): Promise<ManifoldToplevel> {
  if (!enginePromise) {
    // In Node (tests) the default loader finds the file itself.
    const config = typeof window === 'undefined' ? undefined : { locateFile: () => manifoldWasmUrl };
    enginePromise = Module(config).then((wasm) => {
      wasm.setup();
      return wasm;
    });
  }
  return enginePromise;
}

export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
}

/** Rotation of a shape, applied in XYZ order. */
export function shapeEuler(shape: Shape): Euler {
  const [x, y, z] = shape.rotation;
  return new Euler(x * DEG_TO_RAD, y * DEG_TO_RAD, z * DEG_TO_RAD, 'XYZ');
}

export function shapeQuaternion(shape: Shape): Quaternion {
  return new Quaternion().setFromEuler(shapeEuler(shape));
}

export function shapePosition(shape: Shape): Vector3 {
  return new Vector3(...shape.position);
}

/**
 * The shape's unscaled-to-size primitive, centred on the origin, in the
 * shape's own (unrotated, unmoved) frame. Callers own the returned manifold.
 */
export function localPrimitive(wasm: ManifoldToplevel, shape: Shape): Manifold {
  let base: Manifold;
  switch (shape.type) {
    case 'box':
      base = wasm.Manifold.cube([1, 1, 1], true);
      break;
    case 'cylinder': {
      // Manifold cylinders run along Z; rotate them so they stand along Y.
      const upright = wasm.Manifold.cylinder(1, 0.5, 0.5, CYLINDER_SEGMENTS, true);
      base = upright.transform(toMat4(new Matrix4().makeRotationX(-Math.PI / 2)));
      upright.delete();
      break;
    }
    case 'sphere':
      base = wasm.Manifold.sphere(0.5, SPHERE_SEGMENTS);
      break;
  }
  const sized = base.scale(shape.size);
  base.delete();
  return sized;
}

/** Matrix that places a local primitive into the scene. */
export function placementMatrix(shape: Shape): Matrix4 {
  return new Matrix4().compose(shapePosition(shape), shapeQuaternion(shape), new Vector3(1, 1, 1));
}

function toMat4(matrix: Matrix4): Mat4 {
  return [...matrix.elements] as unknown as Mat4;
}

function placedPrimitive(wasm: ManifoldToplevel, shape: Shape): Manifold {
  const local = localPrimitive(wasm, shape);
  const placed = local.transform(toMat4(placementMatrix(shape)));
  local.delete();
  return placed;
}

/**
 * Combines shapes into one solid: all solids are unioned, then all holes are
 * subtracted. Returns null when there is nothing solid to make.
 * The caller owns the returned manifold.
 */
export function buildResult(wasm: ManifoldToplevel, shapes: Shape[]): Manifold | null {
  // Each group is built on its own, so a hole only cuts the solids it is merged with.
  // Ungrouped shapes each form a group of their own.
  const groups = new Map<string, Shape[]>();
  for (const shape of shapes) {
    const key = shape.groupId ?? `solo:${shape.id}`;
    groups.set(key, [...(groups.get(key) ?? []), shape]);
  }
  const parts: Manifold[] = [];
  for (const members of groups.values()) {
    const part = buildGroup(wasm, members);
    if (part) parts.push(part);
  }
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  const union = wasm.Manifold.union(parts);
  parts.forEach((m) => m.delete());
  return union;
}

function buildGroup(wasm: ManifoldToplevel, shapes: Shape[]): Manifold | null {
  const solidParts = shapes.filter((s) => !s.hole).map((s) => placedPrimitive(wasm, s));
  if (solidParts.length === 0) return null;
  const solid = wasm.Manifold.union(solidParts);
  solidParts.forEach((m) => m.delete());

  const holeParts = shapes.filter((s) => s.hole).map((s) => placedPrimitive(wasm, s));
  if (holeParts.length === 0) return solid;
  const holes = wasm.Manifold.union(holeParts);
  holeParts.forEach((m) => m.delete());

  const result = solid.subtract(holes);
  solid.delete();
  holes.delete();
  return result;
}

export function meshData(manifold: Manifold): MeshData {
  const mesh = manifold.getMesh();
  const stride = mesh.numProp;
  const vertCount = mesh.vertProperties.length / stride;
  const positions = new Float32Array(vertCount * 3);
  for (let i = 0; i < vertCount; i++) {
    positions[i * 3] = mesh.vertProperties[i * stride];
    positions[i * 3 + 1] = mesh.vertProperties[i * stride + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * stride + 2];
  }
  return { positions, indices: Uint32Array.from(mesh.triVerts) };
}

/** Converts a Y-up point to the Z-up space used by STL files. */
function toPrinterSpace(positions: Float32Array, vertex: number): Vec3 {
  const i = vertex * 3;
  return [positions[i], -positions[i + 2], positions[i + 1]];
}

/** Encodes a mesh as a binary STL file, in Z-up printer coordinates. */
export function encodeBinarySTL(data: MeshData): ArrayBuffer {
  const triangleCount = data.indices.length / 3;
  const buffer = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(buffer);
  const header = 'Plinth3D binary STL';
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i));
  view.setUint32(80, triangleCount, true);

  let offset = 84;
  for (let t = 0; t < triangleCount; t++) {
    const a = toPrinterSpace(data.positions, data.indices[t * 3]);
    const b = toPrinterSpace(data.positions, data.indices[t * 3 + 1]);
    const c = toPrinterSpace(data.positions, data.indices[t * 3 + 2]);
    const normal = faceNormal(a, b, c);
    for (const v of [normal, a, b, c]) {
      for (const n of v) {
        view.setFloat32(offset, n, true);
        offset += 4;
      }
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  return buffer;
}

function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  return length === 0 ? [0, 0, 0] : [nx / length, ny / length, nz / length];
}

/** The printable result for a set of shapes, or null when there is no solid. */
export function resultMesh(wasm: ManifoldToplevel, shapes: Shape[]): MeshData | null {
  const manifold = buildResult(wasm, shapes);
  if (!manifold) return null;
  try {
    return meshData(manifold);
  } finally {
    manifold.delete();
  }
}

/** Rounds to the nearest step. A step of 0 means no snapping, only tidy decimals. */
export function snapTo(value: number, step: number): number {
  const snapped = step > 0 ? Math.round(value / step) * step : value;
  return Math.round(snapped * 1000) / 1000;
}

/**
 * The size and position a shape gets when one axis is stretched to `extent`.
 * The face opposite the dragged handle stays where it is: the centre moves by half the change.
 */
export function resizeAlongAxis(shape: Shape, axis: number, sign: number, extent: number): { size: Vec3; position: Vec3 } {
  const size = [...shape.size] as Vec3;
  size[axis] = extent;
  const change = sign * (extent - shape.size[axis]);
  const dir = new Vector3().setComponent(axis, 1).applyQuaternion(shapeQuaternion(shape));
  const position = shape.position.map((value, i) => Math.round((value + (dir.getComponent(i) * change) / 2) * 1000) / 1000) as Vec3;
  return { size, position };
}
