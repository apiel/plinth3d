# Plinth3D

A browser-based, Tinkercad-style 3D modelling tool for designing objects to 3D print.
Shapes are combined with holes, and the result is exported as an STL file for your slicer.

**Status:** early MVP. Runs entirely in the browser; there is no server.

## Features

- Box, cylinder and sphere primitives. Pick one, then click the plan (or the top of a shape) to place it. Esc or right-click cancels.
- Move and rotate gizmos (snapping to 1 mm and 15°).
- Light and dark themes, from the toolbar. Your choice is remembered.
- Holes: a shape marked as a hole is subtracted from all solids on visible layers.
- Layers, like Photoshop: show/hide, lock, rename, create and delete. Each shape belongs to one layer.
- Properties panel for exact size, position, rotation, colour, layer and hole flag.
- Undo (Ctrl+Z), duplicate (Ctrl+D), delete (Del), and select with Escape.
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
