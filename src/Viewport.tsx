import { useEffect, useRef } from 'react';
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Euler,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  Material,
  Mesh,
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
import { createShape, type Layer, type Shape, type ShapeType, type Vec3 } from './model';
import { localPrimitive, meshData, shapePosition, shapeQuaternion, type MeshData } from './geometry';

const DEG_TO_RAD = Math.PI / 180;
const HOLE_COLOR = '#ff4d4d';
const RESULT_COLOR = '#c9d2e0';

export type Theme = 'dark' | 'light';

const THEMES = {
  dark: { background: '#1d2129', gridMajor: '#3a4150', gridMinor: '#2a2f3a' },
  light: { background: '#f4f6fa', gridMajor: '#b8c0cc', gridMinor: '#d9dee7' },
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
  result: MeshData | null;
  showResult: boolean;
  theme: Theme;
  placing: ShapeType | null;
  onSelect: (id: string | null) => void;
  onTransform: (change: TransformChange) => void;
  onPlace: (position: Vec3) => void;
  onCancelPlace: () => void;
}

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
    ghost: Group;
    grid: GridHelper | null;
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
    // The ghost previews where a primitive will land while one is being placed.
    const ghost = new Group();
    ghost.visible = false;
    scene.add(objects, resultGroup, ghost);

    sceneRef.current = { renderer, scene, camera, orbit, transform, objects, resultGroup, ghost, grid: null };

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      renderer.setSize(clientWidth, clientHeight);
      camera.aspect = clientWidth / Math.max(clientHeight, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    renderer.setAnimationLoop(() => {
      orbit.update();
      renderer.render(scene, camera);
    });

    // Picking. A press that turns into a drag is an orbit, not a click.
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const plan = new Plane(new Vector3(0, 1, 0), 0);
    let downAt: { x: number; y: number } | null = null;

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

    // Where a new shape would land: on the top of a solid under the pointer, or on the plan.
    // Side faces do not count, so a shape is never dropped beside another one.
    const placementUnder = (): Vec3 | null => {
      const height = (ghost.userData.height as number | undefined) ?? 0;
      const hit = raycaster.intersectObjects(objects.children, true).find((h) => {
        const id = shapeIdOf(h.object);
        const shape = id ? handlersRef.current.shapes.find((s) => s.id === id) : undefined;
        if (!shape || shape.hole || !h.face) return false;
        const normal = h.face.normal.clone().transformDirection(h.object.matrixWorld);
        return normal.y > 0.5;
      });
      const point = new Vector3();
      if (hit) {
        point.copy(hit.point);
      } else if (!raycaster.ray.intersectPlane(plan, point)) {
        return null;
      }
      const baseY = hit ? hit.point.y : 0;
      return [Math.round(point.x), round(baseY + height / 2), Math.round(point.z)];
    };

    const onDown = (event: PointerEvent) => {
      downAt = { x: event.clientX, y: event.clientY };
    };

    const onMove = (event: PointerEvent) => {
      if (!handlersRef.current.placing) {
        ghost.visible = false;
        return;
      }
      aim(event);
      const at = placementUnder();
      ghost.visible = at !== null;
      if (at) ghost.position.set(at[0], at[1], at[2]);
    };

    const onLeave = () => {
      ghost.visible = false;
    };

    const onUp = (event: PointerEvent) => {
      if (!downAt || transform.axis !== null) return;
      const distance = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y);
      downAt = null;
      if (distance > 4) return;

      aim(event);
      if (handlersRef.current.placing) {
        const at = placementUnder();
        if (at) handlersRef.current.onPlace(at);
        return;
      }
      const hit = raycaster.intersectObjects(objects.children, true)[0];
      handlersRef.current.onSelect(hit ? shapeIdOf(hit.object) : null);
    };

    const onContextMenu = (event: Event) => {
      event.preventDefault();
      if (handlersRef.current.placing) handlersRef.current.onCancelPlace();
    };

    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    renderer.domElement.addEventListener('contextmenu', onContextMenu);

    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
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
    const { engine, shapes, layers, selectedId, showResult } = props;
    const lockedLayers = new Set(layers.filter((l) => l.locked).map((l) => l.id));
    const visibleLayers = new Set(layers.filter((l) => l.visible).map((l) => l.id));

    transform.detach();
    clearGroup(objects);
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

      if (shape.id === selectedId) {
        const outline = new LineSegments(
          // Only sharp edges, so curved shapes do not get a line on every facet.
          new EdgesGeometry(mesh.geometry, 30),
          new LineBasicMaterial({ color: '#ffffff' }),
        );
        group.add(outline);
      }
      objects.add(group);

      if (shape.id === selectedId && !lockedLayers.has(shape.layerId) && !showResult) {
        transform.attach(group);
      }
    }
    transform.setMode(props.gizmoMode);
  }, [props.engine, props.shapes, props.layers, props.selectedId, props.showResult, props.gizmoMode]);

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

  // The ghost is a translucent copy of the primitive being placed.
  useEffect(() => {
    const view = sceneRef.current;
    if (!view || !props.engine) return;
    clearGroup(view.ghost);
    view.ghost.visible = false;
    if (!props.placing) return;

    const shape = createShape(props.placing, '', []);
    const local = localPrimitive(props.engine, shape);
    const data = meshData(local);
    local.delete();
    const material = solidMaterial(shape.color);
    material.transparent = true;
    material.opacity = 0.5;
    material.depthWrite = false;
    view.ghost.add(new Mesh(toGeometry(data), material));
    view.ghost.userData.height = shape.size[1];
  }, [props.engine, props.placing]);

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

  return <div className={props.placing ? 'viewport placing' : 'viewport'} ref={containerRef} />;
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
