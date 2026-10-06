import { scene, mesh } from '../../experiment-scene.mjs';
export default scene([
  mesh('floor', 'plane', { parameters: { width: 4, depth: 4 }, surface: { color: '#686d71' } }),
  mesh('red-block', 'box', { position: [-.8, .5, 0], surface: { color: '#b65349' } }),
  mesh('green-sphere', 'sphere', { position: [.8, .5, 0], surface: { color: '#59ad8b' } }),
], { activeObjectId: 'red-block' });
