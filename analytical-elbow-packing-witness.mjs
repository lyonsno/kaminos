#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  applyExactElbowMuscleVolumeEdit,
  compareExactElbowPackings,
  createExactElbowPackingSource,
  solveExactElbowPacking,
} from './analytical-elbow-packing-core.mjs';

const WITNESS_ROUTE = 'exact-elbow-packing-orbitable-v0';
const DEFAULT_IO = Object.freeze({ mkdir, readFile, rename, writeFile });

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function jsonForHtml(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

async function writeJsonAtomically(io, path, value) {
  const temporaryPath = `${path}.tmp`;
  await io.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await io.rename(temporaryPath, path);
}

function visualCase(result, changedCellIds = new Set()) {
  return {
    id: result.parentSourceId ? 'brachialis-swell' : 'baseline',
    cells: result.cells.map(cell => ({
      p: [cell.x, cell.y, cell.z],
      o: cell.ownerId,
      changed: changedCellIds.has(cell.sourceCellId),
    })),
    domain: result.domain,
    elbow: result.elbow,
    metrics: result.metrics,
    compartments: result.compartments,
  };
}

function renderHtml({ baseline, edited, comparison, report }) {
  const baselineById = new Map(baseline.cells.map(cell => [cell.sourceCellId, cell]));
  const changedCellIds = new Set(edited.cells
    .filter(cell => baselineById.get(cell.sourceCellId)?.ownerId !== cell.ownerId)
    .map(cell => cell.sourceCellId));
  const visualData = {
    route: report.route,
    comparison,
    cases: [visualCase(baseline), visualCase(edited, changedCellIds)],
  };
  return `<!doctype html>
<html lang="en" data-witness-route="${WITNESS_ROUTE}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Exact elbow 3D packing witness</title>
  <style>
    :root { color-scheme:dark; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; background:#111513; color:#f2eee3; }
    * { box-sizing:border-box; }
    body { margin:0; min-width:320px; overflow:hidden; background:#111513; }
    main { display:grid; grid-template-rows:auto minmax(0,1fr) auto; width:100%; height:100vh; min-height:540px; }
    header { display:flex; align-items:center; justify-content:space-between; gap:22px; padding:15px 20px; border-bottom:1px solid #3f4943; background:#151b17; }
    h1 { margin:0; font:650 18px/1.2 ui-sans-serif,system-ui,sans-serif; letter-spacing:0; }
    .authority { margin:4px 0 0; color:#d8b76d; font-size:11px; }
    .route { color:#98a59d; font-size:10px; line-height:1.5; text-align:right; overflow-wrap:anywhere; }
    .viewport { position:relative; min-width:0; min-height:0; overflow:hidden; }
    canvas { display:block; width:100%; height:100%; touch-action:none; }
    .legend { position:absolute; top:16px; left:18px; display:grid; gap:7px; margin:0; padding:0; list-style:none; pointer-events:none; color:#d9dfda; font-size:11px; text-shadow:0 1px 2px #000; }
    .legend span { display:inline-block; width:12px; height:12px; margin-right:8px; border:1px solid #ffffff55; vertical-align:-2px; }
    .flexor { background:#58b7a3; }
    .extensor { background:#df735f; }
    .residual { background:#9aa99f; }
    .rigid { background:#e8dcc1; }
    .changed { background:#f3ce63; }
    .metrics { position:absolute; right:18px; bottom:16px; min-width:250px; padding:10px 12px; border:1px solid #4a554e; background:#111713e8; font-size:10px; line-height:1.6; pointer-events:none; }
    .metrics div { position:relative; min-height:16px; padding-right:74px; }
    .metrics span:first-child { color:#8f9b94; }
    .metrics strong { position:absolute; top:0; right:0; color:#f2eee3; font-weight:700; }
    footer { display:flex; align-items:center; justify-content:space-between; gap:18px; width:100%; min-width:0; padding:12px 18px; border-top:1px solid #3f4943; background:#151b17; overflow:hidden; }
    .controls { display:flex; gap:3px; min-width:0; }
    button { min-width:112px; min-height:34px; padding:7px 12px; border:1px solid #536058; border-radius:4px; background:#202823; color:#dce2dd; font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace; cursor:pointer; }
    button[aria-pressed="true"] { border-color:#d8b76d; background:#d8b76d; color:#181b19; }
    .status { min-width:0; color:#98a59d; font-size:10px; text-align:right; overflow-wrap:anywhere; }
    @media (max-width:720px) {
      header { flex-direction:column; align-items:flex-start; gap:7px; padding:13px 14px; }
      .route { width:100%; text-align:left; }
      footer { flex-direction:column; align-items:flex-start; padding:10px 12px; }
      .controls { display:grid; grid-template-columns:minmax(0,1fr); width:100%; }
      button { width:100%; min-width:0; }
      .status { width:100%; text-align:left; }
      .metrics { right:10px; left:10px; bottom:10px; width:auto; min-width:0; }
    }
  </style>
  <script type="importmap">
    {"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.171.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.171.0/examples/jsm/"}}
  </script>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Exact elbow · shared material domain</h1>
        <p class="authority">Synthetic packing hypothesis · no anatomical admission</p>
      </div>
      <div class="route">requested ${WITNESS_ROUTE}<br>effective ${WITNESS_ROUTE}</div>
    </header>
    <section class="viewport" aria-label="Orbitable exact elbow packing">
      <ul class="legend">
        <li><span class="flexor"></span>brachialis-like flexor</li>
        <li><span class="extensor"></span>triceps-like extensor</li>
        <li><span class="residual"></span>residual tissue</li>
        <li><span class="rigid"></span>rigid exclusions</li>
        <li><span class="changed"></span>changed ownership</li>
      </ul>
      <div class="metrics" id="metrics"></div>
    </section>
    <footer>
      <div class="controls" role="group" aria-label="Packing case">
        <button type="button" data-case="0" aria-pressed="true">Baseline</button>
        <button type="button" data-case="1" aria-pressed="false" title="Brachialis volume increased by 18 percent">Swell</button>
      </div>
      <div class="status" id="status">exclusive 3D ownership · rigid interior excluded</div>
    </footer>
  </main>
  <script id="packing-data" type="application/json">${jsonForHtml(visualData)}</script>
  <script type="module">
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

    const data = JSON.parse(document.querySelector('#packing-data').textContent);
    const viewport = document.querySelector('.viewport');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111513);
    scene.fog = new THREE.Fog(0x111513, 5.5, 10);
    const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 40);
    camera.position.set(3.4, 2.4, 4.1);
    const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    viewport.prepend(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.28, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 2.2;
    controls.maxDistance = 9;
    scene.add(new THREE.HemisphereLight(0xf4ead4, 0x25342d, 2.2));
    const key = new THREE.DirectionalLight(0xffe3b5, 3.4);
    key.position.set(3.5, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x72c9be, 1.8);
    rim.position.set(-4, 1, -3);
    scene.add(rim);

    const colors = {
      'brachialis-like-flexor': new THREE.Color(0x58b7a3),
      'monoarticular-triceps-like-extensor': new THREE.Color(0xdf735f),
      'residual-tissue': new THREE.Color(0x84968b),
      changed: new THREE.Color(0xf3ce63),
    };
    const rigidMaterials = {
      'segment-bone': new THREE.MeshStandardMaterial({ color:0xe8dcc1, roughness:0.72 }),
      'segment-process': new THREE.MeshStandardMaterial({ color:0xcbd8ca, roughness:0.68 }),
      'joint-core': new THREE.MeshStandardMaterial({ color:0x75827a, roughness:0.55, transparent:true, opacity:0.72 }),
    };
    let caseGroup = null;
    function vector(values) { return new THREE.Vector3(...values); }
    function capsuleBetween(startValues, endValues, radius, material) {
      const start = vector(startValues);
      const end = vector(endValues);
      const direction = end.clone().sub(start);
      const totalLength = direction.length();
      const geometry = new THREE.CapsuleGeometry(radius, Math.max(0.001, totalLength - radius * 2), 8, 18);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(start).add(end).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      return mesh;
    }
    function pointsFor(cells, ownerId, highlightChanged) {
      const selected = cells.filter(cell => cell.o === ownerId);
      const positions = new Float32Array(selected.length * 3);
      const pointColors = new Float32Array(selected.length * 3);
      selected.forEach((cell, index) => {
        positions.set(cell.p, index * 3);
        const color = highlightChanged && cell.changed ? colors.changed : colors[ownerId];
        pointColors.set([color.r, color.g, color.b], index * 3);
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(pointColors, 3));
      const material = new THREE.PointsMaterial({
        size: ownerId === 'residual-tissue' ? 0.035 : 0.047,
        vertexColors:true,
        transparent:true,
        opacity:ownerId === 'residual-tissue' ? 0.23 : 0.9,
        depthWrite:ownerId !== 'residual-tissue',
        sizeAttenuation:true,
      });
      return new THREE.Points(geometry, material);
    }
    function pathLine(path, color) {
      const geometry = new THREE.BufferGeometry().setFromPoints(path.map(sample => vector(sample.position)));
      return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent:true, opacity:0.95 }));
    }
    function envelopeWire(domain) {
      const edges = new THREE.EdgesGeometry(new THREE.SphereGeometry(1, 20, 14), 18);
      const wire = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color:0xa7b2aa, transparent:true, opacity:0.12 }));
      wire.position.copy(vector(domain.center));
      wire.scale.set(...domain.radii);
      return wire;
    }
    function disposeGroup(group) {
      group.traverse(object => {
        if (object.geometry) object.geometry.dispose();
        if (object.material && !Object.values(rigidMaterials).includes(object.material)) object.material.dispose();
      });
      scene.remove(group);
    }
    function showCase(index) {
      if (caseGroup) disposeGroup(caseGroup);
      const item = data.cases[index];
      caseGroup = new THREE.Group();
      caseGroup.add(envelopeWire(item.domain));
      for (const ownerId of ['residual-tissue', 'brachialis-like-flexor', 'monoarticular-triceps-like-extensor']) {
        caseGroup.add(pointsFor(item.cells, ownerId, index === 1));
      }
      for (const rigid of item.elbow.rigidStructures) {
        if (rigid.kind === 'sphere') {
          const mesh = new THREE.Mesh(new THREE.SphereGeometry(rigid.radius, 24, 16), rigidMaterials[rigid.sourceKind]);
          mesh.position.copy(vector(rigid.center));
          caseGroup.add(mesh);
        } else {
          caseGroup.add(capsuleBetween(rigid.start, rigid.end, rigid.radius, rigidMaterials[rigid.sourceKind]));
        }
      }
      for (const muscle of item.elbow.muscles) {
        caseGroup.add(pathLine(muscle.path, muscle.id === 'brachialis-like-flexor' ? 0xc1fff1 : 0xffc5b8));
      }
      scene.add(caseGroup);
      const flexor = item.compartments['brachialis-like-flexor'];
      const extensor = item.compartments['monoarticular-triceps-like-extensor'];
      document.querySelector('#metrics').innerHTML =
        '<div><span>Soft cells</span><strong>' + item.metrics.activeCellCount.toLocaleString() + '</strong></div>' +
        '<div><span>Rigid exclusions</span><strong>' + item.metrics.excludedRigidCellCount.toLocaleString() + '</strong></div>' +
        '<div><span>Brachialis volume</span><strong>' + flexor.realizedVolume.toFixed(4) + '</strong></div>' +
        '<div><span>Triceps volume</span><strong>' + extensor.realizedVolume.toFixed(4) + '</strong></div>' +
        '<div><span>Changed owners</span><strong>' + (index === 1 ? data.comparison.changedOwnerCellCount : 0).toLocaleString() + '</strong></div>' +
        '<div><span>Local change</span><strong>' + (index === 1 ? (data.comparison.localChangeFraction * 100).toFixed(1) + '%' : '—') + '</strong></div>';
      document.querySelector('#status').textContent = index === 0
        ? 'exclusive 3D ownership · finite cells clear rigid structure'
        : data.comparison.changedOwnerCellCount + ' cells reassigned locally · identities stable';
      document.querySelectorAll('[data-case]').forEach((button, buttonIndex) => button.setAttribute('aria-pressed', String(buttonIndex === index)));
    }
    document.querySelectorAll('[data-case]').forEach(button => button.addEventListener('click', () => showCase(Number(button.dataset.case))));
    function resize() {
      const width = Math.max(1, viewport.clientWidth);
      const height = Math.max(1, viewport.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(viewport);
    resize();
    const requestedCase = Number(new URLSearchParams(window.location.search).get('case') || 0);
    showCase(requestedCase === 1 ? 1 : 0);
    renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
    document.documentElement.dataset.witnessLoaded = 'true';
  </script>
</body>
</html>`;
}

export async function writeExactElbowPackingWitness({
  outDir,
  source = createExactElbowPackingSource(),
  io: ioOverrides = {},
}) {
  const outputRoot = resolve(outDir);
  const io = { ...DEFAULT_IO, ...ioOverrides };
  let phase = 'prepare-output';
  const failureBase = {
    schema: 'kaminos.exact-elbow-packing-witness-report.v0',
    status: 'failed',
    route: { requested: WITNESS_ROUTE, effective: null, fallbackUsed: false },
    source: {
      id: source?.id || null,
      schema: source?.schema || null,
      authority: source?.authority?.kind || null,
      anatomicalAdmission: source?.authority?.anatomicalAdmission || null,
    },
  };
  try {
    await io.mkdir(outputRoot, { recursive: true });
    phase = 'solve-baseline';
    const baseline = solveExactElbowPacking(source);
    phase = 'derive-perturbation';
    const editedSource = applyExactElbowMuscleVolumeEdit({
      source,
      edit: { id:'swell-brachialis-18-percent', muscleId:'brachialis-like-flexor', scale:1.18 },
    });
    phase = 'solve-perturbation';
    const edited = solveExactElbowPacking(editedSource);
    phase = 'compare-cases';
    const comparison = compareExactElbowPackings({ baseline, edited });
    const structuralFailure = [baseline, edited].some(result =>
      result.metrics.unownedCellCount !== 0 ||
      result.metrics.multiOwnedCellCount !== 0 ||
      result.metrics.rigidOwnedCellCount !== 0 ||
      result.metrics.finiteRigidOverlapCellCount !== 0 ||
      result.metrics.anchorViolationCount !== 0 ||
      result.metrics.duplicateSourceCellCount !== 0
    );
    const volumeFailure = [baseline, edited].some(result =>
      Object.values(result.compartments).some(compartment =>
        compartment.targetVolumeError > result.grid.cellVolume + 1e-12,
      ),
    );
    if (
      structuralFailure || volumeFailure || comparison.changedOwnerCellCount === 0 ||
      comparison.localChangeFraction < 0.72 || comparison.lostSourceCellCount !== 0 ||
      comparison.addedSourceCellCount !== 0 ||
      comparison.unchangedMaterialIdentityViolationCount !== 0 ||
      comparison.attachmentIdentityViolationCount !== 0 ||
      comparison.rigidIdentityViolationCount !== 0 ||
      comparison.gridIdentityViolationCount !== 0 ||
      comparison.unexpectedOwnerTransitionCount !== 0 ||
      comparison.tricepsCellDelta !== 0
    ) {
      throw new Error('exact-elbow packing witness failed structural admission');
    }
    const report = {
      ...failureBase,
      status: 'complete',
      route: { requested:WITNESS_ROUTE, effective:WITNESS_ROUTE, fallbackUsed:false },
      cases: [
        { id:'baseline', metrics:baseline.metrics, compartments:baseline.compartments },
        { id:'brachialis-swell', metrics:edited.metrics, compartments:edited.compartments },
      ],
      comparison,
      claims: {
        threeDimensionalPacking: 'supported-by-numerical-contract',
        reciprocalLocalResponse: 'supported-by-matched-perturbation',
        anatomicalCorrectness: 'unassayed',
        poseTransport: 'unassayed',
        generatedSurfaceTransfer: 'unassayed',
      },
      visualInspection: { status:'pending-agent-inspection', artifact:'index.html' },
    };
    phase = 'write-supporting-artifacts';
    const writes = await Promise.allSettled([
      io.writeFile(resolve(outputRoot, 'source.json'), `${JSON.stringify(source, null, 2)}\n`),
      io.writeFile(resolve(outputRoot, 'baseline.json'), `${JSON.stringify(baseline, null, 2)}\n`),
      io.writeFile(resolve(outputRoot, 'brachialis-swell.json'), `${JSON.stringify(edited, null, 2)}\n`),
      io.writeFile(resolve(outputRoot, 'index.html'), renderHtml({ baseline, edited, comparison, report })),
    ]);
    const rejected = writes.find(result => result.status === 'rejected');
    if (rejected) throw rejected.reason;
    phase = 'publish-report';
    await writeJsonAtomically(io, resolve(outputRoot, 'report.json'), report);
    return { outputRoot, report, baseline, edited };
  } catch (error) {
    const failureReport = {
      ...failureBase,
      failurePhase: phase,
      lastTrustworthyEvidence: { phase:'source-received', sourceId:source?.id || null, sourceSchema:source?.schema || null },
      error: { name:error.name, message:error.message },
    };
    const failureReportPath = phase === 'prepare-output'
      ? `${outputRoot}.failure-report.json`
      : resolve(outputRoot, 'report.json');
    error.failureReportPath = failureReportPath;
    try {
      await io.mkdir(dirname(failureReportPath), { recursive:true });
      await writeJsonAtomically(io, failureReportPath, failureReport);
    } catch (reportError) {
      error.failureReportError = reportError;
    }
    throw error;
  }
}

export async function admitExactElbowPackingVisualInspection({
  outDir,
  inspection,
  io: ioOverrides = {},
}) {
  const outputRoot = resolve(outDir);
  const io = { ...DEFAULT_IO, ...ioOverrides };
  if (
    typeof inspection?.observedAt !== 'string' ||
    inspection.observedAt.length === 0 ||
    !Array.isArray(inspection.images) ||
    inspection.images.length === 0 ||
    !inspection.verdict ||
    Object.values(inspection.verdict).some(value => value !== true)
  ) {
    throw new Error('exact-elbow visual admission requires a timestamp, images, and all-positive inspected verdict');
  }
  const reportPath = resolve(outputRoot, 'report.json');
  const indexPath = resolve(outputRoot, 'index.html');
  const pendingReportBytes = await io.readFile(reportPath);
  const indexBytes = await io.readFile(indexPath);
  const pendingReport = JSON.parse(String(pendingReportBytes));
  if (
    pendingReport.schema !== 'kaminos.exact-elbow-packing-witness-report.v0' ||
    pendingReport.status !== 'complete' ||
    pendingReport.route?.requested !== WITNESS_ROUTE ||
    pendingReport.route?.effective !== WITNESS_ROUTE ||
    pendingReport.route?.fallbackUsed !== false ||
    pendingReport.visualInspection?.status !== 'pending-agent-inspection'
  ) {
    throw new Error('exact-elbow visual admission requires the current pending witness report and effective route');
  }
  const images = [];
  for (const image of inspection.images) {
    if (
      typeof image?.path !== 'string' ||
      image.path.length === 0 ||
      !Array.isArray(image.viewport) ||
      image.viewport.length !== 2 ||
      !image.viewport.every(value => Number.isInteger(value) && value > 0) ||
      typeof image.case !== 'string' ||
      image.case.length === 0
    ) {
      throw new Error('exact-elbow visual admission image metadata is incomplete');
    }
    const imagePath = resolve(outputRoot, image.path);
    if (!imagePath.startsWith(`${outputRoot}/`)) {
      throw new Error(`exact-elbow visual admission image escapes output root: ${image.path}`);
    }
    const bytes = await io.readFile(imagePath);
    images.push({ ...structuredClone(image), sha256:sha256(bytes) });
  }
  const receipt = {
    schema: 'kaminos.exact-elbow-packing-visual-inspection.v0',
    status: 'passed-agent-inspection',
    observedAt: inspection.observedAt,
    route: {
      ...structuredClone(pendingReport.route),
      url: inspection.url || null,
    },
    backend: inspection.backend ? structuredClone(inspection.backend) : null,
    capture: inspection.capture ? structuredClone(inspection.capture) : null,
    bindings: {
      indexHtmlSha256: sha256(indexBytes),
      pendingReportSha256: sha256(pendingReportBytes),
    },
    images,
    verdict: structuredClone(inspection.verdict),
  };
  const report = {
    ...pendingReport,
    visualInspection: {
      status: 'passed-agent-inspection',
      artifact: 'index.html',
      receipt: 'visual-inspection.json',
      indexHtmlSha256: receipt.bindings.indexHtmlSha256,
      pendingReportSha256: receipt.bindings.pendingReportSha256,
    },
  };
  await writeJsonAtomically(
    io,
    resolve(outputRoot, 'visual-inspection.json'),
    receipt,
  );
  await writeJsonAtomically(io, reportPath, report);
  return { outputRoot, report, receipt };
}

async function main() {
  if (process.argv[2] === '--admit-visual') {
    const outDir = process.argv[3] || 'artifacts/exact-elbow-packing-v0';
    const inspectionPath = process.argv[4];
    if (!inspectionPath) throw new Error('visual admission requires an inspection JSON path');
    const inspection = JSON.parse(await readFile(resolve(inspectionPath), 'utf8'));
    const admitted = await admitExactElbowPackingVisualInspection({ outDir, inspection });
    console.log(JSON.stringify({
      status: admitted.report.visualInspection.status,
      outputRoot: admitted.outputRoot,
      route: admitted.receipt.route,
      bindings: admitted.receipt.bindings,
    }));
    return;
  }
  const outDir = process.argv[2] || 'artifacts/exact-elbow-packing-v0';
  const result = await writeExactElbowPackingWitness({ outDir });
  console.log(JSON.stringify({ status:result.report.status, outputRoot:result.outputRoot, route:result.report.route, comparison:result.report.comparison }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
}
