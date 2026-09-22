import {Vector2, Vector3, Quaternion, Matrix4, Spherical, Plane, Raycaster} from './lib/three.core.js';

const Y = new Vector3(0, 1, 0);
const finite = v => v.toArray().every(Number.isFinite);

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
  for (const root of roots.filter(Boolean)) {
    root.updateWorldMatrix(true, true);
    // A supplied child can have an invisible parent outside the supplied roots.
    let visible = true;
    for (let p = root; p; p = p.parent) if (!p.visible) visible = false;
    if (visible) root.traverseVisible(o => {
      if (o.isMesh && o.layers.test(camera.layers)) meshes.add(o);
    });
  }
  const hit = cast.intersectObjects([...meshes], false).find(hit => {
    const material = Array.isArray(hit.object.material)
      ? hit.object.material[hit.face.materialIndex] : hit.object.material;
    return material?.visible && (!material.transparent || material.opacity > 0);
  });
  const plane = new Plane().setFromNormalAndCoplanarPoint(forward, target);
  const point = hit?.point || cast.ray.intersectPlane(plane, new Vector3()) || target.clone();
  return {point, source: hit ? 'mesh-surface' : 'retained-depth', object: hit?.object.name || null};
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
  const toY = new Quaternion().setFromUnitVectors(camera.up.clone().normalize(), Y);
  const spherical = new Spherical().setFromVector3(camera.position.clone().sub(target).applyQuaternion(toY));
  spherical.theta += yaw;
  spherical.phi += pitch;
  spherical.makeSafe();
  const direction = new Vector3().setFromSpherical(spherical).applyQuaternion(toY.invert());
  const next = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(direction, new Vector3(), camera.up));
  const rotation = next.clone().multiply(camera.quaternion.clone().invert());
  camera.position.sub(pivot).applyQuaternion(rotation).add(pivot);
  target.sub(pivot).applyQuaternion(rotation).add(pivot);
  camera.quaternion.copy(next);
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
  camera.position.copy(target).addScaledVector(offset, next / distance);
  camera.updateMatrixWorld(true);
}

export function viewCamera(camera, target, direction) {
  const distance = camera.position.distanceTo(target);
  camera.position.copy(target).addScaledVector(direction.clone().normalize(), distance);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
}

const textInput = target => !!target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
const modeFor = e => e.shiftKey ? 'pan' : e.ctrlKey || e.metaKey ? 'dolly' : 'orbit';
const take = e => { e.preventDefault(); e.stopImmediatePropagation(); };

export function installSceneNavigation({canvas, viewport, camera, controls, roots, frameAll, gizmo = null,
  blocked = () => false, status = () => {}, document = globalThis.document, window = globalThis.window}) {
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
  const pose = () => ({position:camera.position.clone(), target:controls.target.clone()});
  const finish = cancel => {
    if (!gesture) return;
    const old = gesture;
    gesture = null;
    if (cancel) {camera.position.copy(old.before.position); controls.target.copy(old.before.target); changed();}
    if (canvas.hasPointerCapture(old.pointerId)) canvas.releasePointerCapture(old.pointerId);
    if (old.gizmo) {gizmo.enabled = old.gizmo.enabled; gizmo.getHelper().visible = old.gizmo.visible;}
    controls.dispatchEvent({type:'end'});
    status('');
  };
  listen(canvas, 'pointerenter', () => hover = true);
  listen(canvas, 'pointerleave', () => hover = false);
  listen(canvas, 'pointerdown', e => {
    if (e.button !== 1 || e.pointerType === 'touch') return;
    take(e); // Browser autoscroll and OrbitControls must never also acquire MMB.
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
  listen(canvas, 'auxclick', e => {if (e.button === 1) take(e);});
  listen(canvas, 'wheel', e => {
    take(e);
    if (gesture || !permitted()) return;
    // Wheel is a discrete depth-aware zoom. The offset never moves toward the cursor.
    sample(e);
    const pixels = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1);
    zoomCamera(camera, controls.target, Math.exp(pixels * .0015));
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
    if (action) {take(e); action(); changed();}
  }, true);
  return {
    state: () => ({gesture:gesture?.mode || null, depth:lastDepth, position:camera.position.toArray(), target:controls.target.toArray(), fov:camera.fov, projection:'perspective', autoDepth:true, zoomToMouse:false}),
    cancel: () => finish(true),
    dispose: () => {finish(true); for (const dispose of disposers) dispose();},
  };
}
