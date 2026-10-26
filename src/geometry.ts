// Geometry for Plinth3D: manifold primitives, boolean results and STL export.
// Internal coordinates are Y-up (as in three.js). STL export converts to
// Z-up, which is what slicers expect.

import Module, { type Manifold, type ManifoldToplevel, type Mat4 } from 'manifold-3d';
// Import the WASM file's URL explicitly. Without this, the dev server can serve
// its HTML fallback instead, and the engine never loads.
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { createId, type MeshGeometry, type Shape, type Vec3 } from './model';

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
  if (shape.type === 'mesh') return mergedGeometry(wasm, shape);
  if (hasEdges(shape)) return edgedSolid(wasm, shape, shape.edges!);
  if (isPartialSweep(shape)) return sweptSolid(wasm, shape);
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
    case 'cone':
      base = uprightCylinder(wasm, 0.5, 0, CYLINDER_SEGMENTS);
      break;
    case 'pyramid':
      // Four segments turned by 45 degrees give a square base whose sides are 1 wide.
      base = uprightCylinder(wasm, Math.SQRT1_2, 0, 4, 45);
      break;
    case 'wedge': {
      // A right triangle in X and Y, extruded along Z.
      const triangle = wasm.CrossSection.ofPolygons([[[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5]]]);
      base = wasm.Manifold.extrude(triangle, 1, undefined, undefined, undefined, true);
      triangle.delete();
      break;
    }
    case 'torus': {
      // A ring around the Y axis. It is flattened to fill the unit box, so its height matches its size.
      // Revolving puts the ring's axis on Z, so it is turned to stand along Y first.
      const section = wasm.CrossSection.circle(0.2, 32).translate(0.3, 0);
      const ring = wasm.Manifold.revolve(section, CYLINDER_SEGMENTS);
      section.delete();
      const upright = ring.transform(toMat4(new Matrix4().makeRotationX(-Math.PI / 2)));
      ring.delete();
      base = upright.scale([1, 2.5, 1]);
      upright.delete();
      break;
    }
  }
  const sized = base.scale(shape.size);
  base.delete();
  return sized;
}

/** Boxes and cylinders (whole ones) can have their edges rounded or chamfered. */
export const EDGE_TYPES: Shape['type'][] = ['box', 'cylinder'];

function hasEdges(shape: Shape): boolean {
  const e = shape.edges;
  return !!e && EDGE_TYPES.includes(shape.type) && !isPartialSweep(shape) && e.vertical.size + e.top.size + e.bottom.size > 0;
}

/** Shapes that are a profile turned around the Y axis can be built over part of the turn. */
export const SWEEP_TYPES: Shape['type'][] = ['cylinder', 'cone', 'torus'];

function isPartialSweep(shape: Shape): boolean {
  return SWEEP_TYPES.includes(shape.type) && shape.sweep !== undefined && shape.sweep > 0 && shape.sweep < 360;
}

/**
 * A cylinder, cone or torus turned over only part of the circle: its profile revolved by `sweep`
 * degrees, starting on the +X side. The bounding box stays that of the whole shape, so it resizes the same way.
 */
function sweptSolid(wasm: ManifoldToplevel, shape: Shape): Manifold {
  const sweep = shape.sweep as number;
  // Profile in (radius, height); revolving turns it around the vertical axis of the profile.
  const profile =
    shape.type === 'torus'
      ? wasm.CrossSection.circle(0.2, 32).translate(0.3, 0)
      : wasm.CrossSection.ofPolygons([
          shape.type === 'cone'
            ? [[0, -0.5], [0.5, -0.5], [0, 0.5]]
            : [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]],
        ]);
  const segments = Math.max(3, Math.ceil((CYLINDER_SEGMENTS * sweep) / 360));
  const revolved = wasm.Manifold.revolve(profile, segments, sweep);
  profile.delete();
  // Revolving puts the axis on Z; stand it along Y.
  const upright = revolved.transform(toMat4(new Matrix4().makeRotationX(-Math.PI / 2)));
  revolved.delete();
  const flattened = shape.type === 'torus' ? upright.scale([1, 2.5, 1]) : upright;
  if (flattened !== upright) upright.delete();
  const sized = flattened.scale(shape.size);
  flattened.delete();
  return sized;
}

/** A cylinder or cone standing along Y, with the given radii, centred on the origin. */
function uprightCylinder(
  wasm: ManifoldToplevel,
  radiusLow: number,
  radiusHigh: number,
  segments: number,
  turnDegrees = 0,
): Manifold {
  const lying = wasm.Manifold.cylinder(1, radiusLow, radiusHigh, segments, true);
  const turned = turnDegrees === 0 ? lying : lying.rotate([0, 0, turnDegrees]);
  if (turned !== lying) lying.delete();
  const upright = turned.transform(toMat4(new Matrix4().makeRotationX(-Math.PI / 2)));
  turned.delete();
  return upright;
}

/** A merged shape's stored mesh, stretched from its original size to its current size. */
function mergedGeometry(wasm: ManifoldToplevel, shape: Shape): Manifold {
  const { mesh, baseSize } = shape;
  if (!mesh || !baseSize) throw new Error(`Merged shape "${shape.name}" has no geometry.`);
  const original = new wasm.Mesh({
    numProp: 3,
    vertProperties: Float32Array.from(mesh.positions),
    triVerts: Uint32Array.from(mesh.indices),
  });
  const base = new wasm.Manifold(original);
  const factor: Vec3 = [0, 1, 2].map((i) => (baseSize[i] > 0 ? shape.size[i] / baseSize[i] : 1)) as Vec3;
  const scaled = base.scale(factor);
  base.delete();
  return scaled;
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
/**
 * The printable union of every visible solid. Holes are left out: a hole only cuts
 * the solids it is merged with (see mergeShapes).
 */
export function buildResult(wasm: ManifoldToplevel, shapes: Shape[]): Manifold | null {
  const parts = shapes.filter((s) => !s.hole).map((s) => placedPrimitive(wasm, s));
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  const union = wasm.Manifold.union(parts);
  parts.forEach((m) => m.delete());
  return union;
}

export interface MergedGeometry {
  geometry: MeshGeometry;
  position: Vec3;
  size: Vec3;
}

/**
 * Bakes shapes into one mesh: solids are unioned, then holes are subtracted.
 * The mesh is centred on its own bounding box, so the result can be moved and resized.
 * Returns null when there is no solid to keep.
 */
export function mergeShapes(wasm: ManifoldToplevel, shapes: Shape[]): MergedGeometry | null {
  const solidParts = shapes.filter((s) => !s.hole).map((s) => placedPrimitive(wasm, s));
  if (solidParts.length === 0) return null;
  const solid = wasm.Manifold.union(solidParts);
  solidParts.forEach((m) => m.delete());

  const holeParts = shapes.filter((s) => s.hole).map((s) => placedPrimitive(wasm, s));
  let result = solid;
  if (holeParts.length > 0) {
    const holes = wasm.Manifold.union(holeParts);
    holeParts.forEach((m) => m.delete());
    result = solid.subtract(holes);
    solid.delete();
    holes.delete();
  }

  const data = meshData(result);
  result.delete();
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < data.positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], data.positions[i + axis]);
      max[axis] = Math.max(max[axis], data.positions[i + axis]);
    }
  }
  const position = min.map((v, i) => (v + max[i]) / 2) as Vec3;
  const size = min.map((v, i) => round3(max[i] - v)) as Vec3;
  const positions: number[] = [];
  for (let i = 0; i < data.positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) positions.push(round3(data.positions[i + axis] - position[axis]));
  }
  return {
    geometry: { positions, indices: Array.from(data.indices) },
    position: position.map(round3) as Vec3,
    size,
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
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
 * The snap step while Ctrl, Shift and Alt are held. Each key has a factor; 1 leaves the step alone
 * and 0 turns snapping off. Alt can also be set to 'round', which is not a factor. A step that is
 * already off stays off.
 */
export function modifiedStep(
  base: number,
  keys: { ctrl: number; shift: number; alt: number },
  held: { ctrl: boolean; shift: boolean; alt?: boolean },
): number {
  if (base <= 0) return 0;
  return base * (held.ctrl ? keys.ctrl : 1) * (held.shift ? keys.shift : 1) * (held.alt ? keys.alt : 1);
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

interface Frame {
  origin: Vector3;
  scale: Vector3;
  position: Vector3;
  quaternion: Quaternion;
}

/**
 * The shapes a merged object was made from, moved and resized to match the merged object as it is now.
 * Each restored shape gets a new id, so a clone of a merged object does not clash with the original.
 */
export function restoreSources(merged: Shape): Shape[] {
  const frame: Frame = {
    origin: new Vector3(...(merged.sourcePosition ?? merged.position)),
    scale: new Vector3(...merged.size).divide(new Vector3(...(merged.baseSize ?? merged.size))),
    position: new Vector3(...merged.position),
    quaternion: shapeQuaternion(merged),
  };
  return (merged.sources ?? []).map((source) => mapShape(source, frame));
}

function mapPoint(point: Vec3, frame: Frame): Vec3 {
  const v = new Vector3(...point).sub(frame.origin).multiply(frame.scale).applyQuaternion(frame.quaternion).add(frame.position);
  return [round3(v.x), round3(v.y), round3(v.z)];
}

function mapShape(shape: Shape, frame: Frame): Shape {
  const rotation = new Euler().setFromQuaternion(frame.quaternion.clone().multiply(shapeQuaternion(shape)), 'XYZ');
  return {
    ...shape,
    id: createId(),
    position: mapPoint(shape.position, frame),
    rotation: [rotation.x, rotation.y, rotation.z].map((r) => round3(r / DEG_TO_RAD)) as Vec3,
    size: shape.size.map((value, i) => round3(value * frame.scale.getComponent(i))) as Vec3,
    sourcePosition: shape.sourcePosition ? mapPoint(shape.sourcePosition, frame) : undefined,
    sources: shape.sources?.map((child) => mapShape(child, frame)),
  };
}

/** Slices along each rounded edge; a chamfer needs only its two ends. */
const EDGE_STEPS = 8;

/** How far a slice at `t` mm from the face sits in from the outline, for an edge of radius `r`. */
function edgeInset(style: 'round' | 'chamfer', r: number, t: number): number {
  if (style === 'chamfer') return r - t;
  return r - Math.sqrt(Math.max(r * r - (r - t) * (r - t), 0));
}

/** Heights (from the face) and insets of the slices that make one edge. */
function edgeSlices(style: 'round' | 'chamfer', r: number): { t: number; inset: number }[] {
  if (r <= 0) return [{ t: 0, inset: 0 }];
  const steps = style === 'chamfer' ? 1 : EDGE_STEPS;
  const slices = [];
  for (let i = 0; i <= steps; i++) {
    const t = (r * i) / steps;
    slices.push({ t, inset: edgeInset(style, r, t) });
  }
  return slices;
}

/**
 * A box or cylinder with its vertical corners, top edge and bottom edge rounded or chamfered. The
 * solid is convex, so it is the hull of a handful of outlines stacked at different heights. Sizes
 * are in mm; the shape is centred on the origin, standing along Y.
 */
function edgedSolid(wasm: ManifoldToplevel, shape: Shape, edges: NonNullable<Shape['edges']>): Manifold {
  const [w, h, d] = shape.size;
  const isBox = shape.type === 'box';
  const maxR = Math.min(w, d) / 2;
  const vertical = isBox ? Math.min(Math.max(edges.vertical.size, 0), maxR) : 0;
  const top = Math.min(Math.max(edges.top.size, 0), maxR, h);
  const bottom = Math.min(Math.max(edges.bottom.size, 0), maxR, h - top);

  const outline = (inset: number): [number, number][] => {
    const rw = w / 2 - inset;
    const rd = d / 2 - inset;
    if (!isBox) {
      const circle = wasm.CrossSection.circle(1, CYLINDER_SEGMENTS).scale([rw, rd]);
      const points = circle.toPolygons()[0] as [number, number][];
      circle.delete();
      return points;
    }
    if (edges.vertical.chamfer) {
      // Each corner is cut flat; the cut shrinks as the outline moves in.
      const cut = Math.max(vertical - inset * (2 - Math.SQRT2), 0);
      const pts: [number, number][] = [];
      for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
        const x = sx * rw;
        const z = sz * rd;
        // Order the two cut points so the outline keeps its winding.
        const a: [number, number] = [x, z - sz * cut];
        const b: [number, number] = [x - sx * cut, z];
        pts.push(...(sx * sz > 0 ? [a, b] : [b, a]));
      }
      return cut > 0 ? pts : [[rw, rd], [-rw, rd], [-rw, -rd], [rw, -rd]];
    }
    const corner = Math.max(vertical - inset, 0);
    const core = wasm.CrossSection.square([2 * (rw - corner), 2 * (rd - corner)], true);
    const grown = corner > 0 ? core.offset(corner, 'Round', 2, CYLINDER_SEGMENTS / 4) : core;
    const points = grown.toPolygons()[0] as [number, number][];
    if (grown !== core) grown.delete();
    core.delete();
    return points;
  };

  const points: [number, number, number][] = [];
  const add = (y: number, inset: number) => {
    for (const [x, z] of outline(Math.max(inset, 0))) points.push([x, y, z]);
  };
  for (const { t, inset } of edgeSlices(edges.top.chamfer ? 'chamfer' : 'round', top)) add(h / 2 - t, inset);
  for (const { t, inset } of edgeSlices(edges.bottom.chamfer ? 'chamfer' : 'round', bottom)) add(-h / 2 + t, inset);
  return wasm.Manifold.hull(points);
}
