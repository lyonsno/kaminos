import {BufferAttribute, Vector2, Vector3, Quaternion, Plane, Raycaster} from './lib/three.core.js';
import {MeshBVH, acceleratedRaycast} from './node_modules/three-mesh-bvh/build/index.module.js';

const Y = new Vector3(0, 1, 0);
const finite = v => v.toArray().every(Number.isFinite);
const depthIndexes = new WeakMap();
const originalRaycasts = new WeakMap();
const jobs = new Map();
let worker = null, nextJobId = 0;

function indexWorker() {
  if (!globalThis.Worker) return null;
  if (worker) return worker;
  worker = new Worker(new URL('./navigation-bvh.worker.bundle.mjs', import.meta.url), {type: 'module'});
  worker.onmessage = ({data}) => {
    const job = jobs.get(data.id);
    if (!job) return;
    jobs.delete(data.id);
    data.error ? job.reject(new Error(data.error)) : job.resolve(data);
  };
  worker.onerror = error => {
    for (const job of jobs.values()) job.reject(new Error(error.message || 'navigation index worker failed'));
    jobs.clear();
    worker.terminate();
    worker = null;
  };
  return worker;
}

function buildNavigationIndex(geometry) {
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  let builder;
  try { builder = indexWorker(); }
  catch (error) { return Promise.reject(error); }
  if (!builder) return globalThis.document
    ? Promise.reject(new Error('navigation index worker unavailable'))
    : Promise.resolve(new MeshBVH(geometry, {indirect: true}));
  const id = ++nextJobId;
  return new Promise((resolve, reject) => {
    jobs.set(id, {resolve, reject});
    const positionCopy = position.array.slice(), indexCopy = index?.array.slice() || null;
    try {
      builder.postMessage({id, position: positionCopy, index: indexCopy,
        groups: geometry.groups.map(({start, count, materialIndex}) => ({start, count, materialIndex}))},
      [positionCopy.buffer, indexCopy?.buffer].filter(Boolean));
    } catch (error) {
      jobs.delete(id);
      reject(error);
    }
  });
}

function useIndexedRaycast(mesh) {
  if (!originalRaycasts.has(mesh)) originalRaycasts.set(mesh, {
    own: Object.hasOwn(mesh, 'raycast'), method: mesh.raycast,
  });
  mesh.raycast = acceleratedRaycast;
}

function restoreRaycast(mesh) {
  const original = originalRaycasts.get(mesh);
  if (!original) return;
  if (original.own) mesh.raycast = original.method;
  else delete mesh.raycast;
  originalRaycasts.delete(mesh);
}

export function prepareNavigationGeometry(root) {
  const pending = [];
  root.traverse(object => {
    if (!object.isMesh || object.isSkinnedMesh || object.morphTargetInfluences?.length) return;
    const geometry = object.geometry;
    if (!geometry?.getAttribute('position') || geometry.getAttribute('position').isInterleavedBufferAttribute) return;
    let entry = depthIndexes.get(geometry);
    if (!entry) {
      const position = geometry.getAttribute('position');
      const index = geometry.index;
      const positionVersion = position.version, indexVersion = index?.version;
      entry = {status: 'building', meshes: new Set(), promise: null, error: null};
      depthIndexes.set(geometry, entry);
      entry.promise = buildNavigationIndex(geometry).then(result => {
        if (depthIndexes.get(geometry) !== entry) return false;
        if (geometry.getAttribute('position') !== position || (index !== null && geometry.index !== index)
          || position.version !== positionVersion || index?.version !== indexVersion) {
          throw new Error('navigation geometry changed during indexing');
        }
        let tree = result;
        if (result?.roots) {
          if (!geometry.index) geometry.setIndex(new BufferAttribute(result.index, 1));
          tree = MeshBVH.deserialize(result, geometry, {setIndex: false});
        }
        geometry.boundsTree = tree;
        entry.status = 'indexed';
        for (const mesh of entry.meshes) useIndexedRaycast(mesh);
        return true;
      }).catch(error => {
        entry.status = 'failed';
        entry.error = error.message;
        console.error('Navigation depth indexing failed:', error);
        return false;
      });
    }
    entry.meshes.add(object);
    if (entry.status === 'indexed') useIndexedRaycast(object);
    pending.push(entry.promise);
  });
  return Promise.all(pending);
}

export function invalidateNavigationGeometry(root) {
  root.traverse(object => {
    if (!object.isMesh || !object.geometry) return;
    const geometry = object.geometry;
    const entry = depthIndexes.get(geometry);
    if (!entry) return;
    depthIndexes.delete(geometry);
    entry.status = 'invalidated';
    geometry.boundsTree = null;
    for (const mesh of entry.meshes) restoreRaycast(mesh);
  });
  return prepareNavigationGeometry(root);
}

// Visible triangles only: a splat's bounds or the flame's simulation box are
// not surfaces. The caller supplies authored geometry, burner and ground.
export function navigationPivot(camera, target, ndc, roots) {
  camera.updateMatrixWorld(true);
  const cast = new Raycaster();
  cast.setFromCamera(ndc, camera);
  const forward = camera.getWorldDirection(new Vector3());
  const cosine = cast.ray.direction.dot(forward);
  cast.near = camera.near / cosine;
  cast.far = camera.far / cosine;
  const meshes = new Set();
  let indexing = false;
  for (const root of roots.filter(Boolean)) {
    root.updateWorldMatrix(true, true);
    // A supplied child can have an invisible parent outside the supplied roots.
    let visible = true;
    for (let p = root; p; p = p.parent) if (!p.visible) visible = false;
    if (visible) root.traverseVisible(o => {
      if (o.isMesh && o.layers.test(camera.layers)) {
        if (depthIndexes.get(o.geometry)?.status === 'building') indexing = true;
        else meshes.add(o);
      }
    });
  }
  const candidates = (indexing ? [] : [...meshes]).filter(mesh => {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    return materials.some(material => material?.visible && (!material.transparent || material.opacity > 0));
  });
  cast.firstHitOnly = candidates.every(mesh => {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    return materials.every(material => material?.visible && (!material.transparent || material.opacity > 0));
  });
  const hit = cast.intersectObjects(candidates, false).find(hit => {
    const material = Array.isArray(hit.object.material)
      ? hit.object.material[hit.face.materialIndex] : hit.object.material;
    return material?.visible && (!material.transparent || material.opacity > 0);
  });
  const plane = new Plane().setFromNormalAndCoplanarPoint(forward, target);
  const point = hit?.point || cast.ray.intersectPlane(plane, new Vector3()) || target.clone();
  return {point, source: hit ? 'mesh-surface' : indexing ? 'indexing-depth' : 'retained-depth', object: hit?.object.name || null};
}

export function adoptNavigationDepth(camera, target, point) {
  const forward = camera.getWorldDirection(new Vector3());
  const depth = point.clone().sub(camera.position).dot(forward);
  if (!finite(point) || !Number.isFinite(depth) || depth <= camera.near) return false;
  // Change working depth, never the camera pose or the direction of zoom.
  target.copy(camera.position).addScaledVector(forward, depth);
  return true;
}

export function orbitCamera(camera, target, pivot, yaw, pitch) {
  // Pitch around the screen's horizontal axis, without a spherical pole stop.
  // Carry screen-up through the turn so the shared controls' lookAt preserves
  // the view after passing over the top or underneath the object.
  const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const rotation = new Quaternion().setFromAxisAngle(Y, yaw)
    .multiply(new Quaternion().setFromAxisAngle(right, pitch));
  camera.position.sub(pivot).applyQuaternion(rotation).add(pivot);
  target.sub(pivot).applyQuaternion(rotation).add(pivot);
  camera.quaternion.premultiply(rotation).normalize();
  camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
  camera.updateMatrixWorld(true);
}

export function panCamera(camera, target, dx, dy, height) {
  const perPixel = 2 * camera.position.distanceTo(target) * Math.tan(camera.fov * Math.PI / 360) / camera.zoom / height;
  const shift = new Vector3(-dx * perPixel, dy * perPixel, 0).applyQuaternion(camera.quaternion);
  camera.position.add(shift);
  target.add(shift);
  camera.updateMatrixWorld(true);
}

export function zoomCamera(camera, target, factor) {
  if (!Number.isFinite(factor) || factor <= 0) return;
  const offset = camera.position.clone().sub(target);
  const distance = offset.length();
  // Camera clipping, not an arbitrary scene-size wall, bounds approach.
  const next = Math.max(camera.near * 2, distance * factor);
  if (!Number.isFinite(next) || distance === 0) return;
  // Retain the current scene's clipping headroom as the eye moves farther
  // from its working pivot. This keeps a saved dolly view from discarding
  // geometry that was visible before the gesture.
  if (next > distance) {
    const farMargin = Math.max(camera.near, camera.far - distance);
    camera.far = Math.max(camera.far, next + farMargin);
    camera.updateProjectionMatrix();
  }
  camera.position.copy(target).addScaledVector(offset, next / distance);
  camera.updateMatrixWorld(true);
}

export function viewCamera(camera, target, direction) {
  const distance = camera.position.distanceTo(target);
  camera.position.copy(target).addScaledVector(direction.clone().normalize(), distance);
  camera.up.set(0, 1, 0);
  if (Math.abs(direction.y) === direction.length()) camera.up.set(0, 0, -Math.sign(direction.y));
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
}

const textInput = target => !!target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
const modeFor = e => e.shiftKey ? 'pan' : e.ctrlKey || e.metaKey ? 'dolly' : 'orbit';
const take = e => { e.preventDefault(); e.stopImmediatePropagation(); };

export function installSceneNavigation({canvas, viewport, camera, controls, roots, frameAll, frameSelected = () => {}, gizmo = null,
  inputMode = () => 'mouse', blocked = () => false, status = () => {}, document = globalThis.document, window = globalThis.window}) {
  let gesture = null, hover = false, lastDepth = null;
  const listen = (node, type, fn, options) => {
    node.addEventListener(type, fn, options);
    disposers.push(() => node.removeEventListener(type, fn, options));
  };
  const disposers = [];
  const permitted = () => controls.enabled && !blocked();
  const changed = () => { controls.minDistance = camera.near * 2; controls.update(); camera.updateMatrixWorld(true); };
  const sample = e => {
    const rect = canvas.getBoundingClientRect();
    const ndc = new Vector2(2 * (e.clientX - rect.left) / rect.width - 1, 1 - 2 * (e.clientY - rect.top) / rect.height);
    const pivot = navigationPivot(camera, controls.target, ndc, roots());
    adoptNavigationDepth(camera, controls.target, pivot.point);
    lastDepth = {point:pivot.point.toArray(), source:pivot.source, object:pivot.object};
    return pivot.point;
  };
  const pose = () => ({position:camera.position.clone(), target:controls.target.clone(), up:camera.up.clone()});
  const finish = cancel => {
    if (!gesture) return;
    const old = gesture;
    gesture = null;
    if (cancel) {camera.position.copy(old.before.position); controls.target.copy(old.before.target); camera.up.copy(old.before.up); changed();}
    if (canvas.hasPointerCapture(old.pointerId)) canvas.releasePointerCapture(old.pointerId);
    if (old.gizmo) {gizmo.enabled = old.gizmo.enabled; gizmo.getHelper().visible = old.gizmo.visible;}
    controls.dispatchEvent({type:'end'});
    status('');
  };
  listen(canvas, 'pointerenter', () => hover = true);
  listen(canvas, 'pointerleave', () => hover = false);
  listen(canvas, 'pointerdown', e => {
    if (![1, 2].includes(e.button) || e.pointerType === 'touch') return;
    // The viewport's capture handler owns modal transform cancellation before
    // this canvas handler. Otherwise RMB and MMB share the same navigation.
    take(e);
    if (gesture || !permitted()) return;
    const before = pose(), pivot = sample(e);
    gesture = {pointerId:e.pointerId, x:e.clientX, y:e.clientY, mode:modeFor(e), pivot, before};
    if (gizmo) {
      gesture.gizmo = {enabled:gizmo.enabled, visible:gizmo.getHelper().visible};
      gizmo.enabled = false; gizmo.axis = null; gizmo.getHelper().visible = false;
    }
    canvas.setPointerCapture(e.pointerId);
    controls.dispatchEvent({type:'start'});
    status(`${gesture.mode === 'orbit' ? 'Orbit' : gesture.mode === 'pan' ? 'Pan' : 'Dolly'} · Auto depth · Esc cancel`);
  }, true);
  listen(canvas, 'pointermove', e => {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    take(e);
    if (!permitted()) {finish(true); return;}
    const mode = modeFor(e);
    if (mode !== gesture.mode) {gesture.mode = mode; gesture.pivot = sample(e);}
    const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
    if (mode === 'orbit') orbitCamera(camera, controls.target, gesture.pivot, -dx * .005, -dy * .005);
    else if (mode === 'pan') panCamera(camera, controls.target, dx, dy, canvas.clientHeight);
    else zoomCamera(camera, controls.target, Math.exp(dy * .01));
    gesture.x = e.clientX; gesture.y = e.clientY;
    changed();
  }, true);
  listen(canvas, 'pointerup', e => {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    take(e); finish(false);
  }, true);
  for (const type of ['pointercancel', 'lostpointercapture']) listen(canvas, type, e => {
    if (gesture?.pointerId === e.pointerId) finish(true);
  });
  listen(window, 'blur', () => finish(true));
  listen(canvas, 'auxclick', e => {if ([1, 2].includes(e.button)) take(e);});
  listen(canvas, 'contextmenu', take);
  listen(canvas, 'wheel', e => {
    take(e);
    if (gesture || !permitted()) return;
    // Browsers deliver a trackpad glide as wheel input, not a middle-button drag.
    // Units and integer/fractional deltas cannot reliably identify the device.
    const mode = inputMode() === 'trackpad' ? modeFor(e) : 'dolly';
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
    const dx = (e.deltaX || 0) * unit, dy = e.deltaY * unit;
    const pivot = sample(e);
    // Scroll deltas describe content displacement opposite to pointer motion.
    // Each packet completes immediately; no click, capture or idle timer needed.
    if (mode === 'orbit') orbitCamera(camera, controls.target, pivot, dx * .005, dy * .005);
    else if (mode === 'pan') panCamera(camera, controls.target, -dx, -dy, canvas.clientHeight);
    else zoomCamera(camera, controls.target, Math.exp(dy * .0015));
    changed();
  }, {capture:true, passive:false});
  listen(document, 'keydown', e => {
    if (gesture) {take(e); if (e.key === 'Escape') finish(true); return;}
    if (e.defaultPrevented || textInput(e.target) || textInput(document.activeElement)
      || !(hover || viewport.contains(document.activeElement)) || !permitted() || e.metaKey || e.altKey) return;
    const code = e.code;
    const sign = e.ctrlKey ? -1 : 1;
    let action;
    // Kaminos is Y-up: front +Z, right +X, top +Y. Cardinal views keep perspective.
    if (code === 'Numpad1') action = () => viewCamera(camera, controls.target, new Vector3(0,0,sign));
    else if (code === 'Numpad3') action = () => viewCamera(camera, controls.target, new Vector3(sign,0,0));
    else if (code === 'Numpad7') action = () => viewCamera(camera, controls.target, new Vector3(0,sign,0));
    else if ((e.ctrlKey || e.shiftKey) && ['Numpad4','Numpad6','Numpad8','Numpad2'].includes(code)) action = () => {
      const pixels = canvas.clientHeight * .1;
      panCamera(camera, controls.target, code === 'Numpad4' ? pixels : code === 'Numpad6' ? -pixels : 0,
        code === 'Numpad8' ? pixels : code === 'Numpad2' ? -pixels : 0, canvas.clientHeight);
    };
    else if (!e.ctrlKey && ['Numpad4','Numpad6','Numpad8','Numpad2','Numpad9'].includes(code)) action = () => {
      const step = Math.PI / 12;
      orbitCamera(camera, controls.target, controls.target.clone(),
        code === 'Numpad4' ? -step : code === 'Numpad6' ? step : code === 'Numpad9' ? Math.PI : 0,
        code === 'Numpad8' ? -step : code === 'Numpad2' ? step : 0);
    };
    else if (!e.ctrlKey && ['NumpadAdd','NumpadSubtract'].includes(code)) action = () => zoomCamera(camera, controls.target, code === 'NumpadAdd' ? 1/1.2 : 1.2);
    else if (!e.ctrlKey && code === 'Home') action = frameAll;
    else if (!e.ctrlKey && !e.shiftKey && (e.key.toLowerCase() === 'f' || code === 'NumpadDecimal')) action = frameSelected;
    if (action) {take(e); action(); changed();}
  }, true);
  return {
    prepare: prepareNavigationGeometry,
    invalidate: invalidateNavigationGeometry,
    indexState: () => {
      const geometries = new Set();
      for (const root of roots().filter(Boolean)) root.traverse(object => {
        if (object.isMesh && object.geometry) geometries.add(object.geometry);
      });
      const result = {indexed: 0, building: 0, failed: 0, unprepared: 0};
      for (const geometry of geometries) result[depthIndexes.get(geometry)?.status || 'unprepared']++;
      return result;
    },
    state: () => ({gesture:gesture?.mode || null, inputMode:inputMode(), depth:lastDepth, position:camera.position.toArray(), target:controls.target.toArray(), up:camera.up.toArray(), near:camera.near, far:camera.far, fov:camera.fov, projection:'perspective', autoDepth:true, zoomToMouse:false}),
    cancel: () => finish(true),
    dispose: () => {finish(true); for (const dispose of disposers) dispose();},
  };
}
