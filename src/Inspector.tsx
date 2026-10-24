import type { Layer, Shape, Vec3 } from './model';

interface InspectorProps {
  shape: Shape | null;
  /** How many shapes are selected. The fields only edit a single shape. */
  count: number;
  layers: Layer[];
  readOnly: boolean;
  onChange: (id: string, patch: Partial<Shape>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const AXES = ['x', 'y', 'z'] as const;

/** Edits the selected shape. Numbers are millimetres and degrees. */
export function Inspector({
  shape,
  count,
  layers,
  readOnly,
  onChange,
  onDuplicate,
  onDelete,
}: InspectorProps) {
  if (!shape && count > 1) {
    return (
      <section className="panel">
        <header className="panel-header">
          <h2>Properties</h2>
        </header>
        <p className="hint">{count} shapes selected. Move them with the arrows or by dragging, or merge them with the Merge button.</p>
      </section>
    );
  }
  if (!shape) {
    return (
      <section className="panel">
        <header className="panel-header">
          <h2>Properties</h2>
        </header>
        <p className="hint">Select a shape to edit it. Click a shape in the scene or in the layer list.</p>
      </section>
    );
  }

  const setVector = (key: 'size' | 'position' | 'rotation', index: number, raw: string) => {
    const value = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(value)) return;
    const next = [...shape[key]] as Vec3;
    next[index] = value;
    onChange(shape.id, { [key]: next } as Partial<Shape>);
  };

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Properties</h2>
      </header>
      <fieldset disabled={readOnly} className="inspector">
        <label className="field">
          <span>Name</span>
          <input value={shape.name} onChange={(e) => onChange(shape.id, { name: e.target.value })} />
        </label>
        <label className="field">
          <span>Layer</span>
          <select value={shape.layerId} onChange={(e) => onChange(shape.id, { layerId: e.target.value })}>
            {layers.map((layer) => (
              <option key={layer.id} value={layer.id}>
                {layer.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field checkbox">
          <input
            type="checkbox"
            checked={!shape.hidden}
            onChange={(e) => onChange(shape.id, { hidden: !e.target.checked })}
          />
          <span>Visible</span>
        </label>
        <label className="field checkbox">
          <input
            type="checkbox"
            checked={shape.hole}
            onChange={(e) => onChange(shape.id, { hole: e.target.checked })}
          />
          <span>Hole (subtract from solids)</span>
        </label>
        <label className="field">
          <span>Colour</span>
          <input type="color" value={shape.color} onChange={(e) => onChange(shape.id, { color: e.target.value })} />
        </label>
        <VectorRow label="Size (mm)" values={shape.size} onChange={(i, v) => setVector('size', i, v)} min={0.1} />
        <VectorRow label="Position (mm)" values={shape.position} onChange={(i, v) => setVector('position', i, v)} />
        <VectorRow label="Rotation (°)" values={shape.rotation} onChange={(i, v) => setVector('rotation', i, v)} />
        <div className="button-row">
          <button type="button" onClick={onDuplicate}>
            Duplicate
          </button>
          <button type="button" className="danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      </fieldset>
    </section>
  );
}

function VectorRow({
  label,
  values,
  onChange,
  min,
}: {
  label: string;
  values: Vec3;
  onChange: (index: number, raw: string) => void;
  min?: number;
}) {
  return (
    <div className="vector">
      <span className="vector-label">{label}</span>
      {AXES.map((axis, i) => (
        <label key={axis} className="axis">
          <span>{axis.toUpperCase()}</span>
          <input
            type="number"
            step="0.5"
            min={min}
            value={round(values[i])}
            onChange={(e) => onChange(i, e.target.value)}
          />
        </label>
      ))}
    </div>
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
