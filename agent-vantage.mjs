// The agent vantage inside a live Kaminos page: a small sub, stored as an
// ordinary camera object, that an agent pilots from the terminal and the
// operator selects and moves like any other object. A picture from the sub
// borrows the viewport camera for a few frames, so every layer the page draws
// (scene, fire volume, water) renders from the sub through its own loop, then
// the operator's view is restored.
import {
  VANTAGE_SCHEMA, DEFAULT_PILOT, vantageCameraId, poseLookingAt, poseAxes, movedPose, turnedPose,
  orbitPose, framePose, framingDistance, objectsInView, objectsInProjection, viewChange, resolveTarget, checkedCommand,
} from './agent-vantage-core.mjs';
import {CAMERA_TYPE, CAMERA_SOURCE, checkedCameraRecord, cameraViewFromRecord} from './scene-camera.mjs';

export const VANTAGE_GLYPH_NAME = 'kaminos-vantage-glyph';
const SUB_PREFIX = 'vantage-';
const HIDDEN = 'The Kaminos tab is hidden, and browsers stop drawing hidden tabs. Bring it to the front; it can sit in its own window.';

export class VantageCommandError extends Error {
  constructor(phase, message) {
    super(message);
    this.phase = phase;
  }
}
const fail = (phase, message) => { throw new VantageCommandError(phase, message); };
const isSub = record => record.type === CAMERA_TYPE && record.id.startsWith(SUB_PREFIX);
const pilotOf = record => record.id.slice(SUB_PREFIX.length);
const defaultLabel = pilot => pilot === DEFAULT_PILOT ? 'Bebop' : `Vantage ${pilot}`;
const formatNumber = value => String(Math.round(value * 1000) / 1000);

/**
 * Pilot logic over injected application services. `host.objects()` returns
 * `{id,label,type,bounds}` rows; `compose`, `encode`, `annotate` and `sheet`
 * own pixels; `suspendHelpers({all, hide})` hides all editor drawing when
 * `all` is true plus the listed object ids, and returns a restore function.
 * `hold()` takes the page's document lock for the whole capture so the
 * operator's camera actions cannot save the borrowed view; it returns a
 * release function. `frameState().layers` maps canvas ids to frame counters
 * and `cameraMatrices()` returns the matrices the page is rendering with.
 */
export function createVantagePilot(host) {
  let capturing = false;
  const aspect = () => {
    const {width, height} = host.viewportSize();
    if (!(width > 0 && height > 0)) fail('viewport', 'The Kaminos viewport has no visible area');
    return width / height;
  };
  const cameras = () => host.cameras.read().cameras;
  const subRecord = pilot => cameras().find(record => record.id === vantageCameraId(pilot)) ?? null;
  const requireSub = pilot => subRecord(pilot) ?? fail('no-sub', `There is no ${pilot} sub in this scene. Run "launch" first.`);
  const subIds = () => cameras().filter(isSub).map(record => record.id);
  const viewOf = record => cameraViewFromRecord(record, aspect(), 3);
  const describe = record => record && {pilot: pilotOf(record), id: record.id, label: record.label,
    pose: structuredClone(record.transform), lens: record.camera.lens, view: viewOf(record)};
  const targets = (exclude = []) => [...host.objects(), ...host.extraTargets()].filter(object => !exclude.includes(object.id));
  const target = (spec, record) => {
    try { return resolveTarget(spec, {objects: targets(record ? [record.id] : []), selection: host.selection()}); }
    catch (error) { return fail('target', error.message); }
  };
  const admitEdit = () => {
    const reason = host.busy();
    if (reason) fail('busy', reason);
    const edits = host.edits.state();
    if (edits.active || edits.replaying) fail('busy', 'Kaminos has an edit in progress');
  };
  const admitCapture = () => {
    if (capturing) fail('busy', 'Another vantage capture is in progress');
    if (!host.visible()) fail('page-hidden', HIDDEN);
    const reason = host.busy();
    if (reason) fail('busy', reason);
  };
  const pose = (record, next, what) => {
    admitEdit();
    host.edits.apply(record.id, next, `${record.label}: ${what}`);
    host.glyph?.();
    return {sub: describe(subRecord(pilotOf(record)))};
  };
  const cameraLabel = id => cameras().find(record => record.id === id)?.label ?? id;
  // Choose how the sub's view reaches the canvas: borrow the viewport, or use
  // the operator's own camera view when they are already looking through it.
  const route = record => {
    const state = host.cameras.state();
    if (state.mode !== 'camera') return {route: 'viewport-borrow', borrow: true};
    if (state.activeId === record.id) return {route: 'operator-camera-view', borrow: false};
    return fail('camera-view', `The viewport is looking through scene camera "${cameraLabel(state.activeId)}". Leave camera view (Numpad 0) first, or use peek to picture that view.`);
  };
  // Name what a picture shows from the matrices it was rendered with, which
  // include camera-frame zoom and offset, roll and lens, and from the scene
  // as it stood when that picture was composed.
  const namesFor = (shot, hideHelpers) => {
    const rows = (shot.rows ?? targets()).filter(object => !(hideHelpers && object.type === CAMERA_TYPE));
    return shot.optics ? objectsInProjection(shot.optics, rows, {excludeIds: subIds()})
      : objectsInView(shot.view, aspect(), rows, {excludeIds: subIds()});
  };

  async function capture({record = null, borrow, check, settle, maxSize, hideHelpers, frames = 1, interval = 0}) {
    if (capturing) fail('busy', 'Another vantage capture is in progress');
    capturing = true;
    let release = null, restore = null, original = null, requested = null, before = null, started = null;
    const shots = [];
    try {
      try { release = host.hold?.() ?? null; }
      catch (error) { fail('busy', error.message); }
      original = host.readView();
      requested = borrow ? viewOf(record) : original;
      before = host.frameState();
      if (hideHelpers || record) restore = host.suspendHelpers({all: hideHelpers, hide: record ? [record.id] : []});
      if (borrow) host.writeView(requested);
      host.redraw();
      let since = host.frameState();
      await host.frames(settle);
      started = host.now();
      for (let index = 0; index < frames; index++) {
        if (index) { await host.sleep(interval); host.redraw(); await host.frames(1); }
        if (!host.visible()) fail('page-hidden', HIDDEN);
        const frame = host.frameState(), view = host.readView(), deviation = viewChange(requested, view);
        if (check && deviation.changed) {
          fail('view-changed', `The viewport camera changed during the capture (${deviation.position.toFixed(3)} m, ${deviation.angle.toFixed(2)}° heading, ${deviation.roll.toFixed(2)}° roll, ${deviation.fov.toFixed(2)}° lens); nothing was kept`);
        }
        const optics = host.cameraMatrices?.() ?? null, rows = targets(), shot = host.compose({maxSize}), stale = [], unverified = [];
        // Every pictured canvas must have drawn since the view was requested.
        for (const layer of shot.layers) {
          const now = frame.layers?.[layer], then = since.layers?.[layer];
          if (!Number.isFinite(now)) unverified.push(layer);
          else if (Number.isFinite(then) && !(now > then)) stale.push(layer);
        }
        if (stale.length) fail('stale-frame', `Kaminos did not draw a new frame from the requested view in ${stale.join(', ')}, so nothing was kept. The page may still be loading or paused.`);
        if (host.blank?.(shot.canvas)) fail('blank-frame', 'The picture came back as one flat color, which usually means the page has not drawn its scene yet. Try again in a moment; if the sub faces a blank surface, point it elsewhere.');
        since = frame;
        shots.push({index, atMs: host.now() - started, view, deviation, optics, rows, frame, shot, unverified});
      }
      return {requested, shots, before, after: host.frameState()};
    } finally {
      try { if (borrow && original) host.writeView(original); }
      finally {
        try { restore?.(); }
        finally {
          try { host.redraw(); }
          finally { capturing = false; release?.(); }
        }
      }
    }
  }

  function pictureResult({kind, routeName, record, taken, settle, hideHelpers, images, seen, extra = {}}) {
    const first = taken.shots[0];
    return {schema: VANTAGE_SCHEMA, kind, route: routeName, ...(record ? {pilot: pilotOf(record), sub: describe(record)} : {}),
      requestedView: taken.requested, view: first.view, viewDeviation: first.deviation, aspect: aspect(),
      layers: first.shot.layers, unverifiedLayers: [...new Set(taken.shots.flatMap(item => item.unverified))],
      naming: first.optics ? 'effective-camera' : 'nominal-view', settleFrames: settle, helpers: hideHelpers ? 'hidden' : 'shown',
      image: {width: first.shot.width, height: first.shot.height}, images, objects: seen,
      frame: {before: taken.before, after: taken.after}, capturedAt: new Date(host.now()).toISOString(), ...extra};
  }

  function picture(kind, shot, annotate, seen) {
    const images = [{name: kind, ...host.encode(shot.canvas)}];
    if (annotate) images.push({name: 'annotated', ...host.encode(host.annotate(shot.canvas, seen.inView))});
    return images;
  }

  const handlers = {
    status: () => ({schema: VANTAGE_SCHEMA, subs: cameras().filter(isSub).map(describe),
      operator: {view: host.readView(), selection: host.selection()}, viewport: host.viewportSize(), aspect: aspect(),
      busy: host.busy(), visible: host.visible(), cameraMode: host.cameras.state(), frame: host.frameState()}),

    objects({pilot}) {
      const record = subRecord(pilot), rows = targets(subIds());
      return {objects: rows, sub: describe(record), ...(record ? {fromSub: objectsInView(viewOf(record), aspect(), rows)} : {})};
    },

    launch({pilot, label, placement, lens}) {
      const existing = subRecord(pilot);
      if (existing) return {created: false, sub: describe(existing)};
      admitEdit();
      const view = host.readView();
      const at = placement === 'operator' ? view.position : view.position.map((v, i) => v + (view.target[i] - v) * 0.35);
      const record = checkedCameraRecord({id: vantageCameraId(pilot), label: label ?? defaultLabel(pilot), type: CAMERA_TYPE,
        source: CAMERA_SOURCE, fileName: 'Camera', createdAt: new Date(host.now()).toISOString(),
        transform: poseLookingAt(at, view.target, view.up),
        camera: {projection: 'perspective', lens, sensorWidth: 36, near: 0.05, far: 1000}});
      const current = host.cameras.read();
      host.edits.apply('@scene-cameras', {settings: current.settings, cameras: [...current.cameras, record]}, `Launch ${record.label}`);
      host.glyph?.();
      return {created: true, sub: describe(subRecord(pilot))};
    },

    remove({pilot}) {
      const current = host.cameras.read(), id = vantageCameraId(pilot), record = current.cameras.find(item => item.id === id);
      if (!record) return {removed: false, pilot};
      admitEdit();
      host.edits.apply('@scene-cameras', {settings: {...current.settings, activeId: current.settings.activeId === id ? null : current.settings.activeId},
        cameras: current.cameras.filter(item => item.id !== id)}, `Remove ${record.label}`);
      return {removed: true, pilot};
    },

    goto({pilot, position, lookAt}) {
      const record = requireSub(pilot);
      if (lookAt == null) return pose(record, {...record.transform, position}, `go to (${position.map(formatNumber).join(', ')})`);
      const aim = target(lookAt, record);
      return {...pose(record, poseLookingAt(position, aim.center), `go to (${position.map(formatNumber).join(', ')}) and look at ${aim.label}`), target: aim};
    },
    move({pilot, forward, right, up}) { const record = requireSub(pilot); return pose(record, movedPose(record.transform, {forward, right, up}), 'move'); },
    turn({pilot, yaw, pitch}) { const record = requireSub(pilot); return pose(record, turnedPose(record.transform, {yaw, pitch}), 'turn'); },
    look({pilot, target: spec}) {
      const record = requireSub(pilot), aim = target(spec, record);
      let next;
      try { next = poseLookingAt(record.transform.position, aim.center); }
      catch (error) { fail('target', `${aim.label} is where the sub is; move away before looking at it`); }
      return {...pose(record, next, `look at ${aim.label}`), target: aim};
    },
    orbit({pilot, target: spec, radius, azimuth, elevation}) {
      const record = requireSub(pilot), aim = target(spec, record);
      const size = aim.bounds ? Math.max(Math.hypot(...aim.bounds.max.map((v, i) => v - aim.bounds.min[i])) / 2, 0.05) : null;
      const distance = radius ?? (size ? framingDistance(size, {vfovDeg: viewOf(record).fov, aspect: aspect(), margin: 1.3}) : 3);
      return {...pose(record, orbitPose(aim.center, {radius: distance, azimuth, elevation}), `orbit ${aim.label}`), target: aim};
    },
    frame({pilot, target: spec, margin}) {
      const record = requireSub(pilot), aim = target(spec, record);
      if (!aim.bounds) fail('target', 'Framing needs an object with bounds, not a point');
      const next = framePose(aim.bounds, {direction: poseAxes(record.transform).forward, vfovDeg: viewOf(record).fov, aspect: aspect(), margin});
      return {...pose(record, next, `frame ${aim.label}`), target: aim};
    },
    align({pilot}) {
      const record = requireSub(pilot), view = host.readView();
      return pose(record, poseLookingAt(view.position, view.target, view.up), 'align to operator view');
    },

    async snap({pilot, settle, maxSize, annotate, helpers}) {
      const record = requireSub(pilot);
      admitCapture();
      const {route: routeName, borrow} = route(record), hideHelpers = !helpers;
      const taken = await capture({record, borrow, check: true, settle, maxSize, hideHelpers});
      const seen = namesFor(taken.shots[0], hideHelpers);
      const images = picture('snap', taken.shots[0].shot, annotate, seen);
      host.shutter?.({kind: 'snap', label: record.label, image: images[0]});
      return pictureResult({kind: 'snap', routeName, record, taken, settle, hideHelpers, images, seen});
    },

    async peek({maxSize, annotate, clean}) {
      admitCapture();
      const taken = await capture({borrow: false, check: false, settle: 1, maxSize, hideHelpers: clean});
      const seen = namesFor(taken.shots[0], clean);
      const images = picture('peek', taken.shots[0].shot, annotate, seen);
      return pictureResult({kind: 'peek', routeName: 'operator-view', taken, settle: 1, hideHelpers: clean, images, seen});
    },

    async burst({pilot, count, interval, settle, maxSize, cell, annotate, frames}) {
      const record = requireSub(pilot);
      admitCapture();
      const {route: routeName, borrow} = route(record);
      const taken = await capture({record, borrow, check: true, settle, maxSize, hideHelpers: true, frames: count, interval});
      const seen = namesFor(taken.shots[0], true);
      const sheet = host.sheet(taken.shots.map(item => ({canvas: item.shot.canvas, label: `#${item.index + 1}  +${Math.round(item.atMs)} ms`})), {cell});
      const images = [{name: 'sheet', ...host.encode(sheet)}];
      if (annotate) images.push({name: 'annotated', ...host.encode(host.annotate(taken.shots[0].shot.canvas, seen.inView))});
      if (frames) taken.shots.forEach(item => images.push({name: `frame-${item.index + 1}`, ...host.encode(item.shot.canvas)}));
      host.shutter?.({kind: 'burst', label: record.label, image: images[0]});
      return pictureResult({kind: 'burst', routeName, record, taken, settle, hideHelpers: true, images, seen,
        extra: {interval, frames: taken.shots.map(item => ({index: item.index, atMs: item.atMs, frame: item.frame, view: item.view,
          viewDeviation: item.deviation, objects: namesFor(item, true)}))}});
    },
  };

  async function run(command, args = {}) {
    let checked;
    try { checked = checkedCommand({command, args}); }
    catch (error) { throw new VantageCommandError('validate', error.message); }
    return handlers[checked.command](checked.args);
  }
  return {run, isCapturing: () => capturing};
}

// --- pixels ---------------------------------------------------------------

const zIndex = style => Number.parseInt(style.zIndex, 10) || 0;
const opaque = color => {
  if (!color || color === 'transparent') return false;
  const match = /rgba?\(([^)]+)\)/.exec(color);
  if (!match) return true;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  return parts.length < 4 || Number.parseFloat(parts[3]) > 0;
};

// Composite the canvases the viewport displays, in stacking order, with each
// canvas's own CSS background behind it. DOM overlays are not pictured.
export function composeViewport({document, window, viewport, hostCanvas, maxSize = 1280}) {
  const base = hostCanvas.getBoundingClientRect();
  if (!(base.width > 0 && base.height > 0 && hostCanvas.width > 0 && hostCanvas.height > 0)) {
    throw new VantageCommandError('viewport', 'The Kaminos viewport has no visible area');
  }
  const sx = hostCanvas.width / base.width, sy = hostCanvas.height / base.height;
  const layers = [...viewport.querySelectorAll('canvas')]
    .map((canvas, order) => ({canvas, order, style: window.getComputedStyle(canvas), rect: canvas.getBoundingClientRect()}))
    .filter(({canvas, style, rect}) => canvas === hostCanvas || (style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity) > 0 && canvas.width > 1 && canvas.height > 1 && rect.width > 1 && rect.height > 1
      && rect.right > base.left && rect.left < base.right && rect.bottom > base.top && rect.top < base.bottom))
    .sort((a, b) => zIndex(a.style) - zIndex(b.style) || a.order - b.order);
  const full = document.createElement('canvas');
  full.width = hostCanvas.width; full.height = hostCanvas.height;
  const context = full.getContext('2d');
  for (const {canvas, style, rect} of layers) {
    const x = (rect.left - base.left) * sx, y = (rect.top - base.top) * sy, w = rect.width * sx, h = rect.height * sy;
    context.globalAlpha = Number(style.opacity) || 1;
    if (canvas !== hostCanvas && opaque(style.backgroundColor)) { context.fillStyle = style.backgroundColor; context.fillRect(x, y, w, h); }
    context.drawImage(canvas, x, y, w, h);
  }
  context.globalAlpha = 1;
  const scale = Math.min(1, maxSize / Math.max(full.width, full.height));
  let output = full;
  if (scale < 1) {
    output = document.createElement('canvas');
    output.width = Math.max(1, Math.round(full.width * scale)); output.height = Math.max(1, Math.round(full.height * scale));
    const small = output.getContext('2d');
    small.imageSmoothingQuality = 'high';
    small.drawImage(full, 0, 0, output.width, output.height);
  }
  return {canvas: output, width: output.width, height: output.height, sourceSize: [full.width, full.height],
    layers: layers.map(layer => layer.canvas.id || layer.canvas.className || 'canvas')};
}

export const encodeCanvas = canvas => ({mime: 'image/png', dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height});

// One flat color across a sampled grid (including fully transparent) means
// the canvas held no drawn scene.
export function isBlankCanvas(canvas) {
  const {width, height} = canvas, data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 48)), low = [255, 255, 255, 255], high = [0, 0, 0, 0];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) { low[c] = Math.min(low[c], data[i + c]); high[c] = Math.max(high[c], data[i + c]); }
    }
  }
  return high.every((value, c) => value - low[c] <= 2);
}

const LABEL_COLORS = ['#ffcf3f', '#5fd3c8', '#ff7aa8', '#a99bff', '#7dde6f', '#ff9f43'];

export function annotateCanvas(document, source, inView) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width; canvas.height = source.height;
  const context = canvas.getContext('2d'), unit = Math.max(1, canvas.width / 900);
  context.drawImage(source, 0, 0);
  context.lineWidth = 2 * unit;
  context.font = `${Math.round(13 * unit)}px ui-monospace, Menlo, monospace`;
  context.textBaseline = 'top';
  inView.forEach((object, i) => {
    const color = LABEL_COLORS[i % LABEL_COLORS.length], [x0, y0, x1, y1] = object.rect;
    const x = x0 * canvas.width, y = y0 * canvas.height, w = (x1 - x0) * canvas.width, h = (y1 - y0) * canvas.height;
    context.strokeStyle = color;
    context.setLineDash(object.partial ? [6 * unit, 4 * unit] : []);
    context.strokeRect(x, y, w, h);
    const text = `${object.label} · ${object.distance.toFixed(2)} m`, pad = 3 * unit, height = 16 * unit;
    const top = y - height - pad >= 0 ? y - height - pad : y + pad;
    context.fillStyle = 'rgba(10, 12, 16, 0.8)';
    context.fillRect(x, top, context.measureText(text).width + 2 * pad, height + pad);
    context.fillStyle = color;
    context.fillText(text, x + pad, top + pad / 2);
  });
  context.setLineDash([]);
  return canvas;
}

export function contactSheet(document, frames, {cell = 480} = {}) {
  if (!frames.length) throw new VantageCommandError('capture', 'A contact sheet needs at least one frame');
  const columns = Math.ceil(Math.sqrt(frames.length)), rows = Math.ceil(frames.length / columns), gap = 4;
  const width = cell, height = Math.round(cell * frames[0].canvas.height / frames[0].canvas.width);
  const canvas = document.createElement('canvas');
  canvas.width = columns * (width + gap) + gap; canvas.height = rows * (height + gap) + gap;
  const context = canvas.getContext('2d'), unit = Math.max(1, cell / 480);
  context.fillStyle = '#0d0f13';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = `${Math.round(13 * unit)}px ui-monospace, Menlo, monospace`;
  context.textBaseline = 'bottom';
  frames.forEach((frame, i) => {
    const x = gap + (i % columns) * (width + gap), y = gap + Math.floor(i / columns) * (height + gap);
    context.drawImage(frame.canvas, x, y, width, height);
    const metrics = context.measureText(frame.label);
    context.fillStyle = 'rgba(10, 12, 16, 0.8)';
    context.fillRect(x, y + height - 20 * unit, metrics.width + 10 * unit, 20 * unit);
    context.fillStyle = '#f2f2f2';
    context.fillText(frame.label, x + 5 * unit, y + height - 4 * unit);
  });
  return canvas;
}

// --- presence in the scene -------------------------------------------------

// A small yellow sub with a glowing lens and a few octopus arms. Its nose and
// lens face local -Z, the direction the camera looks.
export function buildSubGlyph(THREE) {
  const group = new THREE.Group();
  group.name = VANTAGE_GLYPH_NAME;
  group.userData.kaminosEditorOnly = true;
  const hull = new THREE.MeshStandardMaterial({color: 0xf2b134, roughness: 0.45, metalness: 0.25});
  const trim = new THREE.MeshStandardMaterial({color: 0x3a3f55, roughness: 0.6, metalness: 0.3});
  const lens = new THREE.MeshStandardMaterial({color: 0x0b1416, emissive: 0x38f2e0, emissiveIntensity: 2.2, roughness: 0.3});
  const arm = new THREE.MeshStandardMaterial({color: 0x9b59d0, roughness: 0.55});
  const add = (geometry, material, place = () => {}) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.kaminosEditorOnly = true;
    place(mesh);
    group.add(mesh);
  };
  add(new THREE.CapsuleGeometry(0.055, 0.15, 6, 16), hull, mesh => { mesh.rotation.x = Math.PI / 2; });
  add(new THREE.BoxGeometry(0.036, 0.05, 0.065), hull, mesh => mesh.position.set(0, 0.07, 0.015));
  add(new THREE.CylinderGeometry(0.005, 0.005, 0.05, 8), trim, mesh => mesh.position.set(0, 0.115, 0.03));
  add(new THREE.BoxGeometry(0.012, 0.012, 0.03), trim, mesh => mesh.position.set(0, 0.14, 0.022));
  add(new THREE.BoxGeometry(0.13, 0.006, 0.03), trim, mesh => mesh.position.set(0, 0, 0.125));
  add(new THREE.BoxGeometry(0.006, 0.08, 0.03), trim, mesh => mesh.position.set(0, 0, 0.125));
  add(new THREE.TorusGeometry(0.032, 0.008, 10, 28), lens, mesh => mesh.position.set(0, 0, -0.112));
  add(new THREE.CircleGeometry(0.026, 24), lens, mesh => { mesh.position.set(0, 0, -0.113); mesh.rotation.y = Math.PI; });
  for (let i = 0; i < 4; i++) {
    const side = i < 2 ? -1 : 1, z = i % 2 ? 0.04 : -0.03;
    const curve = new THREE.CatmullRomCurve3([[0.025, -0.045, z], [0.05, -0.09, z + 0.02], [0.04, -0.12, z + 0.06], [0.015, -0.115, z + 0.09]]
      .map(([x, y, w]) => new THREE.Vector3(x * side, y, w)));
    add(new THREE.TubeGeometry(curve, 16, 0.007, 6, false), arm);
  }
  return group;
}

const HUD_STYLE = `
#agent-vantage-hud{position:absolute;top:52px;right:12px;z-index:20;width:220px;background:rgba(14,16,20,.88);border:1px solid rgba(95,211,200,.45);border-radius:8px;color:#e8ecef;font:11px ui-monospace,Menlo,monospace;overflow:hidden;box-shadow:0 6px 18px rgba(0,0,0,.35)}
#agent-vantage-hud[hidden]{display:none}
#agent-vantage-hud .vantage-head{display:flex;align-items:center;gap:6px;padding:5px 7px}
#agent-vantage-hud .vantage-dot{width:7px;height:7px;border-radius:50%;background:#6b7280}
#agent-vantage-hud[data-link="linked"] .vantage-dot{background:#38f2e0}
#agent-vantage-hud .vantage-title{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#agent-vantage-hud button{background:none;border:0;color:#9aa3ad;cursor:pointer;font:inherit;padding:0 2px}
#agent-vantage-hud img{display:block;width:100%;height:auto}
#agent-vantage-hud.flash{animation:agent-vantage-flash .6s ease-out}
@keyframes agent-vantage-flash{from{box-shadow:0 0 0 3px rgba(56,242,224,.9)}to{box-shadow:0 6px 18px rgba(0,0,0,.35)}}`;

// Shows the operator each picture the sub takes, so both see the same image.
export function installVantageHud({document, viewport}) {
  if (!document.getElementById('agent-vantage-style')) {
    const style = document.createElement('style');
    style.id = 'agent-vantage-style';
    style.textContent = HUD_STYLE;
    document.head.append(style);
  }
  const root = document.createElement('div');
  root.id = 'agent-vantage-hud';
  root.hidden = true;
  root.innerHTML = '<div class="vantage-head"><span class="vantage-dot"></span><span class="vantage-title">Sub</span><button type="button" aria-label="Hide the sub picture">×</button></div><img alt="Latest picture from the agent sub">';
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'click', 'dblclick', 'wheel']) root.addEventListener(type, event => event.stopPropagation());
  root.querySelector('button').addEventListener('click', () => { root.hidden = true; });
  viewport.append(root);
  return {
    link(status) { root.dataset.link = status.state; },
    shutter({kind, label, image}) {
      root.querySelector('img').src = image.dataUrl;
      root.querySelector('.vantage-title').textContent = `${label} · ${kind} · ${new Date().toLocaleTimeString()}`;
      root.hidden = false;
      root.classList.remove('flash');
      void root.offsetWidth;
      root.classList.add('flash');
    },
    dispose() { root.remove(); },
  };
}

// --- link to the terminal --------------------------------------------------

// Runs commands one at a time in arrival order. A command whose deadline
// passed while it waited is answered as expired instead of being run.
export function createCommandPump({run, reply, now = () => Date.now()}) {
  const queue = [];
  let pumping = null;
  async function drain() {
    while (queue.length) {
      const message = queue.shift();
      let answer;
      if (Number.isFinite(message.expiresAt) && now() > message.expiresAt) {
        answer = {id: message.id, ok: false, phase: 'expired', error: 'The command waited past its deadline and was not run'};
      } else {
        try { answer = {id: message.id, ok: true, result: await run(message.command, message.args)}; }
        catch (error) { answer = {id: message.id, ok: false, error: error?.message || String(error), phase: error?.phase || 'execute'}; }
      }
      try { await reply(answer); }
      catch (error) { console.warn('Agent vantage reply was not delivered', error); }
    }
  }
  return {
    push(message) {
      queue.push(message);
      if (!pumping) pumping = drain().finally(() => { pumping = null; });
      return pumping;
    },
    idle: () => pumping ?? Promise.resolve(),
  };
}

export function connectVantageLink({window, document, endpoint, pageId, run, onStatus = () => {}}) {
  let source = null, closed = false, retry = null;
  const post = (path, body) => window.fetch(endpoint + path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const facts = () => ({page: pageId, visible: document.visibilityState === 'visible', focused: document.hasFocus(), href: window.location.href, title: document.title});
  const presence = () => { if (!closed) post('/presence', facts()).catch(() => {}); };
  const pump = createCommandPump({run, reply: answer => post('/reply', {page: pageId, ...answer})});
  function open() {
    if (closed) return;
    const url = new URL(`${endpoint}/link`, window.location.href), now = facts();
    for (const [key, value] of Object.entries({page: pageId, href: now.href, title: now.title, visible: now.visible ? '1' : '0', focused: now.focused ? '1' : '0'})) url.searchParams.set(key, value);
    source = new window.EventSource(url);
    source.addEventListener('open', () => { onStatus({state: 'linked', pageId}); presence(); });
    source.addEventListener('command', event => {
      let message;
      try { message = JSON.parse(event.data); }
      catch (error) { console.warn('Malformed agent vantage command', error); return; }
      pump.push(message);
    });
    source.addEventListener('error', () => {
      if (source.readyState !== window.EventSource.CLOSED) { onStatus({state: 'reconnecting', pageId}); return; }
      onStatus({state: 'offline', pageId});
      // A server without the vantage bridge answers 404: stop asking it.
      window.fetch(`${endpoint}/pages`).then(response => {
        if (response.status === 404) { closed = true; onStatus({state: 'unavailable', pageId}); }
        else retry = window.setTimeout(open, 5000);
      }, () => { retry = window.setTimeout(open, 5000); });
    });
  }
  document.addEventListener('visibilitychange', presence);
  window.addEventListener('focus', presence);
  window.addEventListener('blur', presence);
  const heartbeat = window.setInterval(presence, 15000);
  open();
  return {
    pageId,
    close() {
      closed = true;
      source?.close();
      window.clearTimeout(retry);
      window.clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', presence);
      window.removeEventListener('focus', presence);
      window.removeEventListener('blur', presence);
    },
  };
}

const animationFrames = (window, count) => new Promise(resolve => {
  let seen = 0;
  const tick = () => (++seen >= count ? resolve() : window.requestAnimationFrame(tick));
  window.requestAnimationFrame(tick);
});

/**
 * Join the vantage to the running application. `entries()` returns live
 * scene entries `{id,label,fileName,type,object}`; `suspendEditorDrawing`
 * hides editor-only drawing for a clean picture and returns a restore function.
 */
export function installAgentVantage({THREE, document, window, edits, cameras, entries, selection, readView, writeView,
  viewport, hostCanvas, busy, hold, cameraMatrices, suspendEditorDrawing, redraw, frameState, extraTargets = () => [],
  endpoint = '/api/vantage', link = true}) {
  const hud = installVantageHud({document, viewport});
  const boundsOf = object => {
    object.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(object);
    return box.isEmpty() ? null : {min: box.min.toArray(), max: box.max.toArray()};
  };
  const glyph = () => {
    for (const entry of entries()) {
      if (entry.type !== CAMERA_TYPE || !entry.id.startsWith(SUB_PREFIX) || !entry.object || entry.object.getObjectByName(VANTAGE_GLYPH_NAME)) continue;
      entry.object.add(buildSubGlyph(THREE));
      entry.object.material?.color?.set?.(0x5fd3c8);
      redraw();
    }
  };
  const pilot = createVantagePilot({
    edits, cameras, selection, readView, writeView, busy, hold, cameraMatrices, redraw, frameState, extraTargets, glyph,
    objects: () => entries().map(entry => ({id: entry.id, label: entry.label || entry.fileName || entry.id, type: entry.type,
      bounds: entry.object ? boundsOf(entry.object) : null})),
    viewportSize: () => ({width: viewport.clientWidth, height: viewport.clientHeight}),
    visible: () => document.visibilityState === 'visible',
    suspendHelpers: options => suspendEditorDrawing(options),
    frames: count => animationFrames(window, count),
    sleep: ms => new Promise(resolve => window.setTimeout(resolve, ms)),
    compose: ({maxSize}) => composeViewport({document, window, viewport, hostCanvas, maxSize}),
    encode: encodeCanvas,
    blank: isBlankCanvas,
    annotate: (canvas, inView) => annotateCanvas(document, canvas, inView),
    sheet: (frames, options) => contactSheet(document, frames, options),
    now: () => Date.now(),
    shutter: info => hud.shutter(info),
  });
  glyph();
  const glyphTimer = window.setInterval(glyph, 1000);
  const pageId = `page-${window.crypto.randomUUID()}`;
  const connection = link ? connectVantageLink({window, document, endpoint, pageId, run: pilot.run, onStatus: status => hud.link(status)}) : null;
  return {
    pageId, run: pilot.run,
    dispose() { window.clearInterval(glyphTimer); connection?.close(); hud.dispose(); },
  };
}

