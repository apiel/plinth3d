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
  MOUSE,
  type Intersection,
  ArrowHelper,
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
import type { MouseMap, StepKeys } from './SettingsMenu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { ManifoldToplevel } from 'manifold-3d';
import type { Layer, Shape, Vec3 } from './model';
import { localPrimitive, measureSegments, meshData, resizeAlongAxis, shapePosition, shapeQuaternion, modifiedStep, snapTo, type MeshData } from './geometry';

const DEG_TO_RAD = Math.PI / 180;
const HOLE_COLOR = '#ff4d4d';
const RESULT_COLOR = '#c9d2e0';
const MIN_SIZE = 0.1;
const AXIS_NAMES = ['Width', 'Height', 'Depth'];
const AXIS_LABELS = ['X', 'Y', 'Z'];
const VIEW_KEY = 'plinth3d:view';

const PLANE_AXES: Record<DragPlane, number[]> = { XY: [0, 1], XZ: [0, 2], YZ: [1, 2] };
/** Degrees a rotation turns by: normally, with Shift, and with Ctrl. */
const ROTATE_STEP = 1;
const ROTATE_STEP_BIG = 15;
const ROTATE_STEP_FINE = 0.1;
const GIZMO_AXES: Record<string, number[]> = { X: [0], Y: [1], Z: [2], XY: [0, 1], XZ: [0, 2], YZ: [1, 2], XYZ: [0, 1, 2] };
const CARD_OFFSET = 18;
const HANDLE_HOVER_COLOR = '#9cc2ff';
const HANDLE_ACTIVE_COLOR = '#2f6bff';
/** Length of the resize arrow as a fraction of the camera distance. */
const ARROW_SCREEN_SCALE = 0.12;
/** The move gizmo's colours for X, Y and Z, and the colour of a hovered cube. */
const AXIS_COLORS = [0xff3b3b, 0x3bd13b, 0x3b6bff];
const KNOB_HOVER_COLOR = 0xffff00;
/** Edge of a resize cube as a fraction of the camera distance. */
const KNOB_SCREEN_SCALE = 0.02;
/** Orange stands out on the blue shapes. */
const ARROW_COLOR = 0xff8a00;
const MEASURE_COLOR = 0xff8a00;
/** Width, height, depth and the gap to the plan. */
const MAX_MEASURE_LINES = 4;
const DRAG_THRESHOLD = 3;
/** Thickness of a face grab, in mm. */
const FACE_THICKNESS = 0.01;
/** The rim that grabs a face: this fraction of its shorter side, or this fraction of the camera distance. */
const RIM_FRACTION = 0.25;
const RIM_SCREEN_SCALE = 0.02;

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

/** Resize hides the gizmo and lets a drag anywhere on a face stretch it, never move the shape. */
export type GizmoMode = 'translate' | 'rotate' | 'resize';

/** A move or resize that the readout card shows and can edit. */
export type ReadoutTarget =
  | { id: string; kind: 'move'; axes: number[]; start: Vec3 }
  | { id: string; kind: 'rotate'; axes: number[]; start: Vec3 }
  | { id: string; kind: 'resize'; sides: { axis: number; sign: number }[] };

interface ViewportProps {
  engine: ManifoldToplevel | null;
  layers: Layer[];
  shapes: Shape[];
  selectedId: string | null;
  selection: string[];
  gizmoMode: GizmoMode;
  dragPlane: DragPlane;
  snap: number;
  /** Filled every frame with the camera's forward direction on the ground, for the arrow keys. */
  viewDirRef: { current: [number, number] };
  /** Set to a function that returns the current view as a PNG data URL (and its size), without the gizmos. */
  snapshotRef: { current: (() => { href: string; width: number; height: number } | null) | null };
  readout: ReadoutTarget | null;
  result: MeshData | null;
  showResult: boolean;
  /** While true, the selection's dimensions are drawn on top of the scene. */
  measuring: boolean;
  theme: Theme;
  onSelect: (id: string | null, additive: boolean) => void;
  /** Called once when a drag actually starts changing a shape. Used for one undo step. */
  onEditStart: (target: ReadoutTarget | null) => void;
  /** Called when a value is typed into the readout card. */
  onReadoutEdit: (target: ReadoutTarget, index: number, value: number) => void;
  /** Shows the readout for a target without adding an undo step. */
  onReadoutShow: (target: ReadoutTarget) => void;
  /** Closes the readout, so a clicked face stops being lit. */
  onReadoutClose: () => void;
  /** Shift + drag on empty space selects the shapes inside the rectangle. */
  onMarquee: (ids: string[]) => void;
  /** What Ctrl and Shift do to the snap step while dragging. */
  stepKeys: StepKeys;
  /** What each mouse button does to the view. */
  mouseMap: MouseMap;
  /** Called on every step of a drag. Does not add undo steps. */
  onShapeLive: (id: string, patch: Partial<Shape>) => void;
}

/** The drag in progress, if any. */
type Drag = {
  moved: boolean;
  target: ReadoutTarget;
} & (
  | { kind: 'move'; plane: Plane; start: Vector3; members: { id: string; start: Vec3 }[] }
  | {
      kind: 'resize';
      id: string;
      plane: Plane;
      startHit: Vector3;
      // The face being dragged: its axis, its sign and its world direction.
      side: { axis: number; sign: number };
      faces: { axis: number; sign: number; dir: Vector3 }[];
      startShape: Shape;
    }
);

/** Owns the three.js scene. React state drives it through props. */
export function Viewport(props: ViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const marqueeRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
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
    /** The resize gizmo of the selected shape: its axes, and the cubes at their ends. */
    resizeGizmos: Group[];
    knobs: Mesh[];
    hoveredKnob: Mesh | null;
    gizmoDragging: boolean;
    activeHandle: string | null;
    hoveredHandle: string | null;
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
    orbit.mouseButtons = mouseButtonsFor(handlersRef.current.mouseMap);
    // The view (camera position and orbit target) is kept across reloads.
    try {
      const saved = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null');
      if (Array.isArray(saved?.position) && Array.isArray(saved?.target) && [...saved.position, ...saved.target].every(Number.isFinite)) {
        camera.position.fromArray(saved.position);
        orbit.target.fromArray(saved.target);
        orbit.update();
      }
    } catch {
      // No saved view, or storage is unavailable: keep the default view.
    }
    const saveView = () => {
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify({ position: camera.position.toArray(), target: orbit.target.toArray() }));
      } catch {
        // Storage is full or blocked: the view is just not remembered.
      }
    };
    // Damping keeps firing change events after a drag, so this throttles instead of
    // debouncing, and the view is also saved when the page goes away.
    let saveViewTimer: number | undefined;
    orbit.addEventListener('change', () => {
      if (saveViewTimer !== undefined) return;
      saveViewTimer = window.setTimeout(() => {
        saveViewTimer = undefined;
        saveView();
      }, 300);
    });
    window.addEventListener('pagehide', saveView);

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setTranslationSnap(1);
    // Rotation turns 1 degree at a time. Shift takes big steps and Ctrl fine ones.
    const setRotationStep = (event: { ctrlKey: boolean; metaKey?: boolean; shiftKey: boolean }) => {
      const degrees = event.ctrlKey || event.metaKey ? ROTATE_STEP_FINE : event.shiftKey ? ROTATE_STEP_BIG : ROTATE_STEP;
      transform.setRotationSnap(degrees * DEG_TO_RAD);
    };
    setRotationStep({ ctrlKey: false, shiftKey: false });
    // Capture, so the step is set before the gizmo reads it.
    renderer.domElement.addEventListener('pointerdown', setRotationStep, true);
    renderer.domElement.addEventListener('pointermove', setRotationStep, true);
    // Where a gizmo drag started: the pivot (or the single shape) and every shape it moves.
    let gizmoStart: { origin: Vector3; members: { id: string; start: Vec3 }[]; multi: boolean } | null = null;
    transform.addEventListener('dragging-changed', (event) => {
      const dragging = (event as unknown as { value: boolean }).value;
      orbit.enabled = !dragging;
      const view = sceneRef.current;
      if (!view) return;
      view.gizmoDragging = dragging;
      const object = transform.object;
      if (!dragging || !object) {
        gizmoStart = null;
        return;
      }
      const multi = object.userData.isPivot === true;
      const ids = multi ? handlersRef.current.selection : [object.userData.shapeId as string];
      const members = ids
        .map((id) => handlersRef.current.shapes.find((s) => s.id === id))
        .filter((s): s is Shape => s !== undefined)
        .map((s) => ({ id: s.id, start: [...s.position] as Vec3 }));
      const primary = members[members.length - 1];
      if (!primary) return;
      gizmoStart = { origin: object.position.clone(), members, multi };
      // The first step of the drag is one undo step. The readout shows what is being moved or turned.
      const axes = GIZMO_AXES[transform.axis ?? 'XYZ'] ?? [0, 1, 2];
      if (transform.mode === 'translate') {
        handlersRef.current.onEditStart({ id: primary.id, kind: 'move', axes, start: primary.start });
      } else {
        const turning = handlersRef.current.shapes.find((s) => s.id === primary.id);
        handlersRef.current.onEditStart(
          turning ? { id: primary.id, kind: 'rotate', axes, start: [...turning.rotation] as Vec3 } : null,
        );
      }
    });
    // Live: the shapes follow the gizmo while it is dragged.
    transform.addEventListener('objectChange', () => {
      const object = transform.object;
      if (!object || !gizmoStart || !sceneRef.current?.gizmoDragging) return;
      if (gizmoStart.multi) {
        const delta = object.position.clone().sub(gizmoStart.origin);
        for (const member of gizmoStart.members) {
          const position = member.start.map((value, i) => round(value + delta.getComponent(i))) as Vec3;
          handlersRef.current.onShapeLive(member.id, { position });
        }
        return;
      }
      const id = object.userData.shapeId as string | undefined;
      if (!id) return;
      const rotation = new Euler().setFromQuaternion(object.quaternion, 'XYZ');
      handlersRef.current.onShapeLive(id, {
        position: [round(object.position.x), round(object.position.y), round(object.position.z)],
        rotation: [rotation.x, rotation.y, rotation.z].map((r) => round(r / DEG_TO_RAD)) as Vec3,
      });
    });

    scene.add(transform);

    // The coloured plane squares of the move gizmo are removed, with their pickers.
    // Dragging the shape's body moves it in a plane instead (see the drag plane buttons).
    const planeSquares: Object3D[] = [];
    transform.traverse((node) => {
      if (node.name === 'XY' || node.name === 'YZ' || node.name === 'XZ') planeSquares.push(node);
    });
    for (const square of planeSquares) square.parent?.remove(square);

    const objects = new Group();
    const resultGroup = new Group();
    scene.add(objects, resultGroup);

    sceneRef.current = {
      renderer,
      scene,
      camera,
      orbit,
      transform,
      objects,
      resultGroup,
      grid: null,
      handles: [],
      resizeGizmos: [],
      knobs: [],
      hoveredKnob: null,
      gizmoDragging: false,
      activeHandle: null,
      hoveredHandle: null,
    };

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

    // The face under the pointer. It gets the resize arrow.
    let hintFace: { shapeId: string; side: { axis: number; sign: number } } | null = null;
    const arrow = new ArrowHelper(new Vector3(1, 0, 0), new Vector3(), 10, ARROW_COLOR);
    arrow.visible = false;
    arrow.renderOrder = 20;
    (arrow.line.material as LineBasicMaterial).depthTest = false;
    (arrow.cone.material as MeshBasicMaterial).depthTest = false;
    scene.add(arrow);

    // Points the arrow out of the hovered face, in the direction a drag grows it.
    const updateArrow = () => {
      const face = hintFace;
      const group = face ? (objects.children.find((c) => c.userData.shapeId === face.shapeId) as Group | undefined) : undefined;
      const shape = face ? handlersRef.current.shapes.find((s) => s.id === face.shapeId) : undefined;
      if (!face || !group || !shape) {
        arrow.visible = false;
        return;
      }
      const { axis, sign } = face.side;
      const centre = new Vector3().setComponent(axis, (sign * shape.size[axis]) / 2);
      const origin = group.localToWorld(centre);
      const dir = new Vector3().setComponent(axis, sign).applyQuaternion(group.quaternion);
      const length = origin.distanceTo(camera.position) * ARROW_SCREEN_SCALE;
      arrow.position.copy(origin);
      arrow.setDirection(dir);
      arrow.setLength(length, length * 0.3, length * 0.25);
      arrow.visible = true;
    };
    // The readout card sits under the cursor, where the last drag left it.
    let cursor = { x: 0, y: 0 };
    const placeReadout = () => {
      const card = readoutRef.current;
      if (!card) return;
      const info = handlersRef.current.readout;
      if (!info || info.id !== handlersRef.current.selectedId || handlersRef.current.selection.length !== 1) {
        card.style.display = 'none';
        return;
      }
      const { clientWidth, clientHeight } = container;
      let x = cursor.x + CARD_OFFSET;
      let y = cursor.y + CARD_OFFSET;
      if (x + card.offsetWidth > clientWidth) x = cursor.x - card.offsetWidth - CARD_OFFSET;
      if (y + card.offsetHeight > clientHeight) y = cursor.y - card.offsetHeight - CARD_OFFSET;
      card.style.display = 'block';
      card.style.transform = `translate(${x}px, ${y}px)`;
    };
    const trackCursor = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    // Dimension lines, drawn over everything. The labels are HTML, moved to each line's middle every frame.
    const measureLines = new LineSegments(
      new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(MAX_MEASURE_LINES * 6), 3)),
      new LineBasicMaterial({ color: MEASURE_COLOR, depthTest: false }),
    );
    measureLines.renderOrder = 999;
    measureLines.frustumCulled = false;
    measureLines.visible = false;
    scene.add(measureLines);
    const middle = new Vector3();
    const placeMeasure = () => {
      const layer = measureRef.current;
      if (!layer) return;
      const h = handlersRef.current;
      const shown = h.measuring && !h.showResult;
      const visibleLayers = new Set(h.layers.filter((l) => l.visible).map((l) => l.id));
      const segments = shown
        ? measureSegments(
            h.shapes.filter((s) => h.selection.includes(s.id) && visibleLayers.has(s.layerId) && !s.hidden),
            camera.position.toArray() as Vec3,
          )
        : [];
      measureLines.visible = segments.length > 0;
      layer.style.display = segments.length > 0 ? 'block' : 'none';
      if (segments.length === 0) return;
      const positions = measureLines.geometry.getAttribute('position') as BufferAttribute;
      segments.forEach((segment, i) => positions.array.set([...segment.a, ...segment.b], i * 6));
      positions.needsUpdate = true;
      measureLines.geometry.setDrawRange(0, segments.length * 2);
      while (layer.children.length < segments.length) {
        const label = document.createElement('span');
        label.className = 'measure-label';
        layer.appendChild(label);
      }
      while (layer.children.length > segments.length) layer.lastChild?.remove();
      segments.forEach((segment, i) => {
        const label = layer.children[i] as HTMLElement;
        if (label.textContent !== segment.label) label.textContent = segment.label;
        middle.set(...segment.a).add(new Vector3(...segment.b)).multiplyScalar(0.5).project(camera);
        const onScreen = middle.z < 1;
        label.style.display = onScreen ? 'block' : 'none';
        label.style.transform = `translate(-50%, -50%) translate(${((middle.x + 1) / 2) * container.clientWidth}px, ${((1 - middle.y) / 2) * container.clientHeight}px)`;
      });
    };

    renderer.setAnimationLoop(() => {
      orbit.update();
      placeReadout();
      placeMeasure();
      updateArrow();
      for (const gizmo of sceneRef.current?.resizeGizmos ?? []) placeResizeGizmo(gizmo, camera);
      const forward = camera.getWorldDirection(scratch);
      if (Math.hypot(forward.x, forward.z) > 1e-3) props.viewDirRef.current = [forward.x, forward.z];
      renderer.render(scene, camera);
    });

    props.snapshotRef.current = () => {
      const gizmos = sceneRef.current?.resizeGizmos ?? [];
      const hidden = [transform as unknown as Object3D, ...gizmos].map((o) => [o, o.visible] as const);
      for (const [o] of hidden) o.visible = false;
      try {
        renderer.render(scene, camera);
        const { width, height } = renderer.domElement;
        return { href: renderer.domElement.toDataURL('image/png'), width, height };
      } finally {
        for (const [o, v] of hidden) o.visible = v;
      }
    };

    const raycaster = new Raycaster();
    const pointer = new Vector2();
    // Where the current press started, and which shape it pressed on (if any).
    let pressAt: { x: number; y: number } | null = null;
    let pressedShape: string | null = null;
    let drag: Drag | null = null;
    // Shift + drag on empty space: where the rubber-band rectangle started, in container pixels.
    let marquee: { x0: number; y0: number } | null = null;

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

    // Whether a point on a face is within the rim, the band along the face's edges that grabs it. The
    // middle of a face is left to moving the shape, since on a box the face is the shape's surface.
    const inRim = (hit: Intersection): boolean => {
      const group = hit.object.parent;
      const shape = group ? shapeById(group.userData.shapeId as string) : undefined;
      if (!group || !shape) return false;
      if (handlersRef.current.gizmoMode === 'resize') return true;
      const { axis } = hit.object.userData.side as { axis: number };
      const local = group.worldToLocal(hit.point.clone());
      const [b, c] = [0, 1, 2].filter((i) => i !== axis);
      const smallest = Math.min(shape.size[b], shape.size[c]);
      // A fraction of the face, but never thinner than a few pixels when zoomed out. Half the face at most.
      const band = Math.min(Math.max(smallest * RIM_FRACTION, hit.distance * RIM_SCREEN_SCALE), smallest / 2);
      const edge = Math.min(shape.size[b] / 2 - Math.abs(local.getComponent(b)), shape.size[c] / 2 - Math.abs(local.getComponent(c)));
      return edge <= band;
    };

    // The rim of a face under the pointer, unless another shape is in front of it.
    // The gizmo wins where it overlaps the face: its arrows, and the centre where they meet, which moves the shape.
    const pickKnob = (): Intersection | undefined => {
      const view = sceneRef.current;
      return view ? raycaster.intersectObjects(view.knobs, false)[0] : undefined;
    };
    const pickHandle = (): Intersection | undefined => {
      if (transform.axis !== null) return undefined;
      const knob = pickKnob();
      if (knob) return knob;
      const handle = raycaster.intersectObjects(sceneRef.current?.handles ?? [], false).find(inRim);
      if (!handle) return undefined;
      const body = raycaster
        .intersectObjects(objects.children, true)
        .find((h) => h.object instanceof Mesh && !h.object.userData.face);
      const tolerance = handle.distance * 0.002;
      return body && body.distance < handle.distance - tolerance ? undefined : handle;
    };

    // Dragging a face stretches the shape along that face's axis. The opposite face stays where it is.
    const startResize = (face: Intersection) => {
      const side = face.object.userData.side as { axis: number; sign: number };
      // A resize cube sits in the gizmo group, one level below the shape's group.
      const group = (face.object.userData.knob ? face.object.parent?.parent : face.object.parent) as Group;
      const id = group.userData.shapeId as string;
      const shape = shapeById(id);
      if (!shape) return;
      // The readout belongs to the selected shape, so a face of any other shape selects it first.
      if (handlersRef.current.selection.length !== 1 || handlersRef.current.selection[0] !== id) handlersRef.current.onSelect(id, false);

      const dir = new Vector3().setComponent(side.axis, 1).applyQuaternion(group.quaternion);
      // A plane through the pointer that holds the face's direction and faces the camera, so the mouse moves the face.
      const cameraDir = camera.getWorldDirection(new Vector3());
      const normal = cameraDir.clone().sub(dir.clone().multiplyScalar(cameraDir.dot(dir)));
      if (normal.lengthSq() < 1e-6) normal.set(dir.y > 0.9 ? 1 : 0, dir.y > 0.9 ? 0 : 1, 0);
      const plane = new Plane().setFromNormalAndCoplanarPoint(normal.normalize(), face.point);

      drag = {
        kind: 'resize',
        moved: false,
        id,
        plane,
        startHit: face.point.clone(),
        side,
        faces: [{ axis: side.axis, sign: side.sign, dir }],
        startShape: shape,
        target: { id, kind: 'resize', sides: [side] },
      };
      orbit.enabled = false;
      const view = sceneRef.current;
      if (view) {
        view.activeHandle = handleId(face.object);
        paintHandles(view);
      }
    };

    // Dragging the body moves the shape within the chosen drag plane.
    const startMove = (shape: Shape, point: Vector3) => {
      const plane = new Plane().setFromNormalAndCoplanarPoint(DRAG_PLANE_NORMAL[handlersRef.current.dragPlane], point);
      // Dragging a selected shape moves the whole selection; any other shape moves alone.
      const selection = handlersRef.current.selection;
      const ids = selection.includes(shape.id) ? selection : [shape.id];
      const members = ids
        .map((id) => handlersRef.current.shapes.find((s) => s.id === id))
        .filter((s): s is Shape => s !== undefined)
        .map((s) => ({ id: s.id, start: [...s.position] as Vec3 }));
      drag = {
        kind: 'move',
        moved: false,
        plane,
        start: point.clone(),
        members,
        target: {
          id: shape.id,
          kind: 'move',
          axes: PLANE_AXES[handlersRef.current.dragPlane],
          start: [...shape.position] as Vec3,
        },
      };
      orbit.enabled = false;
    };

    // Only the left button picks, selects and drags shapes. The others are for the view.
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        pressAt = null;
        return;
      }
      trackCursor(event);
      pressAt = { x: event.clientX, y: event.clientY };
      pressedShape = null;
      aim(event);

      // A face rim is grabbed unless the gizmo is under the pointer (see pickHandle).
      const handle = pickHandle();
      if (handle) {
        event.stopImmediatePropagation();
        startResize(handle);
        return;
      }
      // A press anywhere but on a face lets go of the clicked face.
      if (handlersRef.current.readout?.kind === 'resize') handlersRef.current.onReadoutClose();
      // An arrow or plane of the move gizmo is under the pointer: TransformControls handles it.
      // Its centre handle sits on the shape itself, so a press there is a body drag instead.
      if (transform.axis !== null && transform.axis !== 'XYZ') return;

      const hit = raycaster.intersectObjects(objects.children, true).find((h) => h.object instanceof Mesh);
      const id = hit ? shapeIdOf(hit.object) : null;
      if (!hit || !id) {
        // Shift + drag on empty space starts a rubber-band selection. Orbit stays off for this drag.
        if (event.shiftKey) {
          const box = container.getBoundingClientRect();
          marquee = { x0: event.clientX - box.left, y0: event.clientY - box.top };
          orbit.enabled = false;
        }
        return;
      }
      pressedShape = id;
      if (transform.axis === 'XYZ') event.stopImmediatePropagation();

      const shape = shapeById(id);
      if (!shape) return;
      if (!handlersRef.current.selection.includes(id)) handlersRef.current.onSelect(id, event.shiftKey);
      if (!isLocked(shape) && handlersRef.current.gizmoMode !== 'resize') startMove(shape, hit.point);
    };

    // The rubber-band rectangle, from where it started to the pointer.
    const updateMarquee = (event: PointerEvent) => {
      if (!marquee) return;
      const box = container.getBoundingClientRect();
      const x1 = event.clientX - box.left;
      const y1 = event.clientY - box.top;
      const style = marqueeRef.current?.style;
      if (!style) return;
      style.display = 'block';
      style.left = `${Math.min(marquee.x0, x1)}px`;
      style.top = `${Math.min(marquee.y0, y1)}px`;
      style.width = `${Math.abs(x1 - marquee.x0)}px`;
      style.height = `${Math.abs(y1 - marquee.y0)}px`;
    };

    // Selects every shape whose centre falls inside the rectangle.
    const finishMarquee = (event: PointerEvent) => {
      if (!marquee) return;
      const box = container.getBoundingClientRect();
      const x1 = event.clientX - box.left;
      const y1 = event.clientY - box.top;
      const left = Math.min(marquee.x0, x1);
      const right = Math.max(marquee.x0, x1);
      const top = Math.min(marquee.y0, y1);
      const bottom = Math.max(marquee.y0, y1);
      const moved = Math.hypot(x1 - marquee.x0, y1 - marquee.y0);
      marquee = null;
      orbit.enabled = true;
      if (marqueeRef.current) marqueeRef.current.style.display = 'none';
      if (moved <= DRAG_THRESHOLD) return;

      const ids: string[] = [];
      objects.traverse((node) => {
        if (!(node instanceof Group) || !node.userData.shapeId) return;
        const p = node.getWorldPosition(scratch).project(camera);
        const x = ((p.x + 1) / 2) * box.width;
        const y = ((1 - p.y) / 2) * box.height;
        if (x >= left && x <= right && y >= top && y <= bottom) ids.push(node.userData.shapeId as string);
      });
      handlersRef.current.onMarquee(ids);
    };

    // The snap step for this event: Ctrl and Shift scale it by their settings.
    const stepOf = (event: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) =>
      modifiedStep(handlersRef.current.snap, handlersRef.current.stepKeys, { ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey });

    const onMove = (event: PointerEvent) => {
      if (marquee) {
        updateMarquee(event);
        return;
      }
      if (!drag) {
        // Hover highlight on the face handles.
        trackCursor(event);
        aim(event);
        const hovered = pickHandle();
        const key = hovered ? handleId(hovered.object) : null;
        hintFace = hovered
          ? {
              shapeId: (hovered.object.parent?.userData.shapeId as string) ?? '',
              side: hovered.object.userData.side as { axis: number; sign: number },
            }
          : null;
        const view = sceneRef.current;
        if (view) {
          const knob = pickKnob()?.object as Mesh | undefined;
          if (knob !== (view.hoveredKnob ?? undefined)) {
            view.hoveredKnob = knob ?? null;
            for (const k of view.knobs) (k.material as MeshBasicMaterial).color.set(k === knob ? KNOB_HOVER_COLOR : AXIS_COLORS[(k.userData.side as { axis: number }).axis]);
          }
        }
        if (view && key !== view.hoveredHandle) {
          view.hoveredHandle = key;
          paintHandles(view);
        }
        return;
      }
      trackCursor(event);
      if (!drag.moved) {
        if (!pressAt || Math.hypot(event.clientX - pressAt.x, event.clientY - pressAt.y) < DRAG_THRESHOLD) return;
        drag.moved = true;
        handlersRef.current.onEditStart(drag.target);
      }

      aim(event);
      const hit = new Vector3();
      if (!raycaster.ray.intersectPlane(drag.plane, hit)) return;

      if (drag.kind === 'move') {
        const delta = hit.sub(drag.start);
        for (const member of drag.members) {
          const position = member.start.map((value, i) => snapTo(value + delta.getComponent(i), stepOf(event))) as Vec3;
          handlersRef.current.onShapeLive(member.id, { position });
        }
        return;
      }

      const delta = hit.sub(drag.startHit);
      let shape = drag.startShape;
      for (const face of drag.faces) {
        const growth = face.sign * delta.dot(face.dir);
        const extent = Math.max(MIN_SIZE, snapTo(drag.startShape.size[face.axis] + growth, stepOf(event)));
        shape = { ...shape, ...resizeAlongAxis(shape, face.axis, face.sign, extent) };
      }
      handlersRef.current.onShapeLive(drag.id, { size: shape.size, position: shape.position });
    };

    const onUp = (event: PointerEvent) => {
      if (marquee) {
        finishMarquee(event);
        return;
      }
      if (drag) {
        // A click on a face (no drag) shows its value.
        if (drag.kind === 'resize' && !drag.moved) handlersRef.current.onReadoutShow({ id: drag.id, kind: 'resize', sides: [drag.side] });
        // After a drag the face goes dark. After a plain click it stays lit while its readout is open.
        const dragged = drag.moved;
        drag = null;
        if (sceneRef.current) {
          if (dragged) sceneRef.current.activeHandle = null;
          paintHandles(sceneRef.current);
        }
        orbit.enabled = true;
        pressAt = null;
        return;
      }
      if (!pressAt) return;
      const moved = Math.hypot(event.clientX - pressAt.x, event.clientY - pressAt.y);
      pressAt = null;
      // A click on empty plan clears the selection.
      if (moved <= DRAG_THRESHOLD && pressedShape === null && transform.axis === null) {
        handlersRef.current.onSelect(null, false);
      }
    };

    // Capture phase, so the handle check runs before the transform gizmo's own pointerdown.
    renderer.domElement.addEventListener('pointerdown', onDown, true);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointerleave', () => {
      if (!drag) hintFace = null;
    });
    // A middle press would otherwise start browser auto-scroll.
    const onAuxDown = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };
    renderer.domElement.addEventListener('mousedown', onAuxDown);
    renderer.domElement.addEventListener('auxclick', onAuxDown);

    return () => {
      renderer.setAnimationLoop(null);
      window.removeEventListener('pagehide', saveView);
      window.clearTimeout(saveViewTimer);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown, true);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('mousedown', onAuxDown);
      renderer.domElement.removeEventListener('auxclick', onAuxDown);
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
    // While the gizmo is dragged, the object already sits where the gizmo put it. Rebuilding now would drop the drag.
    if (!view || !props.engine || view.gizmoDragging) return;
    const { objects, transform } = view;
    const { engine, shapes, layers, selection, showResult, theme } = props;
    const lockedLayers = new Set(layers.filter((l) => l.locked).map((l) => l.id));
    const visibleLayers = new Set(layers.filter((l) => l.visible).map((l) => l.id));

    transform.detach();
    clearGroup(objects);
    view.handles = [];
    view.resizeGizmos = [];
    view.knobs = [];
    view.hoveredKnob = null;
    view.resultGroup.visible = showResult;
    objects.visible = !showResult;

    const selectedShapes = shapes.filter((s) => selection.includes(s.id) && visibleLayers.has(s.layerId));
    const selectedSet = new Set(selectedShapes.map((s) => s.id));
    const multi = selectedShapes.length > 1;
    const editable = selectedShapes.every((s) => !lockedLayers.has(s.layerId));

    // Several selected shapes sit under a pivot at their centre, so the gizmo moves them together.
    const pivot = new Group();
    pivot.userData.isPivot = true;
    if (multi) {
      const centre = new Vector3();
      for (const shape of selectedShapes) centre.add(shapePosition(shape));
      pivot.position.copy(centre.divideScalar(selectedShapes.length));
      objects.add(pivot);
    }

    for (const shape of shapes) {
      if (!visibleLayers.has(shape.layerId) || shape.hidden) continue;
      const group = new Group();
      group.userData.shapeId = shape.id;
      group.quaternion.copy(shapeQuaternion(shape));
      const inPivot = multi && selectedSet.has(shape.id);
      group.position.copy(inPivot ? shapePosition(shape).sub(pivot.position) : shapePosition(shape));

      const local = localPrimitive(engine, shape);
      const data = meshData(local);
      local.delete();
      const mesh = new Mesh(toGeometry(data), shape.hole ? holeMaterial() : solidMaterial(shape.color));
      mesh.userData.shapeId = shape.id;
      group.add(mesh);
      (inPivot ? pivot : objects).add(group);

      const unlocked = !lockedLayers.has(shape.layerId) && !showResult;
      if (selectedSet.has(shape.id) && unlocked) {
        group.add(boundingBox(shape.size, THEMES[theme].outline));
        if (!multi && props.gizmoMode !== 'resize') transform.attach(group);
      }
      // With a selection, only the selected shape resizes; with none, any shape does.
      const facesActive = selectedShapes.length === 0 || (!multi && selectedSet.has(shape.id));
      if (unlocked && !multi && selectedSet.has(shape.id) && props.gizmoMode === 'resize') {
        const gizmo = makeResizeGizmo(shape.size);
        group.add(gizmo);
        view.resizeGizmos.push(gizmo);
        view.knobs.push(...(gizmo.children.filter((c) => c.userData.knob) as Mesh[]));
      }
      if (unlocked && facesActive) {
        for (const handle of makeFaces(shape.size)) {
          group.add(handle);
          view.handles.push(handle);
        }
      }
    }
    if (multi && editable && !showResult && props.gizmoMode !== 'resize') transform.attach(pivot);
    paintHandles(view);
    // Rotation applies to one shape; a selection only moves.
    transform.setMode(multi || props.gizmoMode === 'resize' ? 'translate' : props.gizmoMode);
  }, [props.engine, props.shapes, props.layers, props.selection, props.showResult, props.gizmoMode, props.theme]);

  // The clicked edge stays lit while its readout is open, and goes dark when the readout closes.
  useEffect(() => {
    const view = sceneRef.current;
    if (!view || props.readout?.kind === 'resize') return;
    view.activeHandle = null;
    paintHandles(view);
  }, [props.readout]);

  // The mouse menu decides what each button does to the view.
  useEffect(() => {
    const view = sceneRef.current;
    if (view) view.orbit.mouseButtons = mouseButtonsFor(props.mouseMap);
  }, [props.mouseMap]);

  // The move arrows snap to the same step as dragging, scaled while Ctrl, Shift or Alt is held.
  useEffect(() => {
    const apply = (ctrl: boolean, shift: boolean, alt = false) => {
      const step = modifiedStep(props.snap, props.stepKeys, { ctrl, shift, alt });
      sceneRef.current?.transform.setTranslationSnap(step > 0 ? step : null);
    };
    apply(false, false);
    const onKey = (event: KeyboardEvent) => apply(event.ctrlKey, event.shiftKey, event.altKey);
    const onBlur = () => apply(false, false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [props.snap, props.stepKeys]);

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

  const readoutShape =
    props.readout && props.readout.id === props.selectedId && props.selection.length === 1
      ? props.shapes.find((s) => s.id === props.readout?.id)
      : undefined;

  return (
    <div className="viewport" ref={containerRef}>
      <div className="marquee" ref={marqueeRef} />
      <div className="measure" ref={measureRef} />
      <div className="readout" ref={readoutRef}>
        {readoutShape && props.readout && (
          <ReadoutFields target={props.readout} shape={readoutShape} step={props.snap} onEdit={props.onReadoutEdit} />
        )}
      </div>
    </div>
  );
}

/** Editable values for a move or resize, shown in the readout card. */
function ReadoutFields({
  target,
  shape,
  step,
  onEdit,
}: {
  target: ReadoutTarget;
  shape: Shape;
  step: number;
  onEdit: (target: ReadoutTarget, index: number, value: number) => void;
}) {
  if (target.kind === 'resize') {
    return (
      <div className="readout-body">
        <span className="readout-title">Size (mm)</span>
        {target.sides.map((side) => (
          <div className="readout-row" key={side.axis}>
            <AxisInput
              label={AXIS_NAMES[side.axis]}
              value={shape.size[side.axis]}
              step={step}
              onChange={(value) => onEdit(target, side.axis, value)}
            />
          </div>
        ))}
      </div>
    );
  }

  if (target.kind === 'rotate') {
    return (
      <div className="readout-body">
        <span className="readout-title">Rotate (°)</span>
        {target.axes.map((i) => (
          <div className="readout-row" key={i}>
            <AxisInput
              label={AXIS_LABELS[i]}
              value={shape.rotation[i]}
              step={1}
              onChange={(value) => onEdit(target, i, value)}
            />
            <span className="readout-delta">turned {signed(shape.rotation[i] - target.start[i])}</span>
          </div>
        ))}
      </div>
    );
  }

  // Only the axes that are moving. The centre distance is measured on those axes.
  const centreDistance = Math.hypot(...target.axes.map((i) => shape.position[i]));
  return (
    <div className="readout-body">
      <span className="readout-title">Move (mm)</span>
      {target.axes.map((i) => (
        <div className="readout-row" key={i}>
          <AxisInput
            label={AXIS_LABELS[i]}
            value={shape.position[i]}
            step={step}
            onChange={(value) => onEdit(target, i, value)}
          />
          <span className="readout-delta">moved {signed(shape.position[i] - target.start[i])}</span>
        </div>
      ))}
      <span className="readout-footer">From plan centre: {round(centreDistance)} mm</span>
    </div>
  );
}

function AxisInput({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="readout-field">
      <span>{label}</span>
      <input
        type="number"
        step={step > 0 ? step : 0.1}
        value={round(value)}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(next)) onChange(next);
        }}
      />
    </label>
  );
}

function signed(value: number): string {
  const rounded = round(value);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
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

/**
 * The six faces of the dashed box, as invisible grabs. Hovering or pressing one lights up the whole face.
 * Each face moves along its own axis, so dragging it needs no choice of direction.
 */
function makeFaces(size: Vec3): Mesh[] {
  const faces: Mesh[] = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [-1, 1]) {
      const material = new MeshBasicMaterial({
        color: HANDLE_HOVER_COLOR,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      });
      const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
      mesh.scale.set(size[0], size[1], size[2]).setComponent(axis, FACE_THICKNESS);
      mesh.position.setComponent(axis, (sign * size[axis]) / 2);
      mesh.renderOrder = 10;
      mesh.userData.face = true;
      mesh.userData.side = { axis, sign };
      mesh.userData.key = `${axis}:${sign}`;
      faces.push(mesh);
    }
  }
  return faces;
}

/**
 * The resize gizmo: three axes through the shape's centre with a cube at each end. A cube resizes the
 * side it sits on. Sized by placeResizeGizmo every frame, so it keeps its size on screen.
 */
function makeResizeGizmo(size: Vec3): Group {
  const gizmo = new Group();
  gizmo.userData.size = size;
  for (let axis = 0; axis < 3; axis++) {
    const end = new Vector3().setComponent(axis, 1);
    const line = new LineSegments(
      new BufferGeometry().setFromPoints([end.clone().negate(), end]),
      new LineBasicMaterial({ color: AXIS_COLORS[axis], depthTest: false }),
    );
    line.renderOrder = 30;
    line.userData.axis = axis;
    gizmo.add(line);
    for (const sign of [-1, 1]) {
      const knob = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: AXIS_COLORS[axis], depthTest: false }));
      knob.renderOrder = 31;
      knob.userData.knob = true;
      knob.userData.side = { axis, sign };
      knob.userData.key = `knob${axis}:${sign}`;
      gizmo.add(knob);
    }
  }
  return gizmo;
}

/** Puts the cubes just outside the box and scales the gizmo to a fixed share of the view. */
function placeResizeGizmo(gizmo: Group, camera: PerspectiveCamera) {
  const size = gizmo.userData.size as Vec3;
  const unit = gizmo.getWorldPosition(new Vector3()).distanceTo(camera.position) * KNOB_SCREEN_SCALE;
  for (const child of gizmo.children) {
    if (child.userData.knob) {
      const { axis, sign } = child.userData.side as { axis: number; sign: number };
      child.position.set(0, 0, 0).setComponent(axis, sign * (size[axis] / 2 + unit * 3));
      child.scale.setScalar(unit);
    } else {
      const axis = child.userData.axis as number;
      child.scale.set(1, 1, 1).setComponent(axis, size[axis] / 2 + unit * 3);
    }
  }
}

const MOUSE_ACTION = { rotate: MOUSE.ROTATE, pan: MOUSE.PAN, zoom: MOUSE.DOLLY, none: null } as const;

function mouseButtonsFor(map: MouseMap) {
  return { LEFT: MOUSE_ACTION[map.left], MIDDLE: MOUSE_ACTION[map.middle], RIGHT: MOUSE_ACTION[map.right] };
}

/** A face grab's identity across shapes: its shape and its place on the box. */
function handleId(edge: Object3D): string {
  return `${edge.parent?.userData.shapeId as string}|${edge.userData.key as string}`;
}

/** Shows the hovered face lightly, and the pressed face strongly. */
function paintHandles(view: { handles: Mesh[]; activeHandle: string | null; hoveredHandle: string | null }) {
  for (const edge of view.handles) {
    const key = handleId(edge);
    const material = edge.material as MeshBasicMaterial;
    material.color.set(key === view.activeHandle ? HANDLE_ACTIVE_COLOR : HANDLE_HOVER_COLOR);
    material.opacity = key === view.activeHandle ? 0.5 : key === view.hoveredHandle ? 0.28 : 0;
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function toGeometry(data: MeshData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  // Smooth where the surface curves (rounded edges, cylinders), sharp across real edges.
  return toCreasedNormals(geometry, Math.PI / 6);
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
