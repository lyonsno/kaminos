import {
  buildStageAtoms,
  simulateStageMaterialFrame,
  spatializeFromStageMaterial,
} from './stage-atoms-core.mjs';

const REPORT_URL = './artifacts/stage-atoms/ccmixter-geppetto-decoded-stage-atoms-witness.json';
const AUDIO_URL = './artifacts/stage-atoms/local-audio/coruscate-geppetto-dry-main.mp3';
const ROUTE_IDENTITY = 'stage-atoms-pulp-shaped-material-spatializer-v0';
const FEATURE_AUTHORITY = 'decoded-audio-clock-frame-v0';

const canvas = document.querySelector('#stage-atoms-canvas');
const context = canvas.getContext('2d');
const playButton = document.querySelector('#stage-atoms-play');
const seek = document.querySelector('#stage-atoms-seek');
const resetButton = document.querySelector('#stage-atoms-reset');
const stateNode = document.querySelector('#stage-atoms-state');
const failureNode = document.querySelector('#stage-atoms-failure');
const sourceAuthorityNode = document.querySelector('[data-stage-source-authority]');
const routeAuthorityNode = document.querySelector('[data-stage-route-authority]');
const fallbackAuthorityNode = document.querySelector('[data-stage-fallback-authority]');
const sourceLink = document.querySelector('#stage-atoms-source-link');

const nodes = {
  audioClock: document.querySelector('#stage-atoms-audio-clock'),
  visualClock: document.querySelector('#stage-atoms-visual-clock'),
  featureFrame: document.querySelector('#stage-atoms-feature-frame'),
  energy: document.querySelector('#feature-energy'),
  onset: document.querySelector('#feature-onset'),
  materialMemory: document.querySelector('#material-memory'),
  materialCoherence: document.querySelector('#material-coherence'),
  selectedName: document.querySelector('#material-selected-name'),
  selectedRole: document.querySelector('#material-selected-role'),
  selectedValue: document.querySelector('#material-selected-value'),
  selectedMeter: document.querySelector('#material-selected-meter'),
  selectedExcitation: document.querySelector('#material-selected-excitation'),
  selectedMemory: document.querySelector('#material-selected-memory'),
  selectedCoherence: document.querySelector('#material-selected-coherence'),
  selectedFlux: document.querySelector('#material-selected-flux'),
  time: document.querySelector('#stage-atoms-time'),
  duration: document.querySelector('#stage-atoms-duration'),
};

const runtime = {
  status: 'loading',
  report: null,
  stage: null,
  frames: [],
  materialFrame: null,
  spatialization: null,
  audioContext: null,
  audioBuffer: null,
  audioInputBus: null,
  audioBufferSource: null,
  audioMaster: null,
  audioAnalyser: null,
  audioOutput: { rms: 0, peak: 0 },
  audioSends: new Map(),
  audioEffectiveSource: null,
  audioBrowserSha256: null,
  transportOffsetSeconds: 0,
  playbackContextStartedAt: 0,
  playing: false,
  visualStartedAt: performance.now(),
  frameNumber: 0,
  lastMaterialFeatureIndex: null,
  materialResetCount: 0,
  nodeControlValues: {},
  selectedNodeId: null,
  pointerGesture: null,
  interactionCount: 0,
  lastInteractionAuthority: null,
  sourceRequested: REPORT_URL,
  sourceEffective: null,
  representativeSelection: null,
  fallbackAuthority: 'none',
  failure: null,
};

function authority(node, value, state) {
  node.dataset.state = state;
  node.querySelector('strong').textContent = value;
}

function formatTime(seconds) {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function featureFrameAt(timeSeconds) {
  if (runtime.frames.length === 0) return null;
  const rate = runtime.report.lastTrustworthyEvidence.audioInput.featureClock.rateHz;
  const index = Math.min(runtime.frames.length - 1, Math.max(0, Math.round(timeSeconds * rate)));
  return runtime.frames[index];
}

function depthSpatialization(materialFrame) {
  const spatialization = spatializeFromStageMaterial(materialFrame);
  return spatialization;
}

function materialStateAt(timeSeconds, {
  previousMaterialFrame = runtime.materialFrame,
  forceAdvance = false,
} = {}) {
  const sourceFrame = featureFrameAt(timeSeconds);
  if (!sourceFrame) return null;
  const shouldAdvance = forceAdvance || !previousMaterialFrame || sourceFrame.index !== runtime.lastMaterialFeatureIndex;
  const materialFrame = shouldAdvance
    ? simulateStageMaterialFrame(runtime.stage, {
      t: timeSeconds,
      dt: 1 / runtime.report.lastTrustworthyEvidence.audioInput.featureClock.rateHz,
      audioFeatures: sourceFrame,
      featureAuthority: FEATURE_AUTHORITY,
      previousMaterialFrame,
      nodeControls: runtime.nodeControlValues,
    })
    : previousMaterialFrame;
  const spatialization = depthSpatialization(materialFrame);
  if (shouldAdvance) runtime.lastMaterialFeatureIndex = sourceFrame.index;
  return { sourceFrame, materialFrame, spatialization };
}

function resetMaterialState() {
  runtime.materialFrame = null;
  runtime.spatialization = null;
  runtime.lastMaterialFeatureIndex = null;
  runtime.materialResetCount += 1;
  if (runtime.status === 'live') {
    const state = materialStateAt(audioClockTime(), { forceAdvance: true });
    runtime.materialFrame = state.materialFrame;
    runtime.spatialization = state.spatialization;
    updateAudioSends(state.spatialization);
  }
}

function setNodeControl(nodeId, value, interactionAuthority = 'programmatic-node-control') {
  const atom = runtime.stage?.atoms.find(candidate => String(candidate.id) === String(nodeId));
  if (!atom) return false;
  const contract = atom.materialRegion.localControl;
  runtime.nodeControlValues[atom.id] = Math.max(contract.min, Math.min(contract.max, Number(value)));
  runtime.selectedNodeId = atom.id;
  runtime.interactionCount += 1;
  runtime.lastInteractionAuthority = interactionAuthority;
  if (runtime.status === 'live') {
    const state = materialStateAt(audioClockTime(), { forceAdvance: true });
    runtime.materialFrame = state.materialFrame;
    runtime.spatialization = state.spatialization;
    updateAudioSends(state.spatialization);
  }
  return true;
}

function ensureAudioGraph() {
  if (runtime.audioMaster) return;
  runtime.audioInputBus = runtime.audioContext.createGain();
  runtime.audioMaster = runtime.audioContext.createGain();
  runtime.audioAnalyser = runtime.audioContext.createAnalyser();
  runtime.audioAnalyser.fftSize = 2048;
  runtime.audioMaster.connect(runtime.audioAnalyser);
  runtime.audioAnalyser.connect(runtime.audioContext.destination);
  for (const atom of runtime.stage.atoms) {
    const filter = runtime.audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    const panner = runtime.audioContext.createStereoPanner();
    const directGain = runtime.audioContext.createGain();
    const delay = runtime.audioContext.createDelay(1);
    const feedbackGain = runtime.audioContext.createGain();
    const wetGain = runtime.audioContext.createGain();
    directGain.gain.value = 0;
    wetGain.gain.value = 0;
    feedbackGain.gain.value = 0;
    runtime.audioInputBus.connect(filter);
    filter.connect(panner);
    panner.connect(directGain);
    directGain.connect(runtime.audioMaster);
    panner.connect(delay);
    delay.connect(feedbackGain);
    feedbackGain.connect(delay);
    delay.connect(wetGain);
    wetGain.connect(runtime.audioMaster);
    runtime.audioSends.set(atom.id, { filter, panner, directGain, delay, feedbackGain, wetGain });
  }
}

function updateTransportButton() {
  playButton.innerHTML = runtime.playing ? '&#10074;&#10074;' : '&#9654;';
  playButton.setAttribute('aria-label', runtime.playing ? 'Pause' : 'Play');
}

function audioClockTime() {
  if (!runtime.playing || !runtime.audioContext) return runtime.transportOffsetSeconds;
  const elapsed = runtime.audioContext.currentTime - runtime.playbackContextStartedAt;
  return Math.min(runtime.audioBuffer.duration, runtime.transportOffsetSeconds + elapsed);
}

function stopBufferSource({ preserveTime = true } = {}) {
  if (!runtime.audioBufferSource) return;
  if (preserveTime) runtime.transportOffsetSeconds = audioClockTime();
  const source = runtime.audioBufferSource;
  runtime.audioBufferSource = null;
  runtime.playing = false;
  source.onended = null;
  source.stop();
  updateTransportButton();
}

function startBufferSource() {
  stopBufferSource({ preserveTime: false });
  if (runtime.transportOffsetSeconds >= runtime.audioBuffer.duration) runtime.transportOffsetSeconds = 0;
  const source = runtime.audioContext.createBufferSource();
  source.buffer = runtime.audioBuffer;
  source.connect(runtime.audioInputBus);
  source.onended = () => {
    if (runtime.audioBufferSource !== source) return;
    runtime.transportOffsetSeconds = runtime.audioBuffer.duration;
    runtime.audioBufferSource = null;
    runtime.playing = false;
    updateTransportButton();
  };
  runtime.playbackContextStartedAt = runtime.audioContext.currentTime;
  runtime.audioBufferSource = source;
  runtime.playing = true;
  source.start(0, runtime.transportOffsetSeconds);
  updateTransportButton();
}

function measureAudioOutput() {
  if (!runtime.audioAnalyser) return runtime.audioOutput;
  const waveform = new Float32Array(runtime.audioAnalyser.fftSize);
  runtime.audioAnalyser.getFloatTimeDomainData(waveform);
  let sumSquares = 0;
  let peak = 0;
  for (const sample of waveform) {
    sumSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  runtime.audioOutput = {
    rms: Math.sqrt(sumSquares / waveform.length),
    peak,
  };
  return runtime.audioOutput;
}

function updateAudioSends(spatialization) {
  if (!runtime.audioContext) return;
  const now = runtime.audioContext.currentTime;
  const byId = new Map(spatialization.emitters.map(emitter => [emitter.id, emitter]));
  const directTotal = spatialization.emitters.reduce((sum, emitter) => sum + emitter.send.direct, 0) || 1;
  for (const [id, sendNodes] of runtime.audioSends) {
    const emitter = byId.get(id);
    const direct = emitter ? emitter.send.direct / directTotal * 0.84 : 0;
    const wet = emitter ? emitter.send.reverb / Math.max(1, spatialization.emitters.length) * 0.42 : 0;
    const latencySamples = runtime.stage.atoms.find(atom => atom.id === id)?.graph.latencySamples || 0;
    sendNodes.filter.frequency.setTargetAtTime(emitter?.send.lowpassHz || 1200, now, 0.025);
    sendNodes.panner.pan.setTargetAtTime(emitter?.send.pan || 0, now, 0.025);
    sendNodes.directGain.gain.setTargetAtTime(direct, now, 0.025);
    sendNodes.delay.delayTime.setTargetAtTime(Math.min(0.32, latencySamples / 44100 + (emitter?.send.spread || 0) * 0.11), now, 0.04);
    sendNodes.feedbackGain.gain.setTargetAtTime(Math.min(0.64, (emitter?.send.reverb || 0) * 0.58), now, 0.04);
    sendNodes.wetGain.gain.setTargetAtTime(wet, now, 0.04);
  }
}

function stagePoint(position, width, height) {
  const mobile = window.innerWidth <= 820;
  const railSpace = mobile ? 0 : 276;
  const stageWidth = width - railSpace;
  const depth = 1;
  const stageTop = mobile ? 98 : 72;
  const stageBottom = mobile ? height - 294 : height - 92;
  const stageHeight = Math.max(1, stageBottom - stageTop);
  return {
    x: stageWidth * 0.5 + position[0] * stageWidth * (mobile ? 0.27 : 0.34) * depth,
    y: stageTop + stageHeight * 0.5 - position[2] * stageHeight * 0.31 * depth,
  };
}

function atomColor(index) {
  return ['#ff806e', '#77e6d5', '#fff0a8', '#9faf63', '#da8fff'][index % 5];
}

function atomRadius(atom) {
  return 24 + atom.field.heat * 72 + atom.field.feedbackMemory * 22;
}

function nodeInterfaceGeometry() {
  if (!runtime.materialFrame) return [];
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  return runtime.materialFrame.materialAtoms.map((atom, index) => ({
    id: atom.id,
    label: atom.label,
    role: atom.field.localControlRole,
    value: runtime.nodeControlValues[atom.id],
    point: stagePoint(atom.position, width, height),
    radius: atomRadius(atom),
    color: atomColor(index),
  }));
}

function hitTestStageAtom(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  return nodeInterfaceGeometry()
    .map(node => ({
      ...node,
      hitDistance: Math.hypot((x - node.point.x) / Math.max(32, node.radius), (y - node.point.y) / Math.max(24, node.radius * 0.68)),
    }))
    .filter(node => node.hitDistance <= 1.15)
    .sort((a, b) => a.hitDistance - b.hitDistance)[0] || null;
}

function drawStage(timeSeconds) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = '#101216';
  context.fillRect(0, 0, width, height);

  context.strokeStyle = 'rgba(245,242,233,0.055)';
  context.lineWidth = 1;
  for (let row = 0; row < 9; row += 1) {
    const y = 92 + row * (height - 190) / 8;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y + Math.sin(row * 1.7) * 10);
    context.stroke();
  }

  if (!runtime.materialFrame) {
    context.fillStyle = '#777e82';
    context.font = '12px ui-monospace, monospace';
    context.fillText(runtime.status === 'failed' ? 'SOURCE GATE FAILED' : 'RESOLVING MATERIAL SOURCE', 24, 116);
    return;
  }

  const atomByGraphId = new Map(runtime.stage.atoms.map(atom => [String(atom.graph.nodeId), atom]));
  context.lineCap = 'round';
  for (const connection of runtime.stage.sourceGraph.connections || []) {
    const from = atomByGraphId.get(String(connection.sourceNode));
    const to = atomByGraphId.get(String(connection.destNode));
    if (!from || !to) continue;
    const a = stagePoint(from.stage.position, width, height);
    const b = stagePoint(to.stage.position, width, height);
    const materialFlow = runtime.materialFrame.materialFlows?.find(flow => (
      String(flow.sourceId) === String(from.id) && String(flow.destinationId) === String(to.id)
    ));
    const activity = materialFlow?.activity || 0;
    const pulse = 0.65 + 0.35 * Math.sin(timeSeconds * (2 + activity * 4) + Number(connection.sourceNode));
    const alpha = 0.06 + activity * 0.72 * pulse;
    context.strokeStyle = connection.feedback ? `rgba(255,128,110,${alpha})` : `rgba(119,230,213,${alpha})`;
    context.lineWidth = 1 + activity * 6 + (connection.feedback ? 1 : 0);
    context.setLineDash(connection.feedback ? [7, 8] : []);
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.bezierCurveTo(a.x, a.y - 70, b.x, b.y + 70, b.x, b.y);
    context.stroke();
  }
  context.setLineDash([]);

  for (const [index, atom] of runtime.materialFrame.materialAtoms.entries()) {
    const sourceAtom = runtime.stage.atoms.find(candidate => candidate.id === atom.id);
    const point = stagePoint(atom.position, width, height);
    const color = atomColor(index);
    const heat = atom.field.heat;
    const radius = atomRadius(atom);
    const localValue = runtime.nodeControlValues[atom.id] ?? 1;
    const selected = String(runtime.selectedNodeId) === String(atom.id);
    const mobile = window.innerWidth <= 820;

    context.save();
    context.translate(point.x, point.y);
    context.rotate(Math.sin(timeSeconds * 0.37 + index) * 0.13);
    context.strokeStyle = color;
    context.globalAlpha = 0.18 + heat * 0.52;
    context.lineWidth = 2 + heat * 4;
    context.beginPath();
    for (let step = 0; step <= 36; step += 1) {
      const phase = step / 36 * Math.PI * 2;
      const warp = 1 + 0.17 * Math.sin(phase * 3 + timeSeconds * (1.2 + atom.field.coupling) + index);
      const x = Math.cos(phase) * radius * warp;
      const y = Math.sin(phase) * radius * (0.42 + atom.field.occlusion * 0.25) * warp;
      if (step === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.closePath();
    context.stroke();

    context.globalAlpha = 1;
    const particleCount = 10 + Math.round(heat * 18 + atom.field.feedbackMemory * 10);
    for (let particle = 0; particle < particleCount; particle += 1) {
      const phase = particle * 2.399 * (1 - atom.field.coherence * 0.78) + timeSeconds * (0.4 + atom.field.coupling * 1.3);
      const radial = radius * (0.18 + ((particle * 37) % 83) / 100);
      const x = Math.cos(phase) * radial;
      const y = Math.sin(phase * 1.13) * radial * 0.5 - Math.sin(timeSeconds * 2.1 + particle) * heat * 13;
      context.fillStyle = particle % 4 === 0 ? '#f5f2e9' : color;
      context.globalAlpha = 0.24 + heat * 0.66;
      context.fillRect(x - 1.5, y - 1.5, 3 + heat * 2, 3 + heat * 2);
    }
    context.restore();

    const controlRadius = radius + 11;
    const controlStart = Math.PI * 0.72;
    const controlSpan = Math.PI * 1.56;
    const controlEnd = controlStart + controlSpan * (localValue / 2);
    context.lineWidth = selected ? 4 : 2;
    context.strokeStyle = 'rgba(245,242,233,0.13)';
    context.beginPath();
    context.arc(point.x, point.y, controlRadius, controlStart, controlStart + controlSpan);
    context.stroke();
    context.strokeStyle = selected ? '#f5f2e9' : color;
    context.globalAlpha = selected ? 0.95 : 0.58;
    context.beginPath();
    context.arc(point.x, point.y, controlRadius, controlStart, controlEnd);
    context.stroke();
    context.fillStyle = selected ? '#f5f2e9' : color;
    context.beginPath();
    context.arc(point.x + Math.cos(controlEnd) * controlRadius, point.y + Math.sin(controlEnd) * controlRadius, selected ? 5 : 3.5, 0, Math.PI * 2);
    context.fill();

    context.globalAlpha = 1;
    const labelX = Math.max(12, Math.min(point.x - radius, width - (mobile ? 118 : 190)));
    const labelY = point.y + radius * 0.7 + 18;
    context.fillStyle = '#f5f2e9';
    context.font = '600 11px ui-sans-serif, system-ui';
    context.fillText(atom.label, labelX, labelY);
    context.fillStyle = selected ? '#fff0a8' : color;
    context.font = '600 9px ui-monospace, monospace';
    context.fillText(`${atom.field.localControlRole.toUpperCase()} ${localValue.toFixed(2)}`, labelX, labelY + 13);
    if (!mobile) {
      context.fillStyle = '#747c7e';
      context.font = '9px ui-monospace, monospace';
      const authorityText = sourceAtom?.materialRegion.bindingAuthority === 'pulp-design-ir-param-key' ? 'DESIGNIR' : 'GRAPH';
      context.fillText(`${authorityText}  E${atom.field.excitation.toFixed(2)}  M${atom.field.feedbackMemory.toFixed(2)}  C${atom.field.coherence.toFixed(2)}`, labelX, labelY + 26);
    }
  }
}

function updateSelectedReadout() {
  const sourceAtom = runtime.stage?.atoms.find(atom => String(atom.id) === String(runtime.selectedNodeId));
  const materialAtom = runtime.materialFrame?.materialAtoms.find(atom => String(atom.id) === String(runtime.selectedNodeId));
  if (!sourceAtom || !materialAtom) return;
  const value = runtime.nodeControlValues[sourceAtom.id] ?? 1;
  nodes.selectedName.textContent = sourceAtom.label;
  nodes.selectedRole.textContent = sourceAtom.materialRegion.localControl.label;
  nodes.selectedValue.textContent = value.toFixed(2);
  nodes.selectedMeter.style.width = `${value / 2 * 100}%`;
  nodes.selectedExcitation.textContent = materialAtom.field.excitation.toFixed(2);
  nodes.selectedMemory.textContent = materialAtom.field.feedbackMemory.toFixed(2);
  nodes.selectedCoherence.textContent = materialAtom.field.coherence.toFixed(2);
  nodes.selectedFlux.textContent = materialAtom.field.incomingFlux.toFixed(2);
}

function updateReadouts(sourceFrame, visualSeconds) {
  const audioTime = audioClockTime();
  nodes.audioClock.textContent = `${audioTime.toFixed(3)} s`;
  nodes.visualClock.textContent = `${visualSeconds.toFixed(3)} s`;
  nodes.featureFrame.textContent = `${sourceFrame.index + 1} / ${runtime.frames.length}`;
  nodes.energy.textContent = sourceFrame.energy.toFixed(2);
  nodes.onset.textContent = sourceFrame.onsetStrength.toFixed(2);
  const atoms = runtime.materialFrame?.materialAtoms || [];
  const divisor = Math.max(1, atoms.length);
  nodes.materialMemory.textContent = (atoms.reduce((sum, atom) => sum + atom.field.feedbackMemory, 0) / divisor).toFixed(2);
  nodes.materialCoherence.textContent = (atoms.reduce((sum, atom) => sum + atom.field.coherence, 0) / divisor).toFixed(2);
  updateSelectedReadout();
  nodes.time.textContent = formatTime(audioTime);
  nodes.duration.textContent = formatTime(runtime.audioBuffer?.duration);
  seek.value = runtime.audioBuffer?.duration ? String(audioTime / runtime.audioBuffer.duration) : '0';
}

function publishDebug(sourceFrame, visualSeconds) {
  const audioOutput = measureAudioOutput();
  window.kaminosStageAtomsDebugState = {
    schema: 'kaminos.stage-atoms-browser-debug.v0',
    status: runtime.status,
    requestedRoute: ROUTE_IDENTITY,
    effectiveRoute: runtime.report?.effectiveRoute || null,
    requestedSource: runtime.sourceRequested,
    effectiveSource: runtime.sourceEffective,
    sourceAuthority: runtime.report?.lastTrustworthyEvidence?.audioInput?.authority || null,
    decodedSha256: runtime.report?.lastTrustworthyEvidence?.audioInput?.decode?.sha256 || null,
    downloadSha256: runtime.report?.lastTrustworthyEvidence?.downloadReceipt?.sha256 || null,
    browserAudioSha256: runtime.audioBrowserSha256,
    browserAudioEffectiveSource: runtime.audioEffectiveSource,
    fallbackAuthority: runtime.fallbackAuthority,
    audioClock: { authority: 'webaudio-context-plus-transport-offset', timeSeconds: audioClockTime(), paused: !runtime.playing },
    simulationClock: { authority: 'request-animation-frame-performance-now', timeSeconds: visualSeconds, frameNumber: runtime.frameNumber },
    clockBoundary: 'decoded feature frame selected by AudioContext currentTime plus transport offset; pointer control events advance one bounded transition; render sampled by performance.now()',
    representativeSelection: runtime.representativeSelection,
    nodeControls: { ...runtime.nodeControlValues },
    nodeInterfaces: nodeInterfaceGeometry().map(node => ({
      id: node.id,
      label: node.label,
      role: node.role,
      value: node.value,
      point: node.point,
      radius: node.radius,
      selected: String(node.id) === String(runtime.selectedNodeId),
    })),
    selectedNodeId: runtime.selectedNodeId,
    interaction: {
      authority: runtime.lastInteractionAuthority,
      count: runtime.interactionCount,
      pointerActive: Boolean(runtime.pointerGesture),
    },
    materialHistory: {
      stateAuthority: runtime.materialFrame?.stateAuthority || null,
      resetCount: runtime.materialResetCount,
    },
    featureFrame: sourceFrame,
    materialFrame: runtime.materialFrame,
    spatialization: runtime.spatialization,
    audioGraph: {
      authority: 'material-spatialization-emitter-sends',
      sendCount: runtime.audioSends.size,
      outputRms: audioOutput.rms,
      outputPeak: audioOutput.peak,
    },
    failure: runtime.failure,
  };
}

function frame(now) {
  runtime.frameNumber += 1;
  const visualSeconds = (now - runtime.visualStartedAt) / 1000;
  if (runtime.status === 'live') {
    const state = materialStateAt(audioClockTime());
    runtime.materialFrame = state.materialFrame;
    runtime.spatialization = state.spatialization;
    updateAudioSends(state.spatialization);
    updateReadouts(state.sourceFrame, visualSeconds);
    publishDebug(state.sourceFrame, visualSeconds);
  }
  drawStage(visualSeconds);
  requestAnimationFrame(frame);
}

function fail(error) {
  runtime.status = 'failed';
  runtime.failure = String(error?.message || error);
  runtime.fallbackAuthority = 'none-failed-loud';
  document.body.dataset.stageAtomsStatus = 'failed';
  failureNode.hidden = false;
  failureNode.textContent = runtime.failure;
  stateNode.dataset.state = 'failed';
  stateNode.querySelector('span').textContent = 'Failed';
  authority(sourceAuthorityNode, 'unverified', 'failed');
  authority(routeAuthorityNode, 'rejected', 'failed');
  authority(fallbackAuthorityNode, 'none / failed', 'failed');
  playButton.disabled = true;
  window.kaminosStageAtomsDebugState = {
    schema: 'kaminos.stage-atoms-browser-debug.v0',
    status: 'failed',
    requestedRoute: ROUTE_IDENTITY,
    effectiveRoute: runtime.report?.effectiveRoute || null,
    requestedSource: runtime.sourceRequested,
    effectiveSource: runtime.sourceEffective,
    fallbackAuthority: runtime.fallbackAuthority,
    failure: runtime.failure,
  };
}

async function boot() {
  const response = await fetch(REPORT_URL, { cache: 'no-store' });
  runtime.sourceEffective = response.url;
  if (!response.ok) throw new Error(`witness report HTTP ${response.status}: ${response.url}`);
  const report = await response.json();
  runtime.report = report;
  const evidence = report.lastTrustworthyEvidence || {};
  const decode = evidence.audioInput?.decode;
  const download = evidence.downloadReceipt;
  if (report.status !== 'passed') throw new Error(`witness report status ${report.status}`);
  if (report.effectiveRoute !== ROUTE_IDENTITY) throw new Error(`effective route mismatch: ${report.effectiveRoute}`);
  if (report.witness?.materialFrame?.featureAuthority !== FEATURE_AUTHORITY) throw new Error(`feature authority mismatch: ${report.witness?.materialFrame?.featureAuthority}`);
  if (download?.status !== 'downloaded' || !decode?.sha256 || decode.sha256 !== download.sha256) throw new Error('download/decode hash authority mismatch');
  if (!Array.isArray(evidence.audioInput?.frames) || evidence.audioInput.frames.length === 0) throw new Error('decoded feature frames missing');
  const reportedStage = report.witness.stage;
  runtime.stage = buildStageAtoms({
    sourceAccess: reportedStage.sourceAccess,
    design: reportedStage.sourceDesign,
    graph: reportedStage.sourceGraph,
  });
  runtime.nodeControlValues = Object.fromEntries(runtime.stage.atoms.map(atom => [atom.id, atom.materialRegion.localControl.defaultValue]));
  runtime.selectedNodeId = runtime.stage.atoms[0]?.id || null;
  runtime.frames = evidence.audioInput.frames;
  runtime.representativeSelection = evidence.featureSelection || null;
  sourceLink.href = report.witness.stage.sourceAccess.sourcePageUrl;
  sourceLink.textContent = `${report.witness.stage.sourceAccess.artist} / ${report.witness.stage.sourceAccess.title}`;

  const audioResponse = await fetch(AUDIO_URL, { cache: 'no-store' });
  runtime.audioEffectiveSource = audioResponse.url;
  if (!audioResponse.ok) throw new Error(`verified audio asset HTTP ${audioResponse.status}: ${audioResponse.url}`);
  const encodedAudio = await audioResponse.arrayBuffer();
  runtime.audioBrowserSha256 = await sha256Hex(encodedAudio);
  if (runtime.audioBrowserSha256 !== decode.sha256) throw new Error('browser audio hash does not match decoded source receipt');
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  runtime.audioContext = new AudioContextClass();
  runtime.audioBuffer = await runtime.audioContext.decodeAudioData(encodedAudio.slice(0));
  ensureAudioGraph();
  const selectedTime = evidence.featureSelection?.effectiveTimeSeconds || 0;
  runtime.transportOffsetSeconds = Math.min(runtime.audioBuffer.duration, selectedTime);
  runtime.status = 'live';
  document.body.dataset.stageAtomsStatus = 'live';
  authority(sourceAuthorityNode, `decoded / ${decode.sha256.slice(0, 8)}`, 'verified');
  authority(routeAuthorityNode, 'material stage', 'verified');
  authority(fallbackAuthorityNode, 'none', 'verified');
  stateNode.dataset.state = 'live';
  stateNode.querySelector('span').textContent = 'Live source';
  playButton.disabled = false;
  const initial = materialStateAt(audioClockTime());
  runtime.materialFrame = initial.materialFrame;
  runtime.spatialization = initial.spatialization;
  publishDebug(initial.sourceFrame, 0);
}

playButton.addEventListener('click', async () => {
  if (runtime.status !== 'live') return;
  await runtime.audioContext.resume();
  if (runtime.playing) stopBufferSource(); else startBufferSource();
});
seek.addEventListener('input', () => {
  if (!runtime.audioBuffer) return;
  const wasPlaying = runtime.playing;
  if (wasPlaying) stopBufferSource({ preserveTime: false });
  runtime.transportOffsetSeconds = Number(seek.value) * runtime.audioBuffer.duration;
  resetMaterialState();
  if (wasPlaying) startBufferSource();
});

resetButton.addEventListener('click', resetMaterialState);

canvas.addEventListener('pointerdown', event => {
  if (runtime.status !== 'live') return;
  const hit = hitTestStageAtom(event.clientX, event.clientY);
  if (!hit) return;
  runtime.selectedNodeId = hit.id;
  runtime.pointerGesture = {
    pointerId: event.pointerId,
    nodeId: hit.id,
    startY: event.clientY,
    startValue: runtime.nodeControlValues[hit.id],
  };
  runtime.lastInteractionAuthority = 'canvas-node-pointer-selection';
  canvas.setPointerCapture(event.pointerId);
  canvas.style.cursor = 'ns-resize';
  updateSelectedReadout();
});

canvas.addEventListener('pointermove', event => {
  const gesture = runtime.pointerGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) {
    canvas.style.cursor = hitTestStageAtom(event.clientX, event.clientY) ? 'ns-resize' : 'default';
    return;
  }
  const value = gesture.startValue + (gesture.startY - event.clientY) / 90;
  setNodeControl(gesture.nodeId, value, 'canvas-node-pointer-drag-current-decoded-frame');
});

function finishPointerGesture(event) {
  if (!runtime.pointerGesture || runtime.pointerGesture.pointerId !== event.pointerId) return;
  runtime.pointerGesture = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  canvas.style.cursor = 'default';
}

canvas.addEventListener('pointerup', finishPointerGesture);
canvas.addEventListener('pointercancel', finishPointerGesture);
canvas.addEventListener('dblclick', event => {
  const hit = hitTestStageAtom(event.clientX, event.clientY);
  if (hit) setNodeControl(hit.id, 1, 'canvas-node-double-click-reset');
});

window.kaminosMaterialCircuitSetNodeControl = setNodeControl;
window.kaminosStageAtomsResetMaterialState = resetMaterialState;

requestAnimationFrame(frame);
boot().catch(fail);
