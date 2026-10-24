import { useEffect, useRef } from 'react';
import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Euler,
  GridHelper,
  Group,
  type Intersection,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { ManifoldToplevel } from 'manifold-3d';
import type { Layer, Shape, Vec3 } from './model';
import { localPrimitive, meshData, shapePosition, shapeQuaternion, type MeshData } from './geometry';

const DEG_TO_RAD = Math.PI / 180;
const HOLE_COLOR = '#ff4d4d';
const RESULT_COLOR = '#c9d2e0';
const MIN_SIZE = 1;
const DRAG_THRESHOLD = 3;
/** Handle size as a fraction of the camera distance, so handles look the same size on screen. */
const HANDLE_SCREEN_SCALE = 0.012;

export type Theme = 'dark' | 'light';

/** Which plane a body drag moves the shape in. Names follow the Inspector's X, Y and Z. */
export type DragPlane = 'XY' | 'XZ' | 'YZ';

const DRAG_PLANE_NORMAL: Record<DragPlane, Vector3> = {
  XY: new Vector3(0, 0, 1),
  XZ: new Vector3(0, 1, 0),
  YZ: new Vector3(1, 0, 0),
};

const THEMES = {
  dark: { background: '#1d2129', gridMajor: '#3a4150', gridMinor: '#2a2f3a', outline: '#ffffff' },
  light: { background: '#f4f6fa', gridMajor: '#b8c0cc', gridMinor: '#d9dee7', outline: '#1d2129' },
};

export type GizmoMode = 'translate' | 'rotate';

export interface TransformChange {
  id: string;
  position: Vec3;
  rotation: Vec3;
}

interface ViewportProps {
  engine: ManifoldToplevel | null;
  layers: Layer[];
  shapes: Shape[];
  selectedId: string | null;
  gizmoMode: GizmoMode;
  dragPlane: DragPlane;
  result: MeshData | null;
  showResult: boolean;
  theme: Theme;
  onSelect: (id: string | null) => void;
  onTransform: (change: TransformChange) => void;
  /** Called once when a drag actually starts changing a shape. Used for one undo step. */
  onEditStart: () => void;
  /** Called on every step of a drag. Does not add undo steps. */
  onShapeLive: (id: string, patch: Partial<Shape>) => void;
}

/** The drag in progress, if any. */
type Drag = {
  moved: boolean;
} & (
  | { kind: 'move'; id: string; plane: Plane; start: Vector3; startPosition: Vec3 }
  | {
      kind: 'resize';
      id: string;
      dir: Vector3;
      plane: Plane;
      origin: Vector3;
      axis: number;
      sign: number;
      startAlong: number;
      startSize: Vec3;
      startPosition: Vec3;
    }
);

/** Owns the three.js scene. React state drives it through props. */
export function Viewport(props: ViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handlersRef = useRef<ViewportProps>(props);
  handlersRef.current = props;

  const sceneRef = useRef<{
    renderer: WebGLRenderer;
    scene: Scene;
    camera: PerspectiveCamera;
    orbit: OrbitControls;
    transform: TransformControls;
    objects: Group;
    resultGroup: Group;
    grid: GridHelper | null;
    handles: Mesh[];
  } | null>(null);

  // One-time scene setup.
  useEffect(() => {
    const container = containerRef.current!;
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const scene = new Scene();

    const camera = new PerspectiveCamera(45, 1, 0.1, 5000);
    camera.position.set(120, 110, 160);

    scene.add(new AmbientLight(0xffffff, 0.6));
    const sun = new DirectionalLight(0xffffff, 1.0);
    sun.position.set(100, 200, 120);
    scene.add(sun);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setTranslationSnap(1);
    transform.setRotationSnap(15 * DEG_TO_RAD);
    transform.addEventListener('dragging-changed', (event) => {
      const dragging = (event as unknown as { value: boolean }).value;
      orbit.enabled = !dragging;
      if (!dragging) {
        const object = transform.object;
        if (object) {
          const rotation = new Euler().setFromQuaternion(object.quaternion, 'XYZ');
          handlersRef.current.onTransform({
            id: object.userData.shapeId as string,
            position: [round(object.position.x), round(object.position.y), round(object.position.z)],
            rotation: [rotation.x, rotation.y, rotation.z].map((r) => round(r / DEG_TO_RAD)) as Vec3,
          });
        }
      }
    });
    scene.add(transform);

    const objects = new Group();
    const resultGroup = new Group();
    scene.add(objects, resultGroup);

    sceneRef.current = { renderer, scene, camera, orbit, transform, objects, resultGroup, grid: null, handles: [] };

    const resizeCanvas = () => {
      const { clientWidth, clientHeight } = container;
      renderer.setSize(clientWidth, clientHeight);
      camera.aspect = clientWidth / Math.max(clientHeight, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(container);
    resizeCanvas();

    const scratch = new Vector3();
    renderer.setAnimationLoop(() => {
      orbit.update();
      // Keep the face handles a constant size on screen, however far the camera is.
      for (const handle of sceneRef.current?.handles ?? []) {
        handle.scale.setScalar(handle.getWorldPosition(scratch).distanceTo(camera.position) * HANDLE_SCREEN_SCALE);
      }
      renderer.render(scene, camera);
    });

    const raycaster = new Raycaster();
    const pointer = new Vector2();
    // Where the current press started, and which shape it pressed on (if any).
    let pressAt: { x: number; y: number } | null = null;
    let pressedShape: string | null = null;
    let drag: Drag | null = null;

    const aim = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      // New objects get their world matrix on the next frame; refresh now so picks are exact.
      objects.updateMatrixWorld(true);
      raycaster.setFromCamera(pointer, camera);
    };

    const shapeIdOf = (object: Object3D): string | null => {
      let node: Object3D | null = object;
      while (node && !node.userData.shapeId) node = node.parent;
      return (node?.userData.shapeId as string | undefined) ?? null;
    };

    const shapeById = (id: string) => handlersRef.current.shapes.find((s) => s.id === id);
    const isLocked = (shape: Shape) => handlersRef.current.layers.find((l) => l.id === shape.layerId)?.locked ?? false;

    // Dragging a face handle stretches the shape along that axis, keeping the opposite face still.
    const startResize = (handle: Intersection) => {
      const { handleAxis: axis, handleSign: sign } = handle.object.userData as { handleAxis: number; handleSign: number };
      const group = handle.object.parent as Group;
      const id = group.userData.shapeId as string;
      const shape = shapeById(id);
      if (!shape) return;

      const dir = new Vector3().setComponent(axis, 1).applyQuaternion(group.quaternion);
      // A plane that contains the axis and faces the camera, so the mouse drives the axis.
      const cameraDir = camera.getWorldDirection(new Vector3());
      const normal = cameraDir.clone().sub(dir.clone().multiplyScalar(cameraDir.dot(dir)));
      if (normal.lengthSq() < 1e-6) normal.set(dir.y > 0.9 ? 1 : 0, dir.y > 0.9 ? 0 : 1, 0);
      const origin = handle.object.getWorldPosition(new Vector3());
      const plane = new Plane().setFromNormalAndCoplanarPoint(normal.normalize(), origin);

      const hitAtStart = new Vector3();
      if (!raycaster.ray.intersectPlane(plane, hitAtStart)) return;
      drag = {
        kind: 'resize',
        moved: false,
        id,
        dir,
        plane,
        origin,
        axis,
        sign,
        startAlong: hitAtStart.sub(origin).dot(dir),
        startSize: [...shape.size] as Vec3,
        startPosition: [...shape.position] as Vec3,
      };
      orbit.enabled = false;
    };

    // Dragging the body moves the shape within the chosen drag plane.
    const startMove = (shape: Shape, point: Vector3) => {
      const plane = new Plane().setFromNormalAndCoplanarPoint(DRAG_PLANE_NORMAL[handlersRef.current.dragPlane], point);
      drag = {
        kind: 'move',
        moved: false,
        id: shape.id,
        plane,
        start: point.clone(),
        startPosition: [...shape.position] as Vec3,
      };
      orbit.enabled = false;
    };

    const onDown = (event: PointerEvent) => {
      pressAt = { x: event.clientX, y: event.clientY };
      pressedShape = null;
      aim(event);

      // Face handles win over the move arrows, which can sit on the same spot.
      const handle = raycaster.intersectObjects(sceneRef.current?.handles ?? [], false)[0];
      if (handle) {
        event.stopImmediatePropagation();
        startResize(handle);
        return;
      }
      // An arrow or plane of the move gizmo is under the pointer: TransformControls handles it.
      // Its centre handle sits on the shape itself, so a press there is a body drag instead.
      if (transform.axis !== null && transform.axis !== 'XYZ') return;

      const hit = raycaster.intersectObjects(objects.children, true).find((h) => h.object instanceof Mesh);
      const id = hit ? shapeIdOf(hit.object) : null;
      if (!hit || !id) return;
      pressedShape = id;
      if (transform.axis === 'XYZ') event.stopImmediatePropagation();

      const shape = shapeById(id);
      if (!shape) return;
      if (handlersRef.current.selectedId !== id) handlersRef.current.onSelect(id);
      if (!isLocked(shape)) startMove(shape, hit.point);
    };

    const onMove = (event: PointerEvent) => {
      if (!drag) return;
      if (!drag.moved) {
        if (!pressAt || Math.hypot(event.clientX - pressAt.x, event.clientY - pressAt.y) < DRAG_THRESHOLD) return;
        drag.moved = true;
        handlersRef.current.onEditStart();
      }

      aim(event);
      const hit = new Vector3();
      if (!raycaster.ray.intersectPlane(drag.plane, hit)) return;

      if (drag.kind === 'move') {
        const delta = hit.sub(drag.start);
        const position = drag.startPosition.map((value, i) => Math.round(value + delta.getComponent(i))) as Vec3;
        handlersRef.current.onShapeLive(drag.id, { position });
        return;
      }

      const along = hit.sub(drag.origin).dot(drag.dir) - drag.startAlong;
      const startExtent = drag.startSize[drag.axis];
      const extent = Math.max(MIN_SIZE, Math.round(startExtent + drag.sign * along));
      const change = drag.sign * (extent - startExtent);
      const size = [...drag.startSize] as Vec3;
      size[drag.axis] = extent;
      const { dir, startPosition } = drag;
      const position = startPosition.map((value, i) => round(value + dir.getComponent(i) * change / 2)) as Vec3;
      handlersRef.current.onShapeLive(drag.id, { size, position });
    };

    const onUp = (event: PointerEvent) => {
      if (drag) {
        drag = null;
        orbit.enabled = true;
        pressAt = null;
        return;
      }
      if (!pressAt) return;
      const moved = Math.hypot(event.clientX - pressAt.x, event.clientY - pressAt.y);
      pressAt = null;
      // A click on empty plan clears the selection.
      if (moved <= DRAG_THRESHOLD && pressedShape === null && transform.axis === null) {
        handlersRef.current.onSelect(null);
      }
    };

    // Capture phase, so the handle check runs before the transform gizmo's own pointerdown.
    renderer.domElement.addEventListener('pointerdown', onDown, true);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);

    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown, true);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
      transform.dispose();
      orbit.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, []);

  // Rebuild the per-shape meshes when shapes, layers or selection change.
  useEffect(() => {
    const view = sceneRef.current;
    if (!view || !props.engine) return;
    const { objects, transform } = view;
    const { engine, shapes, layers, selectedId, showResult, theme } = props;
    const lockedLayers = new Set(layers.filter((l) => l.locked).map((l) => l.id));
    const visibleLayers = new Set(layers.filter((l) => l.visible).map((l) => l.id));

    transform.detach();
    clearGroup(objects);
    view.handles = [];
    view.resultGroup.visible = showResult;
    objects.visible = !showResult;

    for (const shape of shapes) {
      if (!visibleLayers.has(shape.layerId)) continue;
      const group = new Group();
      group.userData.shapeId = shape.id;
      group.position.copy(shapePosition(shape));
      group.quaternion.copy(shapeQuaternion(shape));

      const local = localPrimitive(engine, shape);
      const data = meshData(local);
      local.delete();
      const mesh = new Mesh(toGeometry(data), shape.hole ? holeMaterial() : solidMaterial(shape.color));
      mesh.userData.shapeId = shape.id;
      group.add(mesh);
      objects.add(group);

      if (shape.id === selectedId && !lockedLayers.has(shape.layerId) && !showResult) {
        transform.attach(group);
        group.add(boundingBox(shape.size, THEMES[theme].outline));
        for (const handle of makeHandles(shape.size, THEMES[theme].outline)) {
          group.add(handle);
          view.handles.push(handle);
        }
      }
    }
    transform.setMode(props.gizmoMode);
  }, [props.engine, props.shapes, props.layers, props.selectedId, props.showResult, props.gizmoMode, props.theme]);

  // Follow the theme: background and grid colours.
  useEffect(() => {
    const view = sceneRef.current;
    if (!view) return;
    const palette = THEMES[props.theme];
    view.scene.background = new Color(palette.background);
    if (view.grid) {
      view.scene.remove(view.grid);
      view.grid.geometry.dispose();
      (view.grid.material as Material).dispose();
    }
    view.grid = new GridHelper(400, 40, palette.gridMajor, palette.gridMinor);
    view.scene.add(view.grid);
  }, [props.theme]);

  // Show the boolean result when it changes.
  useEffect(() => {
    const view = sceneRef.current;
    if (!view) return;
    clearGroup(view.resultGroup);
    if (props.result) {
      const mesh = new Mesh(toGeometry(props.result), solidMaterial(RESULT_COLOR));
      view.resultGroup.add(mesh);
    }
  }, [props.result]);

  return <div className="viewport" ref={containerRef} />;
}

/** Dashed outline of the shape's bounding box, drawn in the shape's own frame. */
function boundingBox(size: Vec3, color: string): LineSegments {
  const line = new LineSegments(
    new EdgesGeometry(new BoxGeometry(size[0], size[1], size[2])),
    new LineDashedMaterial({ color, dashSize: 2, gapSize: 1.5 }),
  );
  line.computeLineDistances();
  return line;
}

/** Six square handles, one per face, in the shape's own frame. Each is 1 unit wide and scaled per frame. */
function makeHandles(size: Vec3, outlineColor: string): Mesh[] {
  const handles: Mesh[] = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [-1, 1]) {
      const box = new BoxGeometry(1, 1, 1);
      const mesh = new Mesh(box, new MeshBasicMaterial({ color: '#ffffff', depthTest: false }));
      mesh.position.setComponent(axis, (sign * size[axis]) / 2);
      mesh.renderOrder = 10;
      mesh.userData.handleAxis = axis;
      mesh.userData.handleSign = sign;

      const edges = new LineSegments(
        new EdgesGeometry(box),
        new LineBasicMaterial({ color: outlineColor, depthTest: false }),
      );
      edges.renderOrder = 11;
      mesh.add(edges);
      handles.push(mesh);
    }
  }
  return handles;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function toGeometry(data: MeshData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

function solidMaterial(color: string): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 });
}

function holeMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: HOLE_COLOR,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
}

function clearGroup(group: Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((node) => {
      const mesh = node as Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as MeshStandardMaterial | MeshStandardMaterial[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
  }
}
