// Live hand mesh in the browser: camera frames through the WiLoR hand detector
// and MobRecon on the page's shared WebGPU device (the app GPU host's kit
// session), shown as a mesh in the working scene. Controls and display follow
// the native diagnostic `hand-live` experiment so the two can be compared:
// automatic (detector) or manual square crop, operator-chosen handedness,
// display-only centering with the native route's scale. No interaction authority.
import { Mesh, BufferGeometry, BufferAttribute, MeshNormalMaterial, DoubleSide } from '../lib/three.core.js';
import { createBrowserHandMeshRoute } from '../models/mobrecon/hand-mesh-route.js';

export function cameraCrop(width, height, x, y, size) {
  if (![width, height, x, y, size].every(Number.isFinite) || width <= 0 || height <= 0 || size <= 0) throw Error('invalid crop');
  const half = Math.min(width, height) * size / 2;
  return [x * width - half, y * height - half, x * width + half, y * height + half];
}

// Display-only transform of the route's meter vertices (as hand-live): mean
// centering and Y inversion; the scene mesh carries the fixed scale.
export function displayPositions(verticesMeters) {
  const positions = new Float32Array(verticesMeters), center = [0, 0, 0], n = positions.length / 3;
  for (let i = 0; i < positions.length; i++) center[i % 3] += positions[i] / n;
  for (let i = 0; i < positions.length; i++) positions[i] = (positions[i] - center[i % 3]) * (i % 3 === 1 ? -1 : 1);
  return { positions, center };
}

const median = values => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

export default {
  id: 'hand-mesh-webgpu', title: 'Browser MobRecon hand',
  async create({ host, inputs, record }) {
    const document = host.controls.document, window = document.defaultView;
    const appGpu = await window.kaminosAppGpu?.();
    if (!appGpu) throw Error('the browser hand mesh needs the page\'s app GPU host');
    const packages = { mobrecon: inputs.mobreconPackage ?? '/scratch/mobrecon/package/', detector: inputs.detectorPackage ?? '/scratch/hand-detector/package/' };
    let loading = { phase: 'weights' };
    const route = await createBrowserHandMeshRoute({ session: await appGpu.session(), mobreconPackageUrl: packages.mobrecon,
      detectorPackageUrl: packages.detector, onProgress: event => { loading = event; } });
    loading = null;
    let acquisitionMode = inputs.acquisitionMode ?? 'detector', cropPadding = Number(inputs.cropPadding ?? 1.4), detectorThreshold = Number(inputs.detectorThreshold ?? 0.18);
    let handedness = inputs.handedness ?? 'right', cropX = 0.5, cropY = 0.5, cropSize = 0.85;
    if (!['manual', 'detector'].includes(acquisitionMode) || !(cropPadding >= 1) || !(detectorThreshold >= 0 && detectorThreshold <= 1)) throw Error('invalid acquisition inputs');
    if (!['left', 'right'].includes(handedness)) throw Error('handedness must be left or right');

    const scene = await host.scene.open();
    const faces = Array.from(route.faces);
    const reversed = faces.map((v, i) => (i % 3 === 1 ? faces[i + 1] : i % 3 === 2 ? faces[i - 1] : v));
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(778 * 3), 3));
    geometry.setIndex(faces);
    const mesh = new Mesh(geometry, new MeshNormalMaterial({ side: DoubleSide }));
    mesh.name = 'MobRecon WebGPU hand'; mesh.position.y = 1.5; mesh.scale.setScalar(5); mesh.visible = false;
    await scene.attach(mesh, { owned: true, metadata: { label: mesh.name, type: 'live-diagnostic', source: route.identity } });
    window.kaminosSelection?.clear();

    const video = document.createElement('video');
    video.muted = true; video.autoplay = true; video.playsInline = true; video.style.cssText = 'width:100%;display:block';
    let stream = null, running = false, starting = false, disposed = false, generation = 0, frameCallback, flight = null;
    let status, button, overlay, error = null, last = null, received = 0, controls = {};
    const recent = [];
    const read = () => ({
      authority: 'browser_webgpu_diagnostic_not_interaction', interactionAuthority: false, identity: route.identity, packages, loading,
      running, starting, error, received, visible: mesh.visible, handedness, crop: { x: cropX, y: cropY, size: cropSize },
      acquisitionMode, cropPadding, detectorThreshold,
      acquisition: last?.acquisition.source ?? null, fallback: last?.acquisition.fallback ?? null,
      detections: last?.acquisition.detections.map(d => ({ handSide: d.handSide, confidence: d.confidence, bbox: d.bbox })) ?? null,
      cropBox: last?.cropBox ?? null, lastTimings: last?.timings ?? null,
      recentMedianMs: { total: median(recent.map(r => r.totalMs)), detector: median(recent.map(r => r.detectorMs).filter(Number.isFinite)), mobrecon: median(recent.map(r => r.mobreconMs)) },
      meshesPerSecond: recent.length > 1 ? (recent.length - 1) / ((recent.at(-1).at - recent[0].at) / 1000) : null,
      captureAgeMs: last ? performance.now() - last.capturedAt : null,
      camera: stream?.getVideoTracks()[0]?.getSettings() ?? null,
    });
    const fmt = v => (v == null ? '-' : Math.round(v));
    const sync = () => {
      if (button) { button.textContent = running ? 'Stop camera' : starting ? 'Starting camera' : 'Start camera'; button.disabled = starting; }
      const r = read();
      if (status) status.textContent = error ? `Stopped: ${error}${last ? ' | last mesh retained' : ''}`
        : `${running ? 'LIVE CAMERA' : 'STOPPED'} | MobRecon / WebGPU | ${received} meshes | ${fmt(r.meshesPerSecond)} per s | `
          + `median ${fmt(r.recentMedianMs.total)} ms (detector ${fmt(r.recentMedianMs.detector)}, mesh ${fmt(r.recentMedianMs.mobrecon)}) | `
          + `${last?.acquisition.fallback ? 'NO DETECTION: MANUAL CROP FALLBACK' : last?.acquisition.source === 'wilor_yolo_detector_bbox_only' ? 'YOLO / WebGPU crop' : acquisitionMode === 'detector' ? 'AUTO: awaiting detection' : 'MANUAL CROP'} | diagnostic, no interaction`;
      if (overlay && video.videoWidth) {
        const [x0, y0, x1, y1] = acquisitionMode === 'detector' && last ? last.cropBox : cameraCrop(video.videoWidth, video.videoHeight, cropX, cropY, cropSize);
        overlay.style.borderColor = last?.acquisition.fallback ? '#ff725e' : acquisitionMode === 'detector' ? '#60e1a1' : '#ffd75a';
        Object.assign(overlay.style, { left: `${x0 / video.videoWidth * 100}%`, top: `${y0 / video.videoHeight * 100}%`,
          width: `${(x1 - x0) / video.videoWidth * 100}%`, height: `${(y1 - y0) / video.videoHeight * 100}%` });
      }
    };
    const present = result => {
      const { positions } = displayPositions(result.verticesMeters);
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      geometry.setIndex(result.handedness === 'left' ? reversed : faces);
      geometry.computeVertexNormals(); geometry.computeBoundingSphere();
      mesh.visible = true; scene.redraw();
    };
    const infer = async (ticket, capturedAt) => {
      const width = video.videoWidth, height = video.videoHeight;
      const result = await route.infer({ source: video, width, height, handedness,
        acquisition: { mode: acquisitionMode, padding: cropPadding, threshold: detectorThreshold, manualBox: cameraCrop(width, height, cropX, cropY, cropSize) } });
      if (ticket !== generation || disposed) return;
      result.capturedAt = capturedAt;
      last = result; received++;
      recent.push({ at: performance.now(), ...result.timings });
      if (recent.length > 30) recent.shift();
      present(result); sync();
    };
    const schedule = ticket => {
      if (!running || ticket !== generation || disposed) return;
      frameCallback = video.requestVideoFrameCallback(() => {
        flight = infer(ticket, performance.now()).catch(cause => {
          error = String(cause?.message ?? cause); running = false;
          stream?.getTracks().forEach(t => t.stop()); stream = null; sync();
          record({ kind: 'hand-mesh-webgpu.failure', phase: 'applied', effective: read() });
        }).finally(() => { flight = null; schedule(ticket); });
      });
    };
    const stop = async () => {
      running = false; generation++;
      if (frameCallback !== undefined) video.cancelVideoFrameCallback(frameCallback);
      stream?.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null; sync();
      if (flight) await flight.catch(() => {});
      record({ kind: 'hand-mesh-webgpu.stop', phase: 'applied', effective: read() });
      return read();
    };
    const start = async () => {
      if (running || starting) return read();
      if (disposed) throw Error('experiment closed');
      if (flight) await flight;
      starting = true; error = null; sync();
      const ticket = ++generation;
      try {
        const acquired = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        if (disposed || ticket !== generation) { acquired.getTracks().forEach(t => t.stop()); return read(); }
        stream = acquired; video.srcObject = stream; await video.play();
        running = true; last = null; received = 0; recent.length = 0; mesh.visible = false; scene.redraw(); schedule(ticket);
        record({ kind: 'hand-mesh-webgpu.start', phase: 'applied', effective: read() });
        return read();
      } catch (cause) { error = String(cause?.message ?? cause); stream?.getTracks().forEach(t => t.stop()); stream = null; throw cause; }
      finally { starting = false; sync(); }
    };
    const frame = () => scene.setView({ position: [0, 1.5, window.innerWidth < 600 ? 6 : 4.2], target: [0, 1.5, 0] });
    const setAcquisition = value => {
      const mode = value.mode ?? acquisitionMode, padding = Number(value.padding ?? cropPadding), threshold = Number(value.threshold ?? detectorThreshold);
      if (!['manual', 'detector'].includes(mode) || !(padding >= 1) || !(threshold >= 0 && threshold <= 1)) throw Error('invalid acquisition config');
      acquisitionMode = mode; cropPadding = padding; detectorThreshold = threshold;
      if (controls.mode) controls.mode.value = mode;
      if (controls.padding) controls.padding.value = padding;
      if (controls.threshold) controls.threshold.value = threshold;
      sync();
      record({ kind: 'hand-mesh-webgpu.acquisition', phase: 'applied', effective: read() });
      return read();
    };
    const setHandedness = value => {
      if (!['left', 'right'].includes(value)) throw Error('handedness must be left or right');
      handedness = value;
      if (controls.hand) controls.hand.value = value;
      record({ kind: 'hand-mesh-webgpu.handedness', phase: 'applied', effective: read() });
      return read();
    };
    const setCrop = ({ x = cropX, y = cropY, size = cropSize } = {}) => {
      if (![x, y, size].every(Number.isFinite) || size <= 0) throw Error('invalid manual crop');
      cropX = x; cropY = y; cropSize = size; sync();
      return read();
    };
    frame();
    const unsubscribe = scene.onFrame(sync);
    return {
      read, operations: { start, stop, frame, setAcquisition, setHandedness, setCrop },
      mount({ root, document, invoke }) {
        const preview = document.createElement('div'); preview.style.cssText = 'position:relative;overflow:hidden';
        overlay = document.createElement('div'); overlay.style.cssText = 'position:absolute;border:2px solid #ffd75a;pointer-events:none;box-sizing:border-box';
        preview.append(video, overlay);
        const hand = document.createElement('select'); hand.setAttribute('aria-label', 'Hand');
        for (const side of ['right', 'left']) { const o = document.createElement('option'); o.value = side; o.textContent = side === 'right' ? 'Right hand' : 'Left hand'; hand.append(o); }
        hand.value = handedness; hand.onchange = () => invoke('setHandedness', hand.value).catch(cause => { error = String(cause); sync(); });
        controls.hand = hand;
        button = document.createElement('button'); button.onclick = () => invoke(running ? 'stop' : 'start').catch(cause => { error = String(cause?.message ?? cause); sync(); });
        const frameButton = document.createElement('button'); frameButton.textContent = 'Frame hand'; frameButton.onclick = () => invoke('frame');
        const mode = document.createElement('select'); mode.setAttribute('aria-label', 'Crop mode');
        for (const [value, label] of [['detector', 'Automatic crop'], ['manual', 'Manual crop']]) { const o = document.createElement('option'); o.value = value; o.textContent = label; mode.append(o); }
        mode.value = acquisitionMode; mode.onchange = () => invoke('setAcquisition', { mode: mode.value }).catch(cause => { error = String(cause); sync(); });
        controls.mode = mode;
        root.append(preview, hand, button, frameButton, mode);
        for (const [label, key, value, min, step] of [['Auto padding', 'padding', cropPadding, 1, 0.1], ['Detector threshold', 'threshold', detectorThreshold, 0, 0.01]]) {
          const holder = document.createElement('label'); holder.textContent = label;
          const input = document.createElement('input'); input.type = 'number'; input.min = min; input.step = step; input.value = value; input.style.width = '100%';
          if (key === 'threshold') input.max = 1;
          input.setAttribute('aria-label', label);
          input.onchange = () => invoke('setAcquisition', { [key]: Number(input.value) }).catch(cause => { error = String(cause); sync(); });
          controls[key] = input; holder.append(input); root.append(holder);
        }
        for (const [label, key, value] of [['Crop X', 'x', cropX], ['Crop Y', 'y', cropY], ['Crop size', 'size', cropSize]]) {
          const holder = document.createElement('label'); holder.textContent = label;
          const input = document.createElement('input'); input.type = 'range'; input.min = key === 'size' ? '.1' : '0'; input.max = '1'; input.step = '.01'; input.value = value;
          input.setAttribute('aria-label', label); input.style.width = '100%';
          input.oninput = () => invoke('setCrop', { [key]: Number(input.value) });
          holder.append(input); root.append(holder);
        }
        status = document.createElement('div'); status.dataset.handMeshStatus = ''; status.setAttribute('role', 'status'); status.style.overflowWrap = 'anywhere';
        root.append(status); sync();
      },
      async dispose() {
        disposed = true; unsubscribe();
        try { await stop(); }
        finally { route.release(); await scene.dispose(); }
      },
    };
  },
};
