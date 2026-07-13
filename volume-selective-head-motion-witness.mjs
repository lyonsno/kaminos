#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

const SCHEMA = 'kaminos.volume.selective-head-motion-witness.v0';
const FRAME_SCHEMA = 'kaminos.volume.selective-head-motion-frame.v0';
const TEMPORAL_AUTHORITY = 'consecutive-phase-aligned-per-frame-frozen-model-application-v0';
const PARTIAL_DEBUG_AUTHORITY = 'render-only-control-override-v0';
const EXPECTED_COMPOSITION = 'raymarch-under-splats-v0';
const ROLES = [
  'truthHigh',
  'lowPhaseAligned',
  'selectiveFullResidual',
  'selectiveCalibratedResidual',
];
const ROLE_LABELS = {
  truthHigh: 'Truth high',
  lowPhaseAligned: 'Low phase-aligned control',
  selectiveFullResidual: 'Selective full residual',
  selectiveCalibratedResidual: 'Selective calibrated residual',
};

const args = parseArgs(process.argv.slice(2));
const outDir = resolve(String(args.values.get('--out-dir') || '/tmp/kaminos-selective-head-motion-witness'));
const manifestPath = resolve(String(args.values.get('--manifest') || join(outDir, 'manifest.json')));
const expectedFrameCount = Number(args.values.get('--expected-frame-count') || args.frames.length);
const requestedPartialDebugMix = Number(args.values.get('--partial-debug-mix') || 0.625);
let failurePhase = 'argument-validation';
let lastTrustworthyEvidence = {};

try {
  mkdirSync(outDir, { recursive: true });
  if (args.frames.length < 2) throw new Error('at least two --frame-manifest inputs are required');
  if (!Number.isInteger(expectedFrameCount) || expectedFrameCount < 2) {
    throw new Error(`invalid --expected-frame-count: ${expectedFrameCount}`);
  }
  if (args.frames.length !== expectedFrameCount) {
    throw new Error(`frame count mismatch: received ${args.frames.length}, expected ${expectedFrameCount}`);
  }
  if (!Number.isFinite(requestedPartialDebugMix)
    || requestedPartialDebugMix < 0.5
    || requestedPartialDebugMix > 0.75) {
    throw new Error(`partial debug mix must be within 0.50-0.75, got ${requestedPartialDebugMix}`);
  }

  failurePhase = 'frame-manifest-validation';
  const frames = args.frames.map((path, ordinal) => loadFrame(path, ordinal));
  lastTrustworthyEvidence = {
    loadedFrameCount: frames.length,
    frameManifestPaths: frames.map(frame => frame.sourceManifestPath),
  };

  failurePhase = 'temporal-validation';
  validateTemporalCustody(frames);
  failurePhase = 'role-validation';
  validateRoles(frames);
  failurePhase = 'render-identity-validation';
  const renderIdentity = validateRenderIdentity(frames, requestedPartialDebugMix);
  failurePhase = 'artifact-validation';
  const copiedFrames = copyArtifacts(frames);
  failurePhase = 'output';

  const first = frames[0];
  const manifest = {
    schema: SCHEMA,
    identity: 'selective-head-consecutive-hybrid-playback-v0',
    status: 'captured',
    failurePhase: null,
    temporalAuthority: TEMPORAL_AUTHORITY,
    recurrentPrediction: false,
    staticSidecarOverMovingMaterial: false,
    phaseAlignedPairAuthority: first.phaseAlignedPairAuthority,
    sequenceIdentity: first.sequenceIdentity,
    frameCount: copiedFrames.length,
    roles: ROLES,
    simulationSteps: frames.map(frame => frame.simulationStep),
    simulationTimesMs: frames.map(frame => frame.simulationTimeMs),
    cadenceMs: first.cadenceMs,
    cameraIdentity: first.cameraIdentity,
    cropIdentity: first.cropIdentity,
    sourceCaptureSha256: first.sourceCaptureSha256,
    selectiveModelIdentity: first.selectiveModelIdentity,
    supportThreshold: first.supportThreshold,
    calibratedResidualScale: first.calibratedResidualScale,
    partialFlowDebug: {
      requestedMix: requestedPartialDebugMix,
      effectiveMix: requestedPartialDebugMix,
      applicationAuthority: PARTIAL_DEBUG_AUTHORITY,
    },
    renderIdentity,
    frames: copiedFrames,
    falseClosureChecks: {
      consecutiveSimulationSteps: true,
      matchedRoleSet: true,
      matchedCameraCropCadence: true,
      fixedSourceAndModelIdentity: true,
      requestedEffectivePartialDebugMatch: true,
      noFallbackOrHiddenComposition: true,
      checksumBoundCopiedArtifacts: true,
      durableFailureReport: true,
    },
  };
  writeJson(manifestPath, manifest);
  writeFileSync(join(outDir, 'index.html'), renderHtml(manifest));
  console.log(JSON.stringify({ ok: true, manifest: manifestPath, index: join(outDir, 'index.html') }, null, 2));
} catch (error) {
  mkdirSync(dirname(manifestPath), { recursive: true });
  const failure = {
    schema: SCHEMA,
    identity: 'selective-head-consecutive-hybrid-playback-v0',
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    expectedFrameCount: Number.isFinite(expectedFrameCount) ? expectedFrameCount : null,
    receivedFrameCount: args.frames.length,
    frameManifestPaths: args.frames,
    lastTrustworthyEvidence,
  };
  writeJson(manifestPath, failure);
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
}

function parseArgs(argv) {
  const values = new Map();
  const frames = [];
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    const value = !next || next.startsWith('--') ? '1' : next;
    if (value !== '1') index += 1;
    if (key === '--frame-manifest') frames.push(resolve(value));
    else values.set(key, value);
  }
  return { values, frames };
}

function loadFrame(path, ordinal) {
  if (!existsSync(path)) throw new Error(`missing frame manifest: ${path}`);
  const raw = readFileSync(path, 'utf8');
  const frame = JSON.parse(raw);
  if (frame.schema !== FRAME_SCHEMA || frame.status !== 'captured' || frame.failurePhase !== null) {
    throw new Error(`frame ${ordinal} is not a captured ${FRAME_SCHEMA}: ${path}`);
  }
  return {
    ...frame,
    sourceManifestPath: path,
    sourceManifestSha256: sha256(Buffer.from(raw)),
  };
}

function validateTemporalCustody(frames) {
  const first = frames[0];
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (frame.frameIndex !== index) throw new Error(`frame index is not contiguous at ordinal ${index}: ${frame.frameIndex}`);
    if (!Number.isInteger(frame.simulationStep)) throw new Error(`frame ${index} simulationStep is not an integer`);
    if (index > 0 && frame.simulationStep !== frames[index - 1].simulationStep + 1) {
      throw new Error(`simulation steps are not consecutive: ${frames[index - 1].simulationStep} -> ${frame.simulationStep}`);
    }
    for (const key of [
      'sequenceIdentity',
      'cadenceMs',
      'cameraIdentity',
      'cropIdentity',
      'sourceCaptureSha256',
      'phaseAlignedPairAuthority',
      'selectiveModelIdentity',
      'supportThreshold',
      'calibratedResidualScale',
    ]) {
      if (frame[key] !== first[key]) throw new Error(`frame ${index} ${key} drift: ${frame[key]} != ${first[key]}`);
    }
    const expectedTime = first.simulationTimeMs + index * first.cadenceMs;
    if (Math.abs(frame.simulationTimeMs - expectedTime) > 1e-6) {
      throw new Error(`frame ${index} simulation time drift: ${frame.simulationTimeMs} != ${expectedTime}`);
    }
  }
}

function validateRoles(frames) {
  for (const frame of frames) {
    const actualRoles = Object.keys(frame.captures || {}).sort();
    const expectedRoles = [...ROLES].sort();
    if (JSON.stringify(actualRoles) !== JSON.stringify(expectedRoles)) {
      throw new Error(`frame ${frame.frameIndex} role mismatch: ${actualRoles.join(',')} != ${expectedRoles.join(',')}`);
    }
    for (const role of ROLES) {
      if (frame.captures[role]?.role !== role) throw new Error(`frame ${frame.frameIndex} capture role identity mismatch for ${role}`);
    }
  }
}

function validateRenderIdentity(frames, partialDebugMix) {
  const firstReceipt = frames[0].captures[ROLES[0]].renderReceipt;
  const keys = ['effectiveRoute', 'backend', 'composition', 'learnedDecoder', 'learnedDecoderModel'];
  if (firstReceipt?.composition !== EXPECTED_COMPOSITION) {
    throw new Error(`unsupported hybrid composition: ${firstReceipt?.composition || '(missing)'}`);
  }
  for (const frame of frames) {
    for (const role of ROLES) {
      const capture = frame.captures[role];
      const receipt = capture.renderReceipt || {};
      for (const key of keys) {
        if (receipt[key] !== firstReceipt[key]) {
          throw new Error(`frame ${frame.frameIndex}/${role} render ${key} drift: ${receipt[key]} != ${firstReceipt[key]}`);
        }
      }
      if (receipt.fallback !== null) throw new Error(`frame ${frame.frameIndex}/${role} used fallback: ${receipt.fallback}`);
      for (const countKey of ['boundarySplatCandidateCount', 'boundarySplatInstanceCount', 'boundarySplatOverflowCount']) {
        if (!Number.isFinite(receipt[countKey])) throw new Error(`frame ${frame.frameIndex}/${role} missing ${countKey}`);
      }
      const debug = capture.partialFlowDebug || {};
      if (debug.requestedMix !== partialDebugMix || debug.effectiveMix !== partialDebugMix) {
        throw new Error(`frame ${frame.frameIndex}/${role} partial debug mismatch: ${debug.requestedMix}/${debug.effectiveMix}`);
      }
      if (debug.applicationAuthority !== PARTIAL_DEBUG_AUTHORITY) {
        throw new Error(`frame ${frame.frameIndex}/${role} partial debug is not render-only`);
      }
    }
  }
  return Object.fromEntries(keys.map(key => [key, firstReceipt[key]]));
}

function copyArtifacts(frames) {
  const frameRoot = join(outDir, 'frames');
  mkdirSync(frameRoot, { recursive: true });
  return frames.map(frame => {
    const captures = {};
    for (const role of ROLES) {
      const capture = frame.captures[role];
      captures[role] = {
        role,
        beauty: copyArtifact(capture.beauty, frame.frameIndex, role, 'beauty', frameRoot),
        partialFlowDebug: {
          ...copyArtifact(capture.partialFlowDebug, frame.frameIndex, role, 'partial-flow', frameRoot),
          requestedMix: capture.partialFlowDebug.requestedMix,
          effectiveMix: capture.partialFlowDebug.effectiveMix,
          applicationAuthority: capture.partialFlowDebug.applicationAuthority,
        },
        renderReceipt: capture.renderReceipt,
      };
    }
    return {
      frameIndex: frame.frameIndex,
      simulationStep: frame.simulationStep,
      simulationTimeMs: frame.simulationTimeMs,
      sourceManifestPath: frame.sourceManifestPath,
      sourceManifestSha256: frame.sourceManifestSha256,
      captures,
    };
  });
}

function copyArtifact(artifact, frameIndex, role, kind, frameRoot) {
  const source = resolve(String(artifact?.path || ''));
  if (!existsSync(source)) throw new Error(`missing ${kind} image for frame ${frameIndex}/${role}: ${source}`);
  const actualSha256 = sha256(readFileSync(source));
  if (actualSha256 !== artifact.sha256) {
    throw new Error(`${kind} image checksum mismatch for frame ${frameIndex}/${role}: ${actualSha256} != ${artifact.sha256}`);
  }
  const extension = basename(source).includes('.') ? `.${basename(source).split('.').pop()}` : '.png';
  const target = join(frameRoot, `${String(frameIndex).padStart(4, '0')}-${role}-${kind}${extension}`);
  copyFileSync(source, target);
  return {
    path: relative(outDir, target),
    sourcePath: source,
    sha256: actualSha256,
    byteLength: readFileSync(target).byteLength,
  };
}

function renderHtml(manifest) {
  const playback = manifest.frames.map(frame => ({
    frameIndex: frame.frameIndex,
    simulationStep: frame.simulationStep,
    captures: Object.fromEntries(ROLES.map(role => [role, {
      beauty: frame.captures[role].beauty.path,
      partial: frame.captures[role].partialFlowDebug.path,
    }])),
  }));
  const roleFigures = ROLES.map(role => `
    <figure>
      <img id="image-${role}" alt="${escapeHtml(ROLE_LABELS[role])}">
      <figcaption>${escapeHtml(ROLE_LABELS[role])}</figcaption>
    </figure>`).join('');
  const frameTicks = manifest.frames.map(frame => `
      <option value="${frame.frameIndex}" data-frame-index="${frame.frameIndex}" label="step ${frame.simulationStep}"></option>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Selective Head Motion Witness</title>
  <style>
    :root { color-scheme: dark; background: #0a0a0a; color: #f3f3f3; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    header, .controls { padding: 12px 16px; border-bottom: 1px solid #363636; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; }
    h1 { margin: 0; font-size: 17px; letter-spacing: 0; }
    .meta { color: #aaa; font-size: 12px; }
    .controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    button { border: 1px solid #555; background: #1c1c1c; color: #fff; padding: 7px 10px; border-radius: 4px; }
    button[aria-pressed="true"] { background: #f0f0f0; color: #111; }
    input[type="range"] { width: min(420px, 55vw); }
    main { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; background: #343434; }
    figure { margin: 0; min-width: 0; background: #080808; }
    img { width: 100%; aspect-ratio: 4 / 3; object-fit: contain; display: block; image-rendering: auto; }
    figcaption { padding: 8px 10px; border-top: 1px solid #292929; font-size: 12px; }
    @media (max-width: 760px) { main { grid-template-columns: 1fr; } header { align-items: flex-start; flex-direction: column; } }
  </style>
</head>
<body>
  <header>
    <h1>Selective-head consecutive hybrid witness</h1>
    <div class="meta">${manifest.frameCount} frames · steps ${manifest.simulationSteps[0]}-${manifest.simulationSteps.at(-1)} · 62.5% flow debug</div>
  </header>
  <div class="controls">
    <button id="play" type="button" aria-pressed="false">Playback</button>
    <button id="beauty" type="button" aria-pressed="true">Beauty</button>
    <button id="partial" type="button" aria-pressed="false">62.5% flow debug</button>
    <input id="frame" type="range" min="0" max="${manifest.frameCount - 1}" value="0" step="1" list="frame-ticks" aria-label="Frame">
    <datalist id="frame-ticks">${frameTicks}
    </datalist>
    <output id="readout"></output>
  </div>
  <main>${roleFigures}</main>
  <script>
    const frames = ${JSON.stringify(playback)};
    const roles = ${JSON.stringify(ROLES)};
    let mode = 'beauty';
    let timer = null;
    const slider = document.getElementById('frame');
    const readout = document.getElementById('readout');
    function draw(index) {
      const frame = frames[index];
      for (const role of roles) document.getElementById('image-' + role).src = frame.captures[role][mode];
      slider.value = String(index);
      readout.textContent = 'frame ' + index + ' · simulation step ' + frame.simulationStep;
    }
    function setMode(next) {
      mode = next;
      document.getElementById('beauty').setAttribute('aria-pressed', String(mode === 'beauty'));
      document.getElementById('partial').setAttribute('aria-pressed', String(mode === 'partial'));
      draw(Number(slider.value));
    }
    function togglePlayback() {
      if (timer) {
        clearInterval(timer); timer = null;
      } else {
        timer = setInterval(() => draw((Number(slider.value) + 1) % frames.length), ${Math.max(16, Math.round(manifest.cadenceMs))});
      }
      document.getElementById('play').setAttribute('aria-pressed', String(Boolean(timer)));
    }
    slider.addEventListener('input', () => draw(Number(slider.value)));
    document.getElementById('play').addEventListener('click', togglePlayback);
    document.getElementById('beauty').addEventListener('click', () => setMode('beauty'));
    document.getElementById('partial').addEventListener('click', () => setMode('partial'));
    draw(0);
  </script>
</body>
</html>`;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
