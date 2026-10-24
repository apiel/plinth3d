// Pure data model for a Plinth3D project. No DOM or rendering code lives here,
// so it can be tested in isolation.

export type Vec3 = [number, number, number];

export type ShapeType = 'box' | 'cylinder' | 'sphere';

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}

export interface Shape {
  id: string;
  name: string;
  type: ShapeType;
  layerId: string;
  /** Position in millimetres. */
  position: Vec3;
  /** Rotation in degrees, applied in XYZ order. */
  rotation: Vec3;
  /** Bounding-box size in millimetres. */
  size: Vec3;
  color: string;
  /** Holes are subtracted from the solids in the same visible layers. */
  hole: boolean;
}

export interface Project {
  layers: Layer[];
  shapes: Shape[];
}

export const PROJECT_FORMAT = 'plinth3d';
export const PROJECT_VERSION = 1;

const PALETTE = ['#4f8cff', '#ff7a59', '#2ec4a6', '#f5c542', '#a46cf5', '#9aa4b2'];

const DEFAULT_SIZE: Record<ShapeType, Vec3> = {
  box: [20, 20, 20],
  cylinder: [20, 30, 20],
  sphere: [20, 20, 20],
};

const TYPE_LABEL: Record<ShapeType, string> = {
  box: 'Box',
  cylinder: 'Cylinder',
  sphere: 'Sphere',
};

export function createId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function createLayer(name: string): Layer {
  return { id: createId(), name, visible: true, locked: false };
}

export function createProject(): Project {
  const base = createLayer('Layer 1');
  return { layers: [base], shapes: [] };
}

export function createShape(
  type: ShapeType,
  layerId: string,
  existing: Shape[],
  position?: Vec3,
): Shape {
  const count = existing.filter((s) => s.type === type).length + 1;
  const size = [...DEFAULT_SIZE[type]] as Vec3;
  return {
    id: createId(),
    name: `${TYPE_LABEL[type]} ${count}`,
    type,
    layerId,
    // Default: sit on the build plate (y = 0 in the scene).
    position: position ?? [0, size[1] / 2, 0],
    rotation: [0, 0, 0],
    size,
    color: PALETTE[existing.length % PALETTE.length],
    hole: false,
  };
}

/** Shapes that take part in the output: their layer is visible. */
export function visibleShapes(project: Project): Shape[] {
  const visibleLayers = new Set(project.layers.filter((l) => l.visible).map((l) => l.id));
  return project.shapes.filter((s) => visibleLayers.has(s.layerId));
}

export function serializeProject(project: Project): string {
  return JSON.stringify({ format: PROJECT_FORMAT, version: PROJECT_VERSION, ...project }, null, 2);
}

function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

export function parseProject(text: string): Project {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  if (typeof data !== 'object' || data === null) throw new Error('The file has no project data.');
  const doc = data as Record<string, unknown>;
  if (doc.format !== PROJECT_FORMAT) throw new Error('This file is not a Plinth3D project.');
  if (doc.version !== PROJECT_VERSION) throw new Error(`Unsupported project version: ${String(doc.version)}.`);
  if (!Array.isArray(doc.layers) || !Array.isArray(doc.shapes)) throw new Error('The project is missing layers or shapes.');

  const layers = doc.layers as Layer[];
  const layerIds = new Set(layers.map((l) => l.id));
  for (const shape of doc.shapes as Shape[]) {
    if (!layerIds.has(shape.layerId)) throw new Error(`Shape "${shape.name}" refers to an unknown layer.`);
    if (!isVec3(shape.position) || !isVec3(shape.rotation) || !isVec3(shape.size)) {
      throw new Error(`Shape "${shape.name}" has invalid transform values.`);
    }
    if (!(shape.type in DEFAULT_SIZE)) throw new Error(`Shape "${shape.name}" has an unknown type.`);
  }
  return { layers, shapes: doc.shapes as Shape[] };
}
