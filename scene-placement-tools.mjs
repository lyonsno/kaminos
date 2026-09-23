import { Vector2, Vector3, Raycaster, Plane } from './lib/three.core.js';
import { createSceneEdits, transformPose, axisVector } from './scene-edit-session.mjs';

export function installScenePlacementTools({
  viewport, camera, controls, gizmo, selected, read, write, object, refresh,
  allowed = () => true, busy = () => false, frameSelected = () => {},
}) {
  const hud = document.createElement('div');
  hud.id = 'scene-edit-hud';
  hud.setAttribute('role', 'status');
  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  overlay.id = 'scene-edit-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  viewport.append(overlay, hud);

  let modal = null;
  let field = null;
  let lastPointer = { x: 0, y: 0 };
  let hover = false;
  let suppressClick = false;
  let gizmoEditing = false;
  let gizmoPrior = null;
  let pointerOrigin = null;
  const priorControls = () => ({ controls: controls.enabled, gizmo: gizmo.enabled, helper: gizmo.getHelper().visible });
  const restoreControls = prior => {
    if (!prior) return;
    controls.enabled = prior.controls;
    gizmo.enabled = prior.gizmo;
    gizmo.getHelper().visible = prior.helper;
  };
  const edits = createSceneEdits({ read, write, changed: () => { refresh(); draw(); }, admit: () => {
    if (!allowed()) throw new Error('Finish preview or correction before editing placement');
    if (busy()) throw new Error('Wait for the current authoring action before editing placement');
  } });
  const state = () => ({
    ...edits.state(), gizmoEditing, gizmoDragging: gizmo.dragging, gizmoVisible: gizmo.getHelper().visible,
    controlsEnabled: controls.enabled,
    modal: modal ? { operation: modal.operation, axis: modal.axis, frame: modal.frame, plane: modal.plane, numeric: modal.numeric, snapping: modal.snap } : null,
  });
  const isText = target => !!target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
  const steal = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  const pose = () => read(selected());
  const viewAxis = () => camera.getWorldDirection(new Vector3()).negate();

  function screen(point) {
    const projected = point.clone().project(camera);
    return new Vector2((projected.x + 1) * viewport.clientWidth / 2, (1 - projected.y) * viewport.clientHeight / 2);
  }
  function ray(point) {
    const rect = viewport.getBoundingClientRect();
    const caster = new Raycaster();
    caster.setFromCamera(new Vector2(2 * (point.x - rect.left) / rect.width - 1, 1 - 2 * (point.y - rect.top) / rect.height), camera);
    return caster.ray;
  }
  function finish(commit = true) {
    if (!edits.state().active && !gizmoEditing) return false;
    const prior = modal?.prior || gizmoPrior;
    const capture = field?.capture || (gizmoEditing ? pointerOrigin : null);
    modal = null; field = null; gizmoEditing = false; gizmoPrior = null;
    if (gizmo.dragging) { gizmo.pointerUp({ button: 0 }); gizmo.dragging = false; gizmo.axis = null; }
    if (capture?.target?.hasPointerCapture?.(capture.pointerId)) capture.target.releasePointerCapture(capture.pointerId);
    let error;
    try { commit ? edits.commit() : edits.cancel(); }
    catch (caught) { error = caught; edits.cancel(); }
    restoreControls(prior);
    draw();
    if (error) hud.textContent = error.message;
    return !error;
  }
  function begin(id, label) {
    try { edits.begin(id, label); return true; }
    catch (error) { hud.textContent = error.message; return false; }
  }
  function start(operation) {
    if (!allowed() || busy() || !selected()) return false;
    if (field) finish(true);
    if (!modal) {
      if (!begin(selected(), 'Transform')) return false;
      modal = { axis: null, plane: false, frame: 'world', frameRotation: [...pose().rotation], numeric: '', snap: false, precise: false, prior: priorControls() };
    }
    // Operation changes are alternatives within one gesture. Always restart
    // from the accepted pose captured by begin(), then preview only this mode.
    modal.base = structuredClone(edits.state().active.before);
    edits.preview(modal.base);
    modal.operation = operation;
    modal.anchor = { ...lastPointer };
    modal.numeric = '';
    modal.amount = operation === 'scale' ? 1 : 0;
    if (operation === 'scale' && modal.axis) modal.frame = 'local';
    controls.enabled = false;
    gizmo.enabled = false;
    gizmo.getHelper().visible = false;
    draw();
    return true;
  }
  function preview() {
    if (!modal) return;
    const current = modal;
    const dx = lastPointer.x - current.anchor.x, dy = lastPointer.y - current.anchor.y;
    const pivot = new Vector3(...current.base.position), forward = viewAxis();
    let planeNormal = forward.clone(), axis = current.axis ? axisVector(current.axis, current.frame, current.frameRotation) : null;
    if (axis && !current.plane) {
      planeNormal.addScaledVector(axis, -planeNormal.dot(axis));
      if (planeNormal.lengthSq() < 1e-8) planeNormal = camera.up.clone();
      planeNormal.normalize();
    } else if (axis) planeNormal = axis.clone();
    const plane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, pivot);
    const startHit = ray(current.anchor).intersectPlane(plane, new Vector3());
    const endHit = ray(lastPointer).intersectPlane(plane, new Vector3());
    const unitsPerPixel = 2 * camera.position.distanceTo(pivot) * Math.tan(camera.fov * Math.PI / 360) / viewport.clientHeight;
    let delta = startHit && endHit ? endHit.sub(startHit) : new Vector3(dx * unitsPerPixel, -dy * unitsPerPixel, 0);
    let amount = current.operation === 'translate' ? (axis ? delta.dot(axis) : delta.length()) : current.operation === 'scale' ? 1 + dx / 150 : dx * .01;
    if (current.operation === 'rotate') {
      const center = screen(pivot), rect = viewport.getBoundingClientRect();
      const a = new Vector2(current.anchor.x - rect.left - center.x, current.anchor.y - rect.top - center.y);
      const b = new Vector2(lastPointer.x - rect.left - center.x, lastPointer.y - rect.top - center.y);
      if (a.length() > 20 && b.length() > 20) amount = Math.atan2(a.x * b.y - a.y * b.x, a.dot(b)) * -1;
      if (axis && axis.dot(forward) < 0) amount *= -1;
    }
    if (current.precise) { delta.multiplyScalar(.1); amount = current.operation === 'scale' ? 1 + (amount - 1) * .1 : amount * .1; }
    if (current.numeric) {
      const value = Number(current.numeric);
      if (!Number.isFinite(value) || ['-', '.', '-.'].includes(current.numeric)) { draw(); return; }
      amount = current.operation === 'rotate' ? value * Math.PI / 180 : value;
      if (current.operation === 'translate' && (!current.axis || current.plane)) {
        if (delta.lengthSq() < 1e-12) delta = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        delta.normalize().multiplyScalar(amount);
      }
    }
    const snap = current.snap ? (current.operation === 'rotate' ? Math.PI / 36 : .1) : 0;
    edits.preview(transformPose(current.base, { ...current, amount, delta: delta.toArray(), viewAxis: forward.toArray(), snap }));
    current.amount = amount;
    draw();
  }
  function draw() {
    if (!hud.isConnected && !viewport.contains(hud)) return;
    camera.updateMatrixWorld(true);
    const id = selected(), target = id ? object(id) : null, current = modal;
    const label = target?.userData?.kaminosSceneObject?.label || id;
    hud.dataset.active = String(!!edits.state().active);
    if (current) {
      const value = current.numeric || (current.operation === 'rotate' ? `${((current.amount || 0) * 180 / Math.PI).toFixed(1)}°` : (current.amount ?? (current.operation === 'scale' ? 1 : 0)).toFixed(3));
      hud.textContent = `${{ translate: 'Move', rotate: 'Rotate', scale: 'Scale' }[current.operation]} ${current.axis ? (current.plane ? 'plane ⟂ ' : '') + current.axis.toUpperCase() : ''} · ${current.axis ? current.frame : 'view'} · ${value} · ${current.snap ? 'Snap ' + (current.operation === 'rotate' ? '5°' : '0.1') + ' · ' : ''}Enter / LMB confirm · Esc / RMB cancel`;
    } else if (field) hud.textContent = 'Edit value · drag axis label to adjust · Enter confirm · Esc cancel';
    else hud.textContent = id ? `${label} · G Move · R Rotate · S Scale · X/Y/Z constrain · Ctrl snap · Shift fine · F frame · ⌘/Ctrl Z undo` : 'Select an object to place it';
    const width = viewport.clientWidth, height = viewport.clientHeight;
    overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
    let lines = '';
    const line = (a, b, color, opacity = 1, dash = '') => {
      if ([a.x, a.y, b.x, b.y].every(Number.isFinite)) lines += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" opacity="${opacity}" stroke-width="1.3" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
    };
    if (target) {
      target.updateWorldMatrix(true, true);
      const origin = screen(new Vector3(...pose().position));
      for (const [a, b] of [[[0, -5], [5, 0]], [[5, 0], [0, 5]], [[0, 5], [-5, 0]], [[-5, 0], [0, -5]]]) line(origin.clone().add(new Vector2(...a)), origin.clone().add(new Vector2(...b)), '#efa544');
      if (current?.axis) {
        const pivot = new Vector3(...current.base.position), p = screen(pivot);
        const d = axisVector(current.axis, current.frame, current.frameRotation).multiplyScalar(camera.position.distanceTo(pivot) * .01);
        const axisLine = screen(pivot.clone().add(d)).sub(p).normalize().multiplyScalar(Math.hypot(width, height));
        line(p.clone().sub(axisLine), p.clone().add(axisLine), { x: '#ed6565', y: '#8cca68', z: '#669fee' }[current.axis], .8, '5 3');
      }
    }
    overlay.innerHTML = lines;
  }
  function selectionChanged() { if (edits.state().active) finish(false); draw(); }
  controls.addEventListener?.('change', draw);
  new ResizeObserver(draw).observe(viewport);
  viewport.addEventListener('pointerenter', () => { hover = true; });
  viewport.addEventListener('pointerleave', () => { hover = false; });
  document.addEventListener('pointermove', event => {
    lastPointer = { x: event.clientX, y: event.clientY };
    if (modal) { modal.snap = event.ctrlKey; modal.precise = event.shiftKey; try { preview(); } catch (error) { finish(false); hud.textContent = error.message; } }
    if (field?.drag) {
      const delta = (event.clientX - field.startX) * (event.shiftKey ? .1 : 1) * field.step;
      field.input.value = String(field.startValue + delta);
      fieldInput(field.input);
    }
  }, true);
  document.addEventListener('pointerdown', event => { if (modal && !viewport.contains(event.target)) finish(false); }, true);
  viewport.addEventListener('pointerdown', event => {
    pointerOrigin = { target: event.target, pointerId: event.pointerId, prior: priorControls() };
    if (!modal) return;
    steal(event); suppressClick = true; finish(event.button !== 2);
  }, true);
  for (const type of ['pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) viewport.addEventListener(type, event => {
    if (modal || suppressClick) { steal(event); if (type === 'click' || type === 'contextmenu') suppressClick = false; }
  }, true);
  document.addEventListener('keydown', event => {
    if (gizmoEditing && event.key === 'Escape') { steal(event); finish(false); return; }
    if (field && event.key === 'Escape') { steal(event); const input = field.input; finish(false); input.blur(); refresh(); return; }
    if (field && event.key === 'Enter') { steal(event); const input = field.input; finish(true); input.blur(); return; }
    if (isText(event.target)) return;
    const key = event.key.toLowerCase();
    if (modal) {
      steal(event);
      if (event.key === 'Escape') { finish(false); return; }
      if (event.key === 'Enter') { finish(true); return; }
      if (['g', 'r', 's'].includes(key)) { start({ g: 'translate', r: 'rotate', s: 'scale' }[key]); return; }
      if (['x', 'y', 'z'].includes(key)) {
        if (modal.axis === key && modal.plane === event.shiftKey) {
          if (modal.frame === 'world' && modal.operation !== 'scale') modal.frame = 'local';
          else { modal.axis = null; modal.plane = false; modal.frame = 'world'; }
        } else { modal.axis = key; modal.plane = event.shiftKey; modal.frame = modal.operation === 'scale' ? 'local' : 'world'; }
      } else if (event.key === 'Backspace') modal.numeric = modal.numeric.slice(0, -1);
      else if (/^[0-9.\-]$/.test(event.key)) modal.numeric += event.key;
      modal.snap = event.ctrlKey; modal.precise = event.shiftKey; preview(); return;
    }
    if (!(hover || viewport.contains(document.activeElement)) || !allowed() || busy()) return;
    if ((event.ctrlKey || event.metaKey) && key === 'z') { steal(event); try { event.shiftKey ? edits.redo() : edits.undo(); } catch (error) { hud.textContent = error.message; } return; }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (key === 'f' || event.code === 'NumpadDecimal') { steal(event); frameSelected(); return; }
    if (['g', 'r', 's'].includes(key)) { steal(event); start({ g: 'translate', r: 'rotate', s: 'scale' }[key]); }
  }, true);
  document.addEventListener('keyup', event => { if (modal && ['Control', 'Shift'].includes(event.key)) { modal.snap = event.ctrlKey; modal.precise = event.shiftKey; preview(); } }, true);
  window.addEventListener('blur', () => { if (edits.state().active) finish(false); });

  function fieldInput(input) {
    if (!input.value.trim() || !Number.isFinite(input.valueAsNumber)) return;
    const [group, axis] = input.dataset.transformField.split('.'), current = pose();
    if (!current) return;
    const index = { x: 0, y: 1, z: 2 }[axis], factor = group === 'rotation' ? Math.PI / 180 : 1;
    if (!field) { if (!begin(selected(), `Edit ${input.dataset.transformField}`)) { input.value = String(current[group][index] / factor); return; } field = { input }; }
    current[group][index] = input.valueAsNumber * factor;
    try { edits.preview(current); } catch (error) { finish(false); input.value = String(pose()[group][index] / factor); hud.textContent = error.message; }
  }
  for (const input of document.querySelectorAll('[data-transform-field]')) {
    input.step = 'any';
    input.addEventListener('input', () => fieldInput(input));
    input.addEventListener('blur', () => { if (field?.input === input && !field.drag) finish(true); });
    input.addEventListener('change', () => { if (field?.input === input && !field.drag) finish(true); });
    const grip = input.parentElement.querySelector('.transform-axis');
    if (!grip) continue;
    grip.title = 'Drag to adjust; edit the number to type'; grip.style.cursor = 'ew-resize'; grip.style.touchAction = 'none';
    grip.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !selected()) return;
      event.preventDefault(); if (edits.state().active) finish(true);
      const [group, axis] = input.dataset.transformField.split('.');
      const startValue = pose()[group][{ x: 0, y: 1, z: 2 }[axis]] * (group === 'rotation' ? 180 / Math.PI : 1);
      if (!begin(selected(), `Adjust ${input.dataset.transformField}`)) return;
      field = { input, drag: true, startX: event.clientX, startValue, step: group === 'rotation' ? .2 : .01, capture: { target: grip, pointerId: event.pointerId } };
      grip.setPointerCapture(event.pointerId); draw();
    });
    grip.addEventListener('pointerup', () => { if (field?.drag) finish(true); });
    grip.addEventListener('pointercancel', () => { if (field?.drag) finish(false); });
    grip.addEventListener('lostpointercapture', () => { if (field?.drag) finish(false); });
  }
  gizmo.addEventListener('mouseDown', () => {
    if (!allowed()) return;
    gizmoPrior = pointerOrigin?.prior || priorControls(); gizmoEditing = true;
    if (!selected() || !begin(selected(), 'Gizmo transform')) finish(false);
  });
  gizmo.addEventListener('mouseUp', () => { if (gizmoEditing) { const prior = gizmoPrior; finish(true); queueMicrotask(() => restoreControls(prior)); } });
  draw();
  return {
    edits, state, start, finish, selectionChanged, draw,
    clear() { finish(false); edits.clear(); draw(); },
  };
}
