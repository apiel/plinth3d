// Pure data model for a Plinth3D project. No DOM or rendering code lives here,
// so it can be tested in isolation.

export type Vec3 = [number, number, number];

export type ShapeType = 'box' | 'cylinder' | 'sphere' | 'cone' | 'pyramid' | 'wedge' | 'torus' | 'mesh';

/** Triangle mesh in the shape's own frame, centred on the origin. Used by merged shapes. */
export interface MeshGeometry {
  positions: number[];
  indices: number[];
}

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
  /** A hidden shape is kept in the project but left out of the scene, the result and the export. */
  hidden?: boolean;
  /** Merged shapes only: the geometry, and the size it was made at. Resizing scales it from baseSize. */
  mesh?: MeshGeometry;
  baseSize?: Vec3;
  /** Merged shapes only: the shapes they were made from, and the point they were made around. */
  sources?: Shape[];
  sourcePosition?: Vec3;
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
  cone: [20, 30, 20],
  pyramid: [20, 30, 20],
  wedge: [20, 20, 20],
  torus: [30, 10, 30],
  mesh: [20, 20, 20],
};

const TYPE_LABEL: Record<ShapeType, string> = {
  box: 'Box',
  cylinder: 'Cylinder',
  sphere: 'Sphere',
  cone: 'Cone',
  pyramid: 'Pyramid',
  wedge: 'Wedge',
  torus: 'Torus',
  mesh: 'Merged',
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
  return project.shapes.filter((s) => visibleLayers.has(s.layerId) && !s.hidden);
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
    if (shape.type === 'mesh' && (!shape.mesh || !isVec3(shape.baseSize))) {
      throw new Error(`Merged shape "${shape.name}" is missing its geometry.`);
    }
  }
  return { layers, shapes: doc.shapes as Shape[] };
}

export const LAYER_FORMAT = 'plinth3d-layer';

/** One layer and its shapes, as a file that can be shared and imported into any project. */
export function serializeLayer(project: Project, layerId: string): string {
  const layer = project.layers.find((l) => l.id === layerId);
  if (!layer) throw new Error('That layer does not exist.');
  const shapes = project.shapes.filter((s) => s.layerId === layerId);
  return JSON.stringify({ format: LAYER_FORMAT, version: PROJECT_VERSION, layer, shapes }, null, 2);
}

/** Reads a layer file. Throws a readable error when the file is not a layer. */
export function parseLayer(text: string): { layer: Layer; shapes: Shape[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  const doc = data as Record<string, unknown>;
  if (typeof doc !== 'object' || doc === null || doc.format !== LAYER_FORMAT) {
    throw new Error('This file is not a Plinth3D layer.');
  }
  if (doc.version !== PROJECT_VERSION) throw new Error(`Unsupported layer version: ${String(doc.version)}.`);
  const layer = doc.layer as Layer | undefined;
  if (!layer || typeof layer.name !== 'string') throw new Error('The layer file has no layer.');
  if (!Array.isArray(doc.shapes)) throw new Error('The layer file has no shapes.');
  for (const shape of doc.shapes as Shape[]) {
    if (!(shape.type in DEFAULT_SIZE)) throw new Error(`Shape "${shape.name}" has an unknown type.`);
    if (!isVec3(shape.position) || !isVec3(shape.rotation) || !isVec3(shape.size)) {
      throw new Error(`Shape "${shape.name}" has invalid transform values.`);
    }
  }
  return { layer, shapes: doc.shapes as Shape[] };
}

/** Gives a shape and everything it was merged from fresh ids, so imports never clash with existing shapes. */
function withFreshIds(shape: Shape): Shape {
  return { ...shape, id: createId(), sources: shape.sources?.map(withFreshIds) };
}

/** Adds a parsed layer to a project as a new layer, with new ids throughout. */
export function addLayerFromFile(project: Project, parsed: { layer: Layer; shapes: Shape[] }): Project {
  const layer: Layer = { ...parsed.layer, id: createId() };
  const shapes = parsed.shapes.map((s) => ({ ...withFreshIds(s), layerId: layer.id }));
  return { layers: [...project.layers, layer], shapes: [...project.shapes, ...shapes] };
}
