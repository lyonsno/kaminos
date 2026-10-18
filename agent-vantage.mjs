// The agent vantage inside a live Kaminos page: a small sub, stored as an
// ordinary camera object, that an agent pilots from the terminal and the
// operator selects and moves like any other object. A picture from the sub
// borrows the viewport camera for a few frames, so every layer the page draws
// (scene, fire volume, water) renders from the sub through its own loop, then
// the operator's view is restored. Each picture also keeps a pick map, the
// renderer's own record of which object it drew at each pixel.
import {
  VANTAGE_SCHEMA, DEFAULT_PILOT, vantageCameraId, poseLookingAt, poseAxes, movedPose, turnedPose,
  orbitPose, framePose, framingDistance, objectsInView, objectsInProjection, viewChange, resolveTarget, checkedCommand,
  SKETCH_SCHEMA, sketchMapLayout, opticsOfView, opticsInConvention, rayThrough, rayCrossesBox, insideClipDepth,
  finishPickMap, NOTHING_DRAWN, UNIDENTIFIED, pixelAt, pointAtViewDepth,
} from './agent-vantage-core.mjs';
import {CAMERA_TYPE, CAMERA_SOURCE, checkedCameraRecord, cameraViewFromRecord} from './scene-camera.mjs';
import {GLANCE_OMITS} from './agent-vantage-glance.mjs';

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
 * `hold()` holds the operator's camera actions, navigation and viewport
 * input for the whole capture, so nothing saves or acts through the
 * borrowed view; it returns a release function. `frameState().layers` maps canvas ids to frame counters
 * and `cameraMatrices()` returns the matrices the page is rendering with.
 * `drawIds({optics, width, height, hide, region})` draws a pick map now and
 * returns the rows describing what it drew, the clouds, fields and water
 * drawn outside it, and a promise of the numbers read back. `surfaceOf`
 * casts a pick's ray at the mesh a pick map named.
 */
// The intervals of a watch that got no frame, worked out afterwards from when
// its frames started. Interval k runs from k·interval to the next interval's
// start or the end, whichever comes first, and is missed when no frame started
// inside it. Boundaries are multiplied out, never found by division, so a frame
// on a boundary belongs to the interval that starts there. `end` is the
// window's end, or with an event, the event plus `after`.
export function watchMissedTicks({starts, interval, end}) {
  const sorted = [...starts].sort((a, b) => a - b);
  let missed = 0, next = 0;
  for (let k = 0; k * interval < end; k++) {
    const from = k * interval, to = Math.min((k + 1) * interval, end);
    while (next < sorted.length && sorted[next] < from) next++;
    if (!(next < sorted.length && sorted[next] < to)) missed++;
  }
  return missed;
}

export function createVantagePilot(host) {
  // `released` resolves when the current picture releases the camera.
  let capturing = false, released = Promise.resolve(), markReleased = () => {};
  let watching = null;   // a watch in progress, for page readers
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

  async function capture({record = null, borrow, check, settle, maxSize, hideHelpers, frames = 1, interval = 0, depth = true}) {
    if (capturing) fail('busy', 'Another vantage capture is in progress');
    capturing = true;
    released = new Promise(resolve => { markReleased = resolve; });
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
        // The pick map is drawn in the task that composed the picture, with the matrices it recorded.
        let drawing = null, drawError = null;
        if (host.drawIds && optics) {
          try { drawing = host.drawIds({optics, width: shot.width, height: shot.height, hide: record ? [record.id] : [], depth}); }
          catch (error) { drawError = error?.message || String(error); }
        }
        shots.push({index, atMs: host.now() - started, view, deviation, optics, rows, frame, shot, unverified, drawing, drawError});
      }
      return {requested, shots, before, after: host.frameState()};
    } finally {
      try { if (borrow && original) host.writeView(original); }
      finally {
        try { restore?.(); }
        finally {
          try { host.redraw(); }
          finally { capturing = false; markReleased(); release?.(); }
        }
      }
    }
  }

  // Pick maps are read back once the camera is released. A picture whose map
  // failed is still a picture; it says why it has no map.
  async function withPickMaps(taken) {
    for (const item of taken.shots) {
      item.pickMap = null;
      if (!item.drawing) continue;
      try { item.pickMap = finishPickMap(await item.drawing.ready, item.drawing.rows, item.drawing.context); }
      catch (error) { item.drawError = error?.message || String(error); }
      delete item.drawing;
    }
    return taken;
  }
  const pickMapOf = item => ({pickMap: item.pickMap ?? null, ...(item.drawError ? {pickMapError: item.drawError} : {})});

  function pictureResult({kind, routeName, record, taken, settle, hideHelpers, images, seen, extra = {}}) {
    const first = taken.shots[0];
    return {schema: VANTAGE_SCHEMA, kind, route: routeName, ...(record ? {pilot: pilotOf(record), sub: describe(record)} : {}),
      requestedView: taken.requested, view: first.view, viewDeviation: first.deviation, aspect: aspect(),
      layers: first.shot.layers, unverifiedLayers: [...new Set(taken.shots.flatMap(item => item.unverified))],
      naming: first.optics ? 'effective-camera' : 'nominal-view', optics: first.optics ?? null, settleFrames: settle, helpers: hideHelpers ? 'hidden' : 'shown',
      image: {width: first.shot.width, height: first.shot.height}, images, objects: seen, ...(kind === 'burst' ? {} : pickMapOf(first)),
      frame: {before: taken.before, after: taken.after}, capturedAt: new Date(host.now()).toISOString(), ...extra};
  }

  function picture(kind, shot, annotate, seen) {
    const images = [{name: kind, ...host.encode(shot.canvas)}];
    if (annotate) images.push({name: 'annotated', ...host.encode(host.annotate(shot.canvas, seen.inView))});
    return images;
  }

  // The scene as named boxes, fields and cameras: readable without rendering the scene.
  // `optics` are the matrices the operator's viewport renders with, including
  // a camera frame's zoom and offset; a sub the operator is looking through
  // pictures through those same matrices.
  const sketch = () => {
    const optics = host.cameraMatrices?.() ?? null, state = host.cameras.state();
    const through = record => optics && state.mode === 'camera' && state.activeId === record.id;
    return {schema: SKETCH_SCHEMA, capturedAt: new Date(host.now()).toISOString(),
      objects: host.objects().filter(object => !object.id.startsWith(SUB_PREFIX)), fields: host.extraTargets(),
      operator: {view: host.readView(), aspect: aspect(), ...(optics ? {optics} : {})},
      subs: cameras().filter(isSub).map(record => ({pilot: pilotOf(record), id: record.id, label: record.label, view: viewOf(record),
        ...(through(record) ? {optics} : {})}))};
  };
  const mapOf = (current, size) => {
    const layout = sketchMapLayout(current, {width: size, height: Math.round(size * 0.75)});
    return {image: {name: 'map', ...host.encode(host.paintMap(layout))}, scaleBar: layout.scaleBar};
  };
  const withMap = (images, wanted) => wanted && host.paintMap ? [...images, mapOf(sketch(), 480).image] : images;

  // One view from the sub's own camera, with its pick map drawn in the same
  // task with the same matrices. Everything the record says about the view is
  // taken as it is drawn: a later edit or resize changes none of it.
  async function glanceOf(record, {maxSize, depth, phase}) {
    const ratio = aspect(), width = ratio >= 1 ? maxSize : Math.max(1, Math.round(maxSize * ratio)), height = ratio >= 1 ? Math.max(1, Math.round(maxSize / ratio)) : maxSize;
    const view = viewOf(record), sub = describe(record), optics = opticsOfView(view, ratio, {coordinateSystem: host.coordinateSystem}), hide = [record.id];
    const seen = objectsInProjection(optics, targets().filter(object => object.type !== CAMERA_TYPE), {excludeIds: subIds()});
    let drawn, drawing = null, drawError = null;
    try { drawn = host.renderView({optics, width, height, hide}); }
    catch (error) { fail(phase, `The sub's view could not be drawn: ${error?.message || error}`); }
    if (host.drawIds) {
      try { drawing = host.drawIds({optics, width, height, hide, depth, bridges: true}); }
      catch (error) { drawError = error?.message || String(error); }
    }
    let shot;
    try { shot = await drawn.ready; }
    catch (error) { fail(phase, `The sub's view could not be read back: ${error?.message || error}`); }
    const item = {drawing, drawError};
    await withPickMaps({shots: [item]});
    return {view, sub, ratio, optics, seen, shot, item};
  }

  // An event's detail is carried only when it is plain data that copies as
  // sent: null, booleans, finite numbers, strings, arrays and plain objects,
  // read once from their own data properties. Anything else (getters, symbol
  // keys, extra array properties, cycles, other objects) is reported by path,
  // and the event itself is kept.
  const plainCopy = (value, path, stack) => {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`${path} is ${value}`);
      if (Object.is(value, -0)) throw new Error(`${path} is -0, which JSON carries as 0`);
      return value;
    }
    if (typeof value !== 'object') throw new Error(`${path} is a ${typeof value}`);
    if (stack.includes(value)) throw new Error(`${path} refers back to itself`);
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw new Error(`${path} is a ${value.constructor?.name ?? 'non-plain object'}`);
    const keys = Reflect.ownKeys(value), copy = array ? [] : {};
    for (const key of keys) {
      if (typeof key === 'symbol') throw new Error(`${path} has a symbol key ${String(key)}`);
      if (array && key === 'length') continue;
      const where = array ? `${path}[${key}]` : `${path}.${key}`;
      // An array index is a canonical integer from 0 to 2^32 - 2; JSON drops any other key.
      if (array && !(String(Number(key)) === key && Number.isInteger(Number(key)) && Number(key) >= 0 && Number(key) < 2 ** 32 - 1)) throw new Error(`${where} is not an array entry`);
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (!('value' in descriptor)) throw new Error(`${where} is a getter`);
      if (!descriptor.enumerable) throw new Error(`${where} is not enumerable`);
      // Defined, not assigned, so a key such as __proto__ stays an own data property.
      Object.defineProperty(copy, key, {value: plainCopy(descriptor.value, where, [...stack, value]), enumerable: true, writable: true, configurable: true});
    }
    if (array && copy.length !== value.length) throw new Error(`${path} has missing entries`);
    if (array) for (let i = 0; i < copy.length; i++) if (!(i in copy)) throw new Error(`${path}[${i}] is missing`);
    return copy;
  };
  const eventDetail = detail => {
    if (detail === undefined || detail === null) return {detail: null};
    try { return {detail: plainCopy(detail, 'detail', [])}; }
    catch (error) { return {detail: null, detailError: `${error?.message || String(error)}; only plain data is carried`}; }
  };

  const handlers = {
    sketch: () => sketch(),
    map({size}) {
      const current = sketch(), {image, scaleBar} = mapOf(current, size);
      return {schema: VANTAGE_SCHEMA, kind: 'map', images: [image], scaleBar, sketch: current, capturedAt: current.capturedAt};
    },

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

    async snap({pilot, settle, maxSize, annotate, helpers, map}) {
      const record = requireSub(pilot);
      admitCapture();
      const {route: routeName, borrow} = route(record), hideHelpers = !helpers;
      const taken = await withPickMaps(await capture({record, borrow, check: true, settle, maxSize, hideHelpers}));
      const seen = namesFor(taken.shots[0], hideHelpers);
      const images = withMap(picture('snap', taken.shots[0].shot, annotate, seen), map);
      host.shutter?.({kind: 'snap', label: record.label, image: images[0]});
      return pictureResult({kind: 'snap', routeName, record, taken, settle, hideHelpers, images, seen});
    },

    async peek({maxSize, annotate, clean, map}) {
      admitCapture();
      const taken = await withPickMaps(await capture({borrow: false, check: false, settle: 1, maxSize, hideHelpers: clean}));
      const seen = namesFor(taken.shots[0], clean);
      const images = withMap(picture('peek', taken.shots[0].shot, annotate, seen), map);
      return pictureResult({kind: 'peek', routeName: 'operator-view', taken, settle: 1, hideHelpers: clean, images, seen});
    },

    // The sub's view from its own camera, drawn into its own targets: the
    // operator's view is never borrowed or held. Its pick map is drawn in the
    // same task with the same matrices. It shows what the scene renderer draws
    // and says what it leaves out.
    async glance({pilot, maxSize, annotate, map}) {
      const record = requireSub(pilot);
      if (!host.renderView) fail('glance', 'This page cannot draw a second view of its scene');
      const {view, sub, ratio, optics, seen, shot, item} = await glanceOf(record, {maxSize, depth: true, phase: 'glance'});
      const images = withMap(picture('glance', shot, annotate, seen), map);
      host.shutter?.({kind: 'glance', label: record.label, image: images[0]});
      return {schema: VANTAGE_SCHEMA, kind: 'glance', route: 'own-camera', pilot: pilotOf(record), sub, view,
        aspect: ratio, naming: 'effective-camera', optics, layers: ['scene'], omitted: [...GLANCE_OMITS],
        image: {width: shot.width, height: shot.height}, images, objects: seen, ...pickMapOf(item), capturedAt: new Date(host.now()).toISOString()};
    },

    // A small live view from the sub's own camera in the operator's panel, while on.
    live({pilot, on, fps}) {
      if (on) requireSub(pilot);
      if (!host.live) fail('live', 'This page cannot draw a second view of its scene');
      return {schema: VANTAGE_SCHEMA, kind: 'live', live: on ? host.live.start({pilot, fps}) : host.live.stop()};
    },

    // A film strip from the sub's own camera: a glance at the start of each
    // frame interval of the window, from wherever the sub is then. The
    // operator's view is never borrowed. With `until`, the page event
    // `kaminos:<until>` ends the strip at once with one more frame. Draws never
    // stack, and no frame is drawn outside its own interval or after the deadline.
    async watch({pilot, seconds, fps, until, after = 0, maxSize, cell, frames, map, depth}) {
      requireSub(pilot);
      if (!host.renderView) fail('watch', 'This page cannot draw a second view of its scene');
      if (until && !host.listen) fail('watch', 'This page cannot listen for events, so it cannot watch until one');
      // One watch at a time, however it was asked for: the terminal's queue and the page API both reach here.
      if (watching) fail('busy', 'Another watch is running; ask again when it ends');
      const mine = {pilot, until, frames: 0};
      watching = mine;
      const started = host.now(), interval = 1000 / fps, windowMs = seconds * 1000, afterMs = after * 1000;
      // The deadline frames are drawn before: the window, or after an event, the event plus `after`.
      let deadlineMs = windowMs, extended = false;
      let event = null, wake = null;
      const heard = until ? new Promise(resolve => { wake = resolve; }) : null;
      // An event counts only when it comes before the deadline.
      const stopListening = until ? host.listen(until, detail => {
        const atMs = host.now() - started;
        if (event || atMs >= windowMs) return;
        event = {name: until, atMs, ...eventDetail(detail)};
        wake();
      }) : null;
      // Sleeps end early when the event comes; after it, they run their length.
      const sleep = ms => (heard && !extended ? Promise.race([host.sleep(ms), heard]) : host.sleep(ms));
      // The next tick to draw: a tick is drawn only inside its own interval and
      // before the deadline; ticks whose interval passed are skipped. Between the
      // last tick and the deadline the watch keeps listening. Returns 'event', a
      // tick, or null when the window is over. Missed intervals are counted
      // afterwards from the frames' start times (watchMissedTicks).
      const nextTick = async last => {
        let tick = last + 1;
        while (true) {
          if (event && !extended) return 'event';
          const elapsed = host.now() - started;
          while (tick * interval < deadlineMs && elapsed >= Math.min((tick + 1) * interval, deadlineMs)) tick++;
          if (elapsed >= deadlineMs) return null;
          if (tick * interval >= deadlineMs) { await sleep(deadlineMs - elapsed); continue; }
          if (elapsed >= tick * interval) return tick;
          await sleep(tick * interval - elapsed);
        }
      };
      const shots = [];
      const draw = async () => {
        shots.push({index: shots.length, atMs: host.now() - started, ...await glanceOf(requireSub(pilot), {maxSize, depth, phase: 'watch'})});
        mine.frames = shots.length;
      };
      try {
        await draw();
        let tick = 0;
        while (true) {
          const next = event && !extended ? 'event' : await nextTick(tick);
          if (next === null) break;
          if (next === 'event') {
            // The event came: one more frame at once shows what followed, then
            // with `after` the cadence goes on until that long after the event,
            // from the interval the event frame started in (boundaries multiplied
            // out, as everywhere), so that interval is not drawn twice.
            const startAt = host.now() - started;
            let startedIn = tick;
            while ((startedIn + 1) * interval <= startAt) startedIn++;
            await draw();
            extended = true;
            if (afterMs <= 0) break;
            deadlineMs = event.atMs + afterMs;
            tick = Math.max(tick, startedIn);
            continue;
          }
          await draw();
          tick = next;
        }
      } finally {
        stopListening?.();
        if (watching === mine) watching = null;
      }
      const record = subRecord(pilot), first = shots[0];
      const missedTicks = watchMissedTicks({starts: shots.map(item => item.atMs), interval, end: event ? event.atMs + afterMs : windowMs});
      const sheet = host.sheet(shots.map(item => ({canvas: item.shot.canvas, label: `#${item.index + 1}  +${Math.round(item.atMs)} ms`})), {cell});
      const images = [{name: 'sheet', ...host.encode(sheet)}];
      if (frames) shots.forEach(item => images.push({name: `frame-${item.index + 1}`, ...host.encode(item.shot.canvas)}));
      if (map && host.paintMap) images.push(mapOf(sketch(), 480).image);
      host.shutter?.({kind: 'watch', label: record?.label ?? first.sub?.label, image: images[0]});
      return {schema: VANTAGE_SCHEMA, kind: 'watch', route: 'own-camera', pilot, sub: record ? describe(record) : first.sub,
        requested: {seconds, fps, until, after}, ended: event ? 'event' : 'window', ...(event ? {event} : {}), missedTicks,
        aspect: first.ratio, naming: 'effective-camera', layers: ['scene'], omitted: [...GLANCE_OMITS],
        image: {width: first.shot.width, height: first.shot.height}, images, view: first.view, optics: first.optics, objects: first.seen,
        frames: shots.map(item => ({index: item.index, atMs: item.atMs, image: {width: item.shot.width, height: item.shot.height}, view: item.view, optics: item.optics,
          ...pickMapOf(item.item), objects: item.seen})),
        capturedAt: new Date(started).toISOString()};
    },

    async burst({pilot, count, interval, settle, maxSize, cell, annotate, frames, map, depth}) {
      const record = requireSub(pilot);
      admitCapture();
      const {route: routeName, borrow} = route(record);
      const taken = await withPickMaps(await capture({record, borrow, check: true, settle, maxSize, hideHelpers: true, frames: count, interval, depth}));
      const seen = namesFor(taken.shots[0], true);
      const sheet = host.sheet(taken.shots.map(item => ({canvas: item.shot.canvas, label: `#${item.index + 1}  +${Math.round(item.atMs)} ms`})), {cell});
      const images = [{name: 'sheet', ...host.encode(sheet)}];
      if (annotate) images.push({name: 'annotated', ...host.encode(host.annotate(taken.shots[0].shot.canvas, seen.inView))});
      if (frames) taken.shots.forEach(item => images.push({name: `frame-${item.index + 1}`, ...host.encode(item.shot.canvas)}));
      if (map && host.paintMap) images.push(mapOf(sketch(), 480).image);
      host.shutter?.({kind: 'burst', label: record.label, image: images[0]});
      return pictureResult({kind: 'burst', routeName, record, taken, settle, hideHelpers: true, images, seen,
        extra: {interval, frames: taken.shots.map(item => {
          const names = namesFor(item, true);
          return {index: item.index, atMs: item.atMs, frame: item.frame, view: item.view, viewDeviation: item.deviation,
            optics: item.optics ?? null, ...pickMapOf(item), objects: names};
        })}});
    },

    // What lies under a point of a view or of a kept picture. The answer is
    // the renderer's: a kept picture's pick map was drawn with the picture,
    // and a live pick draws one pixel of a pick map now. A pick names the
    // pixel its point falls in, through that pixel's centre. The point on the
    // object comes from the depth drawn there; without depth, from casting the
    // ray at that mesh where it was drawn.
    async pick({pilot, from, at, optics, pictured, scene}) {
      let source, camera;
      if (pictured) { source = 'picture'; camera = optics; }
      else if (optics) { source = 'camera'; camera = optics; }
      else if (from === 'operator') {
        // During a picture the viewport camera is the sub's, not the operator's.
        if (capturing) fail('busy', 'The sub is taking a picture; pick from the operator view after it');
        source = 'operator'; camera = host.cameraMatrices();
      }
      else {
        // Looking through the sub, the operator sees its view through the camera frame's zoom and
        // offset; a sub pick then uses those same matrices so its fractions mean the same frame.
        const record = requireSub(pilot), state = host.cameras.state(), through = state.mode === 'camera' && state.activeId === record.id;
        if (through && capturing) fail('busy', 'The sub is taking a picture; pick after it');
        source = record.id;
        camera = through ? host.cameraMatrices() : opticsOfView(viewOf(record), aspect(), {coordinateSystem: host.coordinateSystem});
      }
      let row, instance = 0, instanceMatrix = null, context, depth = null, pixel = null, centre = at;
      if (pictured) {
        // The CLI has already moved `at` to the centre of the pixel it read.
        ({instance = 0, instanceMatrix = null, depth = null, pixel = null, ...row} = pictured);
        context = scene ?? {clouds: [], fields: [], water: false};
      } else {
        if (!host.drawIds) fail('pick', 'This page cannot draw a pick map, so it cannot say what is drawn at a point');
        // At the size the viewport is drawn at, so the pixel read is one the operator sees.
        const {width, height} = host.drawingSize?.() ?? host.viewportSize(), w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
        ({pixel, centre} = pixelAt(at, w, h));
        let drawing, ids;
        try {
          drawing = host.drawIds({optics: host.coordinateSystem ? opticsInConvention(camera, host.coordinateSystem) : camera,
            width: w, height: h, hide: subIds(), region: [...pixel, 1, 1], depth: true});
          ids = await drawing.ready;
        } catch (error) { fail('pick', `The pick map could not be drawn: ${error?.message || error}`); }
        instance = ids.instances[0];
        depth = ids.depths?.[0] > 0 ? ids.depths[0] : null;
        row = ids.objects[0] === NOTHING_DRAWN ? {n: NOTHING_DRAWN} : drawing.rows.find(item => item.n === ids.objects[0]) ?? {n: ids.objects[0], unnumbered: true};
        if (row.instanceArray && !row.instancesBeyondMap && (instance + 1) * 16 <= row.instanceArray.length) {
          instanceMatrix = Array.from(row.instanceArray.slice(instance * 16, instance * 16 + 16));
        }
        context = drawing.context;
      }
      const ray = rayThrough(camera, centre);
      let hit = null, drawn = null;
      if (row.id != null) {
        // Past 65,536 instances the map's instance number wraps, so it names no instance.
        const depthPoint = depth ? pointAtViewDepth(camera, centre, depth) : null;
        const found = host.surfaceOf({row, instanceMatrix, ray, optics: camera, depthPoint}), instanced = !!(instanceMatrix || row.instanceArray) && !row.instancesBeyondMap;
        // What an anchor keeps: the geometry identity the map recorded (for recheck), and the
        // entry matrix it was drawn with, in whose frame `local` and `localNormal` are given.
        hit = {id: row.id, label: row.label ?? row.id, type: row.type ?? null, authority: 'exact', now: found.now,
          distance: found.distance ?? null, point: found.point ?? null, local: found.local ?? null, normal: found.normal ?? null,
          localNormal: normalInFrame(found.normal ?? null, row.root ?? null), entryMatrix: row.root ?? null,
          pointBasis: found.basis ?? null, ...(found.surfaceBasis ? {surfaceBasis: found.surfaceBasis} : {}),
          // The map's identity is kept even when there is no mesh now to compare it with.
          geometry: found.geometry || row.geometry ? {status: found.geometry?.status ?? null, identity: row.geometry ?? null} : null,
          surface: {path: row.path, mesh: row.mesh ?? null, face: found.face ?? null, instance: instanced ? instance : null},
          ...(row.coverage ? {coverage: row.coverage} : {})};
      } else {
        drawn = row.n === NOTHING_DRAWN ? {kind: 'nothing'} : row.n === UNIDENTIFIED || row.unnumbered ? {kind: 'unidentified', n: row.n}
          : {kind: 'not-a-scene-object', name: row.name ?? null, type: row.type ?? null};
      }
      // What the pick map cannot see: point clouds and simulation fields along the ray in front of
      // what was drawn, and water from the local water host. "In front" is judged only from the
      // depth drawn there; without it, every crossing may cover the point.
      const drawnAt = depth && hit?.pointBasis === 'depth' ? hit.distance : Infinity, crossing = item => ({item, crossing: rayCrossesBox(ray, item.bounds)});
      const fields = context.fields.map(crossing).filter(item => item.crossing)
        .map(({item, crossing: {enter, exit}}) => ({id: item.id, label: item.label, type: item.type, enter, exit})).sort((a, b) => a.enter - b.enter);
      const unresolved = [
        ...context.clouds.map(crossing).filter(({item, crossing: c}) => c && c.enter < drawnAt && item.id !== row.id)
          .map(({item, crossing: c}) => ({id: item.id, label: item.label, type: item.type, distance: c.enter, reason: 'point clouds are drawn outside the pick map'})),
        ...fields.filter(field => field.enter < drawnAt)
          .map(field => ({id: field.id, label: field.label, type: field.type, distance: field.enter, reason: 'simulation fields are drawn outside the pick map'})),
      ].sort((a, b) => a.distance - b.distance);
      if (context.water) unresolved.push({id: 'local-water', label: 'Water', type: 'local-water', distance: null, reason: 'the local water host draws water outside the pick map'});
      if (hit && (unresolved.length || hit.coverage)) hit.authority = 'approximate';
      return {schema: VANTAGE_SCHEMA, kind: 'pick', from: source, at, ...(pixel ? {pixel} : {}), pixelCentre: centre, ray,
        referent: pictured ? 'pictured' : 'rendered', hit, ...(drawn ? {drawn} : {}), fields, unresolved, pickedAt: new Date(host.now()).toISOString()};
    },

    // Whether an anchored mesh is still the one picked. It reads the scene and draws nothing.
    recheck({id, path, identity}) {
      if (!host.recheck) fail('recheck', 'This page cannot look up scene meshes');
      return host.recheck({id, path, identity});
    },
  };

  async function run(command, args = {}) {
    let checked;
    try { checked = checkedCommand({command, args}); }
    catch (error) { throw new VantageCommandError('validate', error.message); }
    return handlers[checked.command](checked.args);
  }
  // idle() waits until no picture holds the camera, through back-to-back pictures.
  const idle = async () => { while (capturing) await released; };
  return {run, isCapturing: () => capturing, watching: () => (watching ? {...watching} : null), idle, sketch};
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
// canvas's own CSS background behind it. DOM overlays are not pictured, nor are
// canvases inside an element marked data-vantage-ignore (the sub's own panel).
export function composeViewport({document, window, viewport, hostCanvas, maxSize = 1280}) {
  const base = hostCanvas.getBoundingClientRect();
  if (!(base.width > 0 && base.height > 0 && hostCanvas.width > 0 && hostCanvas.height > 0)) {
    throw new VantageCommandError('viewport', 'The Kaminos viewport has no visible area');
  }
  const sx = hostCanvas.width / base.width, sy = hostCanvas.height / base.height;
  const layers = [...viewport.querySelectorAll('canvas')]
    .map((canvas, order) => ({canvas, order, style: window.getComputedStyle(canvas), rect: canvas.getBoundingClientRect()}))
    .filter(({canvas, style, rect}) => canvas === hostCanvas || (!canvas.closest('[data-vantage-ignore]') && style.display !== 'none' && style.visibility !== 'hidden'
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

const MAP_COLORS = {'procedural-mesh': [168, 178, 194], glb: [168, 178, 194], light: [255, 210, 90], 'flame-emitter': [255, 128, 48],
  'local-liquid-emitter': [80, 168, 255], camera: [200, 200, 210], splat: [190, 140, 255], 'simulation-domain': [255, 140, 40]};
const rgba = ([r, g, b], a) => `rgba(${r}, ${g}, ${b}, ${a})`;

// Paint a scene map layout: ground grid and axes, boxes back to front, the
// operator's view cone (white) and each sub's (teal), labels and a scale bar.
export function paintSceneMap(document, layout, {ratio = 2} = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(layout.width * ratio); canvas.height = Math.round(layout.height * ratio);
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  context.fillStyle = '#101317';
  context.fillRect(0, 0, layout.width, layout.height);
  const line = ([x0, y0, x1, y1]) => { context.beginPath(); context.moveTo(x0, y0); context.lineTo(x1, y1); context.stroke(); };
  const shape = points => { context.beginPath(); points.forEach(([x, y], i) => i ? context.lineTo(x, y) : context.moveTo(x, y)); context.closePath(); };
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  layout.grid.forEach(line);
  context.lineWidth = 1.5;
  context.strokeStyle = 'rgba(229, 72, 77, 0.8)'; line(layout.axes.x);
  context.strokeStyle = 'rgba(62, 123, 250, 0.8)'; line(layout.axes.z);
  context.lineWidth = 1;
  for (const box of layout.boxes) {
    const color = MAP_COLORS[box.type] ?? [168, 178, 194];
    shape(box.polygon);
    context.fillStyle = rgba(color, box.kind === 'field' ? 0.1 : 0.32);
    context.fill();
    context.strokeStyle = rgba(color, box.kind === 'field' ? 0.55 : 0.9);
    box.edges.forEach(line);
  }
  for (const cone of layout.cones) {
    const color = cone.kind === 'sub' ? [56, 242, 224] : [255, 255, 255];
    shape(cone.polygon);
    context.fillStyle = rgba(color, 0.12);
    context.fill();
    context.strokeStyle = rgba(color, 0.75);
    cone.edges.forEach(line);
    context.beginPath(); context.arc(cone.apex[0], cone.apex[1], 3.5, 0, Math.PI * 2);
    context.fillStyle = rgba(color, 1); context.fill();
  }
  context.font = '10px ui-monospace, Menlo, monospace';
  context.textBaseline = 'bottom';
  const label = (text, [x, y], color) => {
    const width = context.measureText(text).width;
    context.fillStyle = 'rgba(10, 12, 16, 0.75)';
    context.fillRect(x - width / 2 - 2, y - 13, width + 4, 12);
    context.fillStyle = color;
    context.fillText(text, x - width / 2, y - 2);
  };
  for (const box of layout.boxes) label(box.label, box.labelAt, rgba(MAP_COLORS[box.type] ?? [220, 225, 232], 1));
  for (const cone of layout.cones) label(cone.label, [cone.apex[0], cone.apex[1] - 4], cone.kind === 'sub' ? '#38f2e0' : '#ffffff');
  const bar = Math.min(layout.scaleBar.pixels, layout.width * 0.4);
  context.strokeStyle = '#d8dde4'; context.lineWidth = 1.5;
  line([8, layout.height - 8, 8 + bar, layout.height - 8]);
  context.fillStyle = '#d8dde4'; context.textBaseline = 'bottom';
  context.fillText(`${(layout.scaleBar.meters * bar / layout.scaleBar.pixels).toPrecision(2)} m`, 8, layout.height - 11);
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
#agent-vantage-hud img,#agent-vantage-hud canvas{display:block;width:100%;height:auto}
#agent-vantage-hud [hidden]{display:none}
#agent-vantage-hud .vantage-map,#agent-vantage-hud .vantage-live{border-bottom:1px solid rgba(95,211,200,.25)}`;

// Shows the operator a live map of where everyone is looking, and each
// picture the sub takes, so both see the same image.
export function installVantageHud({document, viewport}) {
  if (!document.getElementById('agent-vantage-style')) {
    const style = document.createElement('style');
    style.id = 'agent-vantage-style';
    style.textContent = HUD_STYLE;
    document.head.append(style);
  }
  const root = document.createElement('div');
  root.id = 'agent-vantage-hud';
  root.dataset.vantageIgnore = '';
  root.hidden = true;
  root.innerHTML = '<div class="vantage-head"><span class="vantage-dot"></span><span class="vantage-title">Sub</span><button type="button" aria-label="Hide the sub panel">×</button></div><canvas class="vantage-map" width="440" height="330" hidden aria-label="Map of the scene with your view and the sub\'s"></canvas><canvas class="vantage-live" width="320" height="180" hidden aria-label="What the sub sees, live"></canvas><img alt="Latest picture from the agent sub" hidden>';
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'click', 'dblclick', 'wheel']) root.addEventListener(type, event => event.stopPropagation());
  const mapCanvas = root.querySelector('canvas'), liveCanvas = root.querySelector('.vantage-live'), picture = root.querySelector('img'), title = root.querySelector('.vantage-title');
  // While the live view runs it stands in for the last picture, which returns when it stops.
  // The header always names what the panel shows: the live view, else the last picture, else the map.
  let dismissed = false, liveFrames = 0, hasPicture = false, liveOn = false, pictureTitle = '', liveTitle = '';
  const show = () => {
    title.textContent = liveOn ? liveTitle : hasPicture ? pictureTitle : mapCanvas.hidden ? 'Sub' : 'Sub · map';
    root.hidden = dismissed || (mapCanvas.hidden && picture.hidden && liveCanvas.hidden);
  };
  root.querySelector('button').addEventListener('click', () => { dismissed = true; show(); });
  viewport.append(root);
  return {
    link(status) { root.dataset.link = status.state; },
    map(canvas) {
      mapCanvas.hidden = !canvas;
      if (canvas) {
        const context = mapCanvas.getContext('2d');
        context.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
        context.drawImage(canvas, 0, 0, mapCanvas.width, mapCanvas.height);
      }
      show();
    },
    // A new picture simply appears: no flash, nothing that pulls attention.
    shutter({kind, label, image}) {
      picture.src = image.dataUrl;
      hasPicture = true;
      picture.hidden = liveOn;
      pictureTitle = `${label} · ${kind} · ${new Date().toLocaleTimeString()}`;
      show();
    },
    live(frame, ImageData, label = 'Sub') {
      if (!frame) { liveOn = false; liveCanvas.hidden = true; picture.hidden = !hasPicture; show(); return; }
      if (liveCanvas.width !== frame.width || liveCanvas.height !== frame.height) { liveCanvas.width = frame.width; liveCanvas.height = frame.height; }
      liveCanvas.getContext('2d').putImageData(new ImageData(frame.pixels, frame.width, frame.height), 0, 0);
      liveCanvas.dataset.frame = String(++liveFrames);
      liveTitle = `${label} · live`;
      liveOn = true;
      liveCanvas.hidden = false;
      picture.hidden = true;
      show();
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

// A page links through the browser's shared vantage hub when it can
// (agent-vantage-hub.mjs): one stream for all its tabs on this server, linked
// whether shown or hidden. Without shared workers, or against a server
// without the hub, it holds its own stream as before.
export function connectVantageLink({window, document, endpoint, pageId, run, onStatus = () => {},
  hubUrl = new URL('./agent-vantage-hub-worker.mjs', import.meta.url)}) {
  let source = null, closed = false, retry = null, port = null;
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
  const joinHub = () => port?.postMessage({type: 'join', endpoint, page: pageId, facts: facts()});
  const leaveHub = () => port?.postMessage({type: 'leave', page: pageId});
  function viaHub() {
    if (!window.SharedWorker || !hubUrl) return false;
    try { port = new window.SharedWorker(hubUrl, {type: 'module', name: 'kaminos-vantage-hub'}).port; }
    catch { port = null; return false; }
    port.onmessage = event => {
      const data = event.data ?? {};
      if (data.type === 'command' && data.page === pageId) pump.push(data.message);
      else if (data.type === 'ping') port.postMessage({type: 'pong', page: pageId});
      else if (data.type === 'status') onStatus({state: data.state, pageId, via: 'hub'});
      else if (data.type === 'fallback') { leaveHub(); port = null; open(); }
    };
    port.start();
    joinHub();
    return true;
  }
  // A tab leaving (closed, or put in the back-forward cache) leaves the hub; one restored joins again.
  window.addEventListener('pagehide', leaveHub);
  window.addEventListener('pageshow', joinHub);
  document.addEventListener('visibilitychange', presence);
  window.addEventListener('focus', presence);
  window.addEventListener('blur', presence);
  // The heartbeat also speaks to the hub unasked, so a hub that dropped this tab after a pause hears it again.
  const heartbeat = window.setInterval(() => { presence(); port?.postMessage({type: 'pong', page: pageId, facts: facts()}); }, 15000);
  if (!viaHub()) open();
  return {
    pageId,
    close() {
      closed = true;
      leaveHub();
      port = null;
      window.removeEventListener('pagehide', leaveHub);
      window.removeEventListener('pageshow', joinHub);
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

const meshPath = (root, node) => {
  const path = [];
  for (let at = node; at && at !== root; at = at.parent) path.unshift(at.parent ? at.parent.children.indexOf(at) : -1);
  return path;
};
const nodeAt = (root, path) => path.reduce((node, index) => node?.children?.[index], root);
const shownChain = object => {
  for (let node = object; node; node = node.parent) {
    if (!node.visible || node.userData?.kaminosEditorHelper || node.userData?.kaminosEditorOnly) return false;
  }
  return true;
};
// FNV-1a over every component of up to 512 evenly spaced items, quantized, so
// the same content can be recognised after a page reload. It is a sample: an
// edit to an item between the sampled ones can escape it.
function sampled(count, itemSize, valueAt) {
  let hash = 0x811c9dc5;
  const mix = value => { hash ^= value & 0xff; hash = Math.imul(hash, 0x01000193) >>> 0; };
  const step = Math.max(1, Math.floor(count / 512));
  for (let i = 0; i < count; i += step) {
    for (let c = 0; c < itemSize; c++) {
      const q = Math.round(valueAt(i, c) * 1e5);
      mix(q); mix(q >> 8); mix(q >> 16); mix(q >> 24);
    }
  }
  return hash.toString(16).padStart(8, '0');
}
// Attribute objects carry no uuid; within a page session they get a number the
// first time they are seen, so a swapped attribute is noticed.
const attributeIds = new WeakMap();
let nextAttributeId = 1;
const attributeId = attribute => {
  if (!attribute) return null;
  if (!attributeIds.has(attribute)) attributeIds.set(attribute, nextAttributeId++);
  return attributeIds.get(attribute);
};
// An interleaved attribute's data and edit count live on its shared buffer.
const storeOf = attribute => (attribute?.isInterleavedBufferAttribute ? attribute.data : attribute);
// How to recognise the geometry under a mesh later: the geometry object, its
// position and index attributes, their stores and edit counts, sampled content,
// and for an instanced mesh its instance matrices.
export function geometryIdentity(mesh, session = null) {
  const geometry = mesh?.geometry, position = geometry?.attributes?.position, index = geometry?.index, store = storeOf(position);
  const instances = mesh?.isInstancedMesh ? mesh.instanceMatrix : null;
  return {uuid: geometry?.uuid ?? null, session,
    position: attributeId(position), positionStore: attributeId(store), version: store?.version ?? null, vertices: position?.count ?? null,
    index: attributeId(index), indexVersion: index?.version ?? null, indices: index?.count ?? null,
    sample: position ? sampled(position.count, position.itemSize, (i, c) => position.getComponent(i, c)) : null,
    indexSample: index ? sampled(index.count, 1, i => index.getX(i)) : null,
    ...(instances ? {instanceMatrix: attributeId(instances), instanceVersion: instances.version, instanceCount: mesh.count,
      instanceSample: sampled(mesh.count, 16, (i, c) => instances.array[i * 16 + c])} : {})};
}
// Whether a kept identity has every field a comparison reads, each of the type
// geometryIdentity writes. The instance fields come together or not at all.
const counted = value => value === null || (Number.isInteger(value) && value >= 0);
const hashed = value => value === null || (typeof value === 'string' && /^[0-9a-f]{8}$/.test(value));
const INSTANCE_KEYS = ['instanceMatrix', 'instanceVersion', 'instanceCount', 'instanceSample'];
function comparableIdentity(recorded) {
  if (!recorded || typeof recorded !== 'object' || Array.isArray(recorded)) return false;
  if (!(recorded.uuid === null || typeof recorded.uuid === 'string') || !(recorded.session === null || typeof recorded.session === 'string')) return false;
  if (!['position', 'positionStore', 'version', 'vertices', 'index', 'indexVersion', 'indices'].every(key => counted(recorded[key]))) return false;
  if (!hashed(recorded.sample) || !hashed(recorded.indexSample)) return false;
  const instanced = INSTANCE_KEYS.filter(key => recorded[key] !== undefined).length;
  if (instanced === 0) return true;
  return instanced === INSTANCE_KEYS.length && counted(recorded.instanceMatrix) && counted(recorded.instanceVersion) && counted(recorded.instanceCount) && hashed(recorded.instanceSample);
}
// Whether the geometry under a mesh is the one a picture recorded. Within one
// page session a different geometry object is a replacement, and any change to
// its attributes, stores, edit counts or sampled content is an edit. Across
// sessions identities differ, so counts and samples decide likely-same or replaced.
// A kept identity missing a field the comparison reads, or holding the wrong
// type there, is unverified: absent evidence is never read as a match or a change.
export function geometryStatus(recorded, current, session) {
  if (!current) return 'replaced';
  if (!comparableIdentity(recorded)) return 'unverified';
  if (session && recorded.session === session) {
    if (recorded.uuid !== current.uuid) return 'replaced';
    const keys = ['position', 'positionStore', 'version', 'vertices', 'index', 'indexVersion', 'indices', 'sample', 'indexSample', ...INSTANCE_KEYS];
    return keys.every(key => (recorded[key] ?? null) === (current[key] ?? null)) ? 'same' : 'edited';
  }
  if (recorded.vertices !== current.vertices || recorded.indices !== current.indices || (recorded.instanceCount ?? null) !== (current.instanceCount ?? null)) return 'replaced';
  if (recorded.sample && current.sample) {
    return ['sample', 'indexSample', 'instanceSample'].every(key => (recorded[key] ?? null) === (current[key] ?? null)) ? 'likely-same' : 'replaced';
  }
  return 'unverified';
}
const worldBounds = (THREE, object) => {
  const box = new THREE.Box3().setFromObject(object);
  return box.isEmpty() ? null : {min: box.min.toArray(), max: box.max.toArray()};
};

// What a pick map says about each object its ID pass drew: the scene entry it
// belongs to and its mesh path and, as they stood when it was drawn, its world
// matrix, its entry's, its geometry and its instance matrices. A drawing that
// belongs to no entry (the ground, a proxy) keeps its name and type.
export function drawnRows(entries, drawn, session) {
  const owners = new Map(entries.filter(entry => entry.object).map(entry => [entry.object, entry]));
  const ownerOf = object => {
    for (let node = object; node; node = node.parent) { const entry = owners.get(node); if (entry) return entry; }
    return null;
  };
  return drawn.map(({n, object, custom}) => {
    const entry = ownerOf(object);
    if (!entry) return {n, id: null, name: object.name || null, type: object.type ?? null};
    return {n, id: entry.id, label: entry.label || entry.fileName || entry.id, type: entry.type, path: meshPath(entry.object, object),
      mesh: object.name || null, matrixWorld: object.matrixWorld.toArray(), root: entry.object.matrixWorld.toArray(),
      geometry: geometryIdentity(object, session), ...(custom ? {coverage: 'custom-shader'} : {}),
      ...(object.isInstancedMesh ? {instanceArray: object.instanceMatrix.array.slice(0, object.count * 16),
        ...(object.count > 0x10000 ? {instancesBeyondMap: true} : {})} : {})};
  });
}

// What a pick map cannot see, as the scene stands: point clouds (splats),
// simulation fields and water drawn by the local water host.
export function sceneOutsideMap(THREE, entries, fields, water) {
  const clouds = [];
  for (const entry of entries) {
    if (!entry.object || !shownChain(entry.object)) continue;
    let cloud = entry.type === 'splat';
    entry.object.traverse(node => { if (node.isPoints && shownChain(node)) cloud = true; });
    const bounds = cloud ? worldBounds(THREE, entry.object) : null;
    if (bounds) clouds.push({id: entry.id, label: entry.label || entry.id, type: entry.type, bounds});
  }
  return {clouds, fields: fields.filter(field => field.bounds).map(({id, label, type, bounds}) => ({id, label, type, bounds})), water: !!water};
}

// A world-space normal in the frame of `matrix` (a column-major 4x4): the
// transpose of its linear part, which is the inverse transpose of the map
// from world to that frame. Null when there is no normal or frame.
function normalInFrame(normal, matrix) {
  if (!normal || !matrix) return null;
  const n = [0, 1, 2].map(i => matrix[4 * i] * normal[0] + matrix[4 * i + 1] * normal[1] + matrix[4 * i + 2] * normal[2]);
  const length = Math.hypot(...n);
  return length > 0 ? n.map(value => value / length) : null;
}

// Whether the mesh at `path` under the entry `id` is still the geometry an
// anchor recorded: same, edited or replaced within the page session that
// recorded it, likely-same or replaced from another, unverified without an
// identity. Reads the scene only.
export function recheckAnchor(entries, {id, path, identity}, session = null) {
  const entry = entries.find(item => item.id === id);
  if (!entry?.object) return {now: 'missing', status: null};
  const node = nodeAt(entry.object, path);
  if (!node) return {now: 'mesh-missing', status: null};
  if (!node.isMesh) return {now: 'present', status: null, reason: 'not-a-mesh'};
  return {now: 'present', status: geometryStatus(identity, geometryIdentity(node, session), session)};
}

// Where a ray meets one mesh placed with the given matrices: the nearest
// intersection inside the camera's depth range. A stand-in mesh shares the
// mesh's geometry, material and morph weights, so nothing in the scene moves.
// A skinned mesh is cast as it is posed now.
function recastSurface(THREE, node, ray, {matrixWorld, instanceMatrix = null, root, optics = null}) {
  const caster = new THREE.Raycaster(new THREE.Vector3(...ray.origin), new THREE.Vector3(...ray.direction).normalize());
  const world = new THREE.Matrix4().fromArray(matrixWorld);
  if (instanceMatrix) world.multiply(new THREE.Matrix4().fromArray(instanceMatrix));
  let probe = node;
  if (!node.isSkinnedMesh) {
    probe = new THREE.Mesh(node.geometry, node.material);
    probe.matrixAutoUpdate = false;
    probe.matrixWorldAutoUpdate = false;
    probe.matrixWorld.copy(world);
    if (node.morphTargetInfluences) { probe.morphTargetInfluences = node.morphTargetInfluences; probe.morphTargetDictionary = node.morphTargetDictionary; }
  }
  const hit = caster.intersectObject(probe, false).find(item => !optics || insideClipDepth(optics, item.point.toArray()));
  if (!hit) return null;
  const surface = node.isSkinnedMesh ? node.matrixWorld : world;
  return {distance: hit.distance, point: hit.point.toArray(),
    local: hit.point.clone().applyMatrix4(new THREE.Matrix4().fromArray(root).invert()).toArray(),
    normal: hit.face ? hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(surface)).normalize().toArray() : null,
    face: hit.faceIndex ?? null, basis: node.isSkinnedMesh ? 'recast-now' : 'recast'};
}

// The surface a pick map named. With `depthPoint`, the point drawn there,
// from the map's depth, is the point: in the world, and in the entry's own
// frame as it stood. The mesh as the scene holds it now adds its face and
// normal only when, placed as it was drawn, it still passes through that point.
// Without depth, the point is where the ray meets the mesh placed as drawn.
export function surfaceOf(THREE, entries, {row, instanceMatrix = null, ray, optics = null, depthPoint = null}, session = null) {
  const pictured = depthPoint ? {distance: new THREE.Vector3(...depthPoint).distanceTo(new THREE.Vector3(...ray.origin)), point: depthPoint,
    local: new THREE.Vector3(...depthPoint).applyMatrix4(new THREE.Matrix4().fromArray(row.root).invert()).toArray(), basis: 'depth'} : null;
  const without = basis => pictured ?? {point: null, basis};
  const entry = entries.find(item => item.id === row.id);
  if (!entry?.object) return {now: 'missing', ...without(null)};
  const node = nodeAt(entry.object, row.path);
  if (!node) return {now: 'mesh-missing', ...without(null)};
  if (!node.isMesh) return {now: 'present', geometry: null, ...without('not-a-mesh')};
  const geometry = row.geometry ? {status: geometryStatus(row.geometry, geometryIdentity(node, session), session)} : null;
  if (node.isInstancedMesh && !instanceMatrix) return {now: 'present', geometry, ...without('instance-unknown')};
  const hit = recastSurface(THREE, node, ray, {matrixWorld: row.matrixWorld, instanceMatrix, root: row.root, optics});
  if (!pictured) return {now: 'present', geometry, ...(hit ?? {point: null, basis: 'missed'})};
  // The mesh agrees with the drawn point to float32 precision (about 16 units
  // in the last place of the distance, plus a micrometre), or not at all.
  const agrees = !!hit && Math.abs(hit.distance - pictured.distance) <= 2 ** -20 * pictured.distance + 1e-6;
  return {now: 'present', geometry, ...pictured, normal: agrees ? hit.normal : null, face: agrees ? hit.face : null,
    surfaceBasis: agrees ? 'recast-agrees' : 'recast-differs'};
}

/**
 * Join the vantage to the running application. `entries()` returns live
 * scene entries `{id,label,fileName,type,object}`; `suspendEditorDrawing`
 * hides editor-only drawing for a clean picture and returns a restore function.
 * `idPass` (agent-vantage-ids.mjs) draws pick maps; without it pictures carry
 * none and picks are refused. `water()` says whether the local water host is
 * drawing, and `coordinateSystem` is the renderer's clip convention.
 */
export function installAgentVantage({THREE, document, window, edits, cameras, entries, selection, readView, writeView,
  viewport, hostCanvas, busy, hold, cameraMatrices, suspendEditorDrawing, redraw, frameState, extraTargets = () => [],
  idPass = null, glance = null, water = () => false, coordinateSystem = THREE.WebGLCoordinateSystem, endpoint = '/api/vantage', link = true}) {
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
    // Tools announce what happened with window.dispatchEvent(new CustomEvent(`kaminos:<name>`, {detail})).
    listen: (name, handler) => {
      const heard = event => handler(event.detail);
      window.addEventListener(`kaminos:${name}`, heard);
      return () => window.removeEventListener(`kaminos:${name}`, heard);
    },
    compose: ({maxSize}) => composeViewport({document, window, viewport, hostCanvas, maxSize}),
    encode: encodeCanvas,
    blank: isBlankCanvas,
    annotate: (canvas, inView) => annotateCanvas(document, canvas, inView),
    sheet: (frames, options) => contactSheet(document, frames, options),
    paintMap: layout => paintSceneMap(document, layout),
    drawingSize: () => (hostCanvas.width > 0 && hostCanvas.height > 0 ? {width: hostCanvas.width, height: hostCanvas.height} : null),
    // The rows are written down in the same task as the map is drawn, so they hold the matrices it was drawn with.
    drawIds: idPass ? options => {
      const pass = idPass.draw(options), list = entries();
      return {rows: drawnRows(list, pass.drawn, pageId), context: sceneOutsideMap(THREE, list, extraTargets(), water()), ready: pass.ready};
    } : null,
    surfaceOf: options => surfaceOf(THREE, entries(), options, pageId),
    recheck: anchor => recheckAnchor(entries(), anchor, pageId),
    // A glance's pixels become a canvas like any other picture.
    renderView: glance ? options => {
      const view = glance.draw(options);
      return {ready: view.ready.then(({width, height, pixels}) => {
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').putImageData(new window.ImageData(pixels, width, height), 0, 0);
        return {canvas, width, height};
      })};
    } : null,
    coordinateSystem,
    now: () => Date.now(),
    shutter: info => hud.shutter(info),
    live: glance ? {start: options => startLive(options), stop: () => stopLive()} : null,
  });
  // The live view: a small glance from the sub's camera on a timer. A tick is
  // skipped while the tab is hidden, while a picture holds the camera, or while
  // the previous frame is still being read back, so it never queues work.
  // One live draw at most is ever in flight, whichever stream issued it.
  let live = null, liveInFlight = false;
  const clock = () => window.performance?.now?.() ?? Date.now();
  const liveState = () => (live ? {on: true, pilot: live.pilot, fps: live.fps, frames: live.frames, skipped: live.skipped, drawMs: live.drawMs} : {on: false});
  const liveTick = () => {
    if (!live) return;
    if (liveInFlight || document.visibilityState !== 'visible' || pilot.isCapturing()) { live.skipped++; return; }
    const record = cameras.read().cameras.find(item => item.id === vantageCameraId(live.pilot));
    if (!record) { stopLive(); return; }
    const ratio = viewport.clientWidth / viewport.clientHeight || 16 / 9, width = 320, height = Math.max(1, Math.round(width / ratio));
    const optics = opticsOfView(cameraViewFromRecord(record, ratio, 3), ratio, {coordinateSystem});
    const started = clock(), current = live;
    let view;
    try { view = glance.draw({optics, width, height, hide: [record.id]}); }
    catch { current.skipped++; return; }
    liveInFlight = true;
    current.drawMs = clock() - started;
    view.ready.then(frame => { if (live === current) { hud.live(frame, window.ImageData, record.label); current.frames++; } }, () => { current.skipped++; })
      .finally(() => { liveInFlight = false; });
  };
  function startLive({pilot: name, fps}) {
    stopLive();
    live = {pilot: name, fps, frames: 0, skipped: 0, drawMs: null, timer: window.setInterval(liveTick, Math.round(1000 / fps))};
    return liveState();
  }
  function stopLive() {
    const state = liveState();
    if (live) { window.clearInterval(live.timer); live = null; hud.live(null); }
    return {...state, on: false};
  }
  glyph();
  const glyphTimer = window.setInterval(glyph, 1000);
  // Keep the operator's map current while a sub is in the scene; repaint
  // only when the scene, the operator's view or a sub changed. Without a sub
  // nothing is measured. During a picture the viewport camera is borrowed,
  // so the map waits.
  let mapKey = null;
  const refreshMap = () => {
    if (document.visibilityState !== 'visible' || pilot.isCapturing()) return;
    let current;
    try {
      if (!cameras.read().cameras.some(isSub)) {
        if (mapKey !== null) { mapKey = null; hud.map(null); }
        return;
      }
      current = pilot.sketch();
    } catch { return; }
    const key = JSON.stringify([current.objects.map(object => [object.id, object.bounds]), current.fields, current.operator, current.subs]);
    if (key === mapKey) return;
    mapKey = key;
    hud.map(paintSceneMap(document, sketchMapLayout(current, {width: 220, height: 165})));
  };
  const mapTimer = window.setInterval(refreshMap, 400);
  const pageId = `page-${window.crypto.randomUUID()}`;
  const connection = link ? connectVantageLink({window, document, endpoint, pageId, run: pilot.run, onStatus: status => hud.link(status)}) : null;
  return {
    pageId, run: pilot.run, capturing: pilot.isCapturing, watching: pilot.watching, idle: pilot.idle,
    dispose() { stopLive(); window.clearInterval(glyphTimer); window.clearInterval(mapTimer); connection?.close(); hud.dispose(); },
  };
}

