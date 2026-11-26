import {
  BufferGeometry, DoubleSide, Group,
  Matrix4, Mesh, MeshBasicMaterial, Raycaster, SphereGeometry, Vector3,
} from './lib/three.core.js';
import {
  clampSurfacePoint, flatSwingLimit, handlePoint, hasArea, hingeFraction, inspectSeparation, intersectRect, materialBands,
  moveCorner, nearestHinge, rectangleBetween, surfaceBounds, surfaceCoordinates,
  surfacePatch, surfacePoint,
} from './surface-separation.mjs';
import {buildShellPiece, meshGeometry} from './surface-separation-fixtures.mjs';

const GREEN = 0x18ef86;
const AMBER = 0xff9239;
const distances = {inside: .014, guide: .021, handle: .029};
const PIECE_INSET = .008;

function edgeBand([a, b, c, d], side, width) {
  const half = width / 2;
  return [
    [a, b - half, c, b + half], [c - half, b, c + half, d],
    [a, d - half, c, d + half], [a - half, b, a + half, d],
  ][side];
}

function bandVertices(surface, bands, offset, gap) {
  const bounds = surfaceBounds(surface);
  return bands.flatMap(band => {
    const clipped = intersectRect(bounds, band);
    return clipped ? materialBands(clipped, gap).flatMap(rect => surfacePatch(surface, rect, offset)) : [];
  });
}

function replaceGeometry(object, geometry) {
  object.geometry.dispose();
  object.geometry = geometry;
}

function makeOverlay() {
  const group = new Group();
  group.name = 'Surface separation preview';
  const materials = {
    fill: new MeshBasicMaterial({color: GREEN, transparent: true, opacity: .24, depthWrite: false, side: DoubleSide}),
    obstruction: new MeshBasicMaterial({color: AMBER, transparent: true, opacity: .65, depthWrite: false, side: DoubleSide}),
    outline: new MeshBasicMaterial({color: GREEN, depthWrite: false, side: DoubleSide}),
    axis: new MeshBasicMaterial({color: 0xffc250, depthWrite: false, side: DoubleSide}),
    rear: new MeshBasicMaterial({color: 0x127bad, transparent: true, opacity: .66,
      depthTest: false, depthWrite: false, side: DoubleSide}),
    corner: new MeshBasicMaterial({color: GREEN}),
    pivot: new MeshBasicMaterial({color: 0xffd982}),
  };
  const fill = new Mesh(new BufferGeometry(), materials.fill);
  const obstruction = new Mesh(new BufferGeometry(), materials.obstruction);
  const outline = new Mesh(new BufferGeometry(), materials.outline);
  const axis = new Mesh(new BufferGeometry(), materials.axis);
  const rear = new Mesh(new BufferGeometry(), materials.rear);
  rear.renderOrder = 10;
  const sphere = new SphereGeometry(.051, 12, 8);
  const handles = Array.from({length: 4}, () => new Mesh(sphere, materials.corner));
  const pivot = new Mesh(sphere, materials.pivot);
  pivot.scale.setScalar(1.45);
  group.add(fill, obstruction, outline, axis, rear, ...handles, pivot);
  group.traverse(node => {
    node.raycast = () => {};
    node.userData.kaminosEditorHelper = true;
  });
  group.matrixAutoUpdate = false;
  group.visible = false;
  return {group, materials, fill, obstruction, outline, axis, rear, handles, pivot};
}

function edgeAt(rect, edge) {
  return [handlePoint(rect, edge), handlePoint(rect, (edge + 1) % 4)];
}

function instanceVisible(object) {
  for (let node = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

export async function installSurfaceSeparation({host, record, session, fixtures}) {
  const document = host.controls.document;
  const browser = document.defaultView;
  const canvas = host.scene.renderer().domElement;
  const viewport = canvas.parentElement;
  const listeners = new AbortController();
  const listen = (node, name, fn) => node.addEventListener(name, fn, {capture: true, signal: listeners.signal});
  const ray = new Raycaster();
  const targets = fixtures.flatMap(item => item.pickMeshes);
  const owners = new Map(fixtures.flatMap(item => item.pickMeshes.map(mesh => [mesh, item])));
  const overlay = makeOverlay();
  await session.attach(overlay.group, {owned: true, presentation: true});
  const stopPose = session.onFrame(syncOverlayPose);
  const priorCursor = canvas.style.cursor;
  let active = true;
  let selected = null;
  let rect = null;
  let hinge = null;
  let hingeAt = .5;
  let motion = null;
  let swing = null;
  let piece = null;
  let pointer = null;
  let missed = false;
  let suppressClick = false;
  let syncPanel = () => {};

  const state = () => ({
    active, fixture: selected?.spec.id ?? null, rect: rect && [...rect], hinge,
    hingeAt: hinge === null ? null : hingeAt, motion, swing: swing && {...swing}, missed,
    depth: rect ? inspectSeparation(selected.spec, rect) : null,
    fixtures: fixtures.map(item => ({id: item.spec.id, objectId: item.asset.id})),
  });
  function report(kind) {
    const effective = state();
    record({kind: 'surface-separation.' + kind, phase: 'applied', target: selected?.asset.id, effective});
    return effective;
  }
  function clearMotion() {
    if (piece) {
      piece.geometry.dispose();
      piece.removeFromParent();
      piece = null;
      selected.clearCut();
    }
    motion = null;
    swing = null;
  }
  function rearBands(rect) {
    return [0, 1, 2, 3].flatMap(side => {
      const axis = side % 2;
      const band = edgeBand(rect, side, .021);
      const start = band[axis], end = band[axis + 2];
      const count = Math.max(1, Math.ceil((end - start) / .13));
      const step = (end - start) / count;
      return Array.from({length: count}, (_, i) => {
        const dash = [...band];
        dash[axis] = start + step * i;
        dash[axis + 2] = dash[axis] + step * .57;
        return dash;
      });
    });
  }
  function syncOverlayPose() {
    overlay.group.visible = Boolean(rect && selected?.root.parent && instanceVisible(selected.root));
    if (!overlay.group.visible) return;
    selected.root.updateWorldMatrix(true, false);
    overlay.group.matrix.copy(selected.root.matrixWorld);
    overlay.group.matrixWorldNeedsUpdate = true;
  }
  function redraw() {
    syncOverlayPose();
    const visible = rect && selected;
    if (visible) {
      const {spec} = selected;
      const outlining = !motion;
      const depth = inspectSeparation(spec, rect);
      const obstruction = spec.brace && intersectRect(rect, spec.brace);
      const rim = swing?.blocked ? edgeBand(rect, (hinge + 2) % 4, .052) : null;
      overlay.fill.visible = overlay.outline.visible = outlining;
      overlay.materials.outline.color.set(['cavity', 'brace', 'rim'].includes(depth) ? AMBER : GREEN);
      if (outlining) {
        replaceGeometry(overlay.fill, meshGeometry(materialBands(rect, spec.gap)
          .flatMap(band => surfacePatch(spec, band, distances.inside))));
        replaceGeometry(overlay.outline, meshGeometry(bandVertices(spec,
          [0, 1, 2, 3].map(side => edgeBand(rect, side, .025)), distances.guide, spec.gap)));
      }
      overlay.rear.visible = outlining && spec.cuttable && depth !== 'rim';
      replaceGeometry(overlay.rear, meshGeometry(overlay.rear.visible
        ? bandVertices(spec, rearBands(rect), -spec.thickness, null) : []));
      overlay.obstruction.visible = Boolean(outlining ? obstruction : rim);
      replaceGeometry(overlay.obstruction, meshGeometry(overlay.obstruction.visible
        ? bandVertices(spec, [rim ?? obstruction], distances.guide, spec.gap) : []));
      overlay.handles.forEach((handle, index) => {
        const uv = handlePoint(rect, index);
        handle.position.fromArray(surfacePoint(spec, uv, distances.handle));
        handle.visible = outlining && (!spec.gap || !(uv[0] > spec.gap[0] && uv[0] < spec.gap[2] &&
          uv[1] > spec.gap[1] && uv[1] < spec.gap[3]));
      });
      overlay.pivot.visible = overlay.axis.visible = hinge !== null && motion !== 'lift';
      if (overlay.axis.visible) {
        const [a, b] = edgeAt(rect, hinge);
        const point = a.map((value, i) => value + (b[i] - value) * hingeAt);
        overlay.pivot.position.fromArray(surfacePoint(spec, point, distances.handle));
        replaceGeometry(overlay.axis, meshGeometry(bandVertices(spec,
          [edgeBand(rect, hinge, .04)], distances.guide + .002, spec.gap)));
      }
    }
    syncPanel();
    session.redraw();
  }
  function take(spec, first, last) {
    const item = fixtures.find(item => item.spec.id === spec);
    if (!item) throw Error('Choose a fixture');
    if (![first, last].every(point => Array.isArray(point) && point.length === 2 &&
        point.every(Number.isFinite))) throw Error('A sketch needs two finite surface coordinates');
    clearMotion();
    selected = item;
    first = clampSurfacePoint(item.spec, first);
    last = clampSurfacePoint(item.spec, last);
    const next = rectangleBetween(first, last);
    rect = hasArea(next) ? next : null;
    hinge = null;
    redraw();
  }
  function setHinge(point) {
    if (!rect || inspectSeparation(selected.spec, rect) !== 'through') return false;
    const [a, b, c, d] = rect;
    clearMotion();
    hinge = nearestHinge(selected.spec, rect, point ?? [a, (b + d) / 2], hinge);
    hingeAt = point ? hingeFraction(rect, hinge, point) : .5;
    redraw();
    return true;
  }
  function preview(action) {
    if (!rect || inspectSeparation(selected.spec, rect) !== 'through' ||
        (action === 'swing' && selected.spec.kind !== 'plane')) return false;
    clearMotion();
    if (action === 'swing' && hinge === null) setHinge();
    const inset = PIECE_INSET;
    const [a, b, c, d] = rect;
    if (c - a <= 2 * inset || d - b <= 2 * inset) return false;
    const spec = selected.spec;
    selected.openCut(rect);
    piece = new Mesh(buildShellPiece(spec, [a + inset, b + inset, c - inset, d - inset]), selected.material);
    piece.name = 'Separated shell preview';
    piece.raycast = () => {};
    piece.userData.kaminosEditorHelper = true;
    selected.root.add(piece);
    motion = action;
    if (action === 'lift') {
      piece.position.z = .46;
      redraw();
    } else {
      const span = hinge % 2 === 0 ? d - b : c - a;
      const limit = flatSwingLimit(span, spec.thickness, inset);
      swing = {requested: 0, angle: 0, limit, blocked: false};
      requestSwing(.63);
    }
    return true;
  }
  function motionAxis() {
    const [start, end] = edgeAt(rect, hinge).map(uv => new Vector3(...surfacePoint(selected.spec, uv)));
    return {start, axis: end.sub(start).normalize()};
  }
  function requestSwing(angle) {
    const requested = Math.max(0, Math.min(Math.PI / 2, angle));
    const achieved = Math.min(requested, swing.limit ?? requested);
    swing = {...swing, requested, angle: achieved, blocked: requested > achieved};
    const {start, axis} = motionAxis();
    piece.quaternion.setFromAxisAngle(axis, achieved);
    piece.position.copy(start).sub(start.clone().applyQuaternion(piece.quaternion));
    redraw();
  }
  function reset() {
    clearMotion();
    rect = hinge = selected = null;
    missed = false;
    redraw();
  }
  function setActive(next) {
    if (!next && pointer) cancelGesture();
    active = Boolean(next);
    canvas.style.cursor = active ? 'crosshair' : priorCursor;
    redraw();
    return report('tool');
  }
  function cameraMatrices() {
    const {matrixWorldInverse, projectionMatrix} = browser.kaminosCameraDebugState();
    return new Matrix4().fromArray(projectionMatrix).multiply(new Matrix4().fromArray(matrixWorldInverse));
  }
  function throughRecess(item) {
    const inverse = item.root.matrixWorld.clone().invert();
    const origin = ray.ray.origin.clone().applyMatrix4(inverse);
    const direction = ray.ray.direction.clone().transformDirection(inverse);
    if (direction.z >= -1e-8) return null;
    const t = -origin.z / direction.z;
    const {x, y} = origin.addScaledVector(direction, t);
    const [a, b, c, d] = item.spec.gap;
    return t >= 0 && x >= a && x <= c && y >= b && y <= d ? {item, uv: [x, y]} : null;
  }
  function setRay(event) {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0 || event.clientX < bounds.left ||
        event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return null;
    const x = 2 * (event.clientX - bounds.left) / bounds.width - 1;
    const y = 1 - 2 * (event.clientY - bounds.top) / bounds.height;
    const inverse = cameraMatrices().invert();
    const near = new Vector3(x, y, .04).applyMatrix4(inverse);
    const far = new Vector3(x, y, .92).applyMatrix4(inverse);
    ray.set(near, far.sub(near).normalize());
    return bounds;
  }
  function readHit(event, captured = null) {
    if (!setRay(event)) return null;
    for (const fixture of fixtures) fixture.root.updateWorldMatrix(true, true);
    const hits = ray.intersectObjects(targets, false).filter(row => instanceVisible(row.object));
    let hit = hits[0];
    if (!hit) return null;
    const item = owners.get(hit.object);
    if (hit.object !== item.front) {
      if (item !== captured) return null;
      hit = hits.find(row => row.object === item.front);
      if (!hit) return item.spec.gap ? throughRecess(item) : null;
    }
    const uv = surfaceCoordinates(item.spec, item.root.worldToLocal(hit.point).toArray());
    return uv && {item, uv: clampSurfacePoint(item.spec, uv)};
  }
  function handleAt(event) {
    if (!overlay.group.visible) return null;
    const bounds = canvas.getBoundingClientRect();
    const matrix = cameraMatrices();
    const handles = overlay.handles.map((handle, slot) => ({handle, slot}));
    if (hinge !== null) handles.unshift({handle: overlay.pivot, slot: 'hinge'});
    let closest = null;
    let distance = 11;
    for (const {handle, slot} of handles) {
      if (!handle.visible) continue;
      const point = handle.getWorldPosition(new Vector3()).applyMatrix4(matrix);
      if (point.z < -1 || point.z > 1) continue;
      const x = bounds.left + (point.x + 1) * bounds.width / 2;
      const y = bounds.top + (1 - point.y) * bounds.height / 2;
      const delta = Math.hypot(x - event.clientX, y - event.clientY);
      if (delta < distance) {
        closest = slot;
        distance = delta;
      }
    }
    return closest;
  }
  function swingGrip(event) {
    const bounds = setRay(event);
    if (!bounds || !piece || !instanceVisible(piece)) return null;
    piece.updateWorldMatrix(true, false);
    const intersections = [];
    Mesh.prototype.raycast.call(piece, ray, intersections);
    if (!intersections.length) return null;
    const hit = intersections.reduce((a, b) => a.distance < b.distance ? a : b);
    const local = selected.root.worldToLocal(hit.point.clone());
    const {start, axis} = motionAxis();
    const next = local.sub(start).applyAxisAngle(axis, .1).add(start);
    const matrix = cameraMatrices();
    const a = hit.point.applyMatrix4(matrix);
    const b = selected.root.localToWorld(next).applyMatrix4(matrix);
    const dx = (b.x - a.x) * bounds.width / 2;
    const dy = (a.y - b.y) * bounds.height / 2;
    const length = Math.hypot(dx, dy);
    return length > .7 ? [dx / length, dy / length] : [0, -1];
  }
  function consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  const same = (a, b) => a && b && a.every((value, i) => Math.abs(value - b[i]) < 1e-5);
  function drag(event) {
    if (pointer.slot === 'swing') {
      const [dx, dy] = pointer.direction;
      requestSwing(pointer.angle + (dx * (event.clientX - pointer.x) +
        dy * (event.clientY - pointer.y)) / 140);
      return;
    }
    const hit = readHit(event, selected);
    if (hit?.item !== selected) {
      if (!missed) {
        missed = true;
        syncPanel();
      }
      return;
    }
    const wasMissed = missed;
    missed = false;
    if (pointer.slot === 'hinge') {
      const next = nearestHinge(selected.spec, rect, hit.uv, hinge);
      const fraction = hingeFraction(rect, next, hit.uv);
      if (next !== hinge || Math.abs(fraction - hingeAt) > .001) {
        hinge = next;
        hingeAt = fraction;
        redraw();
      } else if (wasMissed) syncPanel();
      return;
    }
    const {start, original, slot} = pointer;
    let next;
    if (slot === 'move') {
      const [a, b, c, d] = original;
      const bounds = surfaceBounds(selected.spec);
      const dx = Math.max(bounds[0] - a, Math.min(bounds[2] - c, hit.uv[0] - start[0]));
      const dy = Math.max(bounds[1] - b, Math.min(bounds[3] - d, hit.uv[1] - start[1]));
      next = [a + dx, b + dy, c + dx, d + dy];
    } else if (slot === 'draw') {
      next = rectangleBetween(start, hit.uv);
    } else {
      next = moveCorner(original, slot, hit.uv);
    }
    if (!same(rect, next) && hasArea(next)) {
      rect = next;
      if (inspectSeparation(selected.spec, rect) !== 'through') hinge = null;
      redraw();
    } else if (wasMissed) syncPanel();
  }
  function endGesture() {
    const {id} = pointer;
    pointer = null;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  function cancelGesture() {
    const {prior, slot, angle} = pointer;
    endGesture();
    if (slot === 'swing') {
      requestSwing(angle);
      return;
    }
    ({selected, rect, hinge, hingeAt} = prior);
    missed = false;
    redraw();
  }
  listen(viewport, 'pointerdown', event => {
    if (event.button === 0 && !pointer) suppressClick = false;
    if (!active || event.target !== canvas || event.button !== 0 || event.altKey ||
        event.metaKey || event.ctrlKey || event.shiftKey || pointer) return;
    if (motion) {
      const direction = motion === 'swing' && swingGrip(event);
      if (!direction) return;
      pointer = {id: event.pointerId, slot: 'swing', angle: swing.requested,
        direction, x: event.clientX, y: event.clientY};
      suppressClick = true;
      canvas.setPointerCapture(event.pointerId);
      consume(event);
      return;
    }
    const hit = readHit(event);
    const handle = hit?.item === selected ? handleAt(event) : null;
    if (!hit) return;
    const prior = {selected, rect, hinge, hingeAt};
    const [u, v] = hit.uv;
    const inside = hit.item === selected && rect &&
      u > rect[0] && v > rect[1] && u < rect[2] && v < rect[3];
    const slot = handle ?? (inside ? 'move' : 'draw');
    selected = hit.item;
    if (slot === 'draw') rect = hinge = null;
    pointer = {id: event.pointerId, start: hit.uv, original: rect, slot, prior};
    missed = false;
    suppressClick = true;
    canvas.setPointerCapture(event.pointerId);
    consume(event);
    redraw();
  });
  listen(viewport, 'pointermove', event => {
    if (pointer?.id === event.pointerId) {
      consume(event);
      drag(event);
    }
  });
  listen(viewport, 'pointerup', event => {
    if (pointer?.id === event.pointerId) {
      consume(event);
      drag(event);
      endGesture();
      missed = false;
      syncPanel();
      report('gesture');
    }
  });
  listen(viewport, 'pointercancel', event => {
    if (pointer?.id === event.pointerId) cancelGesture();
  });
  listen(viewport, 'lostpointercapture', event => {
    if (pointer?.id === event.pointerId) cancelGesture();
  });
  listen(viewport, 'click', event => {
    if (suppressClick && event.target === canvas) {
      suppressClick = false;
      consume(event);
    }
  });
  listen(browser, 'keydown', event => {
    if (event.key !== 'Escape' || !active || (!pointer && !rect)) return;
    if (event.target?.closest?.('input, textarea, select, [contenteditable]')) return;
    consume(event);
    if (pointer) cancelGesture();
    else if (motion) { clearMotion(); redraw(); }
    else reset();
  });

  const operations = {
    setActive,
    sketch({fixture, first, last}) { take(fixture, first, last); return report('sketch'); },
    placeHinge(point) { setHinge(point); return report('hinge'); },
    lift() { preview('lift'); return report('lift'); },
    swing() { preview('swing'); return report('swing'); },
    closePreview() { clearMotion(); redraw(); return report('close'); },
    reset() { reset(); return report('reset'); },
  };
  canvas.style.cursor = 'crosshair';
  return {
    read: state, operations,
    mount({root, invoke}) {
      const guidance = document.createElement('p');
      const status = document.createElement('p');
      status.setAttribute('role', 'status');
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
      const makeButton = (label, op, arg) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn';
        button.textContent = label;
        button.onclick = () => invoke(op, arg?.()).catch(error => { status.textContent = error.message; });
        actions.append(button);
        return button;
      };
      const tool = makeButton('Draw on surface', 'setActive', () => !active);
      const lift = makeButton('Lift preview', 'lift');
      const hingeButton = makeButton('Place hinge', 'placeHinge');
      const swingButton = makeButton('Swing preview', 'swing');
      const close = makeButton('Return to outline', 'closePreview');
      root.append(guidance, actions, status);
      syncPanel = () => {
        const depth = rect ? inspectSeparation(selected.spec, rect) : null;
        tool.setAttribute('aria-pressed', String(active));
        tool.classList.toggle('active', active);
        guidance.textContent = active
          ? 'Drag on a front face. Drag the corners to resize, or the fill to move.'
          : 'Select and transform fixtures with the ordinary viewport tools.';
        const canPreview = depth === 'through' && !motion;
        lift.style.display = canPreview ? '' : 'none';
        hingeButton.style.display = canPreview && hinge === null ? '' : 'none';
        swingButton.style.display = canPreview && hinge !== null && selected.spec.kind === 'plane'
          ? '' : 'none';
        close.style.display = motion ? '' : 'none';
        if (motion) {
          status.textContent = motion === 'lift'
            ? 'The shell piece and opening are previewed together.'
            : swing.blocked
              ? `The far rim stops the swing at ${Math.round(swing.angle * 180 / Math.PI)}°. Drag the piece back to close it.`
              : 'Drag the piece to swing it. The gold edge stays attached.';
        } else if (missed) {
          status.textContent = 'Outline held at the last hit on its original face.';
        } else if (depth === 'brace') {
          status.textContent = 'Rear brace crosses the outline. The highlighted strip shows where.';
        } else if (depth === 'cavity') {
          status.textContent = 'The outline crosses the recess. Shading stops at the missing face.';
        } else if (depth === 'rim') {
          status.textContent = 'The outline touches the rim. Move it inward to preview a closed cut.';
        } else if (depth === 'footprint') {
          status.textContent = 'Surface outline only. Cut depth through this solid is undecided.';
        } else if (hinge !== null) {
          status.textContent = selected.spec.kind === 'plane'
            ? 'Drag the gold handle to choose the edge that stays attached.'
            : 'The gold handle marks a straight hinge axis. Lift preview is available on this shell.';
        } else if (depth === 'through') {
          status.textContent = 'Clear through this shell. The blue dashes show the rear exit.';
        } else {
          status.textContent = 'Draw on a shell or on the front face of a solid.';
        }
      };
      syncPanel();
    },
    dispose() {
      if (pointer) endGesture();
      listeners.abort();
      canvas.style.cursor = priorCursor;
      clearMotion();
      stopPose();
      overlay.group.visible = false;
    },
  };
}
