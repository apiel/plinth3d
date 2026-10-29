// The project as a file: an SVG picture of it (the current view) that carries the
// project itself (the same JSON as `serializeProject`) in <metadata>, with
// instructions for an AI asked to edit it. The app only ever reads the JSON
// back; the picture is a preview.

import { PROJECT_FORMAT, PROJECT_VERSION, parseProject, serializeProject, visibleShapes, type Project, type Shape, type Vec3 } from './model';

const DATA_ID = 'plinth3d-data';

/** For an AI assistant asked to change the project. An XML comment: no double hyphens in here. */
const INSTRUCTIONS = `
PLINTH3D PROJECT (file format version ${PROJECT_VERSION})

This SVG is a 3D project made with the Plinth3D app. The project itself is the
JSON inside <metadata id="${DATA_ID}"> below. The drawing is only a preview seen
from the camera (or from above): the app ignores it and rebuilds everything from the JSON.

If you are an AI assistant asked to change this project:
  * Change the JSON in the metadata. Then give back the WHOLE file (the drawing
    may stay as it was), so the user can save it as .svg and open it in Plinth3D.
    Giving back only the JSON, as a .json file, works too.
  * Do not change anything you were not asked to. Keep every existing id.

The JSON:
  * Units are millimetres, angles degrees. y is UP; the build plate is y = 0.
  * format: "${PROJECT_FORMAT}" and version: ${PROJECT_VERSION}. Leave them as they are.
  * name: the project's name (optional), also used as the file name.
  * layers: [{id, name, visible, locked}]. Hidden layers are left out of the result.
  * shapes: [{id, name, type, layerId, position, rotation, size, color, hole, ...}]
      type: box, cylinder, sphere, cone, pyramid, wedge, torus (or mesh, see below).
      layerId: the id of a layer that exists.
      position: [x, y, z] of the shape's centre. A shape resting on the plate has
        y = size[1] / 2.
      rotation: [x, y, z] in degrees, applied in XYZ order.
      size: [x, y, z] of the bounding box.
      color: "#rrggbb".
      hole: true to subtract the shape from the solids of the visible layers.
      hidden: true to keep the shape but leave it out (optional).
      edges: {vertical, top, bottom}, each {size, chamfer?}: rounded (or, with
        chamfer, flat) edges of boxes and cylinders (optional).
      sweep: degrees built, for cylinders, cones and tori (optional, default 360).
  * mesh shapes are made by merging other shapes: they carry a triangle mesh
    (mesh, baseSize, sources, sourcePosition). Do not edit those by hand; you may
    move, rename or delete them.

Rules:
  * New ids: any short text not used yet, for example "n1", "n2".
  * Every shape needs a layerId of an existing layer. Removing a layer means
    removing its shapes too. Keep at least one layer.
  * Valid JSON only: no comments, no trailing commas. Inside the metadata, write
    the characters & < > as &amp; &lt; &gt; (or leave them out).
`;

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

const num = (x: number) => +x.toFixed(2);

/** A point turned by the shape's rotation (degrees, XYZ order: z first, then y, then x). */
function rotate([x, y, z]: Vec3, [rx, ry, rz]: Vec3): Vec3 {
  const rad = Math.PI / 180;
  const [cz, sz] = [Math.cos(rz * rad), Math.sin(rz * rad)];
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  const [cy, sy] = [Math.cos(ry * rad), Math.sin(ry * rad)];
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  const [cx, sx] = [Math.cos(rx * rad), Math.sin(rx * rad)];
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  return [x, y, z];
}

/** The outline of a shape seen from above: its footprint, rotated, as x/z pairs. Round shapes use an ellipse. */
function outline(s: Shape): [number, number][] {
  const [w, h, d] = s.size;
  const round = s.type === 'cylinder' || s.type === 'sphere' || s.type === 'cone' || s.type === 'torus';
  const local: Vec3[] = round
    ? Array.from({ length: 24 }, (_, i) => [Math.cos((i / 24) * 2 * Math.PI) * w / 2, 0, Math.sin((i / 24) * 2 * Math.PI) * d / 2])
    : [[-w / 2, 0, -d / 2], [w / 2, 0, -d / 2], [w / 2, 0, d / 2], [-w / 2, 0, d / 2]];
  void h;
  return local.map((p) => {
    const r = rotate(p, s.rotation);
    return [s.position[0] + r[0], s.position[2] + r[2]];
  });
}

/** A picture of the 3D view as the user sees it, as a data URL. */
export interface ViewImage {
  href: string;
  width: number;
  height: number;
}

/** The project as an SVG file: the picture of the current view (or, without one, a top view of the visible shapes), and the project data in the metadata. */
export function projectToSvg(project: Project, view?: ViewImage): string {
  if (view) return wrap(project, `0 0 ${view.width} ${view.height}`, view.width, view.height, [`<image href="${view.href}" width="${view.width}" height="${view.height}"/>`], 'seen as it was when saved');
  return topView(project);
}

function topView(project: Project): string {
  const solids = visibleShapes(project);
  const shapes = solids.map((s) => ({ s, pts: outline(s) }));
  const all = shapes.flatMap((x) => x.pts);
  let minX = -50, maxX = 50, minZ = -50, maxZ = 50;
  if (all.length) {
    minX = Math.min(...all.map((p) => p[0]));
    maxX = Math.max(...all.map((p) => p[0]));
    minZ = Math.min(...all.map((p) => p[1]));
    maxZ = Math.max(...all.map((p) => p[1]));
  }
  const pad = Math.max(maxX - minX, maxZ - minZ, 10) * 0.05;
  minX -= pad; minZ -= pad; maxX += pad; maxZ += pad;
  const w = maxX - minX;
  const h = maxZ - minZ;
  const scale = 600 / Math.max(w, h);

  // lowest first, so what is higher is drawn on top
  const ordered = [...shapes].sort((a, b) => a.s.position[1] - b.s.position[1]);
  const body = ordered.map(({ s, pts }) => {
    const d = `M${pts.map((p) => `${num(p[0])},${num(p[1])}`).join('L')}Z`;
    const look = s.hole
      ? `fill="${xml(s.color)}" fill-opacity="0.15" stroke="${xml(s.color)}" stroke-dasharray="${num(1 / scale * 4)}"`
      : `fill="${xml(s.color)}" fill-opacity="0.85" stroke="#333"`;
    return `<path d="${d}" ${look} stroke-width="${num(1 / scale)}"><title>${xml(s.name)}</title></path>`;
  });

  return wrap(
    project,
    `${num(minX)} ${num(minZ)} ${num(w)} ${num(h)}`,
    Math.round(w * scale),
    Math.round(h * scale),
    [`<rect x="${num(minX)}" y="${num(minZ)}" width="${num(w)}" height="${num(h)}" fill="#fff"/>`, ...body],
    'seen from above'
  );
}

function wrap(project: Project, viewBox: string, width: number, height: number, drawing: string[], seen: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!--${INSTRUCTIONS}-->`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}" font-family="system-ui, sans-serif" stroke-linejoin="round">`,
    `<title>${project.name ? xml(project.name) : 'Plinth3D project'}</title>`,
    `<desc>3D project made with Plinth3D, ${seen}. The project data is the JSON in the metadata element; see the comment at the top of the file before editing it.</desc>`,
    `<metadata id="${DATA_ID}">`,
    xml(serializeProject(project)),
    '</metadata>',
    ...drawing,
    '</svg>',
    '',
  ].join('\n');
}

/** A project from a saved file: the SVG's metadata, or a plain JSON file. Throws with what is wrong. */
export function readProjectFile(text: string): Project {
  let json = text.trim();
  if (!json.startsWith('{')) {
    // not in a comment: the instructions talk about the metadata element too
    const m = text.replace(/<!--[\s\S]*?-->/g, '').match(new RegExp(`<metadata[^>]*id=["']${DATA_ID}["'][^>]*>([\\s\\S]*?)</metadata>`));
    if (!m) throw new Error(`No project data in this file (an SVG needs the <metadata id="${DATA_ID}"> that Plinth3D writes).`);
    json = m[1].trim();
    // also take a CDATA section, the other way to put JSON in XML
    const cdata = json.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
    json = cdata ? cdata[1] : unxml(json);
  }
  return parseProject(json);
}
