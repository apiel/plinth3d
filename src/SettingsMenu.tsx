import { useEffect, useRef, useState } from 'react';
import { CogIcon } from './Icons';

/** What a mouse button does to the view when it drags on empty space (or anywhere, for middle and right). */
export type MouseAction = 'rotate' | 'pan' | 'zoom' | 'none';
export type MouseButton = 'left' | 'middle' | 'right';
export type MouseMap = Record<MouseButton, MouseAction>;

export const DEFAULT_MOUSE_MAP: MouseMap = { left: 'rotate', middle: 'pan', right: 'pan' };

const BUTTONS: { button: MouseButton; label: string; hint?: string }[] = [
  { button: 'left', label: 'Left', hint: 'Picks and drags shapes; this acts on empty space' },
  { button: 'middle', label: 'Middle' },
  { button: 'right', label: 'Right' },
];

const ACTIONS: { action: MouseAction; label: string }[] = [
  { action: 'rotate', label: 'Rotate view' },
  { action: 'pan', label: 'Pan view' },
  { action: 'zoom', label: 'Zoom view' },
  { action: 'none', label: 'Nothing' },
];

interface SettingsMenuProps {
  map: MouseMap;
  onChange: (map: MouseMap) => void;
}

/** The cog popover. It holds the settings, one titled section each; for now the mouse buttons. */
export function SettingsMenu({ map, onChange }: SettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPress = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPress, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPress, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="mouse-menu" ref={root}>
      <button
        type="button"
        className="tool-icon"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label="Settings"
        title="Settings"
      >
        <CogIcon />
      </button>
      {open && (
        <div className="mouse-menu-card" role="dialog" aria-label="Settings">
          <span className="mouse-menu-title">Mouse buttons</span>
          {BUTTONS.map(({ button, label, hint }) => (
            <label key={button} className="mouse-menu-row" title={hint}>
              <span>{label}</span>
              <select value={map[button]} onChange={(e) => onChange({ ...map, [button]: e.target.value as MouseAction })}>
                {ACTIONS.map((a) => (
                  <option key={a.action} value={a.action}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button type="button" onClick={() => onChange(DEFAULT_MOUSE_MAP)}>
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
