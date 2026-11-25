import * as THREE from '../lib/three.webgpu.js';

export function createGripPressure({down = 1, forceDown = 2} = {}) {
  let active = false, normalized = null;
  return {
    start() { active = true; normalized = null; },
    sample(force) {
      if (!active || !Number.isFinite(force) || force < down) return false;
      normalized = Math.min(1, (force - down) / (forceDown - down));
      return true;
    },
    end() { active = false; normalized = null; },
    read() {
      return {
        active,
        source: normalized === null ? 'standard' : 'webkit-force',
        normalized,
        gain: normalized === null ? 1 : .5 + .75 * normalized,
      };
    },
  };
}

export function installGristTrackpadGrip({canvas, camera, grip, occluders, admit, move, setGain, changed}) {
  const document = canvas.ownerDocument, window = document.defaultView;
  const controller = new AbortController();
  const options = {capture:true, signal:controller.signal};
  const pressure = createGripPressure({
    down:window.MouseEvent.WEBKIT_FORCE_AT_MOUSE_DOWN,
    forceDown:window.MouseEvent.WEBKIT_FORCE_AT_FORCE_MOUSE_DOWN,
  });
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const plane = new THREE.Plane(), start = new THREE.Vector3(), hit = new THREE.Vector3();
  const originalPosition = new THREE.Vector3();
  let pointerId = null, suppressClick = false, previousCursor;
  const ray = event => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(2 * (event.clientX - rect.left) / rect.width - 1,
      1 - 2 * (event.clientY - rect.top) / rect.height);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray;
  };
  const onGrip = event => {
    if (event.target !== canvas || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || !admit()) return null;
    ray(event);
    grip.updateWorldMatrix(true, true);
    const gripHit = raycaster.intersectObject(grip, true)[0];
    if (!gripHit) return null;
    for (const mesh of occluders) {
      if (!mesh.visible) continue;
      mesh.updateWorldMatrix(true, false);
      const hit = raycaster.intersectObject(mesh, false)[0];
      if (hit && hit.distance < gripHit.distance) return null;
    }
    return gripHit.point;
  };
  const consume = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  function finish(event) {
    if (pointerId === null || (event?.pointerId !== undefined && event.pointerId !== pointerId)) return;
    const id = pointerId;
    pointerId = null;
    pressure.end();
    canvas.style.cursor = previousCursor;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    changed();
  }

  document.addEventListener('webkitmouseforcewillbegin', event => {
    if (pointerId !== null || onGrip(event)) event.preventDefault();
  }, options);
  document.addEventListener('pointerdown', event => {
    if (pointerId !== null || !event.isPrimary || event.pointerType !== 'mouse' || event.button !== 0) return;
    suppressClick = false;
    const point = onGrip(event);
    if (!point) return;
    canvas.setPointerCapture(event.pointerId);
    pointerId = event.pointerId;
    suppressClick = true;
    previousCursor = canvas.style.cursor;
    canvas.style.cursor = 'grabbing';
    camera.getWorldDirection(plane.normal);
    plane.setFromNormalAndCoplanarPoint(plane.normal, point);
    start.copy(point);
    originalPosition.copy(grip.position);
    pressure.start();
    setGain(pressure.read().gain);
    changed();
    // WebKit force events use mouse dispatch. Claim the drag without
    // canceling pointerdown, which can suppress compatibility mouse events.
    event.stopImmediatePropagation();
  }, options);
  document.addEventListener('pointermove', event => {
    if (event.pointerId !== pointerId) return;
    const point = ray(event).intersectPlane(plane, hit);
    if (point) move(point.sub(start).add(originalPosition));
    consume(event);
  }, options);
  document.addEventListener('pointerup', event => {
    if (event.pointerId !== pointerId || event.button !== 0) return;
    finish(event);
    consume(event);
  }, options);
  document.addEventListener('pointercancel', finish, options);
  canvas.addEventListener('lostpointercapture', finish, options);
  window.addEventListener('blur', finish, options);
  document.addEventListener('click', event => {
    if (suppressClick && event.target === canvas && event.detail > 0) {
      suppressClick = false;
      consume(event);
    }
  }, options);
  document.addEventListener('webkitmouseforcechanged', event => {
    if (!pressure.sample(event.webkitForce)) return;
    setGain(pressure.read().gain);
    changed();
  }, options);
  return {read:pressure.read, dispose() { controller.abort(); finish(); }};
}
