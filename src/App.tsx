import { useEffect, useMemo, useRef, useState } from 'react';
import type { ManifoldToplevel } from 'manifold-3d';
import { Viewport, type GizmoMode, type Theme, type TransformChange } from './Viewport';
import { BoxIcon, CylinderIcon, MoonIcon, SphereIcon, SunIcon } from './Icons';
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
import { encodeBinarySTL, loadEngine, resultMesh } from './geometry';

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeLayerId, setActiveLayerId] = useState<string>(project.layers[0].id);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate');
  const [showResult, setShowResult] = useState(false);
  const [engine, setEngine] = useState<ManifoldToplevel | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(loadTheme);
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

  const onTransform = ({ id, position, rotation }: TransformChange) => updateShape(id, { position, rotation });

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

    const toggleTheme = () => setTheme((current) => (current === 'dark' ? 'light' : 'dark'));

  const duplicateSelected = () => {
    if (!selected || selectedLayerLocked) return;
    const copy: Shape = {
      ...selected,
      id: createId(),
      name: `${selected.name} copy`,
      position: [selected.position[0] + 10, selected.position[1], selected.position[2] + 10] as Vec3,
    };
    commit({ ...project, shapes: [...project.shapes, copy] });
    setSelectedId(copy.id);
  };

  const deleteSelected = () => {
    if (!selected || selectedLayerLocked) return;
    commit({ ...project, shapes: project.shapes.filter((s) => s.id !== selected.id) });
    setSelectedId(null);
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
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
      } else if (mod && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelected();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        deleteSelected();
      } else if (event.key.toLowerCase() === 'w') {
        setGizmoMode('translate');
      } else if (event.key.toLowerCase() === 'e') {
        setGizmoMode('rotate');
      } else if (event.key === 'Escape') {
        setSelectedId(null);
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
            title="Add a box to the plan"
          >
            <BoxIcon />
          </button>
          <button
            type="button"
            className="tool-icon"
            onClick={() => addShape('cylinder')}
            aria-label="Cylinder"
            title="Add a cylinder to the plan"
          >
            <CylinderIcon />
          </button>
          <button
            type="button"
            className="tool-icon"
            onClick={() => addShape('sphere')}
            aria-label="Sphere"
            title="Add a sphere to the plan"
          >
            <SphereIcon />
          </button>
        </div>
        <div className="group">
          <button
            type="button"
            className={gizmoMode === 'translate' ? 'toggled' : ''}
            onClick={() => setGizmoMode('translate')}
            title="Move (W)"
          >
            Move
          </button>
          <button
            type="button"
            className={gizmoMode === 'rotate' ? 'toggled' : ''}
            onClick={() => setGizmoMode('rotate')}
            title="Rotate (E)"
          >
            Rotate
          </button>
        </div>
        <div className="group">
          <button type="button" onClick={undo} disabled={history.length === 0} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button type="button" onClick={duplicateSelected} disabled={!selected} title="Duplicate (Ctrl+D)">
            Duplicate
          </button>
          <button type="button" onClick={deleteSelected} disabled={!selected} title="Delete (Del)">
            Delete
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
          selectedId={selectedId}
          onActivate={setActiveLayerId}
          onAdd={addLayer}
          onRename={renameLayer}
          onToggle={toggleLayer}
          onDelete={deleteLayer}
          onSelect={(id) => {
            setSelectedId(id);
            const shape = project.shapes.find((s) => s.id === id);
            if (shape) setActiveLayerId(shape.layerId);
          }}
        />
      </aside>

      <main className="stage">
        <Viewport
          engine={engine}
          layers={project.layers}
          shapes={project.shapes}
          selectedId={selectedId}
          gizmoMode={gizmoMode}
          result={result}
          showResult={showResult}
          theme={theme}
          onSelect={(id) => {
            setSelectedId(id);
            const shape = id ? project.shapes.find((s) => s.id === id) : undefined;
            if (shape) setActiveLayerId(shape.layerId);
          }}
          onTransform={onTransform}
        />
        <footer className="statusbar">
          <span>{status}</span>
          {notice && <span className="notice">{notice}</span>}
        </footer>
      </main>

      <aside className="inspector">
        <Inspector
          shape={selected}
          layers={project.layers}
          readOnly={selectedLayerLocked}
          onChange={updateShape}
          onDuplicate={duplicateSelected}
          onDelete={deleteSelected}
        />
      </aside>
    </div>
  );
}
