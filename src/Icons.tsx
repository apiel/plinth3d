import type { ReactNode } from 'react';

// Small line icons. They inherit the button's text colour.
function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {children}
    </svg>
  );
}

export function BoxIcon() {
  return (
    <Svg>
      <polygon points="12 3 20 7.5 12 12 4 7.5" />
      <polyline points="4 7.5 4 16.5 12 21 12 12" />
      <polyline points="20 7.5 20 16.5 12 21" />
    </Svg>
  );
}

export function CylinderIcon() {
  return (
    <Svg>
      <ellipse cx="12" cy="6" rx="6.5" ry="2.5" />
      <path d="M5.5 6v12c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V6" />
    </Svg>
  );
}

export function SphereIcon() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="8.5" />
      <ellipse cx="12" cy="12" rx="8.5" ry="3" />
    </Svg>
  );
}

export function SunIcon() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
    </Svg>
  );
}

export function UndoIcon() {
  return (
    <Svg>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Svg>
  );
}

export function TrashIcon() {
  return (
    <Svg>
      <path d="M4 7h16" />
      <path d="M9.5 7V4.5h5V7" />
      <path d="M6.5 7l1 13h9l1-13" />
      <path d="M10 11v5M14 11v5" />
    </Svg>
  );
}

export function MoonIcon() {
  return (
    <Svg>
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
    </Svg>
  );
}
