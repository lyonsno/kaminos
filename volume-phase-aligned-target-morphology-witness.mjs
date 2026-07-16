#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const SCHEMA = 'kaminos.volume.phase-aligned-target-morphology-witness.v0';
const IDENTITY = 'phase-aligned-high-target-vs-filtered-low-vs-deterministic-vs-learned-v0';
const PAIR_AUTHORITY = 'downsampled-same-high-history-input-to-exact-high-target';
const ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const BACKEND = 'WebGPU:apple';
const args = parseArgs(process.argv.slice(2));
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-phase-aligned-target-morphology'));
const reportPath = join(outDir, 'manifest.json');
let phase = 'argument-validation';
let evidence = {};

try {
  mkdirSync(outDir, { recursive: true });
  const paths = {
    pair: requiredPath('--pair-manifest'),
    truth: requiredPath('--truth-manifest'),
    truthRender: requiredPath('--truth-render-manifest'),
    low: requiredPath('--low-manifest'),
    lowRender: requiredPath('--low-render-manifest'),
    deterministic: requiredPath('--deterministic-manifest'),
    deterministicRender: requiredPath('--deterministic-render-manifest'),
    learned: requiredPath('--learned-manifest'),
    learnedRender: requiredPath('--learned-render-manifest'),
  };
  evidence = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, {
    path, sha256: sha256File(path),
  }]));

  phase = 'input-validation';
  const pair = readJson(paths.pair);
  require(pair.schema === 'kaminos.volume.full-grid-field-pair.v0', 'pair schema mismatch');
  require(pair.status === 'captured' && pair.failurePhase === null, 'pair is not captured');
  require(pair.authority === PAIR_AUTHORITY, 'pair authority mismatch');
  require(pair.lowGrid === 96 && pair.highGrid === 160, 'pair must be phase-aligned 160-to-96');
  const basinSha256 = String(pair.source?.exactBasinSourceCaptureSha256 || '');
  require(validSha(basinSha256), 'pair exact basin source identity is missing');

  const truth = validateHeld(readJson(paths.truth), 'truthHigh', 160, true, basinSha256, pair.high);
  const low = validateHeld(readJson(paths.low), 'lowPhaseAligned', 96, false, basinSha256, pair.low);
  const deterministic = validateApplication(readJson(paths.deterministic), 0, evidence.pair.sha256, basinSha256, 'deterministic');
  const learned = validateApplication(readJson(paths.learned), 1, evidence.pair.sha256, basinSha256, 'learned');
  require(
    deterministic.source?.supportProbeManifestSha256 === learned.source?.supportProbeManifestSha256,
    'deterministic and learned roles do not use the same checkpoint',
  );
  require(
    JSON.stringify(deterministic.applicationHeads.channels) === JSON.stringify(learned.applicationHeads.channels),
    'deterministic and learned application heads do not match',
  );

  const renderInputs = {
    truthHigh160: validateRender(readJson(paths.truthRender), paths.truth, evidence.truth.sha256, 160, 'truthHigh160', basinSha256),
    filteredLow96Native: validateRender(readJson(paths.lowRender), paths.low, evidence.low.sha256, 96, 'filteredLow96Native', basinSha256),
    deterministic96to160: validateRender(readJson(paths.deterministicRender), paths.deterministic, evidence.deterministic.sha256, 160, 'deterministic96to160', basinSha256),
    learned96to160: validateRender(readJson(paths.learnedRender), paths.learned, evidence.learned.sha256, 160, 'learned96to160', basinSha256),
  };
  require(
    new Set(Object.values(renderInputs).map(item => item.comparisonFingerprint)).size === 1,
    'render roles do not share the same source capture, viewport, canvas, camera, and effective control contract',
  );

  phase = 'artifact-write';
  const images = {
    truthHigh160: copyImage(renderInputs.truthHigh160.image, '01-truth-high-160.png'),
    filteredLow96Native: copyImage(renderInputs.filteredLow96Native.image, '02-filtered-low-96-native.png'),
    deterministic96to160: copyImage(renderInputs.deterministic96to160.image, '03-deterministic-96-to-160.png'),
    learned96to160: copyImage(renderInputs.learned96to160.image, '04-learned-96-to-160.png'),
  };
  require(new Set(Object.values(images).map(item => item.sha256)).size === 4, 'comparison roles resolved to duplicate image payloads');

  const roles = {
    truthHigh160: {
      label: 'TARGET: phase-aligned high 160',
      authority: truth.initializationAuthority,
      targetAuthority: true,
      grid: 160,
      residualScale: null,
      image: images.truthHigh160,
    },
    filteredLow96Native: {
      label: 'SOURCE: filtered low 96, native render',
      authority: low.initializationAuthority,
      targetAuthority: false,
      grid: 96,
      residualScale: null,
      image: images.filteredLow96Native,
    },
    deterministic96to160: {
      label: 'CONTROL: deterministic 96 to 160',
      authority: 'phase-aligned-low-deterministically-materialized-at-160-v0',
      targetAuthority: false,
      grid: 160,
      residualScale: 0,
      image: images.deterministic96to160,
    },
    learned96to160: {
      label: 'TREATMENT: learned 96 to 160',
      authority: learned.compositionAuthority,
      targetAuthority: false,
      grid: 160,
      residualScale: 1,
      image: images.learned96to160,
    },
  };
  const report = {
    schema: SCHEMA,
    identity: IDENTITY,
    status: 'captured',
    failurePhase: null,
    question: 'Does deterministic 96-to-160 hollowing track phase-aligned high-160 truth, and what visible increment does learning add beyond deterministic reconstruction?',
    pair: {
      manifestPath: paths.pair,
      manifestSha256: evidence.pair.sha256,
      authority: pair.authority,
      lowGrid: pair.lowGrid,
      highGrid: pair.highGrid,
      exactBasinSourceCaptureSha256: basinSha256,
    },
    renderer: {
      requestedForAllRoles: 'raymarch-only-v0',
      effectiveForAllRoles: 'raymarch-only-v0',
      route: ROUTE,
      backend: BACKEND,
      splatsExcluded: true,
      sameCameraAndPresetRequired: true,
    },
    checkpoint: {
      supportProbeManifestSha256: learned.source.supportProbeManifestSha256,
      applicationHeads: learned.applicationHeads.channels,
      applicationHeadAuthority: learned.applicationHeads.authority,
      diagnosticOnlyExcluded: learned.applicationHeads.diagnosticOnlyExcluded,
      residualScales: { deterministic96to160: 0, learned96to160: 1 },
    },
    sources: evidence,
    roles,
    decisionBoundary: {
      deterministicTracksTarget: 'Treat common sheet/cavity morphology as target-directional deterministic lift; judge learning only against deterministic control.',
      deterministicDoesNotTrackTarget: 'Treat common hollowing as renderer or reconstruction coupling and normalize that path before model attribution.',
      partialAgreement: 'Isolate target-matching morphology from excess deterministic hollowing before ranking learned output.',
    },
    limitations: [
      'One exact phase-aligned training state and camera; this does not establish native-history generalization.',
      'The 96 source is derived from the high history and is not an independently stepped native-96 simulation.',
      'This still assay classifies morphology and model attribution; temporal quality remains a separate witness.',
    ],
    operatorArtifact: {
      path: join(outDir, 'index.html'),
      authority: 'same-state-same-camera-four-role-target-bearing-morphology-comparison-v0',
    },
  };
  writeJson(reportPath, report);
  writeFileSync(join(outDir, 'index.html'), htmlPage(report), 'utf8');
  console.log(JSON.stringify({ status: 'captured', manifest: reportPath, operatorArtifact: report.operatorArtifact.path }, null, 2));
} catch (error) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeJson(reportPath, {
    schema: SCHEMA,
    identity: IDENTITY,
    status: 'failed',
    failurePhase: phase,
    error: error?.stack || String(error),
    lastTrustworthyEvidence: evidence,
  });
  console.error(error?.stack || String(error));
  process.exitCode = 1;
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values.set(key, true);
    else { values.set(key, next); index += 1; }
  }
  return values;
}

function requiredPath(name) {
  const value = args.get(name);
  require(value && value !== true, `missing ${name}`);
  const path = resolve(String(value));
  require(existsSync(path), `${name} does not exist: ${path}`);
  return path;
}

function validateHeld(value, role, grid, runtimeTruthAvailable, basinSha256, pairSide) {
  require(value.schema === 'kaminos.volume.phase-aligned-held-field.v0', `${role} held schema mismatch`);
  require(value.status === 'captured' && value.failurePhase === null, `${role} held source is not captured`);
  require(value.role === role, `${role} held role mismatch`);
  require(value.renderOnly === true, `${role} held source is not render-only`);
  require(value.runtimeTruthAvailable === runtimeTruthAvailable, `${role} runtime truth authority mismatch`);
  require(value.receiver?.grid === grid, `${role} grid mismatch`);
  require(value.source?.exactBasinSourceCaptureSha256 === basinSha256, `${role} basin identity mismatch`);
  require(value.receiver?.fluid?.sha256 === pairSide?.fluid?.sha256, `${role} fluid does not match pair`);
  require(value.receiver?.front?.sha256 === pairSide?.front?.sha256, `${role} front does not match pair`);
  return value;
}

function validateApplication(value, scale, pairSha256, basinSha256, label) {
  require(value.schema === 'kaminos.volume.exact-basin-selective-composition.v0', `${label} application schema mismatch`);
  require(value.status === 'captured' && value.failurePhase === null, `${label} application is not captured`);
  require(value.compositionAuthority === 'learned-selective-head-composition-not-filtered-high-truth-v0', `${label} application authority mismatch`);
  require(value.runtimeTruthAvailable === false, `${label} application exposes runtime truth`);
  require(value.source?.pairManifestSha256 === pairSha256, `${label} pair checksum mismatch`);
  require(value.source?.exactBasinSourceCaptureSha256 === basinSha256, `${label} basin identity mismatch`);
  require(value.relationship?.authority === PAIR_AUTHORITY, `${label} pair authority mismatch`);
  require(value.relationship?.lowGrid === 96 && value.relationship?.highGrid === 160, `${label} grid relationship mismatch`);
  require(value.receiver?.grid === 160, `${label} receiver grid mismatch`);
  require(value.residualBlend?.scale === scale, `${label} residual scale must be ${scale}`);
  const applicationHeads = value.applicationHeads;
  require(applicationHeads?.identity === 'explicit-deployed-head-selection-v0', `${label} application heads identity mismatch`);
  require(applicationHeads?.authority === 'caller-selected-application-heads-v0', `${label} application heads authority mismatch`);
  require(Array.isArray(applicationHeads?.channels) && applicationHeads.channels.length > 0, `${label} application heads are missing`);
  require(new Set(applicationHeads.channels).size === applicationHeads.channels.length, `${label} application heads contain duplicates`);
  require(
    applicationHeads.channels.every(channel => applicationHeads.trainedChannels?.includes(channel)),
    `${label} application heads include an untrained channel`,
  );
  require(
    JSON.stringify(Object.keys(value.channelPolicies || {})) === JSON.stringify(applicationHeads.channels),
    `${label} channel policies do not match application heads`,
  );
  require(
    JSON.stringify(value.residualBlend?.appliesTo) === JSON.stringify(applicationHeads.channels),
    `${label} residual blend does not match application heads`,
  );
  return value;
}

function validateRender(value, sourceManifestPath, sourceManifestSha256, grid, label, basinSha256) {
  require(value.schema === 'kaminos.volume.held-field-render.v0', `${label} render schema mismatch`);
  require(value.status === 'captured' && value.failurePhase === null, `${label} render is not captured`);
  require(value.initialFieldImport?.requested?.manifestSha256 === sourceManifestSha256, `${label} requested source checksum mismatch`);
  require(resolve(String(value.initialFieldImport?.requested?.manifestPath || '')) === resolve(sourceManifestPath), `${label} requested source path mismatch`);
  require(value.initialFieldImport?.requested?.advanceImportedSteps === 0, `${label} advanced the held source`);
  require(value.initialFieldImport?.effective?.grid === grid, `${label} effective grid mismatch`);
  require(value.initialFieldImport?.effective?.routeIdentity === ROUTE, `${label} route mismatch`);
  require(value.initialFieldImport?.effective?.effectiveRoute === ROUTE, `${label} effective route mismatch`);
  require(value.sourceCapture?.hashMatches === true, `${label} source capture hash did not verify`);
  require(value.sourceCapture?.payloadSha256 === basinSha256, `${label} source capture payload mismatch`);
  require(value.sourceCapture?.actualPayloadSha256 === basinSha256, `${label} source capture actual payload mismatch`);
  require(value.importedRender?.backend === BACKEND, `${label} backend mismatch`);
  require(value.importedRender?.boundarySplatCompositionRequestedRaw === 'raymarch-only-v0', `${label} did not request canonical raymarch-only composition`);
  require(value.importedRender?.boundarySplatCompositionRequested === 'raymarch-only-v0', `${label} requested composition was not raymarch-only`);
  require(value.importedRender?.boundarySplatCompositionEffective === 'raymarch-only-v0', `${label} effective composition was not raymarch-only`);
  require(value.importedRender?.raymarchApplied === true, `${label} did not apply raymarch`);
  require(value.importedRender?.splatEncoded === false, `${label} encoded splats`);
  require(value.importedRender?.splatApplied === false, `${label} included splats`);
  require(value.importedRender?.fallbackReason == null, `${label} reported renderer fallback`);
  require(
    typeof value.importedRender?.cameraSignature === 'string' && value.importedRender.cameraSignature.length > 0,
    `${label} camera signature is missing`,
  );
  require(
    typeof value.importedRender?.renderControlSignature === 'string'
      && value.importedRender.renderControlSignature.length > 0,
    `${label} effective render control signature is missing`,
  );
  require(
    value.importedRender?.controlOverrides
      && typeof value.importedRender.controlOverrides === 'object'
      && !Array.isArray(value.importedRender.controlOverrides),
    `${label} render control overrides are missing`,
  );
  require(value.importedRender?.imageAuthority === 'cdp-canvas-clip-capture-after-render-only-frozen-sim-state', `${label} image authority mismatch`);
  require(value.importedRender?.importedFieldManifestSha256 === sourceManifestSha256, `${label} rendered source checksum mismatch`);
  const image = {
    path: resolve(String(value.importedRender?.path || '')),
    byteLength: Number(value.importedRender?.byteLength),
    sha256: String(value.importedRender?.sha256 || ''),
  };
  validateImage(image, label);
  const comparisonContract = {
    sourceCapturePayloadSha256: value.sourceCapture.actualPayloadSha256,
    viewportContract: value.viewportContract,
    renderCanvasContract: value.renderCanvasContract,
    canvasCssRect: value.importedRender.canvasCssRect,
    requestedRenderScale: value.importedRender.requestedRenderScale,
    devicePixelRatio: value.importedRender.devicePixelRatio,
    cameraSignature: value.importedRender.cameraSignature,
    renderControlSignature: value.importedRender.renderControlSignature,
    controlOverrides: value.importedRender.controlOverrides,
  };
  require(value.viewportContract?.identity === 'cdp-emulation-fixed-device-metrics-v0', `${label} viewport contract identity mismatch`);
  require(value.renderCanvasContract?.identity === 'explicit-pre-render-canvas-css-geometry-v0', `${label} canvas contract identity mismatch`);
  require(
    JSON.stringify(value.viewportContract.requested) === JSON.stringify(value.viewportContract.effective),
    `${label} viewport requested/effective mismatch`,
  );
  require(
    value.renderCanvasContract.requested?.width === value.renderCanvasContract.effective?.cssWidth
      && value.renderCanvasContract.requested?.height === value.renderCanvasContract.effective?.cssHeight,
    `${label} canvas requested/effective mismatch`,
  );
  return { image, comparisonFingerprint: sha256Bytes(Buffer.from(JSON.stringify(comparisonContract))) };
}

function validateImage(image, label) {
  require(existsSync(image.path), `${label} image is missing: ${image.path}`);
  require(statSync(image.path).size === image.byteLength && image.byteLength > 24, `${label} image byte length mismatch`);
  require(sha256File(image.path) === image.sha256, `${label} image checksum mismatch`);
  const decoded = decodePngRgb(readFileSync(image.path), label);
  require(decoded.width > 1 && decoded.height > 1, `${label} image dimensions are not evidentiary`);
  require(decoded.pixelActivity > 0, `${label} image is blank or has no pixel activity`);
}

function decodePngRgb(bytes, label) {
  require(bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), `${label} image is not PNG`);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = -1;
  const idat = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    require(dataEnd + 4 <= bytes.length, `${label} PNG chunk is truncated`);
    if (type === 'IHDR') {
      require(length === 13, `${label} PNG IHDR length mismatch`);
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      interlace = bytes[dataStart + 12];
    } else if (type === 'IDAT') idat.push(bytes.subarray(dataStart, dataEnd));
    offset = dataEnd + 4;
    if (type === 'IEND') break;
  }
  require(width > 0 && height > 0 && idat.length > 0, `${label} PNG is missing image data`);
  require(bitDepth === 8 && (colorType === 2 || colorType === 6) && interlace === 0, `${label} PNG format is unsupported`);
  const channels = colorType === 2 ? 3 : 4;
  const rowBytes = width * channels;
  const inflated = inflateSync(Buffer.concat(idat));
  require(inflated.length === height * (rowBytes + 1), `${label} PNG decoded byte length mismatch`);
  const previous = Buffer.alloc(rowBytes);
  const current = Buffer.alloc(rowBytes);
  let cursor = 0;
  let minRgb = 255;
  let maxRgb = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[cursor++];
    require(filter >= 0 && filter <= 4, `${label} PNG filter is invalid`);
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = inflated[cursor++];
      const left = x >= channels ? current[x - channels] : 0;
      const up = previous[x];
      const upperLeft = x >= channels ? previous[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upperLeft);
      current[x] = (raw + predictor) & 0xff;
      if ((x % channels) < 3) {
        minRgb = Math.min(minRgb, current[x]);
        maxRgb = Math.max(maxRgb, current[x]);
      }
    }
    current.copy(previous);
  }
  return { width, height, pixelActivity: maxRgb - minRgb };
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function copyImage(image, name) {
  const path = join(outDir, name);
  copyFileSync(image.path, path);
  return { path, relativePath: basename(path), byteLength: statSync(path).size, sha256: sha256File(path) };
}

function htmlPage(report) {
  const order = ['truthHigh160', 'filteredLow96Native', 'deterministic96to160', 'learned96to160'];
  const panels = order.map(key => {
    const role = report.roles[key];
    const className = role.targetAuthority ? 'target' : key.startsWith('learned') ? 'treatment' : 'control';
    return `<figure class="${className}"><figcaption><strong>${role.label}</strong><span>${role.grid}^3 render; ${role.authority}</span></figcaption><a href="${role.image.relativePath}" target="_blank"><img src="${role.image.relativePath}" alt="${role.label}"></a></figure>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Phase-aligned target morphology</title><style>
  :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#070809;color:#f4f4f5;font:14px system-ui,sans-serif}header{position:sticky;top:0;z-index:2;padding:12px 18px;background:#151719;border-bottom:1px solid #3f4448}h1{margin:0 0 4px;font-size:18px;letter-spacing:0}p{margin:0;color:#b5bbc0}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px;background:#34383b}figure{min-width:0;margin:0;background:#000}figcaption{min-height:64px;padding:10px 14px;background:#151719;border-bottom:1px solid #34383b;display:flex;flex-direction:column}figcaption strong{font-size:16px;letter-spacing:0}figcaption span{margin-top:4px;color:#aeb4b9;overflow-wrap:anywhere}img{display:block;width:100%;height:auto;image-rendering:auto}a{display:block}.target figcaption{border-left:4px solid #43b581}.treatment figcaption{border-left:4px solid #4ea1ff}.note{padding:12px 18px;color:#b5bbc0;border-top:1px solid #34383b}@media(max-width:900px){.grid{grid-template-columns:1fr}}</style><header><h1>Phase-aligned target morphology</h1><p>Same high history, state, preset, and camera. Raymarch only. Click any panel for its original PNG.</p></header><main class="grid">${panels}</main><div class="note">Top-left is the target. Bottom-left isolates deterministic high-grid materialization. Bottom-right differs from bottom-left only by the learned residual.</div>`;
}

function validSha(value) { return /^[a-f0-9]{64}$/i.test(value); }
function require(condition, message) { if (!condition) throw new Error(message); }
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function sha256File(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function sha256Bytes(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
