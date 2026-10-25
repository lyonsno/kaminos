import { createBrowserHandMeshRoute } from '../models/mobrecon/hand-mesh-route.js';
import { readLocalModels, readServedModels, createModelStore } from '../demos/hand-mesh/model-files.js';
import { handObservation, createHoverController } from './iron-gland/interaction.mjs';
import { createMechanism } from './iron-gland/mechanism.mjs';
import { createVirtualHand } from './iron-gland/virtual-hand.mjs';
import { createGestureCapture } from './iron-gland/capture.mjs';
import { mountCaptureControls } from './iron-gland/capture-controls.mjs';

export default {
  id: 'iron-gland', title: 'Iron Gland',
  async create({ host, inputs, record, updateInputs }) {
    const document = host.controls.document, window = document.defaultView;
    const scene = await host.scene.open();
    const video = document.createElement('video'); video.muted = true; video.playsInline = true;
    const sample = document.createElement('canvas'); sample.width = 640; sample.height = 480;
    const sampleContext = sample.getContext('2d');
    const handSurface = createVirtualHand();
    const machine = createMechanism();
    machine.root.visible = false;
    let handAsset, machineAsset;
    try {
      handAsset = await scene.attach(handSurface.root, { owned: true, metadata: { label: 'Virtual hand', source: 'mobrecon:iron-gland', type: 'experiment' } });
      machineAsset = await scene.attach(machine.root, { owned: true, metadata: { label: 'Iron Gland', source: 'experiment:iron-gland', type: 'experiment' } });
    } catch (error) { await scene.dispose(); throw error; }
    window.kaminosSelection?.clear();
    const restoreStage = [];
    const prepareStage = () => ['show-env-bg', 'composition-ground-visible'].forEach(id => {
      const control = document.getElementById(id);
      if (!control) return;
      const original = control.checked;
      control.checked = false; control.dispatchEvent(new window.Event('change', { bubbles: true }));
      let edited = false;
      const changed = () => { edited = true; };
      control.addEventListener('change', changed);
      restoreStage.push(() => {
        control.removeEventListener('change', changed);
        if (!edited) { control.checked = original; control.dispatchEvent(new window.Event('change', { bubbles: true })); }
      });
    });
    const store = createModelStore(window.indexedDB);
    let controller = createHoverController(), state = controller.read();
    let route = null, stream = null, flight = null, loadTask = null, callback = null;
    let unwatchCamera = () => {};
    const releaseCamera = () => {
      unwatchCamera(); unwatchCamera = () => {};
      stream?.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null;
    };
    let disposed = false, running = false, starting = false, generation = 0, loading = false, resumeOptions = false;
    let handedness = inputs.handedness ?? 'right', size = inputs.size ?? 1;
    if (!['left', 'right'].includes(handedness) || !(Number.isFinite(size) && size > 0)) {
      await scene.dispose(); throw Error('invalid Iron Gland inputs');
    }
    let threshold = inputs.threshold ?? .8;
    if (!(Number.isFinite(threshold) && threshold >= 0 && threshold <= 1)) { await scene.dispose(); throw Error('invalid detector threshold'); }
    prepareStage();
    let error = null, modelSource = null, frameCount = 0, missCount = 0, last = null, lastFrameAt = null;
    let startButton, loadButton, status, inputFiles, captureControls, captureStarting;
    const capture = createGestureCapture({fetch:(...args)=>window.fetch(...args),MediaRecorder:window.MediaRecorder,
      changed:()=>captureControls?.update()});
    const read = () => ({ running, starting, loading, draining: !running && !!flight, error, modelSource, handedness, size, threshold, frameCount, missCount,
      identity: route?.identity ?? null, source: 'camera', geometryAuthority: 'inferred-hand-mesh-unregistered-stage', view: 'opposite-camera',
      interaction: structuredClone(state), cameraVisible: false, handVisible: handSurface.root.visible, handObjectId: handAsset.id, objectId: machineAsset.id,
      imageSize: [sample.width, sample.height], lastAcquisition: last?.acquisition ?? null,
      lastPrediction: last ? { hasHand: last.hasHand, handedness: last.handedness, cropBox: last.cropBox, cropUV: last.cropUV ? Array.from(last.cropUV) : null } : null,
      cameraState: stream?.getVideoTracks()[0]?.readyState ?? 'off', capture:capture.read(),
      lighting: 'virtual-core-and-scene', occlusion: 'virtual-hand-depth', placement: 'palm-anchored-view-relative-hover' });
    const sync = () => {
      if (startButton) { startButton.textContent = starting ? 'Cancel camera' : running ? 'Stop camera' : 'Start camera'; startButton.disabled = loading || disposed || !route; }
      if (loadButton) loadButton.disabled = loading || disposed || running || starting || !!flight;
      if (status) status.textContent = error ?? (loading ? 'Loading models' : starting ? 'Camera permission' : !route ? 'Models not loaded' : !running ? 'Camera off' : !state.visible ? 'No hand detected' : state.mode === 'grab' ? 'Pinch held' : 'Hover');
      captureControls?.update();
    };
    const frame = () => {
      const viewport = document.getElementById('viewport');
      const bounds = viewport?.getBoundingClientRect();
      const aspect = bounds?.height ? bounds.width / bounds.height : window.innerWidth / window.innerHeight;
      const tangent=Math.tan(35*Math.PI/360);
      let distance = Math.max(3.5, 4.4 / aspect) / (2*tangent) * 1.14, targetY=2.75;
      const cue=document.querySelector?.('[data-iron-capture-cue]');
      if(capture.read().status==='recording'&&cue&&!cue.hidden&&bounds?.height){
        const top=cue.offsetTop+cue.offsetHeight+12,bottom=bounds.height-70;
        const available=Math.max(60,bottom-top);
        distance=Math.max(distance,3.5*bounds.height/(2*tangent*available));
        targetY+=(Math.min(bounds.height-35,(top+bottom)/2)/bounds.height-.5)*2*distance*tangent;
      }
      return scene.setView({ position: [0, targetY, distance], target: [0, targetY, 0], up: [0, 1, 0], fov: 35, zoom: 1 });
    };
    const hide = () => { state = controller.update(null, 0); machine.root.visible = false; handSurface.root.visible = false; scene.redraw(); };
    const present = (result, now) => {
      const width = sample.width, height = sample.height;
      const palm = handSurface.update(result, route.faces);
      const observation = palm && handObservation(result, { width, height, mirror: true });
      state = controller.update(observation, lastFrameAt === null ? 0 : (now - lastFrameAt) / 1000);
      lastFrameAt = now; last = result; frameCount++; if (!observation) missCount++;
      if (palm && observation) {
        handSurface.root.position.set((state.anchor[0]-.5)*4.4, 2.2+(.5-state.anchor[1])*3.3, 0);
        // Presentation-space levitation: reversing the hand view must not put
        // the instrument behind the hand. This is not physical palm contact.
        machine.root.position.copy(handSurface.root.position);
        machine.root.position.y += palm.width*10*.6;
        machine.root.position.z += palm.width*10*.85;
        machine.root.quaternion.copy(palm.quaternion);
        machine.root.scale.setScalar(palm.width*10*.65*size);
      } else handSurface.root.visible = false;
      machine.update(state, now / 1000); scene.redraw(); sync();
    };
    const schedule = ticket => {
      if (!running || disposed || ticket !== generation) return;
      callback = video.requestVideoFrameCallback((_, metadata) => {
        callback = null;
        if (!running || disposed || ticket !== generation) return;
        const current = (async () => {
          if (sample.width !== video.videoWidth || sample.height !== video.videoHeight) { sample.width = video.videoWidth; sample.height = video.videoHeight; }
          sampleContext.drawImage(video, 0, 0);
          const result = await capture.observe({canvas:sample,metadata,
            infer:features=>route.infer({ source: sample, width: sample.width, height: sample.height, handedness,capture:features,
              acquisition: { mode: 'detector', threshold, padding: 1.4, onMiss: 'skip' } })});
          if (!running || disposed || ticket !== generation) return;
          present(result, performance.now());
        })().catch(cause => {
          if (ticket !== generation || disposed) return;
          error = String(cause?.message ?? cause); running = false; generation++;
          void capture.finish('failed',error);
          releaseCamera();
          hide(); sync(); record({ kind: 'iron-gland.failure', phase: 'applied', effective: read() });
        }).finally(() => { if (flight === current) flight = null; sync(); schedule(ticket); });
        flight = current;
      });
    };
    const stop = async () => {
      generation++; running = false; starting = false; resumeOptions = false;
      if (callback !== null) video.cancelVideoFrameCallback(callback); callback = null;
      releaseCamera();
      hide(); sync();
      if (flight) await flight.catch(() => {});
      if (captureStarting) await captureStarting.catch(()=>{});
      await capture.finish('partial',error??'camera-stopped');
      record({ kind: 'iron-gland.stop', phase: 'applied', effective: read() });
      return read();
    };
    const start = () => {
      if (disposed) throw Error('experiment closed');
      if (loading) throw Error('Wait for model loading to finish');
      if (!route) throw Error('load hand models first');
      if (running || starting) return read();
      const ticket = ++generation;
      starting = true; error = null; sync();
      // Permission is human-paced. Acknowledge initiation so the Workbench
      // operation queue can still admit Stop or Close while it is pending.
      void (async () => {
        if (flight) await flight;
        if (ticket !== generation || disposed) return read();
        const acquired = await window.navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        if (ticket !== generation || disposed) { acquired.getTracks().forEach(track => track.stop()); return read(); }
        stream = acquired; video.srcObject = acquired;
        const tracks = acquired.getVideoTracks();
        const ended = () => {
          if (ticket !== generation || disposed) return;
          error = 'Camera disconnected';
          stop().catch(cause => { error = String(cause?.message ?? cause); sync(); });
        };
        for (const track of tracks) track.addEventListener('ended', ended);
        unwatchCamera = () => { for (const track of tracks) track.removeEventListener('ended', ended); };
        if (!tracks.length || tracks.some(track => track.readyState === 'ended')) throw Error('Camera disconnected');
        await video.play();
        if (ticket !== generation || disposed) return read();
        running = true; controller = createHoverController(); lastFrameAt = null; frameCount = 0; missCount = 0;
        frame(); schedule(ticket);
        record({ kind: 'iron-gland.start', phase: 'applied', effective: read() });
        return read();
      })().catch(cause => {
        if (ticket !== generation || disposed) return read();
        error = String(cause?.message ?? cause); releaseCamera(); hide();
        record({ kind: 'iron-gland.failure', phase: 'applied', effective: read() });
      }).finally(() => { if (ticket === generation) starting = false; sync(); });
      return read();
    };
    const loadModels = ({ files, base } = {}) => {
      if (disposed) throw Error('experiment closed');
      if (running || starting) throw Error('stop camera before replacing models');
      if (flight) throw Error('Wait for the current inference to finish before replacing models');
      if (loadTask) return loadTask;
      loading = true; error = null; sync();
      const task = (async () => {
        const models = files ? await readLocalModels(files) : base ? await readServedModels(base, window.location.href) : await store.get();
        if (!models) throw Error('Choose a prepared hand model folder');
        if (disposed) return read();
        const appGpu = await window.kaminosAppGpu?.();
        if (disposed) return read();
        if (!appGpu) throw Error('Workbench WebGPU host unavailable');
        const session = await appGpu.session();
        if (disposed) return read();
        // This consumer owns a single route lease. Replacing its files releases
        // that lease before re-registering on the same borrowed app session.
        route?.release(); route = null; modelSource = null;
        const next = await createBrowserHandMeshRoute({ session, mobreconPackageSource: models.mobrecon, detectorPackageSource: models.detector });
        if (disposed) { next.release(); return read(); }
        route = next; modelSource = files ? 'local-files' : base ? 'local-server' : 'browser-storage';
        if (files) await store.put(models).catch(() => {});
        return read();
      })().catch(cause => { error = String(cause?.message ?? cause); throw cause; })
        .finally(() => { loading = false; if (loadTask === task) loadTask = null; sync(); });
      loadTask = task; return task;
    };
    const setOptions = async options => {
      if (['starting','recording','saving'].includes(capture.read().status)||captureStarting) throw Error('Finish the take before changing hand or model settings');
      const next = { handedness, size, threshold, ...options };
      if (!['left', 'right'].includes(next.handedness)
          || !(Number.isFinite(next.size) && next.size > 0) || !(Number.isFinite(next.threshold) && next.threshold >= 0 && next.threshold <= 1)) throw Error('invalid Iron Gland options');
      if (disposed) throw Error('experiment closed');
      const resume = running || starting || resumeOptions;
      // Commit each edit before awaiting a drain. Later edits merge with it,
      // and a later explicit Stop cancels the generation-bound restart.
      ({ handedness, size, threshold } = next);
      const stopped = stop(), ticket = generation; resumeOptions = resume;
      updateInputs?.({ ...inputs, handedness, size, threshold });
      await stopped;
      if (ticket !== generation || disposed) return read();
      controller = createHoverController(); state = controller.read();
      record({ kind: 'iron-gland.options', phase: 'applied', effective: read() }); sync();
      if (resumeOptions) { resumeOptions = false; start(); }
      return read();
    };
    const beginCapture = ({label=''}={}) => {
      if (!running || !stream) throw Error('Start the camera before recording a take');
      if(captureStarting) return captureStarting;
      const ticket=generation;
      const task=(async()=>{
        const response=await window.fetch('/api/runtime-config');
        if(!response.ok)throw Error('Cannot identify the capture runtime');
        const runtime=await response.json();
        if(ticket!==generation||disposed)throw Error('Camera stopped before capture began');
        const result=await capture.begin({stream,identity:route.identity,faces:route.faces,runtime,
          settings:{handedness,size,threshold,label},source:inputs.captureSource??{kind:'live-camera'}});
        frame();return result;
      })().finally(()=>{if(captureStarting===task)captureStarting=null;sync();});
      captureStarting=task;return task;
    };
    const finishCapture = async () => {const result=await capture.finish(capture.read().protocolComplete?'complete':'partial','operator-finished');frame();return result;};
    frame();
    const unsubscribe = scene.onFrame(({ timestampMs }) => {
      if (!state.visible) return;
      machine.update(state, timestampMs / 1000); scene.redraw();
    });
    const pagehide = () => { stop().catch(() => {}); };
    window.addEventListener('pagehide', pagehide);
    return {
      read, operations: { start, stop, frame, loadModels, setOptions,beginCapture,finishCapture,
        pauseCapture:()=>capture.pause(),repeatCapture:()=>capture.repeat() },
      mount({ root, document, invoke }) {
        root.style.setProperty('letter-spacing', '0');
        const fail = cause => { error = String(cause?.message ?? cause); sync(); };
        const command = (label, operation) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = operation; return b; };
        startButton = command('Start camera', () => invoke(running || starting ? 'stop' : 'start').catch(fail));
        loadButton = command('Load hand models', () => inputFiles.click());
        inputFiles = document.createElement('input'); inputFiles.type = 'file'; inputFiles.multiple = true; inputFiles.webkitdirectory = true; inputFiles.hidden = true;
        inputFiles.onchange = () => invoke('loadModels', { files: [...inputFiles.files] }).catch(fail).finally(() => { inputFiles.value = ''; });
        const framing = command('Frame hand', () => invoke('frame').catch(fail));
        root.append(startButton, loadButton, inputFiles, framing);
        const hand = document.createElement('select'); hand.setAttribute('aria-label', 'Hand');
        for (const value of ['right', 'left']) { const o = document.createElement('option'); o.value = value; o.textContent = value === 'right' ? 'Right hand' : 'Left hand'; hand.append(o); }
        hand.value = handedness; hand.onchange = () => invoke('setOptions', { handedness: hand.value }).catch(fail); root.append(hand);
        for (const [key, label, value, min, max, step] of [['size', 'Mechanism size', size, .01, null, .05], ['threshold', 'Detection confidence', threshold, 0, 1, .01]]) {
          const holder = document.createElement('label'), grip = document.createElement('span'); grip.textContent = label;
          holder.style.cssText='display:flex;align-items:center;gap:8px;justify-content:space-between;margin:8px 0';
          const field = document.createElement('input'); field.type = 'number'; field.min = min; if(max!==null)field.max = max; field.step = 'any'; field.value = value; field.className='transform-input'; field.setAttribute('aria-label', label); field.style.width = '76px';
          field.oninput = () => { if(field.value.trim() && Number.isFinite(Number(field.value)))invoke('setOptions', { [key]: Number(field.value) }).catch(fail); };
          field.onblur = () => { field.value = read()[key]; };
          holder.append(grip,field); root.append(holder);
          host.controls.installNumberDrag?.({input:field,grip,step});
        }
        status = document.createElement('div'); status.setAttribute('role', 'status'); status.dataset.ironGlandStatus = ''; status.style.overflowWrap = 'anywhere'; root.append(status); sync();
        captureControls=mountCaptureControls({root,document,invoke,read,tick:()=>capture.tick()});
        loadModels({ base: inputs.models }).catch(fail);
      },
      async dispose() {
        disposed = true; window.removeEventListener('pagehide', pagehide); unsubscribe();
        await stop();
        captureControls?.dispose();captureControls=null;
        // A permission prompt may remain open: its generation guard stops a
        // late stream, so disposal need not wait for the human to answer it.
        if (loadTask) await loadTask.catch(() => {});
        route?.release(); route = null;
        await scene.dispose();
        restoreStage.forEach(restore => restore());
      },
    };
  },
};
