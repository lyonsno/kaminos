import { scene, mesh, water } from '../../experiment-scene.mjs';

export default scene([
  water('left-source', { position: [-.35, .4, -1.65], rotation: [Math.atan2(.25, 1), 0, 0] }),
  water('right-source', { position: [.65, .65, -1.4], rotation: [Math.atan2(.4, 1), -.2, 0] }),
  mesh('red-marker', 'box', { position: [-1.4, .25, .4], parameters: { width: .2, height: .5, depth: .2 }, surface: { color: '#bc5349' } }),
], { activeObjectId: 'left-source', activeFieldId: 'water-field', provenance: { kind: 'experiment', source: 'examples/experiments/two-emitters.mjs' } });

// Static context marks space; collision uses the liquid host's analytical basin.
export const layoutOptions = { regions: [{ id: 'inspection-region', min: [-2, -.5, -2], max: [2, 1, 2] }] };
