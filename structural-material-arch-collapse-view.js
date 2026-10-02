import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createElement, Pause, Play, RotateCcw, ZoomIn, ZoomOut } from 'lucide';
import { createArchCollapse, coarsenArchProfile, ARCH_COLLAPSE_ROUTE } from './structural-material-arch-collapse.js';

const profilePath = './artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/intact-profile.json';
const status = document.querySelector('#status'), receipt = document.querySelector('#receipt');
const params = new URLSearchParams(location.search);
const smoke = params.get('smoke') === '1';
const scene = new THREE.Scene(); scene.background = new THREE.Color('#101717');
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.03, 100);
camera.position.set(5.4, 3.2, 8.3);
camera.position.multiplyScalar(Math.max(1, 0.85 / camera.aspect));
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(devicePixelRatio); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.querySelector('#viewport').append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, -0.25, 0); controls.enableDamping = false;
controls.update();
scene.add(new THREE.HemisphereLight(0xe1f7ea, 0x263334, 2));
const key = new THREE.DirectionalLight(0xffedcf, 3); key.position.set(-4, 8, 5);
key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.1, far: 25 });
key.shadow.bias = -0.0002; scene.add(key);
const materials = [0xc0c5c4, 0xb0b8b7, 0xaebfba, 0x98a6a4, 0xc8cdca, 0xa5b0ac].map(color =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.94 }));
const pinnedMaterial = new THREE.MeshStandardMaterial({ color: 0x687c88, roughness: 0.9 });
const crackMaterial = new THREE.MeshStandardMaterial({ color: 0xbc4b32, roughness: 1 });
const outlineMaterial = new THREE.LineBasicMaterial({ color: 0xeebc67 });
const grip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff8759, depthTest: false }));
grip.renderOrder = 10; grip.visible = false; scene.add(grip);
const tether = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xe1b567, depthTest: false }));
tether.renderOrder = 9; tether.visible = false; scene.add(tether);
let model, meshes = [], geometry, floor, mode = 'shear', paused = smoke, grab = null, lastTime = performance.now(), simulationRate = 1;
let modelConfig;
let edges;
let source, profile, latestStepCost = 0, phase = 'loading', bindCount = 0;
let lastPick = null;
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
const toThree = value => new THREE.Vector3(value.x, value.y, value.z);
function icon(node, definition) { node.replaceChildren(createElement(definition)); }
function pauseIcon() { const button = document.querySelector('#pause'); icon(button, paused ? Play : Pause); button.title = button.ariaLabel = paused ? 'Resume' : 'Pause'; }
icon(document.querySelector('#reset'), RotateCcw); pauseIcon();
icon(document.querySelector('#zoom-in'), ZoomIn); icon(document.querySelector('#zoom-out'), ZoomOut);
function zoom(factor) { camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target); controls.update(); synchronize(); }
document.querySelector('#zoom-in').onclick = () => zoom(1/1.2);
document.querySelector('#zoom-out').onclick = () => zoom(1.2);
function rebuild() {
  if (model) model.dispose();
  for (const mesh of meshes) scene.remove(mesh);
  geometry?.dispose(); meshes = [];
  model = createArchCollapse(profile, { strength: Number(document.querySelector('#strength').value) });
  const initial = model.snapshot(); modelConfig = initial.config;
  const { dx, dy, dz } = initial.dimensions;
  geometry = new THREE.BoxGeometry(dx * 0.98, dy * 0.98, dz * 0.98);
  edges?.dispose(); edges = new THREE.EdgesGeometry(geometry);
  meshes = model.cells.map(cell => {
    const mesh = new THREE.Mesh(geometry, cell.pinned ? Array(6).fill(pinnedMaterial) : [...materials]);
    mesh.userData.index = cell.index; mesh.castShadow = true; mesh.receiveShadow = true;
    const outline = new THREE.LineSegments(edges, outlineMaterial);
    outline.visible = false; mesh.add(outline); mesh.userData.outline = outline;
    scene.add(mesh); return mesh;
  });
  if (!floor) {
    floor = new THREE.Mesh(new THREE.PlaneGeometry(22, 18), new THREE.MeshStandardMaterial({ color: 0x33393b, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = model.snapshot().floorY - 0.003;
    floor.receiveShadow = true; scene.add(floor);
  }
  grab = null; controls.enabled = true; lastTime = performance.now(); bindCount = 0;
  synchronize();
}
function synchronize() {
  for (const cell of model.cells) {
    const mesh = meshes[cell.index]; mesh.position.copy(cell.body.position); mesh.quaternion.copy(cell.body.quaternion);
    if (!cell.pinned) mesh.material = [...materials];
    mesh.userData.outline.visible = Boolean(grab?.indices.includes(cell.index));
  }
  for (const bond of model.bonds) if (!bond.alive) {
    const axis = bond.normal.x ? 0 : bond.normal.y ? 1 : 2;
    const face = axis * 2;
    if (!model.cells[bond.a].pinned) meshes[bond.a].material[face] = crackMaterial;
    if (!model.cells[bond.b].pinned) meshes[bond.b].material[face + 1] = crackMaterial;
  }
  if (grab) {
    const world = model.cells[grab.index].body.pointToWorldFrame(grab.local);
    grip.position.copy(world); grip.visible = tether.visible = true;
    const positions = tether.geometry.attributes.position;
    positions.setXYZ(0, world.x, world.y, world.z); positions.setXYZ(1, grab.target.x, grab.target.y, grab.target.z); positions.needsUpdate = true;
  } else { grip.visible = tether.visible = false; }
  const broken = model.bonds.filter(bond => !bond.alive).length;
  status.textContent = `${broken} broken · ${bindCount} bound`;
  receipt.textContent = `${model.cells.length} blocks · ${grab ? `${grab.indices.length}-block grip` : 'surface contact'} · ${paused ? 'paused' : `live ${simulationRate.toFixed(2)}x`} · ${latestStepCost.toFixed(1)} ms/step`;
  scene.updateMatrixWorld(true); renderer.render(scene, camera);
}
function advance(count) {
  if (!Number.isInteger(count) || count < 0) throw new Error('advance count must be a nonnegative integer');
  for (let i = 0; i < count; i++) {
    const start = performance.now(); model.step(); latestStepCost = performance.now() - start;
    if (grab && mode === 'bind') bindCount += model.bind(grab.index).length;
  }
  synchronize();
}
function ray(event) {
  camera.updateMatrixWorld(true);
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
  raycaster.setFromCamera(pointer, camera); return raycaster.ray;
}
renderer.domElement.addEventListener('pointerdown', event => {
  if (phase !== 'interactive' || event.button !== 0) return;
  ray(event);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  lastPick = hit ? { index: hit.object.userData.index, layer: model.cells[hit.object.userData.index].layer,
    point: hit.point.toArray(), screen: { x: event.clientX, y: event.clientY } } : { hit: false, screen: { x: event.clientX, y: event.clientY } };
  if (!hit) return;
  const cell = model.cells[hit.object.userData.index];
  if (cell.pinned || !model.isExposedFace(cell.index, hit.face.normal)) return;
  event.stopImmediatePropagation(); event.preventDefault(); controls.enabled = false;
  renderer.domElement.setPointerCapture(event.pointerId);
  const local = model.worldToLocalPoint(cell.index, hit.point);
  const normal = new THREE.Vector3(); camera.getWorldDirection(normal);
  grab = { index: cell.index, local, target: hit.point.clone(), plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.point), pointerId: event.pointerId };
  model.setSurfaceHand(cell.index, grab.target, local, hit.face.normal);
  grab.indices = model.snapshot().hand.indices;
  if (mode === 'bind') bindCount += model.bind(cell.index).length;
  synchronize();
}, true);
renderer.domElement.addEventListener('pointermove', event => {
  if (!grab || event.pointerId !== grab.pointerId) return;
  const target = ray(event).intersectPlane(grab.plane, new THREE.Vector3());
  if (!target) return;
  grab.target.copy(target); model.moveHand(target);
  event.stopImmediatePropagation(); event.preventDefault(); synchronize();
}, true);
function release(event) {
  if (!grab || event && event.pointerId !== grab.pointerId) return;
  if (mode === 'bind') bindCount += model.bind(grab.index).length;
  model.release(); grab = null; controls.enabled = true; synchronize();
}
renderer.domElement.addEventListener('pointerup', release, true);
renderer.domElement.addEventListener('pointercancel', release, true);
renderer.domElement.addEventListener('lostpointercapture', release, true);
for (const name of ['shear', 'bind']) document.querySelector(`#${name}`).onclick = () => {
  release(); mode = name;
  for (const other of ['shear', 'bind']) document.querySelector(`#${other}`).setAttribute('aria-pressed', String(other === mode));
};
document.querySelector('#pause').onclick = () => { paused = !paused; lastTime = performance.now(); pauseIcon(); synchronize(); };
document.querySelector('#reset').onclick = rebuild;
document.querySelector('#strength').onchange = event => {
  if (!event.target.validity.valid) return;
  model.setStrength(Number(event.target.value)); synchronize();
};
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); synchronize();
});
document.addEventListener('visibilitychange', () => { lastTime = performance.now(); });
function frame(now) {
  const elapsed = (now - lastTime) / 1000; lastTime = now;
  if (model && !paused && !document.hidden) {
    // The measured 10-17ms physics cost makes a render-paced simulation clock preferable to an unbounded catch-up loop.
    simulationRate = elapsed > 0 ? modelConfig.timeStep / elapsed : 1;
    advance(1);
  }
  controls.update(); if (model) synchronize(); requestAnimationFrame(frame);
}
try {
  const response = await fetch(profilePath); if (!response.ok) throw new Error(`profile HTTP ${response.status}`);
  source = await response.json(); profile = coarsenArchProfile(source, 14, 10);
  if (params.has('strength')) document.querySelector('#strength').value = params.get('strength');
  rebuild(); phase = 'interactive';
  const project = point => { const p = toThree(point).project(camera); return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 }; };
  function targets() {
    const result = [], normals = [new THREE.Vector3(1,0,0),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,-1,0),new THREE.Vector3(0,0,1),new THREE.Vector3(0,0,-1)];
    for (const cell of model.cells) {
      if (cell.pinned) continue;
      for (const normal of normals) {
        if (!model.isExposedFace(cell.index, normal)) continue;
        const local = new THREE.Vector3(normal.x * cell.half.x, normal.y * cell.half.y, normal.z * cell.half.z);
        const point = meshes[cell.index].localToWorld(local), projected = project(point);
        raycaster.setFromCamera(new THREE.Vector2(projected.x / innerWidth * 2 - 1, 1 - projected.y / innerHeight * 2), camera);
        const hit = raycaster.intersectObjects(meshes, false)[0];
        result.push({ index: cell.index, id: cell.id, column: cell.column, row: cell.row, layer: cell.layer,
          normal: normal.toArray(), world: { x: point.x, y: point.y, z: point.z }, screen: projected,
          visible: hit?.object.userData.index === cell.index && hit.point.distanceTo(point) < 0.001 });
      }
    }
    return result;
  }
  function pixels() {
    renderer.render(scene, camera);
    const gl = renderer.getContext(), size = new THREE.Vector2(); renderer.getDrawingBufferSize(size);
    const bytes = new Uint8Array(size.x * size.y * 4); gl.readPixels(0, 0, size.x, size.y, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    let bright = 0; for (let i = 0; i < bytes.length; i += 4) if ((bytes[i] + bytes[i+1] + bytes[i+2]) / 3 > 110) bright++;
    return { bright, total: size.x * size.y, fraction: bright / (size.x * size.y), glError: gl.getError() };
  }
  window.__archCollapse = {
    advance, reset: rebuild, release: () => { release(); model.release(); synchronize(); },
    projectWorld: project,
    setHand: (index, target) => { const cell = model.cells[index]; model.setHand(index, target, { x: 0, y: 0, z: cell.half.z }); },
    bind: index => model.bind(index),
    witness: () => {
      const surfaces = targets();
      return { phase, route: ARCH_COLLAPSE_ROUTE, effectiveUrl: location.href,
      profilePath, constructionSource: profile.constructionSource, source: source.source,
      viewport: { width: innerWidth, height: innerHeight }, paused, mode, lastPick, clock: { kind: 'one-fixed-physics-step-per-render-frame', simulationRate }, camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray() },
      state: model.snapshot(), rendererPoses: meshes.map(mesh => ({ index: mesh.userData.index, position: mesh.position.toArray(), quaternion: mesh.quaternion.toArray() })),
      pixels: pixels(), surfaceTargets: surfaces,
      pickTargets: surfaces.filter(item => item.layer === 2 && item.normal[2] === 1),
    }; },
  };
  requestAnimationFrame(frame);
} catch (error) { phase = 'failed'; status.textContent = 'Startup failed'; document.querySelector('#error').textContent = error.stack || error.message; console.error(error); }
