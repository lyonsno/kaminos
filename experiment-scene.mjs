import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildSceneDocument } from './scene-persistence-core.js';
import { checkedProceduralMesh, createProceduralMesh } from './scene-geometry.mjs';
import { createLocalLiquidEmitterSceneRecord, createLocalLiquidEmitterObject } from './local-liquid-scene-object.mjs';
import { defaultLocalLiquidSetup } from './local-liquid-setup.mjs';

const identity = () => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
export function mesh(id, kind, { parameters = {}, surface = {}, ...pose } = {}) {
  return checkedProceduralMesh({ id, label: id, fileName: id, type: 'procedural-mesh', source: 'kaminos:geometry',
    geometry: { kind, parameters }, surface, transform: { ...identity(), ...pose } });
}
export function water(id, { settings, ...pose } = {}) {
  return createLocalLiquidEmitterSceneRecord({ id, label: id, settings, transform: { ...identity(), ...pose } });
}
export function scene(objects, options = {}) {
  if (new Set(objects.map(o => o.id)).size !== objects.length) throw Error('Scene object IDs must be unique');
  return buildSceneDocument({ ...options, objects,
    localLiquid: objects.some(o => o.type === 'local-liquid-emitter') ? (options.localLiquid || defaultLocalLiquidSetup()) : options.localLiquid });
}

function checkedBounds(bounds) {
  if (!bounds || !['min', 'max'].every(k => Array.isArray(bounds[k]) && bounds[k].length === 3 && bounds[k].every(Number.isFinite))
    || bounds.min.some((n, i) => n > bounds.max[i])) throw Error('Finite ordered layout bounds required');
  return new THREE.Box3(new THREE.Vector3(...bounds.min), new THREE.Vector3(...bounds.max));
}

// CPU geometry and caller-supplied asset bounds use the same authored poses as
// the editor. Caller bounds remain explicitly identified in the result.
export function layout(document, { assetBounds = {}, regions = [] } = {}) {
  const objects = document.objects.map(record => {
    let object, dispose = () => {}, representation;
    if (record.type === 'procedural-mesh') {
      const created = createProceduralMesh(THREE, mergeGeometries, record.geometry, record.surface);
      object = created.group; dispose = created.dispose; representation = 'procedural-geometry-bounds';
    } else if (record.type === 'local-liquid-emitter') {
      object = createLocalLiquidEmitterObject(THREE, record).object; representation = 'emitter-handle-bounds';
      dispose = () => object.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    } else if (assetBounds[record.id]) {
      object = new THREE.Object3D(); representation = 'caller-supplied-asset-bounds';
    } else throw Error(`Supply layout bounds for ${record.id} (${record.type})`);
    try {
      object.position.fromArray(record.transform.position); object.rotation.fromArray(record.transform.rotation);
      object.scale.fromArray(record.transform.scale); object.updateMatrixWorld(true);
      // Groups are editing frames; persisted member poses already use world TRS.
      const matrix = object.matrixWorld.clone();
      // Derive local geometry bounds before applying the complete authored transform.
      object.position.set(0, 0, 0); object.rotation.set(0, 0, 0); object.scale.set(1, 1, 1); object.updateMatrixWorld(true);
      const box = assetBounds[record.id] && representation === 'caller-supplied-asset-bounds'
        ? checkedBounds(assetBounds[record.id]) : new THREE.Box3().setFromObject(object);
      box.applyMatrix4(matrix.clone());
      return { id: record.id, representation, min: box.min.toArray(), max: box.max.toArray() };
    } finally { dispose(); }
  });
  for (const region of regions) { checkedBounds(region); objects.push({ ...region, representation: 'caller-supplied-region' }); }
  if (!objects.length) throw Error('Layout needs at least one object or region');
  return objects;
}

export function viewsAround(objects, { directions = [
  { name: 'front', direction: [0, .4, 1] }, { name: 'back', direction: [0, .4, -1] },
  { name: 'left', direction: [-1, .5, 0] }, { name: 'right', direction: [1, .5, 0] },
  { name: 'overhead', direction: [0, 1, .01] }, { name: 'three-quarter', direction: [1, .8, 1] },
], aspect = 1, fov = 40 } = {}) {
  if (!(Number.isFinite(aspect) && aspect > 0 && Number.isFinite(fov) && fov > 0 && fov < 180)) throw Error('Valid camera aspect and field of view required');
  const bounds = new THREE.Box3(); for (const object of objects) bounds.union(checkedBounds(object));
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = bounds.getSize(new THREE.Vector3()).length() / 2;
  if (!(radius > 0 && Number.isFinite(radius))) throw Error('Layout extent must be positive');
  const halfAngle = Math.min(fov * Math.PI / 360, Math.atan(Math.tan(fov * Math.PI / 360) * aspect));
  const distance = radius / Math.sin(halfAngle) * 1.1;
  return directions.map(({ name, direction }) => {
    if (!Array.isArray(direction) || direction.length !== 3 || !direction.every(Number.isFinite) || !direction.some(n => n !== 0)) throw Error('Camera direction must be finite and nonzero');
    return { name, position: new THREE.Vector3(...direction).normalize().multiplyScalar(distance).add(center).toArray(),
      target: center.toArray(), up: [0, 1, 0], fov, aspect, near: Math.max(radius / 1000, .0001), far: distance + radius * 3 };
  });
}
const corners = box => Array.from({ length: 8 }, (_, i) => new THREE.Vector3(...[0, 1, 2].map(axis => box[(i >> axis) & 1 ? 'max' : 'min'][axis])));
export function projectLayout(objects, view) {
  const camera = new THREE.PerspectiveCamera(view.fov, view.aspect, view.near, view.far);
  camera.position.fromArray(view.position); camera.up.fromArray(view.up); camera.lookAt(new THREE.Vector3(...view.target)); camera.updateMatrixWorld(true);
  return objects.map(object => ({ ...object, points: corners(object).map(point => point.project(camera).toArray()) }));
}
const xml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
export function layoutSheet(objects, views) {
  if (!views.length) throw Error('Choose at least one layout view');
  const width = 440, height = 440, columns = Math.min(3, views.length), rows = Math.ceil(views.length / columns);
  const colors = ['#25a39a', '#d46a55', '#8970ca', '#397eb8', '#aaa137'];
  const panels = views.map((view, index) => {
    const drawn = projectLayout(objects, view).map((object, oi) => {
      const points = object.points.map(p => [(p[0] + 1) * 195 + 25, (1 - p[1]) * 175 + 45]);
      const lines = points.flatMap((a, i) => [1, 2, 4].filter(bit => !(i & bit)).map(bit => {
        const b = points[i | bit]; return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`;
      })).join('');
      return `<g stroke="${colors[oi % colors.length]}" stroke-width="1.5">${lines}</g>`;
    }).join('');
    return `<g transform="translate(${(index % columns) * width},${Math.floor(index / columns) * height})"><rect x="1" y="1" width="438" height="438" fill="#fafbfc" stroke="#d2d6dc"/><text x="18" y="27" font-size="17">${xml(view.name)}</text>${drawn}</g>`;
  }).join('');
  const legend = objects.map((o, i) => `<text x="18" y="${rows * height + 65 + i * 23}" fill="${colors[i % colors.length]}" font-size="14">${xml(o.id)}: ${xml(o.representation)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${columns * width}" height="${rows * height + 90 + objects.length * 23}" font-family="sans-serif" fill="#20262b"><rect width="100%" height="100%" fill="white"/>${panels}<text x="18" y="${rows * height + 30}" font-size="16">CPU authored layout bounds</text>${legend}</svg>`;
}
