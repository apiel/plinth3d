import { useEffect, useMemo, useRef, useState } from 'react';
import type { ManifoldToplevel } from 'manifold-3d';
import { Viewport, type DragPlane, type GizmoMode, type ReadoutTarget, type Theme } from './Viewport';
import { BoxIcon, CylinderIcon, KeyHint, Label, MoonIcon, SphereIcon, SunIcon, TrashIcon, UndoIcon } from './Icons';
import { LayerPanel } from './LayerPanel';
import { Inspector } from './Inspector';
import {
  createId,
  createLayer,
  createProject,
  createShape,
  parseProject,
  serializeProject,
  visibleShapes,
  type Project,
  type Shape,
  type ShapeType,
  type Vec3,
} from './model';
import { encodeBinarySTL, loadEngine, mergeShapes, resizeAlongAxis, resultMesh } from './geometry';

const AUTOSAVE_KEY = 'plinth3d:autosave';
const HISTORY_LIMIT = 100;

function loadAutosave(): Project | null {
  try {
    const text = localStorage.getItem(AUTOSAVE_KEY);
    return text ? parseProject(text) : null;
  } catch {
    // Storage can be blocked or hold an old file. Start fresh instead.
    return null;
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const THEME_KEY = 'plinth3d:theme';

const DRAG_PLANE_HINT: Record<DragPlane, string> = {
  XY: 'Drag a shape in X and Y (front view)',
  XZ: 'Drag a shape in X and Z (across the plan)',
  YZ: 'Drag a shape in Y and Z (side view)',
};

function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Storage blocked: fall back to the system setting.
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** The first x position, moving out from the centre, with no shape already on the plan there. */
function freeX(shapes: Shape[]): number {
  const candidates = [0, 30, -30, 60, -60, 90, -90, 120, -120];
  const taken = (x: number) => shapes.some((s) => Math.abs(s.position[0] - x) < 1 && Math.abs(s.position[2]) < 1);
  return candidates.find((x) => !taken(x)) ?? 0;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}

export default function App() {
  const [project, setProject] = useState<Project>(() => loadAutosave() ?? createProject());
  const [history, setHistory] = useState<Project[]>([]);
  // Selected shape ids. The last one is the primary: the Inspector shows it.
  const [selection, setSelection] = useState<string[]>([]);
  const selectedId = selection[selection.length - 1] ?? null;
  const setSelectedId = (id: string | null) => setSelection(id ? [id] : []);
  const [activeLayerId, setActiveLayerId] = useState<string>(project.layers[0].id);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate');
  const [showResult, setShowResult] = useState(false);
  const [engine, setEngine] = useState<ManifoldToplevel | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [dragPlane, setDragPlane] = useState<DragPlane>('XZ');
  // Snap step for moving and resizing, in mm. 0 turns snapping off.
  const [snap, setSnap] = useState<number>(1);
  // The move or resize the readout card is showing for the selected shape.
  const [readout, setReadout] = useState<ReadoutTarget | null>(null);
  const openInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const watchdog = setTimeout(() => {
      setNotice('The geometry engine has not loaded. Reload the page; if it keeps happening, check the console.');
    }, 15000);
    loadEngine()
      .then((wasm) => {
        clearTimeout(watchdog);
        setEngine(wasm);
      })
      .catch((error: unknown) => {
        clearTimeout(watchdog);
        setNotice(`The geometry engine failed to load: ${String(error)}`);
      });
    return () => clearTimeout(watchdog);
  }, []);

  // Autosave in this browser only. Projects are shared through files, not here.
  useEffect(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serializeProject(project));
    } catch {
      // Storage full or blocked: the project still works, it just isn't kept.
    }
  }, [project]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Storage blocked: the theme still applies for this visit.
    }
  }, [theme]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const selected = project.shapes.find((s) => s.id === selectedId) ?? null;
  const selectedShapes = project.shapes.filter((s) => selection.includes(s.id));

  // Click a shape to select it. Shift adds or removes it from the selection.
  const selectShape = (id: string | null, additive: boolean) => {
    if (id === null) {
      if (!additive) setSelection([]);
      return;
    }
    const clicked = project.shapes.find((s) => s.id === id);
    if (!clicked) return;
    if (!additive) setSelection([id]);
    else if (selection.includes(id)) setSelection(selection.filter((x) => x !== id));
    else setSelection([...selection, id]);
    setActiveLayerId(clicked.layerId);
  };
  const layerOf = (id: string) => project.layers.find((l) => l.id === id);
  const selectedLayerLocked = selected ? Boolean(layerOf(selected.layerId)?.locked) : false;

  const result = useMemo(() => {
    if (!engine || !showResult) return null;
    return resultMesh(engine, visibleShapes(project));
  }, [engine, project, showResult]);

  const commit = (next: Project) => {
    setHistory((past) => [...past.slice(-(HISTORY_LIMIT - 1)), project]);
    setProject(next);
  };

  const undo = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory(history.slice(0, -1));
    setProject(previous);
  };

  const updateShape = (id: string, patch: Partial<Shape>) => {
    commit({ ...project, shapes: project.shapes.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  };


  // Clicking a primitive adds it to the plan, selected. It goes to the centre, or
  // beside the shapes already there, so it is never hidden under another one.
  const addShape = (type: ShapeType) => {
    const layer = layerOf(activeLayerId);
    if (!layer) return;
    if (layer.locked) {
      setNotice(`"${layer.name}" is locked. Unlock it or pick another layer.`);
      return;
    }
    const base = createShape(type, layer.id, project.shapes);
    const x = freeX(project.shapes);
    const shape = { ...base, position: [x, base.size[1] / 2, 0] as Vec3 };
    commit({
      ...project,
      layers: project.layers.map((l) => (l.id === layer.id ? { ...l, visible: true } : l)),
      shapes: [...project.shapes, shape],
    });
    setSelectedId(shape.id);
    setShowResult(false);
  };

  // A move or resize drag is one undo step: the state before the drag is saved when it starts.
  const startEdit = (target: ReadoutTarget | null) => {
    setHistory((past) => [...past.slice(-(HISTORY_LIMIT - 1)), project]);
    setReadout(target);
  };

  // A value typed into the readout card. Each edit is one undo step.
  const editReadout = (target: ReadoutTarget, index: number, value: number) => {
    const shape = project.shapes.find((s) => s.id === target.id);
    if (!shape) return;
    if (target.kind === 'move') {
      const position = [...shape.position] as Vec3;
      position[index] = value;
      updateShape(shape.id, { position });
      return;
    }
    const side = target.sides.find((s) => s.axis === index);
    if (!side) return;
    updateShape(shape.id, resizeAlongAxis(shape, side.axis, side.sign, Math.max(0.1, value)));
  };

  // Live updates during a drag. They change the project without adding undo steps.
  const shapeLive = (id: string, patch: Partial<Shape>) => {
    setProject((current) => ({
      ...current,
      shapes: current.shapes.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  };

  const toggleTheme = () => setTheme((current) => (current === 'dark' ? 'light' : 'dark'));

  const selectionLocked = selectedShapes.some((s) => layerOf(s.layerId)?.locked);

  // Clone the selection.
  const cloneSelected = () => {
    if (selectedShapes.length === 0 || selectionLocked) return;
    const clones = selectedShapes.map((s): Shape => ({
      ...s,
      id: createId(),
      name: `${s.name} copy`,
      position: [s.position[0] + 10, s.position[1], s.position[2] + 10] as Vec3,
    }));
    commit({ ...project, shapes: [...project.shapes, ...clones] });
    setSelection(clones.map((c) => c.id));
  };

  const deleteSelected = () => {
    if (selectedShapes.length === 0 || selectionLocked) return;
    const ids = selectedShapes.map((s) => s.id);
    commit({ ...project, shapes: project.shapes.filter((s) => !ids.includes(s.id)) });
    setSelection([]);
  };

  // Merge the selection into one object. Holes cut the solids, then the solids
  // become a single mesh with one colour that moves and resizes like a primitive.
  const mergeSelected = () => {
    if (selectedShapes.length < 2) {
      setNotice('Select at least two shapes to merge them.');
      return;
    }
    if (selectionLocked) return;
    if (!engine) return;
    const merged = mergeShapes(engine, selectedShapes);
    if (!merged) {
      setNotice('Nothing to merge: the selection needs at least one solid shape, not only holes.');
      return;
    }
    const firstSolid = selectedShapes.find((s) => !s.hole) ?? selectedShapes[0];
    const mergedCount = project.shapes.filter((s) => s.type === 'mesh').length + 1;
    const shape: Shape = {
      id: createId(),
      name: `Merged ${mergedCount}`,
      type: 'mesh',
      layerId: selectedShapes[0].layerId,
      position: merged.position,
      rotation: [0, 0, 0],
      size: merged.size,
      baseSize: merged.size,
      color: firstSolid.color,
      hole: false,
      mesh: merged.geometry,
    };
    const ids = selectedShapes.map((s) => s.id);
    commit({ ...project, shapes: [...project.shapes.filter((s) => !ids.includes(s.id)), shape] });
    setSelection([shape.id]);
    setReadout(null);
  };


  // Turn the selection into holes, or back into solids.
  const toggleHoleSelected = () => {
    if (selectedShapes.length === 0 || selectionLocked) return;
    const hole = !selectedShapes[selectedShapes.length - 1].hole;
    const ids = selectedShapes.map((s) => s.id);
    commit({ ...project, shapes: project.shapes.map((s) => (ids.includes(s.id) ? { ...s, hole } : s)) });
  };

  const addLayer = () => {
    const layer = createLayer(`Layer ${project.layers.length + 1}`);
    commit({ ...project, layers: [...project.layers, layer] });
    setActiveLayerId(layer.id);
  };

  const renameLayer = (id: string, name: string) => {
    commit({ ...project, layers: project.layers.map((l) => (l.id === id ? { ...l, name } : l)) });
  };

  const toggleLayer = (id: string, key: 'visible' | 'locked') => {
    commit({ ...project, layers: project.layers.map((l) => (l.id === id ? { ...l, [key]: !l[key] } : l)) });
  };

  const deleteLayer = (id: string) => {
    const layer = layerOf(id);
    if (!layer || project.layers.length < 2) return;
    const members = project.shapes.filter((s) => s.layerId === id).length;
    const warning = members > 0 ? ` and its ${members} shape${members === 1 ? '' : 's'}` : '';
    if (!window.confirm(`Delete "${layer.name}"${warning}?`)) return;

    const layers = project.layers.filter((l) => l.id !== id);
    commit({ layers, shapes: project.shapes.filter((s) => s.layerId !== id) });
    if (activeLayerId === id) setActiveLayerId(layers[0].id);
    if (selected?.layerId === id) setSelectedId(null);
  };

  const exportStl = () => {
    if (!engine) return;
    const mesh = resultMesh(engine, visibleShapes(project));
    if (!mesh) {
      setNotice('Nothing to export. Add a solid shape to a visible layer.');
      return;
    }
    downloadBlob(new Blob([encodeBinarySTL(mesh)], { type: 'model/stl' }), 'plinth3d-model.stl');
  };

  const saveProject = () => {
    downloadBlob(new Blob([serializeProject(project)], { type: 'application/json' }), 'plinth3d-project.json');
  };

  const openProject = async (file: File) => {
    try {
      const next = parseProject(await file.text());
      setHistory([]);
      setProject(next);
      setActiveLayerId(next.layers[0].id);
      setSelectedId(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not open that file.');
    }
  };

  // Keyboard shortcuts. Ignored while typing in a field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      // Single letters work alone, without Ctrl or Alt.
      const plain = !mod && !event.altKey;
      if (mod && key === 'z') {
        event.preventDefault();
        undo();
      } else if (mod && key === 'd') {
        event.preventDefault();
        cloneSelected();
      } else if (mod && key === 'g') {
        event.preventDefault();
        mergeSelected();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        deleteSelected();
      } else if (plain && (key === 'm' || key === 'w')) {
        setGizmoMode('translate');
      } else if (plain && (key === 'r' || key === 'e')) {
        setGizmoMode('rotate');
      } else if (plain && key === 'g') {
        mergeSelected();
      } else if (plain && key === 'h') {
        toggleHoleSelected();
      } else if (plain && key === 'b') {
        addShape('box');
      } else if (plain && key === 'c') {
        addShape('cylinder');
      } else if (plain && key === 's') {
        addShape('sphere');
      } else if (event.key === 'Escape') {
        setSelection([]);
        setReadout(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const status = engine
    ? `${visibleShapes(project).length} visible shape${visibleShapes(project).length === 1 ? '' : 's'} · ${project.layers.length} layer${project.layers.length === 1 ? '' : 's'}`
    : 'Loading geometry engine…';

  return (
    <div className="app">
      <header className="toolbar">
        <strong className="brand">Plinth3D</strong>
        <div className="group">
          <button
            type="button"
            className="tool-icon"
            onClick={() => addShape('box')}
            aria-label="Box"
            title="Add a box to the plan (B)"
          >
            <BoxIcon />
            <KeyHint k="B" />
          </button>
          <button
            type="button"
            className="tool-icon"
            onClick={() => addShape('cylinder')}
            aria-label="Cylinder"
            title="Add a cylinder to the plan (C)"
          >
            <CylinderIcon />
            <KeyHint k="C" />
          </button>
          <button
            type="button"
            className="tool-icon"
            onClick={() => addShape('sphere')}
            aria-label="Sphere"
            title="Add a sphere to the plan (S)"
          >
            <SphereIcon />
            <KeyHint k="S" />
          </button>
        </div>
        <div className="group segmented">
          <button
            type="button"
            className={gizmoMode === 'translate' ? 'toggled' : ''}
            onClick={() => setGizmoMode('translate')}
            title="Move (M)"
          >
            <Label text="Move" at={0} />
            <KeyHint k="M" />
          </button>
          <button
            type="button"
            className={gizmoMode === 'rotate' ? 'toggled' : ''}
            onClick={() => setGizmoMode('rotate')}
            title="Rotate (R)"
          >
            <Label text="Rotate" at={0} />
            <KeyHint k="R" />
          </button>
        </div>
        <div className="group segmented" role="group" aria-label="Drag plane">
          <span className="group-label">Drag in</span>
          {(['XY', 'XZ', 'YZ'] as const).map((plane) => (
            <button
              key={plane}
              type="button"
              className={dragPlane === plane ? 'toggled' : ''}
              onClick={() => setDragPlane(plane)}
              title={DRAG_PLANE_HINT[plane]}
            >
              {plane}
            </button>
          ))}
        </div>
        <div className="group">
          <label className="group-label" htmlFor="snap-step">Step</label>
          <select
            id="snap-step"
            value={snap}
            onChange={(e) => setSnap(Number(e.target.value))}
            title="Snap step for moving and resizing"
          >
            <option value={0}>Off</option>
            <option value={0.1}>0.1 mm</option>
            <option value={0.5}>0.5 mm</option>
            <option value={1}>1 mm</option>
            <option value={2}>2 mm</option>
            <option value={5}>5 mm</option>
            <option value={10}>10 mm</option>
          </select>
        </div>
        <div className="group">
          <button
            type="button"
            className="tool-icon"
            onClick={undo}
            disabled={history.length === 0}
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
          >
            <UndoIcon />
            <KeyHint k="^Z" />
          </button>
          <button type="button" onClick={cloneSelected} disabled={selectedShapes.length === 0} title="Clone (Ctrl+D)">
            Clone
            <KeyHint k="^D" />
          </button>
          <button
            type="button"
            className="tool-icon"
            onClick={deleteSelected}
            disabled={selectedShapes.length === 0}
            aria-label="Delete"
            title="Delete (Del)"
          >
            <TrashIcon />
            <KeyHint k="Del" />
          </button>
        </div>
        <div className="group">
          <button type="button" onClick={mergeSelected} disabled={selectedShapes.length < 2} title="Merge the selection into one object (G)">
            <Label text="Merge" at={3} />
            <KeyHint k="G" />
          </button>
          <button
            type="button"
            className={selectedShapes.length > 0 && selectedShapes[selectedShapes.length - 1].hole ? 'toggled' : ''}
            onClick={toggleHoleSelected}
            disabled={selectedShapes.length === 0}
            title="Hole: cuts the solids when merged (H)"
          >
            <Label text="Hole" at={0} />
            <KeyHint k="H" />
          </button>
        </div>
        <div className="group">
          <button
            type="button"
            className={showResult ? 'toggled' : ''}
            onClick={() => setShowResult((v) => !v)}
            title="Show the combined result with holes cut"
          >
            Result
          </button>
        </div>
        <div className="spacer" />
        <button
          type="button"
          className="tool-icon"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
        <div className="group">
          <button type="button" onClick={() => openInput.current?.click()}>Open</button>
          <button type="button" onClick={saveProject}>Save</button>
          <button type="button" className="primary" onClick={exportStl} disabled={!engine}>
            Export STL
          </button>
          <input
            ref={openInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void openProject(file);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      <aside className="sidebar">
        <LayerPanel
          layers={project.layers}
          shapes={project.shapes}
          activeLayerId={activeLayerId}
          selectedIds={selection}
          onActivate={setActiveLayerId}
          onAdd={addLayer}
          onRename={renameLayer}
          onToggle={toggleLayer}
          onDelete={deleteLayer}
          onSelect={(id, additive) => selectShape(id, additive)}
          onRenameShape={(id, name) => updateShape(id, { name })}
        />
      </aside>

      <main className="stage">
        <Viewport
          engine={engine}
          layers={project.layers}
          shapes={project.shapes}
          selectedId={selectedId}
          selection={selection}
          gizmoMode={gizmoMode}
          result={result}
          showResult={showResult}
          theme={theme}
          onSelect={selectShape}
          dragPlane={dragPlane}
          onEditStart={startEdit}
          onReadoutEdit={editReadout}
          onReadoutShow={setReadout}
          snap={snap}
          readout={readout}
          onShapeLive={shapeLive}
        />
        <footer className="statusbar">
          <span>{status}</span>
          {notice && <span className="notice">{notice}</span>}
        </footer>
      </main>

      <aside className="inspector">
        <Inspector
          shape={selection.length === 1 ? selected : null}
          count={selection.length}
          layers={project.layers}
          readOnly={selectedLayerLocked}
          onChange={updateShape}
          onDuplicate={cloneSelected}
          onDelete={deleteSelected}
        />
      </aside>
    </div>
  );
}
