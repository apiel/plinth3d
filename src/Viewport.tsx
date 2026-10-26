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
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { ManifoldToplevel } from 'manifold-3d';
import type { Layer, Shape, Vec3 } from './model';
import { localPrimitive, meshData, resizeAlongAxis, shapePosition, shapeQuaternion, snapTo, type MeshData } from './geometry';

const DEG_TO_RAD = Math.PI / 180;
const HOLE_COLOR = '#ff4d4d';
const RESULT_COLOR = '#c9d2e0';
const MIN_SIZE = 0.1;
const AXIS_NAMES = ['Width', 'Height', 'Depth'];
const AXIS_LABELS = ['X', 'Y', 'Z'];
const PLANE_AXES: Record<DragPlane, number[]> = { XY: [0, 1], XZ: [0, 2], YZ: [1, 2] };
const GIZMO_AXES: Record<string, number[]> = { X: [0], Y: [1], Z: [2], XY: [0, 1], XZ: [0, 2], YZ: [1, 2], XYZ: [0, 1, 2] };
const CARD_OFFSET = 18;
const HANDLE_HOVER_COLOR = '#9cc2ff';
const HANDLE_ACTIVE_COLOR = '#2f6bff';
/** Length of the resize arrow as a fraction of the camera distance. */
const ARROW_SCREEN_SCALE = 0.12;
/** Width of the rounding highlight as a fraction of the camera distance. */
const ROUND_SCREEN_SCALE = 0.005;
/** How close the pointer must be, in pixels, to pick an edge or a corner. */
const EDGE_PICK_PX = 8;
const CORNER_PICK_PX = 11;
/** Orange stands out on the blue shapes. */
const ARROW_COLOR = 0xff8a00;
const DRAG_THRESHOLD = 3;
/** Width of an edge grab as a fraction of the camera distance, so it is easy to hit on screen. */
const EDGE_SCREEN_SCALE = 0.012;

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

/** A move or resize that the readout card shows and can edit. */
export type ReadoutTarget =
  | { id: string; kind: 'move'; axes: number[]; start: Vec3 }
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
  readout: ReadoutTarget | null;
  result: MeshData | null;
  showResult: boolean;
  theme: Theme;
  onSelect: (id: string | null, additive: boolean) => void;
  /** Called once when a drag actually starts changing a shape. Used for one undo step. */
  onEditStart: (target: ReadoutTarget | null) => void;
  /** Called when a value is typed into the readout card. */
  onReadoutEdit: (target: ReadoutTarget, index: number, value: number) => void;
  /** Shows the readout for a target without adding an undo step. */
  onReadoutShow: (target: ReadoutTarget) => void;
  /** Shift + drag on empty space selects the shapes inside the rectangle. */
  onMarquee: (ids: string[]) => void;
  /** A click on a highlighted edge or corner of an unselected box. */
  onRoundClick: (shapeId: string, key: string, x: number, y: number) => void;
  /** Called on every step of a drag. Does not add undo steps. */
  onShapeLive: (id: string, patch: Partial<Shape>) => void;
}

/** An edge or corner of an unselected box, under the pointer. */
type RoundHover = { shapeId: string; key: string; a: Vector3; b: Vector3; corner: boolean };

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
      // The two faces this edge moves: each with its sign and its world direction.
      // The edge's two faces, and the one a drag moves. A plain click switches to the other face.
      sides: { axis: number; sign: number }[];
      activeIndex: number;
      edgeKey: string;
      faces: { axis: number; sign: number; dir: Vector3 }[];
      startShape: Shape;
    }
);

/** Owns the three.js scene. React state drives it through props. */
export function Viewport(props: ViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const marqueeRef = useRef<HTMLDivElement>(null);
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
    // Middle and right buttons pan the view; the left button rotates it.
    orbit.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN };

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setTranslationSnap(1);
    transform.setRotationSnap(15 * DEG_TO_RAD);
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
      // The first step of the drag is one undo step. Rotation shows no readout.
      const translating = transform.mode === 'translate';
      handlersRef.current.onEditStart(
        translating
          ? { id: primary.id, kind: 'move', axes: GIZMO_AXES[transform.axis ?? 'XYZ'] ?? [0, 1, 2], start: primary.start }
          : null,
      );
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

    // Rounding: an edge or corner of an unselected box is highlighted under the pointer.
    // A click on it opens the rounding modal instead of selecting the box.
    const roundHighlight = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial({ color: '#ff8a00', depthTest: false, transparent: true, opacity: 0.95 }),
    );
    roundHighlight.visible = false;
    roundHighlight.renderOrder = 30;
    scene.add(roundHighlight);
    let roundHover: RoundHover | null = null;
    let roundPress: { shapeId: string; key: string } | null = null;

    const updateRoundHighlight = () => {
      const h = roundHover;
      if (!h || handlersRef.current.selection.includes(h.shapeId)) {
        roundHighlight.visible = false;
        return;
      }
      const mid = h.a.clone().add(h.b).multiplyScalar(0.5);
      const width = mid.distanceTo(camera.position) * ROUND_SCREEN_SCALE;
      roundHighlight.position.copy(mid);
      if (h.corner) {
        roundHighlight.quaternion.identity();
        roundHighlight.scale.setScalar(width * 1.5);
      } else {
        const dir = h.b.clone().sub(h.a);
        roundHighlight.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), dir.clone().normalize());
        roundHighlight.scale.set(dir.length(), width, width);
      }
      roundHighlight.visible = true;
    };

    // The corner or edge of an unselected box nearest the pointer, if any. Corners win.
    const findRoundTarget = (event: PointerEvent): RoundHover | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      const toPage = (world: Vector3) => {
        const p = world.clone().project(camera);
        return new Vector2(rect.left + ((p.x + 1) / 2) * rect.width, rect.top + ((1 - p.y) / 2) * rect.height);
      };
      const pointer = new Vector2(event.clientX, event.clientY);
      let cornerHit: RoundHover | null = null;
      let cornerDistance = CORNER_PICK_PX;
      let edgeHit: RoundHover | null = null;
      let edgeDistance = EDGE_PICK_PX;
      for (const group of objects.children) {
        if (!(group instanceof Group) || !group.userData.shapeId) continue;
        const id = group.userData.shapeId as string;
        const shape = handlersRef.current.shapes.find((s) => s.id === id);
        // Only unselected boxes can be rounded.
        if (!shape || shape.type !== 'box' || handlersRef.current.selection.includes(id)) continue;
        const half = shape.size.map((v) => v / 2);
        group.updateMatrixWorld(true);
        const corners: { sign: number[]; world: Vector3; px: Vector2 }[] = [];
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            for (const sz of [-1, 1]) {
              const world = group.localToWorld(new Vector3(sx * half[0], sy * half[1], sz * half[2]));
              corners.push({ sign: [sx, sy, sz], world, px: toPage(world) });
            }
          }
        }
        for (const c of corners) {
          const d = pointer.distanceTo(c.px);
          if (d < cornerDistance) {
            cornerDistance = d;
            cornerHit = { shapeId: id, key: `c:${c.sign.join(':')}`, a: c.world, b: c.world, corner: true };
          }
        }
        for (const c of corners) {
          for (const o of corners) {
            const differing = [0, 1, 2].filter((i) => c.sign[i] !== o.sign[i]);
            if (differing.length !== 1) continue;
            const along = differing[0];
            // Each edge is seen from both ends; keep the end on the negative side only.
            if (c.sign[along] !== -1) continue;
            const [a, b] = [0, 1, 2].filter((i) => i !== along);
            const d = distanceToSegment(pointer, c.px, o.px);
            if (d < edgeDistance) {
              edgeDistance = d;
              edgeHit = { shapeId: id, key: `${along}:${c.sign[a]}:${c.sign[b]}`, a: c.world, b: o.world, corner: false };
            }
          }
        }
      }
      return cornerHit ?? edgeHit;
    };

    // Which of the two faces each edge drags, switched by clicking the edge.
    const edgeChoice = new Map<string, number>();
    // The edge under the pointer. Its active face gets the resize arrow.
    let hintEdge: { shapeId: string; edgeKey: string; sides: { axis: number; sign: number }[] } | null = null;
    const arrow = new ArrowHelper(new Vector3(1, 0, 0), new Vector3(), 10, ARROW_COLOR);
    arrow.visible = false;
    arrow.renderOrder = 20;
    (arrow.line.material as LineBasicMaterial).depthTest = false;
    (arrow.cone.material as MeshBasicMaterial).depthTest = false;
    scene.add(arrow);

    // Points the arrow along the axis the active edge will move, beside that edge, in the direction it grows.
    const updateArrow = () => {
      const edge = hintEdge;
      const group = edge ? (objects.children.find((c) => c.userData.shapeId === edge.shapeId) as Group | undefined) : undefined;
      const shape = edge ? handlersRef.current.shapes.find((s) => s.id === edge.shapeId) : undefined;
      if (!edge || !group || !shape || handlersRef.current.selection.length !== 1) {
        arrow.visible = false;
        return;
      }
      const index = edgeChoice.get(`${edge.shapeId}|${edge.edgeKey}`) ?? 0;
      const side = edge.sides[index];
      const other = edge.sides[1 - index];
      // Start on the edge itself, where the two faces meet, so the arrow reads as the edge's direction.
      const corner = new Vector3()
        .setComponent(side.axis, (side.sign * shape.size[side.axis]) / 2)
        .setComponent(other.axis, (other.sign * shape.size[other.axis]) / 2);
      const origin = group.localToWorld(corner);
      const dir = new Vector3().setComponent(side.axis, side.sign).applyQuaternion(group.quaternion);
      const length = origin.distanceTo(camera.position) * ARROW_SCREEN_SCALE;
      // Nudge it a little outside the shape, beside the edge, so it does not sit inside the solid.
      const outward = new Vector3().setComponent(other.axis, other.sign).applyQuaternion(group.quaternion);
      origin.addScaledVector(outward, length * 0.15);
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

    renderer.setAnimationLoop(() => {
      orbit.update();
      updateRoundHighlight();
      // Keep the edge grabs a constant width on screen, however far the camera is.
      for (const edge of sceneRef.current?.handles ?? []) {
        const width = edge.getWorldPosition(scratch).distanceTo(camera.position) * EDGE_SCREEN_SCALE;
        const along = edge.userData.edgeAlong as number;
        for (let axis = 0; axis < 3; axis++) if (axis !== along) edge.scale.setComponent(axis, width);
      }
      placeReadout();
      updateArrow();
      const forward = camera.getWorldDirection(scratch);
      if (Math.hypot(forward.x, forward.z) > 1e-3) props.viewDirRef.current = [forward.x, forward.z];
      renderer.render(scene, camera);
    });

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

    // Dragging an edge stretches the shape along one of the two axes that edge moves.
    // Each click on the edge switches to the other axis. The opposite faces stay where they are.
    const startResize = (edge: Intersection) => {
      const sides = edge.object.userData.sides as { axis: number; sign: number }[];
      const along = edge.object.userData.edgeAlong as number;
      const group = edge.object.parent as Group;
      const id = group.userData.shapeId as string;
      const shape = shapeById(id);
      if (!shape) return;

      const axisDir = new Vector3().setComponent(along, 1).applyQuaternion(group.quaternion);
      // A plane through the edge that faces the camera, so the mouse moves the edge.
      const cameraDir = camera.getWorldDirection(new Vector3());
      const normal = cameraDir.clone().sub(axisDir.clone().multiplyScalar(cameraDir.dot(axisDir)));
      if (normal.lengthSq() < 1e-6) normal.set(axisDir.y > 0.9 ? 1 : 0, axisDir.y > 0.9 ? 0 : 1, 0);
      const origin = edge.object.getWorldPosition(new Vector3());
      const plane = new Plane().setFromNormalAndCoplanarPoint(normal.normalize(), origin);

      const startHit = new Vector3();
      if (!raycaster.ray.intersectPlane(plane, startHit)) return;
      const edgeKey = `${id}|${edge.object.userData.key as string}`;
      const activeIndex = edgeChoice.get(edgeKey) ?? 0;
      const faceOf = (i: number) => ({
        axis: sides[i].axis,
        sign: sides[i].sign,
        dir: new Vector3().setComponent(sides[i].axis, 1).applyQuaternion(group.quaternion),
      });
      drag = {
        kind: 'resize',
        moved: false,
        id,
        plane,
        startHit,
        sides,
        activeIndex,
        edgeKey,
        faces: [faceOf(activeIndex)],
        startShape: shape,
        target: { id, kind: 'resize', sides: [sides[activeIndex]] },
      };
      orbit.enabled = false;
      const view = sceneRef.current;
      if (view) {
        view.activeHandle = edge.object.userData.key as string;
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

      // A highlighted edge or corner: a click opens the rounding modal, nothing is selected.
      if (roundHover) {
        roundPress = { shapeId: roundHover.shapeId, key: roundHover.key };
        return;
      }

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
      if (!isLocked(shape)) startMove(shape, hit.point);
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

    const onMove = (event: PointerEvent) => {
      if (marquee) {
        updateMarquee(event);
        return;
      }
      if (!drag) {
        // Hover highlight on the face handles, and on rounding targets.
        aim(event);
        roundHover = findRoundTarget(event);
        const hovered = raycaster.intersectObjects(sceneRef.current?.handles ?? [], false)[0];
        const key = (hovered?.object.userData.key as string | undefined) ?? null;
        hintEdge = hovered
          ? {
              shapeId: (hovered.object.parent?.userData.shapeId as string) ?? '',
              edgeKey: key ?? '',
              sides: hovered.object.userData.sides as { axis: number; sign: number }[],
            }
          : null;
        const view = sceneRef.current;
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
          const position = member.start.map((value, i) => snapTo(value + delta.getComponent(i), handlersRef.current.snap)) as Vec3;
          handlersRef.current.onShapeLive(member.id, { position });
        }
        return;
      }

      const delta = hit.sub(drag.startHit);
      let shape = drag.startShape;
      for (const face of drag.faces) {
        const growth = face.sign * delta.dot(face.dir);
        const extent = Math.max(MIN_SIZE, snapTo(drag.startShape.size[face.axis] + growth, handlersRef.current.snap));
        shape = { ...shape, ...resizeAlongAxis(shape, face.axis, face.sign, extent) };
      }
      handlersRef.current.onShapeLive(drag.id, { size: shape.size, position: shape.position });
    };

    const onUp = (event: PointerEvent) => {
      if (marquee) {
        finishMarquee(event);
        return;
      }
      if (roundPress) {
        const press = roundPress;
        roundPress = null;
        const moved = pressAt ? Math.hypot(event.clientX - pressAt.x, event.clientY - pressAt.y) : Infinity;
        pressAt = null;
        if (moved <= DRAG_THRESHOLD) handlersRef.current.onRoundClick(press.shapeId, press.key, event.clientX, event.clientY);
        return;
      }
      if (drag) {
        // A click on an edge (no drag) switches it to its other axis and shows that value.
        if (drag.kind === 'resize' && !drag.moved) {
          const next = 1 - drag.activeIndex;
          edgeChoice.set(drag.edgeKey, next);
          handlersRef.current.onReadoutShow({ id: drag.id, kind: 'resize', sides: [drag.sides[next]] });
        }
        drag = null;
        if (sceneRef.current) {
          sceneRef.current.activeHandle = null;
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
      if (!drag) hintEdge = null;
      roundHover = null;
    });
    // A middle press would otherwise start browser auto-scroll.
    const onAuxDown = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };
    renderer.domElement.addEventListener('mousedown', onAuxDown);
    renderer.domElement.addEventListener('auxclick', onAuxDown);

    return () => {
      renderer.setAnimationLoop(null);
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

      if (selectedSet.has(shape.id) && !lockedLayers.has(shape.layerId) && !showResult) {
        group.add(boundingBox(shape.size, THEMES[theme].outline));
        // Handles resize one shape, so they only show when a single shape is selected.
        if (!multi) {
          transform.attach(group);
          for (const handle of makeEdges(shape.size)) {
            group.add(handle);
            view.handles.push(handle);
          }
        }
      }
    }
    if (multi && editable && !showResult) transform.attach(pivot);
    paintHandles(view);
    // Rotation applies to one shape; a selection only moves.
    transform.setMode(multi ? 'translate' : props.gizmoMode);
  }, [props.engine, props.shapes, props.layers, props.selection, props.showResult, props.gizmoMode, props.theme]);

  // The move arrows snap to the same step as dragging.
  useEffect(() => {
    sceneRef.current?.transform.setTranslationSnap(props.snap > 0 ? props.snap : null);
  }, [props.snap]);

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
 * The twelve edges of the dashed box, as invisible grabs. Hovering or pressing one lights it up.
 * Each edge runs along one axis and moves the two faces that meet on it.
 */
function makeEdges(size: Vec3): Mesh[] {
  const edges: Mesh[] = [];
  for (let along = 0; along < 3; along++) {
    const [a, b] = [0, 1, 2].filter((axis) => axis !== along);
    for (const signA of [-1, 1]) {
      for (const signB of [-1, 1]) {
        const material = new MeshBasicMaterial({
          color: HANDLE_HOVER_COLOR,
          transparent: true,
          opacity: 0,
          depthTest: false,
          depthWrite: false,
        });
        const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
        mesh.position.setComponent(a, (signA * size[a]) / 2);
        mesh.position.setComponent(b, (signB * size[b]) / 2);
        mesh.scale.setComponent(along, size[along]);
        mesh.renderOrder = 10;
        mesh.userData.edgeAlong = along;
        mesh.userData.sides = [
          { axis: a, sign: signA },
          { axis: b, sign: signB },
        ];
        mesh.userData.key = `${along}:${signA}:${signB}`;
        edges.push(mesh);
      }
    }
  }
  return edges;
}

/** Shows the hovered edge lightly, and the pressed edge strongly. */
function paintHandles(view: { handles: Mesh[]; activeHandle: string | null; hoveredHandle: string | null }) {
  for (const edge of view.handles) {
    const key = edge.userData.key as string;
    const material = edge.material as MeshBasicMaterial;
    material.color.set(key === view.activeHandle ? HANDLE_ACTIVE_COLOR : HANDLE_HOVER_COLOR);
    material.opacity = key === view.activeHandle ? 0.9 : key === view.hoveredHandle ? 0.5 : 0;
  }
}

/** Distance in pixels from a point to a line segment. */
function distanceToSegment(p: Vector2, a: Vector2, b: Vector2): number {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-9)));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
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
