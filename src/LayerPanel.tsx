import { useEffect, useRef, useState } from 'react';
import { DownloadIcon } from './Icons';
import type { Layer, Shape } from './model';

interface LayerPanelProps {
  layers: Layer[];
  shapes: Shape[];
  activeLayerId: string;
  selectedIds: string[];
  onActivate: (layerId: string) => void;
  onAdd: () => void;
  onExportLayer: (layerId: string) => void;
  onImportLayer: (file: File) => void;
  onRename: (layerId: string, name: string) => void;
  onToggle: (layerId: string, key: 'visible' | 'locked') => void;
  onDelete: (layerId: string) => void;
  onSelect: (shapeId: string, additive: boolean) => void;
  onRenameShape: (shapeId: string, name: string) => void;
  onToggleShapeHidden: (shapeId: string) => void;
  /** The shape under the pointer, from the list or the scene. Its row is highlighted and scrolled into view. */
  hoveredId: string | null;
  /** Called with the shape under the pointer in the list, or null when it leaves. The scene outlines it. */
  onHover: (shapeId: string | null) => void;
  /** Called when shapes are dropped on a layer, or on a shape row. beforeId is the shape they go in front of, if any. */
  onMoveShapes: (shapeIds: string[], layerId: string, beforeId?: string) => void;
}

type SortOrder = 'manual' | 'name' | 'type';

const SORT_LABELS: Record<SortOrder, string> = {
  manual: 'Creation order',
  name: 'Name',
  type: 'Type',
};

/** The MIME type used to carry dragged shape ids between list rows. */
const SHAPE_DRAG_TYPE = 'application/x-plinth3d-shapes';

/** Photoshop-style layer list. Each layer lists the shapes it contains. */
export function LayerPanel(props: LayerPanelProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const [editingShape, setEditingShape] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('manual');
  // The layer a drag is currently over, so it can light up.
  const [dropLayer, setDropLayer] = useState<string | null>(null);
  // The shape row a drag is over, and whether the drop goes above it (true) or below it.
  const [dropShape, setDropShape] = useState<{ id: string; before: boolean } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // The shape ids of the drag in progress.
  const draggingIds = useRef<string[]>([]);

  // A shape hovered in the scene: bring its row into view, if the list has to scroll to it.
  useEffect(() => {
    if (!props.hoveredId || !listRef.current) return;
    const row = listRef.current.querySelector<HTMLElement>(`[data-shape-id="${props.hoveredId}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [props.hoveredId]);

  // Newest layers appear at the top, as in Photoshop.
  const ordered = [...props.layers].reverse();

  const sortShapes = (members: Shape[]): Shape[] => {
    if (sortOrder === 'manual') return members;
    const byName = (a: Shape, b: Shape) => a.name.localeCompare(b.name, undefined, { numeric: true });
    if (sortOrder === 'name') return [...members].sort(byName);
    return [...members].sort((a, b) => a.type.localeCompare(b.type) || byName(a, b));
  };

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Layers</h2>
        <div className="button-row">
          <button type="button" onClick={() => importInput.current?.click()} title="Import a layer file">
            Import
          </button>
          <button type="button" onClick={props.onAdd} title="New layer">
            + Layer
          </button>
          <input
            ref={importInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) props.onImportLayer(file);
              e.target.value = '';
            }}
          />
        </div>
      </header>
      <div className="sort-row">
        <label>
          Sort shapes by{' '}
          <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value as SortOrder)}>
            {(Object.keys(SORT_LABELS) as SortOrder[]).map((order) => (
              <option key={order} value={order}>
                {SORT_LABELS[order]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ul className="layer-list" ref={listRef}>
        {ordered.map((layer) => {
          const members = props.shapes.filter((s) => s.layerId === layer.id);
          const active = layer.id === props.activeLayerId;
          return (
            <li key={layer.id} className={active ? 'layer active' : 'layer'}>
              <div
                className={dropLayer === layer.id ? 'layer-row drop-target' : 'layer-row'}
                onClick={() => props.onActivate(layer.id)}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(SHAPE_DRAG_TYPE)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dropLayer !== layer.id) setDropLayer(layer.id);
                }}
                onDragLeave={() => {
                  if (dropLayer === layer.id) setDropLayer(null);
                }}
                onDrop={(e) => {
                  if (!e.dataTransfer.types.includes(SHAPE_DRAG_TYPE)) return;
                  e.preventDefault();
                  setDropLayer(null);
                  const ids = JSON.parse(e.dataTransfer.getData(SHAPE_DRAG_TYPE)) as string[];
                  props.onMoveShapes(ids, layer.id);
                }}
              >
                <button
                  type="button"
                  className="icon-button"
                  title={layer.visible ? 'Hide layer' : 'Show layer'}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onToggle(layer.id, 'visible');
                  }}
                >
                  {layer.visible ? '👁' : '·'}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title={layer.locked ? 'Unlock layer' : 'Lock layer'}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onToggle(layer.id, 'locked');
                  }}
                >
                  {layer.locked ? '🔒' : '🔓'}
                </button>
                {editing === layer.id ? (
                  <input
                    className="layer-name-input"
                    autoFocus
                    defaultValue={layer.name}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      props.onRename(layer.id, e.currentTarget.value.trim() || layer.name);
                      setEditing(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') setEditing(null);
                    }}
                  />
                ) : (
                  <span
                    className="layer-name"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditing(layer.id);
                    }}
                  >
                    {layer.name}
                  </span>
                )}
                <span className="layer-count">{members.length}</span>
                {props.layers.length > 1 && (
                  <button
                    type="button"
                    className="icon-button"
                    title="Delete layer and its shapes"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onDelete(layer.id);
                    }}
                  >
                    ×
                  </button>
                )}
                <button
                  type="button"
                  className="icon-button layer-action"
                  title="Export layer to a file"
                  aria-label="Export layer"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onExportLayer(layer.id);
                  }}
                >
                  <DownloadIcon />
                </button>
              </div>
              {members.length > 0 && (
                <ul className="shape-list">
                  {sortShapes(members).map((shape, index, shown) => (
                    <li
                      key={shape.id}
                      data-shape-id={shape.id}
                      className={`${props.selectedIds.includes(shape.id) ? 'shape selected' : 'shape'}${shape.hidden ? ' hidden' : ''}${props.hoveredId === shape.id ? ' hovered' : ''}${dropShape?.id === shape.id ? (dropShape.before ? ' drop-before' : ' drop-after') : ''}`}
                      onDragOver={(e) => {
                        if (!e.dataTransfer.types.includes(SHAPE_DRAG_TYPE)) return;
                        e.stopPropagation();
                        // Browsers hide drag data until the drop, so the dragged ids come from a ref set at drag start.
                        if (draggingIds.current.includes(shape.id)) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        const rect = e.currentTarget.getBoundingClientRect();
                        const before = e.clientY < rect.top + rect.height / 2;
                        if (dropShape?.id !== shape.id || dropShape.before !== before) setDropShape({ id: shape.id, before });
                      }}
                      onDragLeave={() => {
                        if (dropShape?.id === shape.id) setDropShape(null);
                      }}
                      onDrop={(e) => {
                        if (!e.dataTransfer.types.includes(SHAPE_DRAG_TYPE)) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const dropBefore = dropShape?.id === shape.id ? dropShape.before : true;
                        setDropShape(null);
                        setDropLayer(null);
                        const ids = JSON.parse(e.dataTransfer.getData(SHAPE_DRAG_TYPE)) as string[];
                        if (ids.includes(shape.id)) return;
                        // Dropping below a row goes in front of the next row that is not itself being moved.
                        const after = shown.slice(index + 1).find((s) => !ids.includes(s.id));
                        // A manual order is what makes the new place visible, so the list switches to it.
                        setSortOrder('manual');
                        props.onMoveShapes(ids, layer.id, dropBefore ? shape.id : after?.id);
                      }}
                      // Rename inputs need their text selection, so only the plain row can be dragged.
                      draggable={editingShape !== shape.id}
                      title="Drag onto a layer to move it"
                      onClick={(e) => props.onSelect(shape.id, e.shiftKey)}
                      onMouseEnter={() => props.onHover(shape.id)}
                      onMouseLeave={() => props.onHover(null)}
                      onDragStart={(e) => {
                        // Dragging a selected shape moves the whole selection; any other shape moves alone.
                        const ids = props.selectedIds.includes(shape.id) ? props.selectedIds : [shape.id];
                        draggingIds.current = ids;
                        e.dataTransfer.setData(SHAPE_DRAG_TYPE, JSON.stringify(ids));
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                    >
                      <span className="swatch" style={{ background: shape.hole ? '#ff4d4d' : shape.color }} />
                      {editingShape === shape.id ? (
                        <input
                          className="layer-name-input"
                          autoFocus
                          defaultValue={shape.name}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => {
                            props.onRenameShape(shape.id, e.currentTarget.value.trim() || shape.name);
                            setEditingShape(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            if (e.key === 'Escape') setEditingShape(null);
                          }}
                        />
                      ) : (
                        <span
                          className="shape-name"
                          title="Double-click to rename"
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setEditingShape(shape.id);
                          }}
                        >
                          {shape.name}
                        </span>
                      )}
                      {shape.hole && <span className="badge">hole</span>}
                      <button
                        type="button"
                        className="icon-button"
                        title={shape.hidden ? 'Show shape' : 'Hide shape'}
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onToggleShapeHidden(shape.id);
                        }}
                      >
                        {shape.hidden ? '·' : '👁'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
