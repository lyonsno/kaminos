import { Mesh, PlaneGeometry, MeshBasicMaterial, CanvasTexture, SRGBColorSpace } from '../lib/three.core.js';
import { createBrowserHandMeshRoute } from '../models/mobrecon/hand-mesh-route.js';
import { readLocalModels, readServedModels, createModelStore } from '../demos/hand-mesh/model-files.js';
import { handObservation, createHoverController } from './iron-gland/interaction.mjs';
import { createMechanism } from './iron-gland/mechanism.mjs';

export default {
  id: 'iron-gland', title: 'Iron Gland',
  async create({ host, inputs, record, updateInputs }) {
    const document = host.controls.document, window = document.defaultView;
    const scene = await host.scene.open();
    const video = document.createElement('video'); video.muted = true; video.playsInline = true;
    const sample = document.createElement('canvas'), display = document.createElement('canvas');
    sample.width = display.width = 640; sample.height = display.height = 480;
    const sampleContext = sample.getContext('2d'), displayContext = display.getContext('2d');
    const texture = new CanvasTexture(display); texture.colorSpace = SRGBColorSpace;
    const plane = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: texture, toneMapped: false }));
    plane.name = 'Camera'; plane.visible = false;
    const machine = createMechanism();
    machine.root.visible = false;
    let cameraAsset, machineAsset;
    try {
      cameraAsset = await scene.attach(plane, { owned: true, presentation: true, metadata: { source: 'live-camera:iron-gland' } });
      machineAsset = await scene.attach(machine.root, { owned: true, metadata: { label: 'Iron Gland', source: 'experiment:iron-gland', type: 'experiment' } });
    } catch (error) { await scene.dispose(); throw error; }
    window.kaminosSelection?.clear();
    const store = createModelStore(window.indexedDB);
    let controller = createHoverController(), state = controller.read();
    let route = null, stream = null, flight = null, startTask = null, loadTask = null, callback = null;
    let disposed = false, running = false, starting = false, generation = 0, loading = false;
    let handedness = inputs.handedness ?? 'right', mirror = inputs.mirror ?? true, size = inputs.size ?? 1;
    if (!['left', 'right'].includes(handedness) || typeof mirror !== 'boolean' || !(Number.isFinite(size) && size > 0)) {
      await scene.dispose(); throw Error('invalid Iron Gland inputs');
    }
    let threshold = inputs.threshold ?? .8;
    if (!(Number.isFinite(threshold) && threshold >= 0 && threshold <= 1)) { await scene.dispose(); throw Error('invalid detector threshold'); }
    let error = null, modelSource = null, frameCount = 0, missCount = 0, last = null, lastFrameAt = null;
    let startButton, loadButton, status, inputFiles;
    const read = () => ({ running, starting, loading, error, modelSource, handedness, mirror, size, threshold, frameCount, missCount,
      identity: route?.identity ?? null, source: 'camera', geometryAuthority: 'camera-relative-2d-landmarks',
      interaction: structuredClone(state), cameraVisible: plane.visible, objectId: machineAsset.id,
      imageSize: [display.width, display.height], lastAcquisition: last?.acquisition ?? null,
      lastPrediction: last ? { hasHand: last.hasHand, handedness: last.handedness, cropBox: last.cropBox, cropUV: last.cropUV ? Array.from(last.cropUV) : null } : null,
      cameraState: stream?.getVideoTracks()[0]?.readyState ?? 'off',
      lighting: 'virtual-object-only', occlusion: 'camera-plane-only' });
    const sync = () => {
      if (startButton) { startButton.textContent = starting ? 'Cancel camera' : running ? 'Stop camera' : 'Start camera'; startButton.disabled = loading || disposed || !route; }
      if (loadButton) loadButton.disabled = loading || disposed || running || starting;
      if (status) status.textContent = error ?? (loading ? 'Loading models' : starting ? 'Camera permission' : !route ? 'Models not loaded' : !running ? 'Camera off' : !state.visible ? 'No hand detected' : state.mode === 'grab' ? 'Pinch held' : 'Hover');
    };
    const frame = () => {
      const viewport = document.getElementById('viewport');
      const bounds = viewport?.getBoundingClientRect();
      const aspect = bounds?.height ? bounds.width / bounds.height : window.innerWidth / window.innerHeight;
      const imageHeight = 4.4 * display.height / display.width;
      const distance = Math.max(imageHeight, 4.4 / aspect) / (2 * Math.tan(35 * Math.PI / 360)) * 1.14;
      return scene.setView({ position: [0, 0, distance], target: [0, 0, 0], up: [0, 1, 0], fov: 35, zoom: 1 });
    };
    const hide = () => { state = controller.update(null, 0); machine.root.visible = false; plane.visible = false; scene.redraw(); };
    const present = (result, now) => {
      const width = sample.width, height = sample.height;
      const resized = display.width !== width || display.height !== height;
      if (resized) { display.width = width; display.height = height; }
      displayContext.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? width : 0, 0);
      displayContext.drawImage(sample, 0, 0); displayContext.resetTransform(); texture.needsUpdate = true;
      plane.scale.set(4.4, 4.4 * height / width, 1); plane.visible = true;
      const observation = handObservation(result, { width, height, mirror });
      state = controller.update(observation, lastFrameAt === null ? 0 : (now - lastFrameAt) / 1000);
      lastFrameAt = now; last = result; frameCount++; if (!observation) missCount++;
      // Camera and mechanism occupy one stage; no inferred metric depth is implied.
      machine.root.position.set((state.anchor[0] - .5) * 4.4, (.5 - state.anchor[1]) * plane.scale.y, .08);
      machine.root.scale.setScalar(state.span * 4.4 * .72 * size);
      machine.update(state, now / 1000); if (resized) frame(); scene.redraw(); sync();
    };
    const schedule = ticket => {
      if (!running || disposed || ticket !== generation) return;
      callback = video.requestVideoFrameCallback(() => {
        callback = null;
        if (!running || disposed || ticket !== generation) return;
        const current = (async () => {
          if (sample.width !== video.videoWidth || sample.height !== video.videoHeight) { sample.width = video.videoWidth; sample.height = video.videoHeight; }
          sampleContext.drawImage(video, 0, 0);
          const result = await route.infer({ source: sample, width: sample.width, height: sample.height, handedness,
            acquisition: { mode: 'detector', threshold, padding: 1.4, onMiss: 'skip' } });
          if (!running || disposed || ticket !== generation) return;
          present(result, performance.now());
        })().catch(cause => {
          if (ticket !== generation || disposed) return;
          error = String(cause?.message ?? cause); running = false; generation++;
          stream?.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null;
          hide(); sync(); record({ kind: 'iron-gland.failure', phase: 'applied', effective: read() });
        }).finally(() => { if (flight === current) flight = null; schedule(ticket); });
        flight = current;
      });
    };
    const stop = async () => {
      generation++; running = false; starting = false;
      if (callback !== null) video.cancelVideoFrameCallback(callback); callback = null;
      stream?.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null;
      hide(); sync();
      if (flight) await flight.catch(() => {});
      record({ kind: 'iron-gland.stop', phase: 'applied', effective: read() });
      return read();
    };
    const start = () => {
      if (disposed) throw Error('experiment closed');
      if (!route) throw Error('load hand models first');
      if (running || starting) return startTask ?? Promise.resolve(read());
      const ticket = ++generation;
      starting = true; error = null; sync();
      const task = (async () => {
        if (flight) await flight;
        if (ticket !== generation || disposed) return read();
        const acquired = await window.navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        if (ticket !== generation || disposed) { acquired.getTracks().forEach(track => track.stop()); return read(); }
        stream = acquired; video.srcObject = acquired; await video.play();
        if (ticket !== generation || disposed) return read();
        running = true; controller = createHoverController(); lastFrameAt = null; frameCount = 0; missCount = 0;
        frame(); schedule(ticket);
        record({ kind: 'iron-gland.start', phase: 'applied', effective: read() });
        return read();
      })().catch(cause => {
        if (ticket === generation && !disposed) {
          error = String(cause?.message ?? cause); stream?.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null; hide();
        }
        throw cause;
      }).finally(() => { if (ticket === generation) starting = false; if (startTask === task) startTask = null; sync(); });
      startTask = task; return task;
    };
    const loadModels = ({ files, base } = {}) => {
      if (disposed) throw Error('experiment closed');
      if (running || starting) throw Error('stop camera before replacing models');
      if (loadTask) return loadTask;
      loading = true; error = null; sync();
      const task = (async () => {
        const models = files ? await readLocalModels(files) : base ? await readServedModels(base, window.location.href) : await store.get();
        if (!models) throw Error('Choose a prepared hand model folder');
        if (disposed) return read();
        const appGpu = await window.kaminosAppGpu?.();
        if (!appGpu) throw Error('Workbench WebGPU host unavailable');
        // This consumer owns a single route lease. Replacing its files releases
        // that lease before re-registering on the same borrowed app session.
        route?.release(); route = null; modelSource = null;
        const next = await createBrowserHandMeshRoute({ session: await appGpu.session(), mobreconPackageSource: models.mobrecon, detectorPackageSource: models.detector });
        if (disposed) { next.release(); return read(); }
        route = next; modelSource = files ? 'local-files' : base ? 'local-server' : 'browser-storage';
        if (files) await store.put(models).catch(() => {});
        return read();
      })().catch(cause => { error = String(cause?.message ?? cause); throw cause; })
        .finally(() => { loading = false; if (loadTask === task) loadTask = null; sync(); });
      loadTask = task; return task;
    };
    const setOptions = async options => {
      const next = { handedness, mirror, size, threshold, ...options };
      if (!['left', 'right'].includes(next.handedness) || typeof next.mirror !== 'boolean'
          || !(Number.isFinite(next.size) && next.size > 0) || !(Number.isFinite(next.threshold) && next.threshold >= 0 && next.threshold <= 1)) throw Error('invalid Iron Gland options');
      const wasRunning = running;
      if (running || starting) await stop();
      ({ handedness, mirror, size, threshold } = next); controller = createHoverController(); state = controller.read();
      updateInputs?.({ ...inputs, handedness, mirror, size, threshold });
      record({ kind: 'iron-gland.options', phase: 'applied', effective: read() }); sync();
      if (wasRunning) await start();
      return read();
    };
    frame();
    const unsubscribe = scene.onFrame(({ timestampMs }) => {
      if (!state.visible) return;
      machine.update(state, timestampMs / 1000); scene.redraw();
    });
    const pagehide = () => { stop().catch(() => {}); };
    window.addEventListener('pagehide', pagehide);
    return {
      read, operations: { start, stop, frame, loadModels, setOptions },
      mount({ root, document, invoke }) {
        root.style.setProperty('letter-spacing', '0');
        const fail = cause => { error = String(cause?.message ?? cause); sync(); };
        const command = (label, operation) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = operation; return b; };
        startButton = command('Start camera', () => invoke(running || starting ? 'stop' : 'start').catch(fail));
        loadButton = command('Load hand models', () => inputFiles.click());
        inputFiles = document.createElement('input'); inputFiles.type = 'file'; inputFiles.multiple = true; inputFiles.webkitdirectory = true; inputFiles.hidden = true;
        inputFiles.onchange = () => invoke('loadModels', { files: [...inputFiles.files] }).catch(fail).finally(() => { inputFiles.value = ''; });
        const framing = command('Frame camera', () => invoke('frame').catch(fail));
        root.append(startButton, loadButton, inputFiles, framing);
        const hand = document.createElement('select'); hand.setAttribute('aria-label', 'Hand');
        for (const value of ['right', 'left']) { const o = document.createElement('option'); o.value = value; o.textContent = value === 'right' ? 'Right hand' : 'Left hand'; hand.append(o); }
        hand.value = handedness; hand.onchange = () => invoke('setOptions', { handedness: hand.value }).catch(fail); root.append(hand);
        const mirrorLabel = document.createElement('label'), mirrorInput = document.createElement('input');
        mirrorInput.type = 'checkbox'; mirrorInput.checked = mirror; mirrorInput.onchange = () => invoke('setOptions', { mirror: mirrorInput.checked }).catch(fail);
        mirrorLabel.append(mirrorInput, 'Mirror camera'); root.append(mirrorLabel);
        for (const [key, label, value, min, max, step] of [['size', 'Mechanism size', size, .3, 2, .05], ['threshold', 'Detection confidence', threshold, 0, 1, .01]]) {
          const holder = document.createElement('label'); holder.textContent = label;
          const field = document.createElement('input'); field.type = 'range'; field.min = min; field.max = max; field.step = step; field.value = value; field.setAttribute('aria-label', label); field.style.width = '100%';
          field.onchange = () => invoke('setOptions', { [key]: Number(field.value) }).catch(fail); holder.append(field); root.append(holder);
        }
        status = document.createElement('div'); status.setAttribute('role', 'status'); status.dataset.ironGlandStatus = ''; status.style.overflowWrap = 'anywhere'; root.append(status); sync();
        loadModels({ base: inputs.models }).catch(fail);
      },
      async dispose() {
        disposed = true; window.removeEventListener('pagehide', pagehide); unsubscribe();
        await stop();
        // A permission prompt may remain open: its generation guard stops a
        // late stream, so disposal need not wait for the human to answer it.
        if (loadTask) await loadTask.catch(() => {});
        route?.release(); route = null;
        await scene.dispose();
      },
    };
  },
};
