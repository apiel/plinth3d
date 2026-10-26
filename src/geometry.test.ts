import { describe, expect, it } from 'vitest';
import { buildResult, encodeBinarySTL, loadEngine, localPrimitive, meshData, mergeShapes, modifiedStep } from './geometry';
import { createShape, createProject, type Shape } from './model';

function layerId(): string {
  return createProject().layers[0].id;
}

function box(size: [number, number, number], position: [number, number, number] = [0, 0, 0]): Shape {
  const shape = createShape('box', layerId(), []);
  shape.size = size;
  shape.position = position;
  return shape;
}

describe('geometry', () => {
  it('builds a box with the expected volume', async () => {
    const wasm = await loadEngine();
    const shape = box([10, 20, 30]);
    const result = buildResult(wasm, [shape])!;
    expect(result.volume()).toBeCloseTo(10 * 20 * 30, 3);
    result.delete();
  });

  it('places shapes at their position and rotation', async () => {
    const wasm = await loadEngine();
    const shape = box([10, 10, 10], [100, 0, 0]);
    shape.rotation = [0, 45, 0];
    const result = buildResult(wasm, [shape])!;
    const data = meshData(result);
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < data.positions.length; i += 3) {
      minX = Math.min(minX, data.positions[i]);
      maxX = Math.max(maxX, data.positions[i]);
    }
    expect(minX).toBeGreaterThan(90);
    expect(maxX).toBeLessThan(110);
    result.delete();
  });

  it('ignores holes until they are merged', async () => {
    const wasm = await loadEngine();
    const solid = box([20, 20, 20]);
    const hole = createShape('cylinder', layerId(), [solid]);
    hole.hole = true;
    hole.size = [10, 30, 10];
    const result = buildResult(wasm, [solid, hole])!;
    expect(result.volume()).toBeCloseTo(20 * 20 * 20, 3);
    result.delete();
  });

  it('merges solids and cuts holes into one mesh', async () => {
    const wasm = await loadEngine();
    const solid = box([20, 20, 20]);
    const hole = createShape('cylinder', layerId(), [solid]);
    hole.hole = true;
    hole.size = [10, 30, 10];
    hole.position = [0, 0, 0];
    const merged = mergeShapes(wasm, [solid, hole])!;
    // A cylinder of radius 5 and height 20 goes through the 20 mm box.
    const removed = Math.PI * 5 * 5 * 20;
    expect(merged.size).toEqual([20, 20, 20]);
    expect(merged.geometry.positions.length % 3).toBe(0);

    const shape: Shape = { ...solid, type: 'mesh', mesh: merged.geometry, baseSize: merged.size, hole: false };
    const volume = localPrimitive(wasm, shape);
    expect(volume.volume()).toBeCloseTo(20 * 20 * 20 - removed, -1);
    volume.delete();
  });

  it('scales a merged mesh when it is resized', async () => {
    const wasm = await loadEngine();
    const solid = box([10, 10, 10]);
    const merged = mergeShapes(wasm, [solid])!;
    const shape: Shape = { ...solid, type: 'mesh', mesh: merged.geometry, baseSize: merged.size, size: [20, 10, 10] };
    const scaled = localPrimitive(wasm, shape);
    expect(scaled.volume()).toBeCloseTo(20 * 10 * 10, 3);
    scaled.delete();
  });

  it('returns null when a merge has no solids', async () => {
    const wasm = await loadEngine();
    const hole = box([10, 10, 10]);
    hole.hole = true;
    expect(mergeShapes(wasm, [hole])).toBeNull();
  });

  it('writes a valid binary STL with the right triangle count', async () => {
    const wasm = await loadEngine();
    const result = buildResult(wasm, [box([20, 20, 20])])!;
    const data = meshData(result);
    const buffer = encodeBinarySTL(data);
    const triangles = new DataView(buffer).getUint32(80, true);
    expect(triangles).toBe(data.indices.length / 3);
    expect(buffer.byteLength).toBe(84 + triangles * 50);
    result.delete();
  });
});

describe('primitives', () => {
  const shapeOf = (type: 'cone' | 'pyramid' | 'wedge' | 'torus', size: [number, number, number]) => {
    const shape = createShape(type, createProject().layers[0].id, []);
    shape.size = size;
    return shape;
  };

  it('makes a cone with the volume of a cone', async () => {
    const wasm = await loadEngine();
    const cone = localPrimitive(wasm, shapeOf('cone', [20, 30, 20]));
    // r = 10, h = 30: pi * r^2 * h / 3. The 64-sided base is a little smaller than a circle.
    const ideal = (Math.PI * 100 * 30) / 3;
    expect(Math.abs(cone.volume() - ideal) / ideal).toBeLessThan(0.005);
    cone.delete();
  });

  it('makes a square pyramid', async () => {
    const wasm = await loadEngine();
    const pyramid = localPrimitive(wasm, shapeOf('pyramid', [20, 30, 20]));
    // 20 x 20 base, 30 high: base * height / 3.
    expect(pyramid.volume()).toBeCloseTo((20 * 20 * 30) / 3, 0);
    pyramid.delete();
  });

  it('makes a wedge that is half a box', async () => {
    const wasm = await loadEngine();
    const wedge = localPrimitive(wasm, shapeOf('wedge', [20, 20, 20]));
    expect(wedge.volume()).toBeCloseTo(20 * 20 * 20 / 2, 0);
    wedge.delete();
  });

  it('makes a torus that fills its size', async () => {
    const wasm = await loadEngine();
    const torus = localPrimitive(wasm, shapeOf('torus', [30, 10, 30]));
    const box = torus.boundingBox();
    expect(box.max[1] - box.min[1]).toBeCloseTo(10, 1);
    expect(box.max[0] - box.min[0]).toBeCloseTo(30, 1);
    // 2 * pi^2 * R * r^2 for R = 0.3 and r = 0.2 in unit size, scaled to 30 x 10 x 30.
    const expected = 2 * Math.PI * Math.PI * 0.3 * 0.2 * 0.2 * 2.5 * 30 * 10 * 30;
    expect(torus.volume()).toBeCloseTo(expected, -2);
    torus.delete();
  });
});

describe('rounded edges', () => {
  it('rounds one edge of a box by the quarter-round it removes', async () => {
    const wasm = await loadEngine();
    const shape = createShape('box', createProject().layers[0].id, []);
    shape.size = [20, 20, 20];
    // The edge along Z (axis 2) at +X, +Y, with radius 5.
    shape.rounds = [{ edge: '2:1:1', radius: 5 }];
    const rounded = localPrimitive(wasm, shape);
    // Each rounded edge removes r^2 - pi r^2 / 4 from the square section, along its 20 mm length.
    const removed = (25 - (Math.PI * 25) / 4) * 20;
    expect(Math.abs(rounded.volume() - (8000 - removed)) / 8000).toBeLessThan(0.01);
    rounded.delete();
  });

  it('leaves a box alone when no edge is rounded', async () => {
    const wasm = await loadEngine();
    const shape = createShape('box', createProject().layers[0].id, []);
    shape.size = [20, 20, 20];
    const box = localPrimitive(wasm, shape);
    expect(box.volume()).toBeCloseTo(8000, 2);
    box.delete();
  });
});



describe('edge and corner meeting', () => {
  it('keeps each edge at its own radius, even next to a rounded corner', async () => {
    const wasm = await loadEngine();
    const make = (edgeRadius: number) => {
      const shape = createShape('box', createProject().layers[0].id, []);
      shape.size = [20, 20, 20];
      shape.rounds = [
        { edge: '2:1:1', radius: edgeRadius },
        { edge: 'c:1:1:1', radius: 6 },
      ];
      return localPrimitive(wasm, shape);
    };
    const mismatched = make(4);
    const matched = make(6);
    expect(Math.abs(mismatched.volume() - matched.volume())).toBeGreaterThan(1);
    mismatched.delete();
    matched.delete();
  });

  it('runs a 3 mm edge at full depth into 5 mm corners, as one valid solid', async () => {
    const wasm = await loadEngine();
    const corners = [-1, 1].flatMap((x) =>
      [-1, 1].flatMap((y) => [-1, 1].map((z) => ({ edge: `c:${x}:${y}:${z}`, radius: 5 }))),
    );
    const make = (rounds: Shape['rounds']) => {
      const shape = createShape('box', createProject().layers[0].id, []);
      shape.size = [20, 20, 20];
      shape.rounds = rounds;
      return localPrimitive(wasm, shape);
    };
    const edge = { edge: '0:1:1', radius: 3 };
    const edgeOnly = make([edge]);
    const cornersOnly = make(corners);
    const both = make([...corners, edge]);
    // The edge takes its full cut between the corners: nearly all of what it removes on its own
    // (only the ends, where the corners already cut, overlap).
    const edgeCut = 8000 - edgeOnly.volume();
    const addedByEdge = cornersOnly.volume() - both.volume();
    expect(addedByEdge).toBeGreaterThan(edgeCut * 0.6);
    expect(addedByEdge).toBeLessThan(edgeCut * 1.05);
    expect(both.status()).toBe('NoError');
    edgeOnly.delete();
    cornersOnly.delete();
    both.delete();
  });

  it('meets two rounded edges that share a corner in a mitre, not a bulge', async () => {
    const wasm = await loadEngine();
    const shape = createShape('box', createProject().layers[0].id, []);
    shape.size = [20, 20, 20];
    // The edges along Z and along X, both at the top +X+Y+Z corner, with radius 5.
    shape.rounds = [
      { edge: '2:1:1', radius: 5 },
      { edge: '0:1:1', radius: 5 },
    ];
    const rounded = localPrimitive(wasm, shape);
    // Each edge removes the corner square minus its quarter-round; where they meet the removals overlap.
    // The ideal volume of the mitred result is about 7797.5 mm³.
    expect(Math.abs(rounded.volume() - 7797.5) / 7797.5).toBeLessThan(0.005);
    rounded.delete();
  });
});

describe('rounded corner alone', () => {
  it('takes a bit off the corner and keeps the rest of the box', async () => {
    const wasm = await loadEngine();
    const shape = createShape('box', createProject().layers[0].id, []);
    shape.size = [20, 20, 20];
    shape.rounds = [{ edge: 'c:1:1:1', radius: 6 }];
    const rounded = localPrimitive(wasm, shape);
    // More than the corner cube's volume is kept, less than the whole box.
    expect(rounded.volume()).toBeLessThan(8000);
    expect(rounded.volume()).toBeGreaterThan(8000 - 216);
    rounded.delete();
  });
});

describe('modifiedStep', () => {
  const keys = { ctrl: 0.5, shift: 5, alt: 'round' as number | 'round' };
  const held = (ctrl: boolean, shift: boolean, alt = false) => ({ ctrl, shift, alt });
  it('scales the step by the held keys', () => {
    expect(modifiedStep(1, keys, held(false, false))).toBe(1);
    expect(modifiedStep(1, keys, held(true, false))).toBe(0.5);
    expect(modifiedStep(1, keys, held(false, true))).toBe(5);
    expect(modifiedStep(2, keys, held(true, true))).toBe(5);
  });
  it('leaves the step alone for Alt while it is set to round mode, and scales it otherwise', () => {
    expect(modifiedStep(1, keys, held(false, false, true))).toBe(1);
    expect(modifiedStep(1, { ...keys, alt: 0.1 }, held(false, false, true))).toBe(0.1);
  });
  it('turns snapping off with a zero factor, and keeps it off when it already is', () => {
    expect(modifiedStep(1, { ...keys, ctrl: 0 }, held(true, false))).toBe(0);
    expect(modifiedStep(0, keys, held(false, true))).toBe(0);
  });
});

describe('sweep', () => {
  const volumeOf = async (type: Shape['type'], sweep?: number) => {
    const wasm = await loadEngine();
    const shape = createShape(type, 'layer', []);
    shape.size = [20, 10, 20];
    shape.sweep = sweep;
    const part = localPrimitive(wasm, shape);
    const volume = part.volume();
    const box = part.boundingBox();
    part.delete();
    return { volume, box };
  };

  it.each(['cylinder', 'cone', 'torus'] as const)('builds half a %s with half the volume', async (type) => {
    const whole = await volumeOf(type);
    const half = await volumeOf(type, 180);
    expect(half.volume / whole.volume).toBeCloseTo(0.5, 1);
  });

  it('builds a quarter and any other angle in proportion', async () => {
    const whole = await volumeOf('cylinder');
    expect((await volumeOf('cylinder', 90)).volume / whole.volume).toBeCloseTo(0.25, 1);
    expect((await volumeOf('cylinder', 120)).volume / whole.volume).toBeCloseTo(1 / 3, 1);
  });

  it('keeps a full sweep identical to no sweep', async () => {
    expect((await volumeOf('cylinder', 360)).volume).toBeCloseTo((await volumeOf('cylinder')).volume, 6);
  });
});
