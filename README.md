# Plinth3D

A browser-based, Tinkercad-style 3D modelling tool for designing objects to 3D print.
Shapes are combined with holes, and the result is exported as an STL file for your slicer.

**Status:** early MVP. Runs entirely in the browser; there is no server.

## Features

- Box, cylinder and sphere primitives. Click an icon in the toolbar to add one to the plan; it is selected straight away.
- Move with the arrow gizmo, or drag a shape's body. The Drag in XY / XZ / YZ buttons choose the plane a body drag moves in. XZ (across the plan) is the default.
- Step selector in the toolbar (Off, 0.1 to 10 mm) snaps moves, resizes and the arrows.
- While moving or resizing, a readout card follows the cursor. A move shows only the moving axes, with the distance moved and the distance from the plan centre. Type into it for an exact value.
- The edge you hover lightens, and the edge you press turns blue.
- An orange arrow starts beside the hovered edge and points along the axis it will move, in the direction it grows.
- Rename a shape by double-clicking its name in the layer list, or in the Name field of the Properties panel.
- Rotate with the rotate gizmo.
- Resize by dragging an edge of the dashed box around the selected shape. The edge changes one dimension at a time. Click the edge to switch between its two axes; the readout shows the one that is active. The opposite face stays in place. Each drag is one undo step.
- Light and dark themes, from the toolbar. Your choice is remembered.
- Holes: a shape marked as a hole is subtracted from all solids on visible layers.
- Layers, like Photoshop: show/hide, lock, rename, create and delete. Each shape belongs to one layer.
- Properties panel for exact size, position, rotation, colour, layer and hole flag.
- Undo (Ctrl+Z), clone (Ctrl+D), delete (Del), and clear the selection with Escape.
- Select several shapes with Shift+click, then Merge (Ctrl+G). The holes cut the solids, and the result becomes one object with one colour. It moves and resizes like a primitive. Undo (Ctrl+Z) brings the separate shapes back.
- Hole: a hole cuts the solids it is merged with. Until a merge, it has no effect.
- Result view: preview the combined model with holes cut.
- Export STL (binary, millimetres, Z-up for slicers).
- Save and open projects as `.json` files. The project also autosaves in your browser.

## Getting started

Requires Node.js 20 or newer.

```bash
npm install
npm run dev      # start the editor at http://localhost:5173
npm test         # run unit tests
npm run build    # type-check and build to dist/
```

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
      "color": "#4f8cff", "hole": false
    }
  ]
}
```

Units are millimetres. Rotations are degrees, applied in XYZ order. The app's Y axis is up.

## Roadmap

- Save and load projects to a GitHub repository, so each user can keep their designs in their own repo.
- More primitives and shape editing (for example, wedges and text).
- Each drag of the gizmo is one undo step. Number-field edits are one step per change.

## Licence

MIT. See [LICENSE](LICENSE).
