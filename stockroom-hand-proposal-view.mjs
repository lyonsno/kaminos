import * as T from './lib/three.core.js';
import {createHandProposal} from './stockroom-hand-proposal.mjs';

// MANO surface tips, also used by WiLoR's extra-joint regressor.
const THUMB = 744, INDEX = 320;
const MAX_CAPTURE_AGE_MS = 1000;
const HEIGHT = .52, DEPTH = .42;

export async function installHandProposal({host, session, placeView, isPlaceEditing, record}) {
  const doc = host.controls.document;
  const win = doc.defaultView;
  const canvas = host.scene.renderer().domElement;
  const camera = host.scene.camera();
  const navigation = host.scene.navigation();
  const fixture = new T.Group();
  fixture.name = 'Loose wood proposal';
  fixture.userData.kaminosEditorOnly = true;
  const box = new T.BoxGeometry(1, .19, DEPTH);
  const wood = new T.MeshStandardMaterial({color: 0xb77946, roughness: .74});
  const piece = new T.Mesh(box, wood);
  piece.castShadow = piece.receiveShadow = true;
  fixture.add(piece);
  const outline = new T.LineSegments(new T.EdgesGeometry(box),
    new T.LineBasicMaterial({color: 0xf3c28a}));
  piece.add(outline);
  const handle = new T.Mesh(new T.SphereGeometry(.075, 12, 8),
    new T.MeshBasicMaterial({color: 0xffdfad}));
  fixture.add(handle);
  await session.attach(fixture, {owned: true, presentation: true});

  const proposal = createHandProposal({
    position: [.72, HEIGHT, 2.45], rotation: [0, 0, 0, 1], width: 1.1,
  });
  const hud = doc.createElement('div');
  hud.dataset.handProposal = '';
  hud.style.cssText = 'position:absolute;pointer-events:none;z-index:7;transform:translate(-50%,8px);padding:4px 7px;background:#251c13e8;color:#ffe9cc;border-radius:3px;font:12px system-ui;white-space:nowrap';
  const cursor = doc.createElement('div');
  cursor.style.cssText = 'position:absolute;pointer-events:none;z-index:7;width:12px;height:12px;box-sizing:border-box;border:2px solid #ffdb9f;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 3px #332013';
  canvas.parentElement.append(hud, cursor);

  const plane = new T.Plane(new T.Vector3(0, 1, 0), -HEIGHT);
  let drag = null, lastFrame = null, previousCamera = '', signal = null;
  let signature = '', previousStatus = '', consumedPress = null;
  const listeners = [];
  function listen(target, type, fn, capture = false) {
    target.addEventListener(type, fn, capture);
    listeners.push(() => target.removeEventListener(type, fn, capture));
  }
  function rayFor(ndc) {
    const ray = new T.Raycaster();
    ray.setFromCamera(ndc, camera);
    return ray;
  }
  function xy(x, y) {
    const rect = canvas.getBoundingClientRect();
    return new T.Vector2(2 * (x - rect.left) / rect.width - 1, 1 - 2 * (y - rect.top) / rect.height);
  }
  function screen(world) {
    const rect = canvas.getBoundingClientRect();
    const p = world.clone().project(camera);
    return {x: rect.left + (p.x + 1) * rect.width / 2,
      y: rect.top + (1 - p.y) * rect.height / 2, visible: p.z >= -1 && p.z <= 1};
  }
  function hit(ray) {
    fixture.updateMatrixWorld(true);
    const cover = ray.intersectObjects(placeView.hostTargets(), false)[0]?.distance ?? Infinity;
    const target = ray.intersectObjects(handle.visible ? [piece, handle] : [piece], false)[0];
    return target && target.distance < cover ? target.object : null;
  }
  function trackingBlocked() {
    return navigation.state().gesture || win.kaminosSceneEdits?.state().active || isPlaceEditing();
  }
  function emit(action, observation) {
    record?.({kind: 'stockroom-hand-proposal.' + action, target: 'loose-wood',
      effective: proposal.read(), observation});
  }
  function render() {
    const state = proposal.read();
    const {position, rotation, width} = state.pose;
    const key = JSON.stringify(state);
    if (key !== signature) {
      signature = key;
      fixture.position.fromArray(position);
      fixture.quaternion.fromArray(rotation);
      piece.scale.x = width;
      handle.position.set(width / 2, .13, 0);
      handle.visible = state.mode !== 'held';
      outline.material.color.set(state.holding || state.armed ? 0xffeead : 0xac8052);
      fixture.updateMatrixWorld(true);
      session.redraw();
    }
    const parent = canvas.parentElement.getBoundingClientRect();
    const label = screen(fixture.localToWorld(new T.Vector3(0, -.1, DEPTH / 2)));
    const rect = canvas.getBoundingClientRect();
    hud.hidden = !label.visible || label.x < rect.left || label.x > rect.right ||
      label.y < rect.top || label.y > rect.bottom;
    hud.style.left = (label.x - parent.left) + 'px';
    hud.style.top = (label.y - parent.top) + 'px';
    const message = state.holding ? 'Open to park' : state.mode === 'pointer' ? 'Editing wood' :
      state.armed ? 'Pinch to pick up' : state.nominated ? 'Open, then pinch to pick up' : 'Loose wood';
    if (message !== previousStatus) hud.textContent = previousStatus = message;
    cursor.hidden = !signal;
    if (signal) {
      cursor.style.left = (rect.left - parent.left + (signal.x + 1) * rect.width / 2) + 'px';
      cursor.style.top = (rect.top - parent.top + (1 - signal.y) * rect.height / 2) + 'px';
    }
  }

  function onFrame() {
    camera.updateMatrixWorld();
    const view = camera.matrixWorld.elements.join(',') + '|' + camera.projectionMatrix.elements.join(',');
    const hands = win.kaminosHands;
    const status = hands?.read();
    const before = proposal.read();
    if (trackingBlocked() || previousCamera !== view) {
      proposal.suspend();
      signal = null;
      // Do not rebase from a sample captured under the moving camera.
      lastFrame = status?.last ?? null;
    } else if (!status?.enabled || !status.last || status.lastAgeMs > MAX_CAPTURE_AGE_MS) {
      proposal.observe([]);
      signal = null;
    } else if (status.last !== lastFrame) {
      lastFrame = status.last;
      const [width, height] = lastFrame.imageSize;
      const observations = [];
      signal = null;
      for (const hand of lastFrame.hands) {
        const palm = hands.palmFrame(hand.handedness);
        const box = hand.detection?.bbox;
        const vertices = hand.verticesMeters;
        if (!palm || !width || !height || !box?.every(Number.isFinite)) continue;
        const ndc = new T.Vector2(1 - (box[0] + box[2]) / width, 1 - (box[1] + box[3]) / height);
        const ray = rayFor(ndc);
        const point = ray.ray.intersectPlane(plane, new T.Vector3());
        if (!point) continue;
        if (before.holding === hand.handedness || !signal) signal = ndc;
        const gap = Math.hypot(...[0, 1, 2].map(axis => vertices[3 * THUMB + axis] - vertices[3 * INDEX + axis])) / palm.width;
        const frame = camera.getWorldQuaternion(new T.Quaternion()).multiply(palm.quaternion);
        observations.push({side: hand.handedness, gap, point, frame,
          eligible: hit(ray) === piece});
      }
      proposal.observe(observations);
      const after = proposal.read();
      if (after.mode !== before.mode || after.armed !== before.armed) {
        emit(after.mode, {captureId: lastFrame.captureId, frameId: lastFrame.frameId,
          effectiveModel: status.effectiveModel, hands: observations.map(h => ({
            side: h.side, gap: h.gap, eligible: h.eligible,
          }))});
      }
    }
    previousCamera = view;
    render();
  }

  const pointer = event => rayFor(xy(event.clientX, event.clientY));
  const containsPointer = event => !!hit(pointer(event));
  const stop = event => {event.preventDefault(); event.stopImmediatePropagation();};
  listen(win, 'pointerdown', () => {consumedPress = null;}, true);
  listen(win, 'click', event => {
    if (consumedPress !== null && event.pointerId === consumedPress) {
      consumedPress = null;
      stop(event);
    }
  }, true);
  listen(canvas.parentElement, 'pointerdown', event => {
    if (event.target !== canvas || event.button !== 0 || event.shiftKey || trackingBlocked()) return;
    const ray = pointer(event);
    const target = hit(ray);
    if (!target) return;
    const pose = proposal.read().pose;
    const origin = ray.ray.intersectPlane(plane, new T.Vector3());
    if (!origin) return;
    const a = screen(fixture.localToWorld(new T.Vector3(0, .13, 0)));
    const b = screen(fixture.localToWorld(new T.Vector3(1, .13, 0)));
    if (target === handle && Math.hypot(b.x - a.x, b.y - a.y) < 1) return;
    drag = {id: event.pointerId, x: event.clientX, y: event.clientY, pose, origin,
      width: target === handle, dx: b.x - a.x, dy: b.y - a.y, moved: false, view: previousCamera};
    proposal.beginPointer();
    consumedPress = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    emit('pointer-takeover');
    stop(event);
    render();
  }, true);
  listen(win, 'pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    const d = drag;
    stop(event);
    if (trackingBlocked() || d.view !== previousCamera) {
      endDrag(false);
      return;
    }
    const x = event.clientX - d.x, y = event.clientY - d.y;
    if (!d.moved && Math.hypot(x, y) < 3) return;
    d.moved = true;
    if (d.width) {
      const delta = 2 * (x * d.dx + y * d.dy) / (d.dx * d.dx + d.dy * d.dy);
      proposal.refine({width: Math.max(.16, d.pose.width + delta)});
    } else {
      const point = pointer(event).ray.intersectPlane(plane, new T.Vector3());
      if (point) proposal.refine({position: point.sub(d.origin).add(new T.Vector3().fromArray(d.pose.position)).toArray()});
    }
    render();
  }, true);
  function endDrag(nominate) {
    if (!drag) return;
    const {id, moved, width} = drag;
    drag = null;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    proposal.endPointer();
    if (nominate && !moved && !width) proposal.nominate();
    emit(moved ? 'pointer-refine' : 'parked');
    render();
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    listen(win, type, event => {
      if (drag?.id !== event.pointerId) return;
      endDrag(type === 'pointerup');
      stop(event);
    }, true);
  }
  listen(win, 'blur', () => {endDrag(false); proposal.suspend();});
  const operations = {
    acceptLooseWood() {endDrag(false); proposal.accept(); emit('accept'); render(); return read();},
    backLooseWood() {endDrag(false); proposal.back(); emit('back'); render(); return read();},
  };
  let over = false;
  listen(canvas, 'pointermove', event => {over = !!hit(pointer(event));});
  listen(canvas, 'pointerleave', () => {over = false;});
  listen(win, 'keydown', event => {
    if (!over || trackingBlocked() ||
        event.target?.closest?.('input,textarea,select,button,[contenteditable="true"]')) return;
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    stop(event);
    (event.key === 'Enter' ? operations.acceptLooseWood : operations.backLooseWood)();
  }, true);

  function read() {
    return {...proposal.read(), screen: {body: screen(fixture.getWorldPosition(new T.Vector3())),
      width: screen(handle.getWorldPosition(new T.Vector3()))}};
  }
  render();
  const off = session.onFrame(onFrame);
  return {read, operations, containsPointer,
    backAt(event) {
      if (!containsPointer(event)) return false;
      operations.backLooseWood();
      return true;
    },
    dispose() {
    endDrag(false);
    off();
    for (const remove of listeners) remove();
    hud.remove();
    cursor.remove();
  }};
}
