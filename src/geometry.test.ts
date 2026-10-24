import { describe, expect, it } from 'vitest';
import { buildResult, encodeBinarySTL, loadEngine, meshData } from './geometry';
import { createShape, createProject } from './model';

describe('geometry', () => {
  it('builds a box with the expected volume', async () => {
    const wasm = await loadEngine();
    const project = createProject();
    const box = createShape('box', project.layers[0].id, []);
    box.size = [10, 20, 30];
    const result = buildResult(wasm, [box])!;
    expect(result.volume()).toBeCloseTo(10 * 20 * 30, 3);
    result.delete();
  });

  it('subtracts holes from solids', async () => {
    const wasm = await loadEngine();
    const layerId = createProject().layers[0].id;
    const solid = createShape('box', layerId, []);
    solid.size = [20, 20, 20];
    const hole = createShape('cylinder', layerId, [solid]);
    hole.hole = true;
    hole.size = [10, 30, 10];
    const result = buildResult(wasm, [solid, hole])!;
    // A cylinder of radius 5 and height 20 inside the box (it stands through it).
    const removed = Math.PI * 5 * 5 * 20;
    expect(result.volume()).toBeCloseTo(20 * 20 * 20 - removed, -1);
    result.delete();
  });

  it('returns null when there are no solids', async () => {
    const wasm = await loadEngine();
    const layerId = createProject().layers[0].id;
    const hole = createShape('sphere', layerId, []);
    hole.hole = true;
    expect(buildResult(wasm, [hole])).toBeNull();
  });

  it('places shapes at their position and rotation', async () => {
    const wasm = await loadEngine();
    const layerId = createProject().layers[0].id;
    const box = createShape('box', layerId, []);
    box.size = [10, 10, 10];
    box.position = [100, 0, 0];
    box.rotation = [0, 45, 0];
    const result = buildResult(wasm, [box])!;
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

  it('writes a valid binary STL with the right triangle count', async () => {
    const wasm = await loadEngine();
    const layerId = createProject().layers[0].id;
    const box = createShape('box', layerId, []);
    const result = buildResult(wasm, [box])!;
    const data = meshData(result);
    const buffer = encodeBinarySTL(data);
    const triangles = new DataView(buffer).getUint32(80, true);
    expect(triangles).toBe(data.indices.length / 3);
    expect(buffer.byteLength).toBe(84 + triangles * 50);
    result.delete();
  });
});
