import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {
  ASSET_ARRIVAL_TARGET_DIAGONAL,
  assetArrivalViewDirection,
  assetArrivalFramingWindow,
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

test('arrival framing fits the asset points tightly inside an off-centre window', () => {
  // An L-shaped cloud: its box is much larger than its silhouette.
  const points = [];
  for (let i = 0; i <= 20; i++) { points.push(-0.4 + 0.04 * i, -0.85, 0.4); points.push(-0.4, -0.85 + 0.08 * i, -0.4); points.push(0.4, -0.85, -0.4 + 0.04 * i); }
  for (const aspect of [0.6, 1.4, 2.2]) {
    const window = assetArrivalFramingWindow({ overlayTopNdc: 0.73 });
    const framing = computeAssetArrivalFraming({ points, fovDeg: 40, aspect, window });
    const camera = new THREE.PerspectiveCamera(40, aspect, framing.near, framing.far);
    camera.position.fromArray(framing.position);
    camera.lookAt(new THREE.Vector3().fromArray(framing.target));
    camera.updateMatrixWorld();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < points.length; i += 3) {
      const ndc = new THREE.Vector3(points[i], points[i + 1], points[i + 2]).project(camera);
      assert.ok(ndc.z > -1 && ndc.z < 1, 'point inside clip depth');
      x0 = Math.min(x0, ndc.x); x1 = Math.max(x1, ndc.x); y0 = Math.min(y0, ndc.y); y1 = Math.max(y1, ndc.y);
    }
    const eps = 1e-9;
    assert.ok(x0 >= window.left - eps && x1 <= window.right + eps && y0 >= window.bottom - eps && y1 <= window.top + eps, `outside window at aspect ${aspect}: ${[x0, x1, y0, y1]}`);
    const xTight = Math.abs(x0 - window.left) < 1e-6 && Math.abs(x1 - window.right) < 1e-6;
    const yTight = Math.abs(y0 - window.bottom) < 1e-6 && Math.abs(y1 - window.top) < 1e-6;
    assert.ok(xTight || yTight, `fit is not tight at aspect ${aspect}: ${[x0, x1, y0, y1]}`);
    // The slack axis is centred in the linear fit, which perspective skews slightly.
    assert.ok(Math.abs((x0 + x1) / 2 - (window.left + window.right) / 2) < 0.02, `horizontally centred at aspect ${aspect}`);
    assert.ok(Math.abs((y0 + y1) / 2 - (window.bottom + window.top) / 2) < 0.02, `vertically centred at aspect ${aspect}`);
  }
});

test('arrival window clears an overlay at the top of the viewport', () => {
  assert.deepEqual(assetArrivalFramingWindow({ overlayTopNdc: 1 }), { left: -0.62, right: 0.62, bottom: -0.62, top: 0.62 });
  assert.equal(assetArrivalFramingWindow({ overlayTopNdc: 0.5 }).top, 0.45);
});
