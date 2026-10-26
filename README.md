# Plinth3D

**A browser-based, Tinkercad-style 3D modeller for designing things to 3D print.**
Build with simple shapes, cut with holes, round the edges, and export an STL for your slicer.
Everything runs in your browser: there is no server and no account.

**[Try it live](https://apiel.github.io/plinth3d/)**

![Plinth3D: a plinth with a column, a ball and a wedge](docs/screenshots/hero.png)

> **Status:** early MVP. Expect rough edges, and please report what you find.

## Why Plinth3D

- **Simple.** Add shapes with one click, move them with arrows, resize them by dragging a face, or type exact millimetres.
- **Made for printing.** Units are millimetres, exports are binary STL in Z-up for slicers, and holes are real cuts.
- **Layers, like Photoshop.** Show, hide, lock and rename layers. Export a layer and import it into another project.
- **Private.** Your projects stay in your browser and in `.json` files you save yourself.

## A quick tour

### Combine shapes, cut with holes

Mark a shape as a hole, select it together with a solid, and press **Merge** (`G`). The holes cut the solids and the result becomes one object that moves and resizes like a primitive. **Unmerge** (`U`) brings the original shapes back.

![A block with a bore and a slot cut out of it](docs/screenshots/holes.png)

### Round edges and corners, sanded smooth

With a box not selected, hover an edge or a corner. It lights up. Click it and set the radius in the small window that opens; the shape updates as you type. Zero makes it square again.

Edges and corners are blended where they meet, the way a piece of wood looks after you sand the edge and then work the corner a bit more.

![A block with rounded corners and one rounded edge](docs/screenshots/rounded.png)

### Light and dark

Switch themes from the toolbar. Your choice is remembered.

![Plinth3D in the light theme](docs/screenshots/light.png)

## Features

**Shapes**
- Box, cylinder, sphere, cone, pyramid, wedge and torus. Click an icon in the toolbar to add one to the plan; it is selected straight away.
- Round the edges and corners of a box (see above).
- Merge shapes into one object, and unmerge them again.
- Holes: a shape marked as a hole is subtracted from the solids it is merged with.

**Moving and resizing**
- Move with the arrow gizmo, or drag a shape's body. The Drag in XY / XZ / YZ buttons choose the plane a body drag moves in. XZ (across the plan) is the default.
- Rotate with the rotate gizmo.
- Resize by dragging an edge of the dashed box around the selected shape. The edge changes one dimension at a time. Click the edge to switch between its two axes. The opposite face stays in place.
- Step selector in the toolbar (Off, 0.1 to 10 mm) snaps moves, resizes and the arrows.
- While moving or resizing, a readout card follows the cursor. Type into it for an exact value.
- Shift + drag on empty space draws a rectangle that adds the shapes inside it to the selection.
- Properties panel for exact size, position, rotation, colour, layer and hole flag.

**Layers and projects**
- Layers: show/hide, lock, rename, create and delete. Each shape belongs to one layer.
- Hide a shape with its eye button. Hidden shapes are left out of the scene, the result and the export.
- Rename a shape by double-clicking its name in the layer list.
- Export a layer with its ⤓ button, and import a layer file with the Import button. An imported layer is added as a new layer.
- Save and open projects as `.json` files. The project also autosaves in your browser.
- Undo (`Ctrl+Z`), clone (`Ctrl+D`), delete (`Del`), and clear the selection with `Esc`.

**Output**
- Result view: preview the combined model with holes cut.
- Export STL (binary, millimetres, Z-up for slicers).

## Getting started

Requires Node.js 20 or newer.

```bash
npm install
npm run dev      # start the editor at http://localhost:5173
npm test         # run unit tests
npm run build    # type-check and build to dist/
```

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| B / C / S / K / P / D / T | Add a box / cylinder / sphere / cone / pyramid / wedge / torus to the plan |
| M / R | Move / rotate tool |
| G | Merge the selection (Ctrl+G also works) |
| U | Unmerge: bring back the shapes a merged object was made from |
| H | Hole: toggle the selection as a hole |
| Ctrl+A | Select all visible shapes |
| Ctrl+D | Clone |
| Ctrl+Z | Undo |
| Del | Delete |
| Esc | Clear the selection |

The shortcut letter is underlined in each label, and icon buttons show it in the corner.

## How it works

- The editor is React and three.js. The geometry (merging, holes, the STL result) uses the [Manifold](https://github.com/elalish/manifold) engine, compiled to WebAssembly.
- Rounded boxes are described as a signed distance field ([`src/roundedSdf.ts`](src/roundedSdf.ts)), turned into a mesh by a marching-cubes pass that only looks near the surface ([`src/sparseMarching.ts`](src/sparseMarching.ts)), and then simplified so flat faces stay as a few triangles. Each rounded edge and corner is one term of the field, and the terms are blended with a smooth maximum, which is what gives the sanded look.
- A rounded box takes about a second to build the first time. The result is cached, so selecting and moving shapes stays instant.

## Project file format

Projects are plain JSON, so they are easy to diff and version-control:

```json
{
  "format": "plinth3d",
  "version": 1,
  "layers": [{ "id": "...", "name": "Layer 1", "visible": true, "locked": false }],
  "shapes": [
    {
      "id": "...", "name": "Box 1", "type": "box", "layerId": "...",
      "position": [0, 10, 0], "rotation": [0, 0, 0], "size": [20, 20, 20],
      "color": "#4f8cff", "hole": false,
      "rounds": [{ "edge": "2:1:1", "radius": 2 }, { "edge": "c:1:1:1", "radius": 5 }]
    }
  ]
}
```

Units are millimetres. Rotations are degrees, applied in XYZ order. The app's Y axis is up.

`rounds` is optional. An edge key is `along:signA:signB`: the axis the edge runs along (0 = X, 1 = Y, 2 = Z) and which side of the other two axes it sits on. A corner key is `c:sx:sy:sz`, with each sign `1` or `-1`.

## Roadmap

- Save and load projects to a GitHub repository, so each user can keep their designs in their own repo.
- More primitives and shape editing (for example, text).
- Faster first build of rounded boxes with many rounds.

## Licence

MIT. See [LICENSE](LICENSE).
