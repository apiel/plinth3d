import { EDGE_TYPES, SWEEP_TYPES } from "./geometry";
import { ChamferEdgeIcon, RoundEdgeIcon } from "./Icons";
import type { Layer, Shape, Vec3 } from "./model";

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

const AXES = ["x", "y", "z"] as const;

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
        <p className="hint">
          {count} shapes selected. Move them with the arrows or by dragging, or
          merge them with the Merge button.
        </p>
      </section>
    );
  }
  if (!shape) {
    return (
      <section className="panel">
        <header className="panel-header">
          <h2>Properties</h2>
        </header>
        <p className="hint">
          Select a shape to edit it. Click a shape in the scene or in the layer
          list.
        </p>
      </section>
    );
  }

  const setVector = (
    key: "size" | "position" | "rotation",
    index: number,
    raw: string,
  ) => {
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value)) return;
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
          <input
            value={shape.name}
            onChange={(e) => onChange(shape.id, { name: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Layer</span>
          <select
            value={shape.layerId}
            onChange={(e) => onChange(shape.id, { layerId: e.target.value })}
          >
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
          <input
            type="color"
            value={shape.color}
            onChange={(e) => onChange(shape.id, { color: e.target.value })}
          />
        </label>
        <VectorRow
          label="Size (mm)"
          values={shape.size}
          onChange={(i, v) => setVector("size", i, v)}
          min={0.1}
        />
        <VectorRow
          label="Position (mm)"
          values={shape.position}
          onChange={(i, v) => setVector("position", i, v)}
        />
        <VectorRow
          label="Rotation (°)"
          values={shape.rotation}
          onChange={(i, v) => setVector("rotation", i, v)}
        />
        {SWEEP_TYPES.includes(shape.type) && (
          <label className="field">
            <span>Sweep (°)</span>
            <input
              type="number"
              min={1}
              max={360}
              step={1}
              value={round(shape.sweep ?? 360)}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (
                  e.target.value.trim() === "" ||
                  !Number.isFinite(value) ||
                  value <= 0
                )
                  return;
                // 360 is the whole shape, so it is stored as no sweep at all.
                onChange(shape.id, { sweep: value >= 360 ? undefined : value });
              }}
            />
          </label>
        )}
        {EDGE_TYPES.includes(shape.type) && !shape.sweep && (
          <EdgesSection shape={shape} onChange={onChange} />
        )}
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

type Edges = NonNullable<Shape["edges"]>;
const NO_EDGES: Edges = {
  vertical: { size: 0 },
  top: { size: 0 },
  bottom: { size: 0 },
};

/** Rounded or chamfered corners and edges: one line each, with an icon that switches round and chamfer. */
function EdgesSection({
  shape,
  onChange,
}: {
  shape: Shape;
  onChange: (id: string, patch: Partial<Shape>) => void;
}) {
  const edges = shape.edges ?? NO_EDGES;
  const set = (key: keyof Edges, patch: Partial<Edges[keyof Edges]>) => {
    const next = { ...edges, [key]: { ...edges[key], ...patch } };
    const any = next.vertical.size + next.top.size + next.bottom.size > 0;
    onChange(shape.id, { edges: any ? next : undefined });
  };
  const fields = edgeFields(shape.type);
  return (
    <div className="edges">
      <span className="vector-label">Corners and edges</span>
      {fields.map(([key, label]) => {
        const spec = edges[key];
        return (
          <div key={key} className="edge-row">
            <span>{label}</span>
            <button
              type="button"
              className="icon-button"
              title={
                spec.chamfer
                  ? "Chamfered: click for rounded"
                  : "Rounded: click for chamfered"
              }
              aria-label={`${label}: ${spec.chamfer ? "chamfered" : "rounded"}`}
              onClick={() => set(key, { chamfer: !spec.chamfer })}
            >
              {spec.chamfer ? <ChamferEdgeIcon /> : <RoundEdgeIcon />}
            </button>
            <input
              type="number"
              min={0}
              step={0.5}
              aria-label={`${label} size (mm)`}
              value={round(spec.size)}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (
                  e.target.value.trim() === "" ||
                  !Number.isFinite(value) ||
                  value < 0
                )
                  return;
                set(key, { size: value });
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Which edges a shape has, and what to call them. */
function edgeFields(type: Shape["type"]): [keyof Edges, string][] {
  switch (type) {
    case "box":
      return [
        ["vertical", "Vertical corners"],
        ["top", "Top edge"],
        ["bottom", "Bottom edge"],
      ];
    case "wedge":
      return [
        ["vertical", "Corners"],
        ["top", "Front edge"],
        ["bottom", "Back edge"],
      ];
    case "cone":
    case "pyramid":
      return [["bottom", "Base edge"]];
    default:
      return [
        ["top", "Top edge"],
        ["bottom", "Bottom edge"],
      ];
  }
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
