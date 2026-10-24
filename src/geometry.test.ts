import { describe, expect, it } from 'vitest';
import { buildResult, encodeBinarySTL, loadEngine, localPrimitive, meshData, mergeShapes } from './geometry';
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
