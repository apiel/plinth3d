import { describe, expect, it } from 'vitest';
import { createProject, createShape } from './model';
import { projectToSvg, readProjectFile } from './projectfile';

describe('project file', () => {
  it('round-trips through svg', () => {
    const p = createProject();
    p.name = 'A <&> b';
    p.shapes.push(createShape('box', p.layers[0].id, []), createShape('cylinder', p.layers[0].id, []));
    const back = readProjectFile(projectToSvg(p));
    expect(back.name).toBe(p.name);
    expect(back.shapes).toEqual(p.shapes);
  });
  it('still reads plain json', () => {
    const p = createProject();
    expect(readProjectFile(JSON.stringify({ format: 'plinth3d', version: 1, ...p })).layers).toEqual(p.layers);
  });
});
