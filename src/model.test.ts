import { describe, expect, it } from 'vitest';
import { createProject, createShape, mergeProject, parseProject, serializeProject, visibleShapes } from './model';

describe('project model', () => {
  it('round-trips a project through JSON', () => {
    const project = createProject();
    project.shapes.push(createShape('sphere', project.layers[0].id, project.shapes));
    const restored = parseProject(serializeProject(project));
    expect(restored).toEqual(project);
  });

  it('rejects files that are not Plinth3D projects', () => {
    expect(() => parseProject('{"hello": 1}')).toThrow(/not a Plinth3D project/);
    expect(() => parseProject('not json')).toThrow(/not valid JSON/);
  });

  it('rejects shapes that point at unknown layers', () => {
    const project = createProject();
    const shape = createShape('box', 'missing', []);
    const text = serializeProject({ layers: project.layers, shapes: [shape] });
    expect(() => parseProject(text)).toThrow(/unknown layer/);
  });

  it('merges another project in with new ids, keeping its shapes on their layers', () => {
    const current = createProject();
    current.shapes.push(createShape('box', current.layers[0].id, current.shapes));
    const incoming = createProject();
    incoming.shapes.push(createShape('sphere', incoming.layers[0].id, incoming.shapes));
    const merged = mergeProject(current, incoming);
    expect(merged.layers).toHaveLength(2);
    expect(merged.shapes).toHaveLength(2);
    const added = merged.shapes[1];
    expect(added.id).not.toBe(incoming.shapes[0].id);
    expect(merged.layers.map((l) => l.id)).toContain(added.layerId);
    expect(added.layerId).not.toBe(current.layers[0].id);
    expect(merged.name).toBe(current.name);
  });

  it('hides shapes on hidden layers', () => {
    const project = createProject();
    const hidden = { id: 'h', name: 'Hidden', visible: false, locked: false };
    project.layers.push(hidden);
    project.shapes.push(createShape('box', project.layers[0].id, project.shapes));
    project.shapes.push(createShape('box', hidden.id, project.shapes));
    expect(visibleShapes(project)).toHaveLength(1);
  });
});
