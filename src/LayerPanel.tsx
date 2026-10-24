import { useState } from 'react';
import type { Layer, Shape } from './model';

interface LayerPanelProps {
  layers: Layer[];
  shapes: Shape[];
  activeLayerId: string;
  selectedIds: string[];
  onActivate: (layerId: string) => void;
  onAdd: () => void;
  onRename: (layerId: string, name: string) => void;
  onToggle: (layerId: string, key: 'visible' | 'locked') => void;
  onDelete: (layerId: string) => void;
  onSelect: (shapeId: string, additive: boolean) => void;
  onRenameShape: (shapeId: string, name: string) => void;
  onToggleShapeHidden: (shapeId: string) => void;
}

/** Photoshop-style layer list. Each layer lists the shapes it contains. */
export function LayerPanel(props: LayerPanelProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editingShape, setEditingShape] = useState<string | null>(null);

  // Newest layers appear at the top, as in Photoshop.
  const ordered = [...props.layers].reverse();

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Layers</h2>
        <button type="button" onClick={props.onAdd} title="New layer">
          + Layer
        </button>
      </header>
      <ul className="layer-list">
        {ordered.map((layer) => {
          const members = props.shapes.filter((s) => s.layerId === layer.id);
          const active = layer.id === props.activeLayerId;
          return (
            <li key={layer.id} className={active ? 'layer active' : 'layer'}>
              <div className="layer-row" onClick={() => props.onActivate(layer.id)}>
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
              </div>
              {members.length > 0 && (
                <ul className="shape-list">
                  {members.map((shape) => (
                    <li
                      key={shape.id}
                      className={`${props.selectedIds.includes(shape.id) ? 'shape selected' : 'shape'}${shape.hidden ? ' hidden' : ''}`}
                      onClick={(e) => props.onSelect(shape.id, e.shiftKey)}
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
