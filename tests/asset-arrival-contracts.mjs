import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {
  ASSET_ARRIVAL_TARGET_DIAGONAL,
  assetArrivalViewDirection,
  computeAssetArrivalFraming,
  computeAssetArrivalPlacement,
  resolveAssetArrivalMode,
} from '../asset-arrival.mjs';

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);

function placedWorldBox(object) {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object, true);
}

function offCenterAsset({ rotationY = 0 } = {}) {
  // Authored far from the origin in centimetres, like a raw DCC export.
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(40, 120, 60));
  mesh.position.set(300, 80, -150);
  const root = new THREE.Group();
  root.add(mesh);
  root.rotation.y = rotationY;
  return root;
}

function arrive(root, options) {
  const box = placedWorldBox(root);
  const placement = computeAssetArrivalPlacement({
    bounds: { min: box.min.toArray(), max: box.max.toArray() },
    rootPosition: root.position.toArray(),
    ...options,
  });
  root.scale.multiplyScalar(placement.scale);
  root.position.fromArray(placement.position);
  return placement;
}

test('an off-center asset rests on the ground at the anchor with the shared size', () => {
  for (const rotationY of [0, 0.7]) {
    const root = offCenterAsset({ rotationY });
    const placement = arrive(root, { groundY: -0.85, anchor: [1.5, -2] });
    const box = placedWorldBox(root);
    close(box.min.y, -0.85, 'bottom on ground');
    close((box.min.x + box.max.x) / 2, 1.5, 'center x at anchor');
    close((box.min.z + box.max.z) / 2, -2, 'center z at anchor');
    close(box.getSize(new THREE.Vector3()).length(), ASSET_ARRIVAL_TARGET_DIAGONAL, 'diagonal');
    for (const axis of [0, 1, 2]) {
      close(placement.bounds.min[axis], box.min.getComponent(axis), 'predicted min');
      close(placement.bounds.max[axis], box.max.getComponent(axis), 'predicted max');
    }
  }
});

test('degenerate bounds do not place', () => {
  assert.equal(computeAssetArrivalPlacement({ bounds: { min: [1, 1, 1], max: [1, 1, 1] } }), null);
  assert.equal(computeAssetArrivalPlacement({ bounds: { min: [Infinity, 0, 0], max: [-Infinity, 0, 0] } }), null);
});

test('arrival mode follows clearing, and reopen-style raw loads have none', () => {
  assert.equal(resolveAssetArrivalMode({ cleared: true }), 'fresh');
  assert.equal(resolveAssetArrivalMode({ cleared: false }), 'append');
  assert.equal(resolveAssetArrivalMode({ cleared: true, normalize: false }), null);
  assert.equal(resolveAssetArrivalMode({ cleared: false, normalize: false, arrival: 'append' }), 'append');
  assert.equal(resolveAssetArrivalMode({ cleared: true, arrival: false }), null);
});

test('arrival view looks down at the asset from the front-right', () => {
  const [x, y, z] = assetArrivalViewDirection();
  close(Math.hypot(x, y, z), 1, 'unit direction');
  assert.ok(x > 0 && y > 0 && z > x, 'front-biased elevated three-quarter view');
});

test('arrival framing fits every corner inside the requested screen window and fills it', () => {
  const bounds = { min: [-0.42, -0.85, -0.45], max: [0.42, 0.74, 0.42] };
  for (const aspect of [0.6, 1.4, 2.2]) {
    const fill = 0.75;
    const framing = computeAssetArrivalFraming({ bounds, fovDeg: 40, aspect, fill });
    const camera = new THREE.PerspectiveCamera(40, aspect, framing.near, framing.far);
    camera.position.fromArray(framing.position);
    camera.lookAt(new THREE.Vector3().fromArray(framing.target));
    camera.updateMatrixWorld();
    let extent = 0;
    for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) {
      const ndc = new THREE.Vector3(x, y, z).project(camera);
      assert.ok(Math.abs(ndc.x) <= fill + 1e-9 && Math.abs(ndc.y) <= fill + 1e-9, `corner outside window at aspect ${aspect}: ${ndc.toArray()}`);
      assert.ok(ndc.z > -1 && ndc.z < 1, 'corner inside clip depth');
      extent = Math.max(extent, Math.abs(ndc.x), Math.abs(ndc.y));
    }
    close(extent, fill, `tight fit at aspect ${aspect}`);
  }
});
