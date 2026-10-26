import { useEffect, useRef, useState } from 'react';
import { CogIcon } from './Icons';

/** What a mouse button does to the view when it drags on empty space (or anywhere, for middle and right). */
export type MouseAction = 'rotate' | 'pan' | 'zoom' | 'none';
export type MouseButton = 'left' | 'middle' | 'right';
export type MouseMap = Record<MouseButton, MouseAction>;

/** What Ctrl and Shift do to the snap step while held: a factor, where 1 changes nothing and 0 turns snapping off. */
export type StepKeys = { ctrl: number; shift: number; alt: number | 'round' };

/** Alt flips round mode by default, instead of changing the step. */
export const DEFAULT_STEP_KEYS: StepKeys = { ctrl: 0.5, shift: 5, alt: 'round' };

const FACTORS: { factor: number; label: string }[] = [
  { factor: 0.1, label: 'Step ÷ 10' },
  { factor: 0.2, label: 'Step ÷ 5' },
  { factor: 0.5, label: 'Step ÷ 2' },
  { factor: 1, label: 'No change' },
  { factor: 2, label: 'Step × 2' },
  { factor: 5, label: 'Step × 5' },
  { factor: 10, label: 'Step × 10' },
  { factor: 0, label: 'Snap off' },
];

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
  stepKeys: StepKeys;
  onStepKeys: (keys: StepKeys) => void;
}

/** The cog popover. It holds the settings, one titled section each; the mouse buttons and the step keys. */
export function SettingsMenu({ map, onChange, stepKeys, onStepKeys }: SettingsMenuProps) {
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
          <span className="mouse-menu-title">Step while dragging</span>
          {(['ctrl', 'shift', 'alt'] as const).map((key) => (
            <label key={key} className="mouse-menu-row">
              <span>{key === 'ctrl' ? 'Ctrl' : key === 'shift' ? 'Shift' : 'Alt'}</span>
              <select
                value={stepKeys[key]}
                onChange={(e) => onStepKeys({ ...stepKeys, [key]: e.target.value === 'round' ? 'round' : Number(e.target.value) })}
              >
                {key === 'alt' && <option value="round">Round mode</option>}
                {FACTORS.map((f) => (
                  <option key={f.factor} value={f.factor}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button
            type="button"
            onClick={() => {
              onChange(DEFAULT_MOUSE_MAP);
              onStepKeys(DEFAULT_STEP_KEYS);
            }}
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
