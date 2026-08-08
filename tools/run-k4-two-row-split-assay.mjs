#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  applyRouteRestorationTowardRest,
  computeK4EnvelopeFitMetric,
  parseGlbTriangleSoup,
} from '../k4-envelope-fit-core.mjs';
import {
  measureMuscleCompartmentRingCageContactState,
} from '../muscle-compartment-ring-cage-contact-core.mjs';

const ATTRIBUTION_SCHEMA = 'kaminos.k4-source-route-containment-assay.v0';
const RESULT_SCHEMA = 'kaminos.k4-two-row-split-assay-result.v0';
const REPORT_SCHEMA = 'kaminos.k4-two-row-split-assay-run-report.v0';
const VIEWER_DATA_SCHEMA = 'kaminos.k4-two-row-viewer-data.v0';
const ROUTE = 'k4-two-row-split-comparison-v0';
const CUSTODY_MARKER = '.kaminos-k4-two-row-split-assay-output';
const CUSTODY_SCHEMA = 'kaminos.k4-two-row-split-assay-output-custody.v0';
const CUSTODY_BYTES = Buffer.from(`${CUSTODY_SCHEMA}\n`);
const OWNED_PATHS = Object.freeze([
  'two-row-result.json', 'resolved-carrier.json', 'viewer-data.json', 'index.html',
  'envelope-baseline.glb',
]);
const CONSTRUCTION_ORDER = Object.freeze([
  'muscle-34', 'muscle-13', 'muscle-12', 'muscle-45',
]);
const ATTACHMENT_CAPTION = 'outside authored envelope in source geometry';
const METRIC_EVIDENCE_ONLY_SOURCE_DISTANCE = 0.1;

function parseArguments(argv) {
  const flags = new Map([
    ['--frame-receipt', 'frameReceipt'],
    ['--envelope', 'envelope'],
    ['--attribution', 'attribution'],
    ['--carrier', 'carrier'],
    ['--source', 'source'],
    ['--containment-margin', 'containmentMargin'],
    ['--output', 'output'],
  ]);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = flags.get(argv[index]);
    if (!key) throw new Error(`unsupported argument ${argv[index]}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argv[index]} requires a value`);
    parsed[key] = value;
    index += 1;
  }
  for (const key of [
    'frameReceipt', 'envelope', 'attribution', 'carrier', 'source',
    'containmentMargin', 'output',
  ]) {
    if (!parsed[key]) throw new Error(`--${key} is required`);
  }
  parsed.output = path.resolve(parsed.output);
  parsed.containmentMargin = Number(parsed.containmentMargin);
  if (!Number.isFinite(parsed.containmentMargin) || parsed.containmentMargin < 0) {
    throw new Error('--containment-margin must be a nonnegative number');
  }
  return parsed;
}

function preScanOutputDirectory(argv) {
  const index = argv.indexOf('--output');
  const value = index >= 0 ? argv[index + 1] : null;
  return value && !value.startsWith('--') ? path.resolve(value) : null;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function writeAtomic(target, bytes) {
  const temporary = `${target}.tmp-${process.pid}`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(temporary, bytes);
  await rename(temporary, target);
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function hasOutputCustody(outputDirectory) {
  try {
    return (await readFile(path.join(outputDirectory, CUSTODY_MARKER)))
      .equals(CUSTODY_BYTES);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function clearOwnedOutput(outputDirectory) {
  await Promise.all(OWNED_PATHS.map(relative =>
    rm(path.join(outputDirectory, relative), { recursive: true, force: true })));
}

async function claimOutputCustody(outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  if (await hasOutputCustody(outputDirectory)) return;
  const occupied = [];
  for (const relative of [...OWNED_PATHS, 'run-report.json']) {
    if (await exists(path.join(outputDirectory, relative))) occupied.push(relative);
  }
  if (occupied.length > 0) {
    throw new Error(`refusing to claim unowned output containing ${occupied.join(', ')}`);
  }
  await writeAtomic(path.join(outputDirectory, CUSTODY_MARKER), CUSTODY_BYTES);
}

function receiptPath(target) {
  const relative = path.relative(process.cwd(), target);
  if (!path.isAbsolute(relative) && relative !== '..' &&
      !relative.startsWith(`..${path.sep}`)) {
    return `repo://${relative.split(path.sep).join('/')}`;
  }
  return target;
}

function contactSummary(measurement) {
  return {
    pairwiseMovableTotalPenetration: measurement.pairwise.movableTotalPenetration,
    pairwiseMovableMaximumPenetration: measurement.pairwise.movableMaximumPenetration,
    pairwiseFixedTotalPenetration: measurement.pairwise.fixedTotalPenetration,
    pairwiseFixedMaximumPenetration: measurement.pairwise.fixedMaximumPenetration,
    skeletalTotalPenetration: measurement.skeletal.totalPenetration,
    compartmentMaximumEscape: measurement.compartment.maximumEscape,
  };
}

function sectionIdOfNode(nodeId) {
  const match = /^(.*:section:\d+)/.exec(nodeId);
  return match ? match[1] : null;
}

function bellyLedger(metric, tailSectionIds) {
  return metric.constructions.map(construction => {
    const samples = construction.samples.filter(sample =>
      !tailSectionIds.has(sectionIdOfNode(sample.nodeId)));
    const insideCount = samples.filter(sample => sample.signedDistance < 0).length;
    return {
      constructionId: construction.constructionId,
      bellySampleCount: samples.length,
      insideFraction: samples.length ? insideCount / samples.length : 1,
      meanSignedDistance: samples.length
        ? samples.reduce((sum, sample) => sum + sample.signedDistance, 0) /
          samples.length
        : 0,
      maximumOutsideExcursion: Math.max(0, ...samples.map(sample =>
        sample.signedDistance)),
    };
  });
}

function viewerHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>K4 two-row split comparison</title>
<script type="importmap">
{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/"}}
</script>
<style>
body{margin:0;background:#07090d;color:#f4eee3;font-family:ui-monospace,Menlo,monospace;overflow:hidden}
#panel{position:fixed;top:12px;left:12px;width:430px;background:#0c1118ee;border:1px solid #ffffff22;border-radius:12px;padding:14px;font-size:11px;line-height:1.45;z-index:2}
h1{font-size:14px;margin:0 0 6px}
.row{margin:8px 0;padding:8px;border-radius:8px;border:1px solid #ffffff18}
.row h2{font-size:11px;margin:0 0 4px;color:#ffd166}
.legend span{display:inline-block;width:10px;height:10px;border-radius:5px;margin:0 4px 0 8px;vertical-align:-1px}
button{min-height:38px;padding:6px 10px;margin:4px 6px 0 0;border:1px solid #ffffff24;border-radius:8px;color:#dce6f0;background:#111923;cursor:pointer;font:600 11px ui-monospace,monospace}
button[aria-pressed="true"]{color:#081016;background:#e7d1a8}
#identity{margin-top:8px;color:#6f7d8c;font-size:9px;overflow-wrap:anywhere}
#status{color:#8fa3b8}
canvas{display:block}
</style></head><body>
<div id="panel">
  <h1>K4 two-row split comparison</h1>
  <div id="status">loading…</div>
  <div class="row"><h2>Row 1 · belly / interior — packing &amp; shape quality</h2>
    <div class="legend"><span style="background:#3ddad7"></span>interior boundary sample
    <span style="background:#ff2d2d"></span>packing-induced escape (M12 s8, reference state)
    <span style="background:#43d17a"></span>re-solved (restored toward rest)</div>
    <div>Packing-induced failure styling applies only in this row.</div>
  </div>
  <div class="row"><h2>Row 2 · attachment-tail — source relationship</h2>
    <div class="legend"><span style="background:#e8a13d"></span>source-geometry-attributed
    <span style="background:#e8a13d;border:2px solid #8fa3b8"></span>metric-evidence-only</div>
    <div>Caption: <em>outside authored envelope in source geometry</em>. This is a
    relationship, not an error; envelope anatomical scope remains held authority.</div>
  </div>
  <div>
    <button data-state="reference">Reference (pre-re-solve)</button>
    <button data-state="resolved">Re-solved M12 s8</button>
  </div>
  <div id="identity"></div>
</div>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const query = new URLSearchParams(location.search);
const statusEl = document.getElementById('status');
const identityEl = document.getElementById('identity');
async function fetchExact(pathName, expectedSha256) {
  const response = await fetch(pathName, { cache: 'no-store' });
  if (!response.ok) throw new Error(pathName + ' HTTP ' + response.status);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  if (expectedSha256 && hex !== expectedSha256) {
    throw new Error(pathName + ' identity mismatch: ' + hex);
  }
  return bytes;
}
try {
  const dataBytes = await fetchExact('viewer-data.json', query.get('data'));
  const data = JSON.parse(new TextDecoder().decode(dataBytes));
  if (data.schema !== 'kaminos.k4-two-row-viewer-data.v0') throw new Error('viewer data schema mismatch');
  const routeRequested = query.get('routeRequested') || data.route.requested;
  if (routeRequested !== data.route.effective) throw new Error('identity-bound capture route mismatch');
  const envelopeBytes = await fetchExact('envelope-baseline.glb', query.get('envelope'));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090d);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 500);
  const focus = new THREE.Vector3(...data.focus);
  camera.position.set(focus.x + 7, focus.y + 4, focus.z + 9);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(focus);
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(5, 10, 7);
  scene.add(key);
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(envelopeBytes.buffer, '');
  gltf.scene.traverse(node => {
    if (node.isMesh) {
      node.material = new THREE.MeshStandardMaterial({
        color: 0x8fa3b8, transparent: true, opacity: 0.16,
        side: THREE.DoubleSide, depthWrite: false,
      });
    }
  });
  scene.add(gltf.scene);
  const stateGroups = { reference: new THREE.Group(), resolved: new THREE.Group() };
  scene.add(stateGroups.reference, stateGroups.resolved);
  const markerMaterialCache = new Map();
  function markerMaterial(color) {
    if (!markerMaterialCache.has(color)) {
      markerMaterialCache.set(color, new THREE.MeshStandardMaterial({ color }));
    }
    return markerMaterialCache.get(color);
  }
  const sphere = new THREE.SphereGeometry(0.055, 12, 12);
  for (const stateName of ['reference', 'resolved']) {
    for (const marker of data.states[stateName].markers) {
      const mesh = new THREE.Mesh(sphere, markerMaterial(marker.color));
      mesh.position.set(...marker.position);
      stateGroups[stateName].add(mesh);
    }
  }
  function showState(state) {
    stateGroups.reference.visible = state === 'reference';
    stateGroups.resolved.visible = state === 'resolved';
    document.querySelectorAll('[data-state]').forEach(button =>
      button.setAttribute('aria-pressed', String(button.dataset.state === state)));
    document.documentElement.dataset.witnessState = state;
  }
  document.querySelectorAll('[data-state]').forEach(button =>
    button.addEventListener('click', () => showState(button.dataset.state)));
  showState(query.get('state') === 'resolved' ? 'resolved' : 'reference');
  identityEl.textContent =
    'route requested ' + routeRequested + ' · route effective ' + data.route.effective +
    ' · data ' + (query.get('data') || 'unbound') +
    ' · frame ' + data.frameReceiptSha256.slice(0, 12) +
    ' · reference carrier ' + data.referenceCarrierSha256.slice(0, 12) +
    ' · resolved carrier ' + data.resolvedCarrierSha256.slice(0, 12);
  statusEl.textContent = 'mounted · ' + data.states.reference.markers.length +
    ' reference markers · drag to orbit';
  document.documentElement.dataset.witnessMounted = 'true';
  function frame() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(frame); }
  frame();
} catch (error) {
  statusEl.textContent = 'FAILED: ' + error.message;
  document.documentElement.dataset.witnessMounted = 'failed';
  throw error;
}
</script></body></html>
`;
}

const rawArguments = process.argv.slice(2);
const preScannedOutputDirectory = preScanOutputDirectory(rawArguments);
let args = null;
let phase = 'parse-arguments';
let inputReceipts = null;
let reportPath = preScannedOutputDirectory
  ? path.join(preScannedOutputDirectory, 'run-report.json')
  : null;

try {
  args = parseArguments(rawArguments);
  reportPath = path.join(args.output, 'run-report.json');
  phase = 'claim-output-custody';
  await claimOutputCustody(args.output);
  phase = 'clear-stale-evidence';
  await clearOwnedOutput(args.output);
  phase = 'read-inputs';
  const inputPaths = {};
  const inputBytes = {};
  for (const key of ['frameReceipt', 'envelope', 'attribution', 'carrier', 'source']) {
    inputPaths[key] = await realpath(path.resolve(args[key]));
    inputBytes[key] = await readFile(inputPaths[key]);
  }
  inputReceipts = Object.fromEntries(Object.keys(inputPaths).map(key => [key, {
    requestedPath: receiptPath(path.resolve(args[key])),
    effectivePath: receiptPath(inputPaths[key]),
    sha256: sha256(inputBytes[key]),
  }]));
  const frameReceipt = JSON.parse(inputBytes.frameReceipt);
  const attribution = JSON.parse(inputBytes.attribution);
  const solverCarrier = JSON.parse(inputBytes.carrier);
  const source = JSON.parse(inputBytes.source);
  phase = 'verify-inputs';
  if (frameReceipt?.inputs?.envelopeFileSha256 !== inputReceipts.envelope.sha256) {
    throw new Error('two-row assay envelope does not match the frame receipt identity');
  }
  if (attribution?.schema !== ATTRIBUTION_SCHEMA ||
      attribution.status !== 'completed-provisional' ||
      JSON.stringify(attribution.effectiveConstructionIds) !==
        JSON.stringify(CONSTRUCTION_ORDER)) {
    throw new Error(
      'two-row assay requires the reviewed route-containment attribution with ' +
      'exact construction order',
    );
  }
  phase = 'parse-envelope';
  const envelopeMesh = parseGlbTriangleSoup(inputBytes.envelope);
  phase = 'classify-sections';
  const packingInduced = attribution.returnedEscapeRows
    .filter(row => row.classification === 'packing-induced-route-escape');
  const sourceOutsideRows = attribution.returnedEscapeRows
    .filter(row => row.classification === 'source-route-outside');
  const fixedTailRows = attribution.fixedAttachmentRows
    .filter(row => row.classification === 'source-route-outside');
  if (packingInduced.length !== 1) {
    throw new Error(
      `two-row assay expects exactly one packing-induced escape, found ` +
      `${packingInduced.length}`,
    );
  }
  const tailSections = [...sourceOutsideRows, ...fixedTailRows].map(row => ({
    sectionId: row.sectionId,
    constructionId: row.constructionId,
    markerClass: 'source-geometry-attributed',
    fixedAttachmentSection: row.fixedAttachmentSection === true,
    sourceSignedDistance: row.source?.signedDistance ?? null,
    tags: (row.source?.signedDistance ?? Infinity) <
      METRIC_EVIDENCE_ONLY_SOURCE_DISTANCE
      ? ['metric-evidence-only']
      : [],
  }));
  const tailSectionIds = new Set(tailSections.map(row => row.sectionId));
  phase = 'resolve-escape';
  const escape = packingInduced[0];
  const restoration = applyRouteRestorationTowardRest({
    frameReceipt,
    envelopeMesh,
    solverCarrier,
    config: {
      constructionId: escape.constructionId,
      sectionId: escape.sectionId,
      containmentMargin: args.containmentMargin,
      maximumBlend: 1,
    },
  });
  phase = 'compute-metrics';
  const referenceMetric = computeK4EnvelopeFitMetric({
    frameReceipt, envelopeMesh, solverCarrier,
  });
  const resolvedMetric = computeK4EnvelopeFitMetric({
    frameReceipt, envelopeMesh, solverCarrier: restoration.outputCarrier,
  });
  const referenceContact = contactSummary(
    measureMuscleCompartmentRingCageContactState(solverCarrier, source),
  );
  const resolvedContact = contactSummary(
    measureMuscleCompartmentRingCageContactState(restoration.outputCarrier, source),
  );
  const contactCost = Object.fromEntries(Object.keys(referenceContact).map(key =>
    [`${key}Delta`, resolvedContact[key] - referenceContact[key]]));
  phase = 'build-viewer';
  const transform = frameReceipt.sourceToEnvelope.transform;
  const toEnvelope = point => {
    const scaled = point.map(value => value * transform.scale);
    return [0, 1, 2].map(row =>
      transform.rotation[row][0] * scaled[0] +
      transform.rotation[row][1] * scaled[1] +
      transform.rotation[row][2] * scaled[2] +
      transform.translation[row]);
  };
  const markerColor = (sectionId, signedDistance, stateName) => {
    if (tailSectionIds.has(sectionId)) return '#e8a13d';
    if (sectionId === escape.sectionId) {
      return stateName === 'reference' ? '#ff2d2d' : '#43d17a';
    }
    return signedDistance > 0 ? '#ff2d2d' : '#3ddad7';
  };
  const stateMarkers = metric => stateName => metric.constructions.flatMap(
    construction => construction.samples.map(sample => ({
      position: sample.envelopePosition,
      sectionId: sectionIdOfNode(sample.nodeId),
      color: markerColor(
        sectionIdOfNode(sample.nodeId), sample.signedDistance, stateName),
    })));
  const referenceMarkers = stateMarkers(referenceMetric)('reference');
  const resolvedMarkers = stateMarkers(resolvedMetric)('resolved');
  const focus = toEnvelope(
    solverCarrier.cages
      .find(cage => cage.constructionId === escape.constructionId)
      .manifest.nodes
      .find(node => node.id === `${escape.sectionId}:axis`).currentPosition,
  );
  const viewerData = {
    schema: VIEWER_DATA_SCHEMA,
    route: { requested: ROUTE, effective: ROUTE, fallbackUsed: false },
    frameReceiptSha256: frameReceipt.receiptSha256,
    referenceCarrierSha256: solverCarrier.identity.sha256,
    resolvedCarrierSha256: restoration.outputCarrierSha256,
    attributionSha256: inputReceipts.attribution.sha256,
    focus,
    attachmentCaption: ATTACHMENT_CAPTION,
    states: {
      reference: { markers: referenceMarkers },
      resolved: { markers: resolvedMarkers },
    },
  };
  const viewerDataBytes = jsonBytes(viewerData);
  const viewerBytes = Buffer.from(viewerHtml());
  const resolvedCarrierBytes = jsonBytes(restoration.outputCarrier);
  phase = 'write-outputs';
  await writeAtomic(
    path.join(args.output, 'envelope-baseline.glb'),
    inputBytes.envelope,
  );
  await writeAtomic(path.join(args.output, 'viewer-data.json'), viewerDataBytes);
  await writeAtomic(path.join(args.output, 'index.html'), viewerBytes);
  await writeAtomic(
    path.join(args.output, 'resolved-carrier.json'),
    resolvedCarrierBytes,
  );
  const { outputCarrier: _outputCarrier, ...restorationReceipt } = restoration;
  const result = {
    schema: RESULT_SCHEMA,
    status: 'completed-provisional',
    claimCeiling: frameReceipt.claimCeiling,
    heldClaims: [
      ...attribution.heldClaims,
    ],
    inputs: inputReceipts,
    rows: {
      belly: {
        comparisonClass: 'belly/interior packing and shape quality',
        packingInducedSectionIds: packingInduced.map(row => row.sectionId),
        resolve: {
          ...restorationReceipt,
          contactCost,
          referenceContact,
          resolvedContact,
        },
        reference: bellyLedger(referenceMetric, tailSectionIds),
        resolved: bellyLedger(resolvedMetric, tailSectionIds),
      },
      attachmentTail: {
        comparisonClass: 'attachment-tail source relationship',
        caption: ATTACHMENT_CAPTION,
        sections: tailSections,
      },
    },
    viewer: {
      path: 'index.html',
      dataPath: 'viewer-data.json',
      route: viewerData.route,
      dataSha256: sha256(viewerDataBytes),
      htmlSha256: sha256(viewerBytes),
    },
    resolvedCarrier: {
      path: 'resolved-carrier.json',
      sha256: sha256(resolvedCarrierBytes),
    },
  };
  const resultBytes = jsonBytes(result);
  await writeAtomic(path.join(args.output, 'two-row-result.json'), resultBytes);
  const report = {
    schema: REPORT_SCHEMA,
    status: 'completed',
    failurePhase: null,
    claimCeiling: result.claimCeiling,
    inputs: inputReceipts,
    outputs: {
      twoRowResult: { path: 'two-row-result.json', sha256: sha256(resultBytes) },
      viewer: result.viewer,
      resolvedCarrier: result.resolvedCarrier,
    },
    lastTrustworthyEvidence: {
      phase: 'two-row-result-written',
      twoRowResultSha256: sha256(resultBytes),
      resolvedCarrierSha256: restoration.outputCarrierSha256,
    },
  };
  phase = 'write-report';
  await writeAtomic(reportPath, jsonBytes(report));
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    reportPath,
    appliedBlend: restoration.appliedBlend,
    axisSignedDistanceAfter: restoration.axisSignedDistanceAfter,
    contactCost,
    viewerRoute: viewerData.route,
  })}\n`);
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const outputDirectory = args?.output || preScannedOutputDirectory;
  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive: true });
    reportPath ||= path.join(outputDirectory, 'run-report.json');
    const outputCustodyVerified = await hasOutputCustody(outputDirectory);
    if (outputCustodyVerified) await clearOwnedOutput(outputDirectory);
    await writeAtomic(reportPath, jsonBytes({
      schema: REPORT_SCHEMA,
      status: 'failed',
      failurePhase: phase,
      error: message,
      rawArguments,
      inputs: inputReceipts,
      outputCustodyVerified,
      staleEvidenceCleared: outputCustodyVerified,
      outputs: null,
      lastTrustworthyEvidence: {
        phase: inputReceipts ? 'inputs-read-and-hashed' : 'raw-arguments-captured',
        inputs: inputReceipts,
      },
    }));
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
