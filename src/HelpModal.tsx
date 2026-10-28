interface Section {
  title: string;
  rows: { keys: string; action: string }[];
}

const SECTIONS: Section[] = [
  {
    title: 'Add a shape',
    rows: [
      { keys: 'B', action: 'Box' },
      { keys: 'C', action: 'Cylinder' },
      { keys: 'S', action: 'Sphere' },
      { keys: 'K', action: 'Cone' },
      { keys: 'P', action: 'Pyramid' },
      { keys: 'V', action: 'Wedge' },
      { keys: 'T', action: 'Torus' },
    ],
  },
  {
    title: 'Edit the selection',
    rows: [
      { keys: 'D', action: 'Drop onto the shape under it, or the plan' },
      { keys: 'H', action: 'Make it a hole, or a solid again' },
      { keys: 'G / Ctrl+G', action: 'Merge' },
      { keys: 'U', action: 'Unmerge' },
      { keys: 'Ctrl+D', action: 'Clone' },
      { keys: 'Del', action: 'Delete' },
      { keys: 'Ctrl+Z', action: 'Undo' },
    ],
  },
  {
    title: 'Move and select',
    rows: [
      { keys: 'M / W', action: 'Move tool' },
      { keys: 'R / E', action: 'Rotate tool' },
      { keys: 'X', action: 'Resize tool: drag anywhere on a face' },
      { keys: 'Arrows', action: 'Nudge on the plan, relative to the view' },
      { keys: 'Ctrl+Arrows', action: 'Nudge along the drag plane' },
      { keys: 'Shift / Ctrl / Alt', action: 'Change the snap step (see Settings)' },
      { keys: 'Shift+click', action: 'Add to or remove from the selection' },
      { keys: 'Ctrl+A', action: 'Select all' },
      { keys: 'Esc', action: 'Clear the selection' },
    ],
  },
  {
    title: 'View',
    rows: [
      { keys: 'Z (hold)', action: 'Show the width, height and depth of the selection' },
      { keys: '?', action: 'This window' },
    ],
  },
];

/** A window listing every keyboard shortcut. A click outside it, or the Close button, closes it. */
export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label="Keyboard shortcuts"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <strong>Keyboard shortcuts</strong>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <span className="modal-title">{section.title}</span>
              {section.rows.map((row) => (
                <div className="modal-row" key={row.keys}>
                  <kbd>{row.keys}</kbd>
                  <span>{row.action}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
