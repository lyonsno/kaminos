#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  applyExactElbowMuscleReshape,
  applyExactElbowMuscleVolumeEdit,
  compareExactElbowEnvelopeCoupling,
  compareExactElbowIsovolumetricReshape,
  coupleExactElbowEnvelopeFromMuscleEdit,
  coupleExactElbowIsovolumetricEnvelope,
  createExactElbowPackingSource,
  prepareExactElbowEnvelopeCouplingSource,
  solveExactElbowPacking,
} from './analytical-elbow-packing-core.mjs';

const WITNESS_ROUTE = 'exact-elbow-constitutive-coupling-orbitable-v1';
const REPORT_SCHEMA = 'kaminos.exact-elbow-constitutive-coupling-witness-report.v1';
const DEFAULT_IO = Object.freeze({ mkdir, readFile, rename, writeFile });
const REQUIRED_VISUAL_VERDICTS = Object.freeze([
  'nonblank',
  'orbitable',
  'skinSurfaceLegible',
  'growthInflationLegible',
  'fixedSkinReshapeLegible',
  'conservedRedistributionLegible',
  'compensationRegionLegible',
  'exactCountsLegible',
  'baselineGhostLegible',
  'rigidAndMuscleContextLegible',
  'desktopTextContained',
  'mobileTextContained',
]);

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

function cellForVisual(cell, changedCellIds) {
  return {
    p: [cell.x, cell.y, cell.z],
    o: cell.ownerId,
    changed: changedCellIds.has(cell.sourceCellId),
  };
}

function visualCase({ id, result, changedCellIds = new Set() }) {
  return {
    id,
    cells: result.cells.map(cell => cellForVisual(cell, changedCellIds)),
    domain: result.domain,
    elbow: result.elbow,
    metrics: result.metrics,
    compartments: result.compartments,
  };
}

function renderHtml({
  baseline,
  growthCoupled,
  growthLedger,
  growthComparison,
  fixedEnvelopeReshaped,
  isovolumetricCoupled,
  isovolumetricLedger,
  isovolumetricComparison,
  report,
}) {
  const baselineById = new Map(baseline.cells.map(cell => [cell.sourceCellId, cell]));
  const growthChangedIds = new Set(growthCoupled.cells
    .filter(cell => !baselineById.has(cell.sourceCellId) || baselineById.get(cell.sourceCellId)?.ownerId !== cell.ownerId)
    .map(cell => cell.sourceCellId));
  const fixedReshapeChangedIds = new Set(fixedEnvelopeReshaped.cells
    .filter(cell => baselineById.get(cell.sourceCellId)?.ownerId !== cell.ownerId)
    .map(cell => cell.sourceCellId));
  const isovolumetricChangedIds = new Set(isovolumetricCoupled.cells
    .filter(cell => !baselineById.has(cell.sourceCellId) || baselineById.get(cell.sourceCellId)?.ownerId !== cell.ownerId)
    .map(cell => cell.sourceCellId));
  const visualData = {
    route: report.route,
    ledgers: { growth:growthLedger, isovolumetric:isovolumetricLedger },
    comparisons: { growth:growthComparison, isovolumetric:isovolumetricComparison },
    baselineDomain: baseline.domain,
    cases: [
      visualCase({ id:'baseline', result:baseline }),
      visualCase({ id:'growth-inflation', result:growthCoupled, changedCellIds:growthChangedIds }),
      visualCase({ id:'fixed-skin-reshape', result:fixedEnvelopeReshaped, changedCellIds:fixedReshapeChangedIds }),
      visualCase({ id:'isovolumetric-reshape', result:isovolumetricCoupled, changedCellIds:isovolumetricChangedIds }),
    ],
  };
  return `<!doctype html>
<html lang="en" data-witness-route="${WITNESS_ROUTE}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Exact elbow constitutive coupling witness</title>
  <style>
    :root { color-scheme:dark; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; background:#101412; color:#f2eee3; }
    * { box-sizing:border-box; }
    body { margin:0; min-width:320px; overflow:hidden; background:#101412; }
    main { display:grid; grid-template-rows:auto minmax(0,1fr) auto; width:100vw; min-width:0; height:100vh; min-height:560px; }
    header { display:flex; align-items:center; justify-content:space-between; gap:22px; padding:14px 20px; border-bottom:1px solid #3f4943; background:#151a17; }
    h1 { margin:0; font:650 18px/1.2 ui-sans-serif,system-ui,sans-serif; letter-spacing:0; }
    .authority { margin:4px 0 0; color:#d8b76d; font-size:11px; }
    header > div, .route, .authority, .callout, .status { min-width:0; overflow-wrap:anywhere; white-space:normal; }
    .route { color:#98a59d; font-size:10px; line-height:1.5; text-align:right; }
    .viewport { position:relative; min-width:0; min-height:0; overflow:hidden; }
    canvas { display:block; width:100%; height:100%; touch-action:none; }
    .legend { position:absolute; top:16px; left:18px; display:grid; gap:7px; margin:0; padding:0; list-style:none; pointer-events:none; color:#d9dfda; font-size:11px; text-shadow:0 1px 2px #000; }
    .legend span { display:inline-block; width:12px; height:12px; margin-right:8px; border:1px solid #ffffff66; vertical-align:-2px; }
    .skin { background:#79a892; }
    .ghost { background:transparent; border:2px dashed #f2eee3 !important; }
    .flexor { background:#58b7a3; }
    .extensor { background:#df735f; }
    .changed { background:#f3ce63; }
    .metrics { position:absolute; right:18px; bottom:16px; min-width:272px; padding:10px 12px; border:1px solid #4a554e; background:#101613ed; font-size:10px; line-height:1.6; pointer-events:none; }
    .metrics div { position:relative; min-height:16px; padding-right:84px; }
    .metrics span:first-child { color:#8f9b94; }
    .metrics strong { position:absolute; top:0; right:0; color:#f2eee3; font-weight:700; }
    .callout { position:absolute; top:16px; right:18px; max-width:310px; padding:9px 11px; border-left:3px solid #d8b76d; background:#101613d9; color:#dce2dd; font:600 11px/1.45 ui-sans-serif,system-ui,sans-serif; pointer-events:none; }
    footer { display:flex; align-items:center; justify-content:space-between; gap:18px; width:100%; min-width:0; padding:12px 18px; border-top:1px solid #3f4943; background:#151a17; overflow:hidden; }
    .controls { display:flex; gap:4px; min-width:0; }
    button { min-width:126px; min-height:36px; padding:7px 12px; border:1px solid #536058; border-radius:4px; background:#202823; color:#dce2dd; font:600 11px/1.1 ui-monospace,SFMono-Regular,Menlo,monospace; cursor:pointer; }
    button[aria-pressed="true"] { border-color:#d8b76d; background:#d8b76d; color:#181b19; }
    .status { min-width:0; max-width:520px; color:#a8b2ac; font-size:10px; line-height:1.4; text-align:right; overflow-wrap:anywhere; }
    @media (max-width:760px) {
      header { flex-direction:column; align-items:flex-start; gap:7px; padding:12px 13px; }
      .route { width:100%; text-align:left; }
      footer { flex-direction:column; align-items:flex-start; padding:9px 11px; }
      .controls { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); width:100%; overflow:hidden; }
      button { width:100%; min-width:0; min-height:42px; padding:6px 2px; font-size:8px; overflow:hidden; }
      .status { width:100%; max-width:none; text-align:left; }
      .metrics { right:9px; left:9px; bottom:9px; width:auto; min-width:0; }
      .callout { top:10px; right:9px; left:9px; max-width:none; font-size:10px; }
      .legend { top:auto; bottom:155px; left:11px; font-size:9px; }
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
        <h1>Exact elbow · constitutive muscle-to-skin coupling</h1>
        <p class="authority">Growth and constant-volume redistribution · no elastic or anatomical admission</p>
      </div>
      <div class="route">requested ${WITNESS_ROUTE}<br>effective ${WITNESS_ROUTE}</div>
    </header>
    <section class="viewport" aria-label="Orbitable exact elbow envelope coupling">
      <ul class="legend">
        <li><span class="skin"></span>Actual skin response</li>
        <li><span class="ghost"></span>Baseline skin ghost</li>
        <li><span class="flexor"></span>brachialis-like flexor</li>
        <li><span class="extensor"></span>triceps-like extensor</li>
        <li><span class="changed"></span>changed or admitted cells</li>
      </ul>
      <div class="callout" id="callout"></div>
      <div class="metrics" id="metrics"></div>
    </section>
    <footer>
      <div class="controls" role="group" aria-label="Coupling case">
        <button type="button" data-case="0" aria-pressed="true">Baseline</button>
        <button type="button" data-case="1" aria-pressed="false">Add volume</button>
        <button type="button" data-case="2" aria-pressed="false">Reshape inside</button>
        <button type="button" data-case="3" aria-pressed="false">Conserve volume</button>
      </div>
      <div class="status" id="status">Same elbow, envelope, lattice, bones, attachments, and material identities.</div>
    </footer>
  </main>
  <script id="coupling-data" type="application/json">${jsonForHtml(visualData)}</script>
  <script type="module">
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

    const data = JSON.parse(document.querySelector('#coupling-data').textContent);
    const viewport = document.querySelector('.viewport');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101412);
    scene.fog = new THREE.Fog(0x101412, 6.2, 11);
    const camera = new THREE.PerspectiveCamera(33, 1, 0.01, 40);
    camera.position.set(0, 2.5, 5.8);
    const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    viewport.prepend(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.27, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 2.2;
    controls.maxDistance = 9;
    scene.add(new THREE.HemisphereLight(0xf5ead8, 0x23342d, 2.4));
    const key = new THREE.DirectionalLight(0xffe2b2, 3.6);
    key.position.set(4, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x68cbb9, 2.1);
    rim.position.set(-4, 1, -3);
    scene.add(rim);

    const colors = {
      'brachialis-like-flexor': new THREE.Color(0x58b7a3),
      'monoarticular-triceps-like-extensor': new THREE.Color(0xdf735f),
      'residual-tissue': new THREE.Color(0x7c8e84),
      changed: new THREE.Color(0xf3ce63),
    };
    const rigidMaterials = {
      'segment-bone': new THREE.MeshStandardMaterial({ color:0xe8dcc1, roughness:0.72 }),
      'segment-process': new THREE.MeshStandardMaterial({ color:0xcbd8ca, roughness:0.68 }),
      'joint-core': new THREE.MeshStandardMaterial({ color:0x75827a, roughness:0.55, transparent:true, opacity:0.68 }),
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
    function lobeScale(direction, domain) {
      return (domain.surfaceLobes || []).reduce((scale, lobe) => {
        const center = vector(lobe.direction).normalize();
        const angle = Math.acos(THREE.MathUtils.clamp(direction.dot(center), -1, 1));
        return scale + lobe.amplitude * Math.exp(-0.5 * Math.pow(angle / lobe.angularWidth, 2));
      }, 1);
    }
    function surfaceGeometry(domain) {
      const geometry = new THREE.SphereGeometry(1, 64, 40);
      const positions = geometry.attributes.position;
      const direction = new THREE.Vector3();
      for (let index = 0; index < positions.count; index += 1) {
        direction.fromBufferAttribute(positions, index).normalize();
        const scale = lobeScale(direction, domain);
        positions.setXYZ(index, direction.x * scale, direction.y * scale, direction.z * scale);
      }
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
      return geometry;
    }
    function skinSurface(domain) {
      const geometry = surfaceGeometry(domain);
      const material = new THREE.MeshStandardMaterial({ color:0x79a892, roughness:0.42, transparent:true, opacity:0.42, side:THREE.DoubleSide, depthWrite:false });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(vector(domain.center));
      mesh.scale.set(...domain.radii);
      mesh.renderOrder = 4;
      return mesh;
    }
    function baselineGhost(domain) {
      const points = [];
      for (let index = 0; index < 160; index += 1) {
        const angle = (index / 160) * Math.PI * 2;
        points.push(new THREE.Vector3(
          domain.center[0] + Math.cos(angle) * domain.radii[0],
          domain.center[1] + Math.sin(angle) * domain.radii[1],
          domain.center[2],
        ));
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ color:0xf5f0e5, transparent:true, opacity:0.78, depthTest:false });
      const line = new THREE.LineLoop(geometry, material);
      line.renderOrder = 8;
      return line;
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
        size: ownerId === 'residual-tissue' ? 0.027 : 0.046,
        vertexColors:true,
        transparent:true,
        opacity:ownerId === 'residual-tissue' ? 0.07 : 0.92,
        depthWrite:ownerId !== 'residual-tissue',
        sizeAttenuation:true,
      });
      return new THREE.Points(geometry, material);
    }
    function pathLine(path, color) {
      const geometry = new THREE.BufferGeometry().setFromPoints(path.map(sample => vector(sample.position)));
      return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent:true, opacity:0.95 }));
    }
    function outwardArrow(directionValues, color) {
      const origin = vector(data.cases[0].domain.center);
      const direction = vector(directionValues).normalize();
      return new THREE.ArrowHelper(direction, origin, 1.25, color, 0.15, 0.08);
    }
    function compensationArrow(domain, directionValues) {
      const direction = vector(directionValues).normalize();
      const scale = lobeScale(direction, domain);
      const surface = vector(domain.center).add(new THREE.Vector3(
        direction.x * domain.radii[0] * scale,
        direction.y * domain.radii[1] * scale,
        direction.z * domain.radii[2] * scale,
      ));
      const origin = surface.clone().add(direction.clone().multiplyScalar(0.18));
      return new THREE.ArrowHelper(direction.clone().negate(), origin, 0.72, 0x6eaee8, 0.14, 0.08);
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
      caseGroup.add(skinSurface(item.domain));
      if (index > 0) {
        caseGroup.add(baselineGhost(data.baselineDomain));
      }
      if (index === 1) {
        caseGroup.add(outwardArrow(data.ledgers.growth.pressureDirection, 0xf3ce63));
      }
      if (index === 3) {
        caseGroup.add(outwardArrow(data.ledgers.isovolumetric.outwardDirection, 0xf3ce63));
        caseGroup.add(compensationArrow(item.domain, data.ledgers.isovolumetric.compensationDirection));
      }
      for (const ownerId of ['residual-tissue', 'brachialis-like-flexor', 'monoarticular-triceps-like-extensor']) {
        caseGroup.add(pointsFor(item.cells, ownerId, index > 0));
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
      const growth = data.comparisons.growth;
      const conserved = data.comparisons.isovolumetric;
      const metricStates = [
        { muscleDelta:0, interiorExchange:0, envelopeAdded:0, envelopeLost:0, outward:0, inward:0 },
        { muscleDelta:growth.brachialisCellDelta, interiorExchange:0, envelopeAdded:growth.addedSourceCellCount, envelopeLost:growth.lostSourceCellCount, outward:growth.localSurfaceDisplacement, inward:0 },
        { muscleDelta:0, interiorExchange:conserved.fixedEnvelopeChangedOwnerCellCount, envelopeAdded:0, envelopeLost:0, outward:0, inward:0 },
        { muscleDelta:0, interiorExchange:conserved.fixedEnvelopeChangedOwnerCellCount, envelopeAdded:conserved.addedSourceCellCount, envelopeLost:conserved.lostSourceCellCount, outward:conserved.outwardSurfaceDisplacement, inward:conserved.compensatingSurfaceDisplacement },
      ];
      const metrics = metricStates[index];
      const netExteriorCells = metrics.envelopeAdded - metrics.envelopeLost;
      document.querySelector('#metrics').innerHTML =
        '<div><span>Soft cells</span><strong>' + item.metrics.activeCellCount.toLocaleString() + '</strong></div>' +
        '<div><span>Brachialis cells</span><strong>' + flexor.cellCount.toLocaleString() + '</strong></div>' +
        '<div><span>Muscle cell delta</span><strong>' + metrics.muscleDelta.toLocaleString() + '</strong></div>' +
        '<div><span>Interior exchange</span><strong>' + metrics.interiorExchange.toLocaleString() + '</strong></div>' +
        '<div><span>Envelope + / −</span><strong>' + metrics.envelopeAdded.toLocaleString() + ' / ' + metrics.envelopeLost.toLocaleString() + '</strong></div>' +
        '<div><span>Net exterior cells</span><strong>' + netExteriorCells.toLocaleString() + '</strong></div>' +
        '<div><span>Skin out / in</span><strong>' + metrics.outward.toFixed(4) + ' / ' + metrics.inward.toFixed(4) + '</strong></div>';
      const callouts = [
        'Rest state: one exact material domain and one exterior capacity.',
        'Growth: 268 new muscle cells are paid by 268 new exterior cells.',
        'Internal reshape: 90 cells enter the belly and 90 leave the shoulders while skin stays fixed.',
        'Conserved response: 105 exterior cells move outward and 105 move inward. Net volume stays zero.',
      ];
      const statuses = [
        'Baseline capacity and ownership.',
        'Literal material addition. White is baseline skin; gold is inferred outward pressure.',
        'Constant muscle volume with a fixed exterior control.',
        'Paired redistribution. Gold marks outward pressure; blue marks compensating inward motion.',
      ];
      document.querySelector('#callout').textContent = callouts[index];
      document.querySelector('#status').textContent = statuses[index];
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
    showCase([0, 1, 2, 3].includes(requestedCase) ? requestedCase : 0);
    renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
    document.documentElement.dataset.witnessLoaded = 'true';
  </script>
</body>
</html>`;
}

function assertNumericallyAdmitted({
  baseline,
  growthCoupled,
  growthComparison,
  fixedEnvelopeReshaped,
  isovolumetricCoupled,
  isovolumetricComparison,
}) {
  const structuralFailure = [
    baseline,
    growthCoupled,
    fixedEnvelopeReshaped,
    isovolumetricCoupled,
  ].some(result =>
    result.metrics.unownedCellCount !== 0 ||
    result.metrics.multiOwnedCellCount !== 0 ||
    result.metrics.rigidOwnedCellCount !== 0 ||
    result.metrics.finiteRigidOverlapCellCount !== 0 ||
    result.metrics.anchorViolationCount !== 0 ||
    result.metrics.duplicateSourceCellCount !== 0
  );
  if (
    structuralFailure ||
    growthComparison.muscleCellDeficit <= 0 ||
    growthComparison.addedActiveCellCount !== growthComparison.muscleCellDeficit ||
    growthComparison.addedSourceCellCount !== growthComparison.muscleCellDeficit ||
    growthComparison.lostSourceCellCount !== 0 ||
    growthComparison.brachialisCellDelta !== growthComparison.muscleCellDeficit ||
    growthComparison.tricepsCellDelta !== 0 ||
    growthComparison.residualCellDelta !== 0 ||
    growthComparison.rigidIdentityViolationCount !== 0 ||
    growthComparison.attachmentIdentityViolationCount !== 0 ||
    growthComparison.gridIdentityViolationCount !== 0 ||
    growthComparison.sharedUnchangedMaterialIdentityViolationCount !== 0 ||
    growthComparison.unexpectedSharedOwnerTransitionCount !== 0 ||
    growthComparison.localAddedCellFraction < 0.9 ||
    growthComparison.localSurfaceDisplacement <= 0.04 ||
    growthComparison.remoteSurfaceDisplacement > growthComparison.localSurfaceDisplacement * 0.08 ||
    growthComparison.displacedVolumeError > baseline.grid.cellVolume + 1e-12 ||
    isovolumetricComparison.activeCellDelta !== 0 ||
    isovolumetricComparison.addedSourceCellCount !== isovolumetricComparison.lostSourceCellCount ||
    isovolumetricComparison.addedSourceCellCount <= 0 ||
    isovolumetricComparison.brachialisCellDelta !== 0 ||
    isovolumetricComparison.tricepsCellDelta !== 0 ||
    isovolumetricComparison.residualCellDelta !== 0 ||
    isovolumetricComparison.rigidIdentityViolationCount !== 0 ||
    isovolumetricComparison.attachmentIdentityViolationCount !== 0 ||
    isovolumetricComparison.gridIdentityViolationCount !== 0 ||
    isovolumetricComparison.sharedUnchangedMaterialIdentityViolationCount !== 0 ||
    isovolumetricComparison.unexpectedSharedOwnerTransitionCount !== 0 ||
    isovolumetricComparison.fixedEnvelopeChangedOwnerCellCount < 80 ||
    isovolumetricComparison.outwardSurfaceDisplacement <= 0.025 ||
    isovolumetricComparison.compensatingSurfaceDisplacement >= -0.01 ||
    Math.abs(isovolumetricComparison.remoteSurfaceDisplacement) >= 0.004 ||
    isovolumetricComparison.exteriorVolumeDelta !== 0 ||
    isovolumetricComparison.muscleVolumeDelta !== 0
  ) {
    throw new Error('exact-elbow constitutive coupling witness failed numerical admission');
  }
}

export async function writeExactElbowEnvelopeCouplingWitness({
  outDir,
  source: rawSource = createExactElbowPackingSource(),
  io: ioOverrides = {},
}) {
  const outputRoot = resolve(outDir);
  const io = { ...DEFAULT_IO, ...ioOverrides };
  let phase = 'prepare-output';
  const failureBase = {
    schema: REPORT_SCHEMA,
    status: 'failed',
    route: { requested:WITNESS_ROUTE, effective:null, fallbackUsed:false },
    source: {
      id: rawSource?.id || null,
      schema: rawSource?.schema || null,
      authority: rawSource?.authority?.kind || null,
      anatomicalAdmission: rawSource?.authority?.anatomicalAdmission || null,
    },
  };
  try {
    await io.mkdir(outputRoot, { recursive:true });
    phase = 'prepare-coupling-source';
    const source = prepareExactElbowEnvelopeCouplingSource({ source:rawSource });
    phase = 'solve-baseline';
    const baseline = solveExactElbowPacking(source);
    phase = 'derive-growth-edit';
    const growthFixedEnvelopeSource = applyExactElbowMuscleVolumeEdit({
      source,
      edit: {
        id:'add-brachialis-volume-18-percent-for-envelope-coupling',
        muscleId:'brachialis-like-flexor',
        scale:1.18,
      },
    });
    phase = 'solve-growth-fixed-envelope-control';
    const growthFixedEnvelopeEdited = solveExactElbowPacking(growthFixedEnvelopeSource);
    phase = 'derive-growth-envelope-response';
    const growthResponse = coupleExactElbowEnvelopeFromMuscleEdit({
      source,
      baseline,
      fixedEnvelopeSource:growthFixedEnvelopeSource,
      fixedEnvelopeEdited:growthFixedEnvelopeEdited,
      muscleId:'brachialis-like-flexor',
    });
    phase = 'solve-growth-coupled-envelope';
    const growthCoupled = solveExactElbowPacking(growthResponse.source);
    phase = 'compare-growth-cases';
    const growthComparison = compareExactElbowEnvelopeCoupling({
      baseline,
      fixedEnvelopeEdited:growthFixedEnvelopeEdited,
      coupled:growthCoupled,
      ledger:growthResponse.ledger,
    });
    phase = 'derive-isovolumetric-reshape';
    const reshapedSource = applyExactElbowMuscleReshape({
      source,
      reshape: {
        id:'contract-brachialis-isovolumetrically',
        muscleId:'brachialis-like-flexor',
        centerPathT:0.55,
        width:0.2,
        amplitude:0.42,
      },
    });
    phase = 'solve-fixed-skin-reshape';
    const fixedEnvelopeReshaped = solveExactElbowPacking(reshapedSource);
    phase = 'derive-isovolumetric-envelope-response';
    const isovolumetricResponse = coupleExactElbowIsovolumetricEnvelope({
      source,
      baseline,
      reshapedSource,
      fixedEnvelopeReshaped,
      muscleId:'brachialis-like-flexor',
    });
    phase = 'solve-isovolumetric-envelope';
    const isovolumetricCoupled = solveExactElbowPacking(isovolumetricResponse.source);
    phase = 'compare-isovolumetric-cases';
    const isovolumetricComparison = compareExactElbowIsovolumetricReshape({
      baseline,
      fixedEnvelopeReshaped,
      coupled:isovolumetricCoupled,
      ledger:isovolumetricResponse.ledger,
    });
    assertNumericallyAdmitted({
      baseline,
      growthCoupled,
      growthComparison,
      fixedEnvelopeReshaped,
      isovolumetricCoupled,
      isovolumetricComparison,
    });
    const report = {
      ...failureBase,
      status: 'complete',
      route: { requested:WITNESS_ROUTE, effective:WITNESS_ROUTE, fallbackUsed:false },
      cases: [
        { id:'baseline', metrics:baseline.metrics, compartments:baseline.compartments },
        { id:'growth-inflation', metrics:growthCoupled.metrics, compartments:growthCoupled.compartments },
        { id:'fixed-skin-reshape', metrics:fixedEnvelopeReshaped.metrics, compartments:fixedEnvelopeReshaped.compartments },
        { id:'isovolumetric-reshape', metrics:isovolumetricCoupled.metrics, compartments:isovolumetricCoupled.compartments },
      ],
      ledgers: {
        growth:growthResponse.ledger,
        isovolumetric:isovolumetricResponse.ledger,
      },
      comparisons: {
        growth:growthComparison,
        isovolumetric:isovolumetricComparison,
      },
      claims: {
        literalGrowthInflation: 'supported-by-numerical-contract',
        fixedSkinInternalReshape: 'supported-by-numerical-contract',
        constantVolumeEnvelopeRedistribution: 'supported-by-numerical-contract',
        localizedPairedDirections: 'supported-by-deterministic-constructional-heuristic',
        elasticMechanics: 'unassayed',
        anatomicalCorrectness: 'unassayed',
        poseTransport: 'unassayed',
      },
      visualInspection: { status:'pending-agent-inspection', artifact:'index.html' },
    };
    phase = 'write-supporting-artifacts';
    const writes = await Promise.allSettled([
      io.writeFile(resolve(outputRoot, 'source.json'), `${JSON.stringify(source, null, 2)}\n`),
      io.writeFile(resolve(outputRoot, 'baseline.json'), `${JSON.stringify(baseline, null, 2)}\n`),
      io.writeFile(resolve(outputRoot, 'growth-inflation.json'), `${JSON.stringify(growthCoupled, null, 2)}\n`),
      io.writeFile(resolve(outputRoot, 'growth-pressure-ledger.json'), `${JSON.stringify(growthResponse.ledger, null, 2)}\n`),
      io.writeFile(resolve(outputRoot, 'fixed-skin-reshape.json'), `${JSON.stringify(fixedEnvelopeReshaped, null, 2)}\n`),
      io.writeFile(resolve(outputRoot, 'isovolumetric-reshape.json'), `${JSON.stringify(isovolumetricCoupled, null, 2)}\n`),
      io.writeFile(resolve(outputRoot, 'isovolumetric-ledger.json'), `${JSON.stringify(isovolumetricResponse.ledger, null, 2)}\n`),
      io.writeFile(resolve(outputRoot, 'index.html'), renderHtml({
        baseline,
        growthCoupled,
        growthLedger:growthResponse.ledger,
        growthComparison,
        fixedEnvelopeReshaped,
        isovolumetricCoupled,
        isovolumetricLedger:isovolumetricResponse.ledger,
        isovolumetricComparison,
        report,
      })),
    ]);
    const rejected = writes.find(result => result.status === 'rejected');
    if (rejected) throw rejected.reason;
    phase = 'publish-report';
    await writeJsonAtomically(io, resolve(outputRoot, 'report.json'), report);
    return {
      outputRoot,
      report,
      source,
      baseline,
      growthCoupled,
      fixedEnvelopeReshaped,
      isovolumetricCoupled,
    };
  } catch (error) {
    const failureReport = {
      ...failureBase,
      failurePhase: phase,
      lastTrustworthyEvidence: {
        phase:'source-received',
        sourceId:rawSource?.id || null,
        sourceSchema:rawSource?.schema || null,
      },
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

export async function admitExactElbowEnvelopeCouplingVisualInspection({
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
    REQUIRED_VISUAL_VERDICTS.some(key => inspection.verdict[key] !== true) ||
    Object.values(inspection.verdict).some(value => value !== true)
  ) {
    throw new Error('exact-elbow envelope visual admission requires a timestamp, images, and a complete all-positive inspected verdict');
  }
  if (
    inspection.capture?.routeAttribute !== WITNESS_ROUTE ||
    !Number.isInteger(inspection.capture?.settleMilliseconds) ||
    inspection.capture.settleMilliseconds <= 0 ||
    inspection.capture.agentPixelInspection !== true
  ) {
    throw new Error('exact-elbow envelope visual admission requires current capture route identity and inspected settled pixels');
  }
  if (
    typeof inspection.backend?.requested !== 'string' ||
    inspection.backend.requested.length === 0 ||
    typeof inspection.backend?.effective !== 'string' ||
    inspection.backend.effective !== inspection.backend.requested ||
    inspection.backend.fallbackUsed !== false
  ) {
    throw new Error('exact-elbow envelope visual admission requires matching requested and effective backend identity with no fallback');
  }
  const reportPath = resolve(outputRoot, 'report.json');
  const indexPath = resolve(outputRoot, 'index.html');
  const pendingReportBytes = await io.readFile(reportPath);
  const indexBytes = await io.readFile(indexPath);
  const pendingReport = JSON.parse(String(pendingReportBytes));
  if (
    pendingReport.schema !== REPORT_SCHEMA ||
    pendingReport.status !== 'complete' ||
    pendingReport.route?.requested !== WITNESS_ROUTE ||
    pendingReport.route?.effective !== WITNESS_ROUTE ||
    pendingReport.route?.fallbackUsed !== false ||
    pendingReport.visualInspection?.status !== 'pending-agent-inspection'
  ) {
    throw new Error('exact-elbow envelope visual admission requires the current pending witness report and effective route');
  }
  const images = [];
  const imagePaths = new Set();
  const imageHashes = new Set();
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
      throw new Error('exact-elbow envelope visual admission image metadata is incomplete');
    }
    if (![
      'baseline',
      'growth-inflation',
      'fixed-skin-reshape',
      'isovolumetric-reshape',
    ].includes(image.case)) {
      throw new Error(`exact-elbow envelope visual admission image has unknown case: ${image.case}`);
    }
    if (imagePaths.has(image.path)) {
      throw new Error('exact-elbow envelope visual admission requires distinct image paths');
    }
    imagePaths.add(image.path);
    const imagePath = resolve(outputRoot, image.path);
    if (!imagePath.startsWith(`${outputRoot}/`)) {
      throw new Error(`exact-elbow envelope visual admission image escapes output root: ${image.path}`);
    }
    const bytes = await io.readFile(imagePath);
    const imageSha256 = sha256(bytes);
    if (imageHashes.has(imageSha256)) {
      throw new Error('exact-elbow envelope visual admission requires distinct image content');
    }
    imageHashes.add(imageSha256);
    images.push({ ...structuredClone(image), sha256:imageSha256 });
  }
  const isDesktop = image => image.viewport[0] >= 960 && image.viewport[1] >= 600;
  const isCompact = image => image.viewport[0] <= 600 && image.viewport[1] > image.viewport[0];
  const hasRequiredCaptureCoverage =
    images.some(image => image.case === 'baseline' && isDesktop(image)) &&
    images.some(image => image.case === 'growth-inflation' && isDesktop(image)) &&
    images.some(image => image.case === 'fixed-skin-reshape' && isDesktop(image)) &&
    images.some(image => image.case === 'isovolumetric-reshape' && isDesktop(image)) &&
    images.some(image => image.case === 'isovolumetric-reshape' && isCompact(image));
  if (!hasRequiredCaptureCoverage) {
    throw new Error('exact-elbow envelope visual admission requires required visual capture coverage: baseline, growth, fixed reshape, and isovolumetric desktop plus isovolumetric compact');
  }
  const receipt = {
    schema: 'kaminos.exact-elbow-constitutive-coupling-visual-inspection.v1',
    status: 'passed-agent-inspection',
    observedAt: inspection.observedAt,
    route: { ...structuredClone(pendingReport.route), url:inspection.url || null },
    backend: structuredClone(inspection.backend),
    capture: structuredClone(inspection.capture),
    bindings: {
      indexHtmlSha256:sha256(indexBytes),
      pendingReportSha256:sha256(pendingReportBytes),
    },
    images,
    verdict:structuredClone(inspection.verdict),
  };
  const report = {
    ...pendingReport,
    visualInspection: {
      status:'passed-agent-inspection',
      artifact:'index.html',
      receipt:'visual-inspection.json',
      indexHtmlSha256:receipt.bindings.indexHtmlSha256,
      pendingReportSha256:receipt.bindings.pendingReportSha256,
    },
  };
  await writeJsonAtomically(io, resolve(outputRoot, 'visual-inspection.json'), receipt);
  await writeJsonAtomically(io, reportPath, report);
  return { outputRoot, report, receipt };
}

async function main() {
  if (process.argv[2] === '--admit-visual') {
    const outDir = process.argv[3] || 'artifacts/exact-elbow-constitutive-coupling-v1';
    const inspectionPath = process.argv[4];
    if (!inspectionPath) throw new Error('visual admission requires an inspection JSON path');
    const inspection = JSON.parse(await readFile(resolve(inspectionPath), 'utf8'));
    const admitted = await admitExactElbowEnvelopeCouplingVisualInspection({ outDir, inspection });
    console.log(JSON.stringify({
      status:admitted.report.visualInspection.status,
      outputRoot:admitted.outputRoot,
      route:admitted.receipt.route,
      bindings:admitted.receipt.bindings,
    }));
    return;
  }
  const outDir = process.argv[2] || 'artifacts/exact-elbow-constitutive-coupling-v1';
  const result = await writeExactElbowEnvelopeCouplingWitness({ outDir });
  console.log(JSON.stringify({
    status:result.report.status,
    outputRoot:result.outputRoot,
    route:result.report.route,
    comparisons:result.report.comparisons,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
}
