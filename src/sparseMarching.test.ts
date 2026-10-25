import { describe, expect, it } from 'vitest';
import { loadEngine } from './geometry';
import { polygonizeNearSurface } from './sparseMarching';

describe('sparse marching cubes', () => {
  it('turns a sphere into a closed solid of the right volume', async () => {
    const wasm = await loadEngine();
    const radius = 5;
    const mesh = polygonizeNearSurface((x, y, z) => Math.hypot(x, y, z) - radius, [6, 6, 6], 0.2);
    const solid = new wasm.Manifold(new wasm.Mesh({ numProp: 3, vertProperties: mesh.vertices, triVerts: mesh.triangles }));
    expect(solid.status()).toBe('NoError');
    const expected = (4 / 3) * Math.PI * radius ** 3;
    expect(Math.abs(solid.volume() - expected) / expected).toBeLessThan(0.01);
    solid.delete();
  });

  it('builds nothing when the surface is outside the box', () => {
    const mesh = polygonizeNearSurface((x, y, z) => 100 - Math.hypot(x, y, z) * 0 + x * 0 + y * 0 + z * 0, [3, 3, 3], 0.25);
    expect(mesh.triangles.length).toBe(0);
  });
});
