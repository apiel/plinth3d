import { useEffect, useRef, useState } from 'react';
import type { Shape } from './model';

/** Parses a rounding key: "e:along:signA:signB" for an edge, "c:sx:sy:sz" for a corner. */
export function describeRound(key: string): string {
  if (key.startsWith('c:')) return 'Corner';
  const along = key.split(':')[0];
  return `Edge along ${['X', 'Y', 'Z'][Number(along)]}`;
}

interface RoundModalProps {
  shape: Shape;
  roundKey: string;
  x: number;
  y: number;
  onApply: (radius: number) => void;
  onClose: () => void;
}

/** Sets the rounding radius of one edge or corner of an unselected box. */
export function RoundModal({ shape, roundKey, x, y, onApply, onClose }: RoundModalProps) {
  const current = shape.rounds?.find((r) => r.edge === roundKey)?.radius ?? 0;
  const [value, setValue] = useState(String(current));
  // Every change is applied straight away, so the shape updates while you type.
  const card = useRef<HTMLDivElement>(null);

  // Keep the card on screen, next to the cursor.
  const left = Math.min(x + 14, window.innerWidth - 240);
  const top = Math.min(y + 14, window.innerHeight - 140);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const change = (text: string) => {
    setValue(text);
    const radius = Number(text);
    if (text.trim() === '' || !Number.isFinite(radius) || radius < 0) return;
    onApply(radius);
  };

  return (
    <div className="round-modal" ref={card} style={{ left, top }} role="dialog" aria-label="Round edge">
      <span className="round-modal-title">
        {describeRound(roundKey)} of {shape.name}
      </span>
      <label className="round-modal-field">
        <span>Radius (mm)</span>
        <input
          autoFocus
          type="number"
          min={0}
          step={0.5}
          value={value}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onClose();
          }}
        />
      </label>
      <div className="round-modal-actions">
        <button type="button" onClick={() => onApply(0)} title="Make it square again">
          Square
        </button>
        <button type="button" className="primary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
