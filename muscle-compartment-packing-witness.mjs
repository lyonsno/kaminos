import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createSyntheticFourMuscleCompartment,
  solveMuscleCompartmentPacking,
} from './muscle-compartment-packing-core.mjs';

const WITNESS_ROUTE = 'muscle-compartment-packing-orbitable-v0';
const REPORT_SCHEMA = 'kaminos.muscle-compartment-packing-witness-report.v0';
const INSPECTION_SCHEMA = 'kaminos.muscle-compartment-packing-visual-inspection.v0';
const DEFAULT_IO = { mkdir, readFile, rename, writeFile };

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeJsonAtomically(io, path, value) {
  const temporaryPath = `${path}.tmp`;
  await io.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await io.rename(temporaryPath, path);
}

function formatMetric(value) {
  if (!Number.isFinite(value)) return 'non-finite';
  if (Math.abs(value) < 1e-6) return value.toExponential(2);
  return value.toFixed(5);
}

function renderHtml({ source, result, report }) {
  const payload = JSON.stringify({ source, result, route: report.route });
  const initial = result.metrics.initial;
  const packed = result.metrics.packed;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Muscle Compartment Packing · Before / Packed</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; overflow: hidden; background: #07090d; color: #f4eee3; }
    #viewport { position: fixed; inset: 0; }
    canvas { display: block; width: 100%; height: 100%; }
    .panel { position: fixed; z-index: 3; top: 18px; left: 18px; width: min(390px, calc(100vw - 36px)); padding: 16px 17px 15px; border: 1px solid #ffffff24; border-radius: 14px; background: #0b1017e8; box-shadow: 0 16px 60px #000a; backdrop-filter: blur(14px); }
    h1 { margin: 0 0 4px; font: 650 19px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: -.03em; }
    .authority { margin: 0 0 13px; color: #e5b77d; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
    .controls { display: flex; gap: 8px; margin-bottom: 13px; }
    button { flex: 1; padding: 9px 10px; border: 1px solid #ffffff24; border-radius: 9px; color: #dce6f0; background: #111923; cursor: pointer; font: 600 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
    button[aria-pressed="true"] { color: #081016; background: #e7d1a8; border-color: #fff1d0; }
    .metrics { display: grid; grid-template-columns: 1.35fr .8fr .8fr; column-gap: 9px; row-gap: 5px; font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .metrics .head { color: #8e9baa; text-transform: uppercase; font-size: 9px; letter-spacing: .08em; }
    .metrics .value { text-align: right; color: #dce6f0; }
    .metrics .packed { color: #8ce6be; }
    .legend { display: flex; flex-wrap: wrap; gap: 7px 13px; margin-top: 13px; color: #aeb9c6; font-size: 10px; }
    .swatch { display:inline-block; width: 8px; height: 8px; margin-right:5px; border-radius:50%; }
    .hint { position: fixed; z-index:2; right:18px; bottom:16px; max-width:340px; padding:9px 12px; border-radius:9px; background:#080c12c7; color:#aeb8c4; font-size:11px; text-align:right; }
    @media (max-width: 600px) { .panel { top:10px; left:10px; width:calc(100vw - 20px); padding:12px; } h1 { font-size:16px; } .hint { display:none; } }
  </style>
  <script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/"}}</script>
</head>
<body>
  <div id="viewport"></div>
  <section class="panel" aria-label="Packing witness controls and residuals">
    <h1>Muscle Compartment Packing</h1>
    <p class="authority">Synthetic 3D falsifier · no anatomical admission</p>
    <div class="controls">
      <button data-state="before">Before packing</button>
      <button data-state="packed">Packed result</button>
    </div>
    <div class="metrics">
      <span class="head">residual</span><span class="head value">before</span><span class="head value">packed</span>
      <span>pairwise overlap</span><span class="value">${formatMetric(initial.pairwisePenetration)}</span><span class="value packed">${formatMetric(packed.pairwisePenetration)}</span>
      <span>skeletal penetration</span><span class="value">${formatMetric(initial.skeletalPenetration)}</span><span class="value packed">${formatMetric(packed.skeletalPenetration)}</span>
      <span>compartment escape</span><span class="value">${formatMetric(initial.compartmentEscape)}</span><span class="value packed">${formatMetric(packed.compartmentEscape)}</span>
      <span>endpoint drift</span><span class="value">${formatMetric(initial.endpointDrift)}</span><span class="value packed">${formatMetric(packed.endpointDrift)}</span>
      <span>max volume error</span><span class="value">${formatMetric(initial.maximumRelativeVolumeError)}</span><span class="value packed">${formatMetric(packed.maximumRelativeVolumeError)}</span>
    </div>
    <div class="legend">
      <span><i class="swatch" style="background:#ff6b6b"></i>muscle 01</span>
      <span><i class="swatch" style="background:#ffd166"></i>muscle 02</span>
      <span><i class="swatch" style="background:#4ecdc4"></i>muscle 03</span>
      <span><i class="swatch" style="background:#8f7cff"></i>muscle 04</span>
      <span><i class="swatch" style="background:#f5f1e8"></i>attachments</span>
    </div>
  </section>
  <div class="hint">Drag to orbit · wheel to zoom · packed view retains faint before-state centerlines and displacement vectors</div>
  <script type="module">
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    const payload = ${payload};
    const colors = [0xff6b6b, 0xffd166, 0x4ecdc4, 0x8f7cff, 0x63a4ff, 0xff8fab, 0x72efdd, 0xf4a261];
    const viewport = document.querySelector('#viewport');
    const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false, preserveDrawingBuffer:true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x07090d, 1);
    viewport.append(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x07090d, .13);
    const camera = new THREE.PerspectiveCamera(38, 1, .01, 100);
    camera.position.set(3.35, 2.3, 3.45);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0); controls.enableDamping = true; controls.dampingFactor = .08;
    controls.minDistance = 2.1; controls.maxDistance = 8;
    scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x22150f, 2.1));
    const key = new THREE.DirectionalLight(0xffead1, 4.2); key.position.set(3, 4, 2); scene.add(key);
    const rim = new THREE.DirectionalLight(0x6e8fff, 2.4); rim.position.set(-3, 1, -4); scene.add(rim);

    function material(color, opacity=1) {
      return new THREE.MeshPhysicalMaterial({ color, roughness:.39, metalness:.02, clearcoat:.22, transparent:opacity < 1, opacity, depthWrite:opacity >= 1 });
    }
    function capsuleBetween(a, b, radius, mat) {
      const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
      const delta = end.clone().sub(start), length = delta.length();
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(.001, length - radius * 2), 8, 18), mat);
      mesh.position.copy(start).add(end).multiplyScalar(.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), delta.normalize());
      return mesh;
    }
    function line(points, color, opacity=1) {
      const geometry = new THREE.BufferGeometry().setFromPoints(points.map(point => new THREE.Vector3(...point)));
      return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent:opacity < 1, opacity }));
    }
    function addMuscle(group, muscle, index, opacity=1) {
      const mat = material(colors[index], opacity);
      for (let i=0; i<muscle.centerline.length-1; i++) {
        const left=muscle.centerline[i], right=muscle.centerline[i+1];
        group.add(capsuleBetween(left.position, right.position, (left.radius+right.radius)/2, mat));
      }
      group.add(line(muscle.centerline.map(k => k.position), 0xffffff, opacity * .72));
      for (const endpoint of [muscle.centerline[0], muscle.centerline.at(-1)]) {
        const handle = new THREE.Mesh(new THREE.SphereGeometry(.035, 16, 12), material(0xf5f1e8, opacity));
        handle.position.set(...endpoint.position); group.add(handle);
      }
    }
    function addDisplacements(group, before, packed, index) {
      for (let i=1; i<before.centerline.length-1; i++) {
        const a=before.centerline[i].position, b=packed.centerline[i].position;
        group.add(line([a,b], colors[index], .82));
        const marker=new THREE.Mesh(new THREE.SphereGeometry(.018,10,8), material(colors[index],.9)); marker.position.set(...b); group.add(marker);
      }
    }
    const compartment = payload.source.compartment;
    const size = compartment.maximum.map((v,i)=>v-compartment.minimum[i]);
    const center = compartment.maximum.map((v,i)=>(v+compartment.minimum[i])/2);
    const boxEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(...size)),
      new THREE.LineDashedMaterial({ color:0x86a6c8, transparent:true, opacity:.28, dashSize:.05, gapSize:.035 }),
    ); boxEdges.computeLineDistances(); boxEdges.position.set(...center); scene.add(boxEdges);
    for (const obstacle of payload.source.obstacles) {
      if (obstacle.kind === 'capsule') scene.add(capsuleBetween(obstacle.start, obstacle.end, obstacle.radius, material(0xcdd6df,.94)));
      else { const sphere=new THREE.Mesh(new THREE.SphereGeometry(obstacle.radius,28,20),material(0xcdd6df,.94)); sphere.position.set(...obstacle.center); scene.add(sphere); }
    }
    const beforeGroup = new THREE.Group(), packedGroup = new THREE.Group(), ghosts = new THREE.Group();
    payload.source.muscles.forEach((muscle,index)=>addMuscle(beforeGroup,muscle,index,1));
    payload.result.muscles.forEach((muscle,index)=>addMuscle(packedGroup,muscle,index,1));
    payload.source.muscles.forEach((muscle,index)=>{
      ghosts.add(line(muscle.centerline.map(k=>k.position),colors[index],.22));
      addDisplacements(ghosts,muscle,payload.result.muscles[index],index);
    });
    scene.add(beforeGroup,packedGroup,ghosts);
    function showState(state) {
      const packed = state === 'packed'; beforeGroup.visible=!packed; packedGroup.visible=packed; ghosts.visible=packed;
      document.querySelectorAll('[data-state]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.state===state)));
      document.documentElement.dataset.witnessState=state;
    }
    document.querySelectorAll('[data-state]').forEach(button=>button.addEventListener('click',()=>showState(button.dataset.state)));
    function resize(){const w=Math.max(1,viewport.clientWidth),h=Math.max(1,viewport.clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
    new ResizeObserver(resize).observe(viewport); resize();
    const requested = new URLSearchParams(location.search).get('state'); showState(requested === 'before' ? 'before' : 'packed');
    renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
    document.documentElement.dataset.witnessLoaded='true';
    document.documentElement.dataset.witnessRoute=payload.route.effective;
  </script>
</body>
</html>`;
}

export async function writeMuscleCompartmentPackingWitness({
  outDir = 'artifacts/muscle-compartment-packing-v0',
  source = createSyntheticFourMuscleCompartment(),
  config = {},
  io: ioOverrides = {},
} = {}) {
  const outputRoot = resolve(outDir);
  const io = { ...DEFAULT_IO, ...ioOverrides };
  let phase = 'prepare-output';
  const failureBase = {
    schema: REPORT_SCHEMA,
    status: 'failed',
    route: { requested: WITNESS_ROUTE, effective: null, fallbackUsed: false },
    input: source?.input ? structuredClone(source.input) : { requested:null, effective:null },
    source: {
      id: source?.id || null,
      schema: source?.schema || null,
      authority: source?.authority?.kind || null,
      anatomicalAdmission: source?.authority?.anatomicalAdmission || null,
    },
  };
  try {
    await io.mkdir(outputRoot, { recursive:true });
    phase = 'solve';
    const result = solveMuscleCompartmentPacking(source, config);
    if (result.status !== 'converged') {
      throw new Error(`muscle compartment packing witness requires converged result, got ${result.status}`);
    }
    const initial = result.metrics.initial;
    const packed = result.metrics.packed;
    if (
      initial.pairwisePenetration <= 0 ||
      initial.skeletalPenetration <= 0 ||
      packed.pairwisePenetration >= initial.pairwisePenetration * .02 ||
      packed.skeletalPenetration > result.config.convergenceTolerance ||
      packed.compartmentEscape > result.config.convergenceTolerance ||
      packed.endpointDrift !== 0 ||
      packed.maximumRelativeVolumeError > 1e-9
    ) {
      throw new Error('muscle compartment packing witness failed numerical admission');
    }
    const report = {
      ...failureBase,
      status: 'complete',
      route: { requested:WITNESS_ROUTE, effective:WITNESS_ROUTE, fallbackUsed:false },
      config: structuredClone(result.config),
      result: {
        schema: result.schema,
        status: result.status,
        iterations: result.iterations,
        muscleCount: result.muscles.length,
        metrics: structuredClone(result.metrics),
      },
      claims: {
        threeDimensionalPacking: 'supported-by-numerical-contract',
        fixedAttachmentIdentity: 'supported-by-numerical-contract',
        approximateIndividualVolumePreservation: 'supported-by-numerical-contract',
        pairwiseAndSkeletalExclusion: 'supported-by-numerical-contract',
        anatomicalCorrectness: 'unassayed',
        authoredSourcePacking: 'blocked-on-coordinate-bearing-atlas',
      },
      visualInspection: { status:'pending-agent-inspection', artifact:'index.html' },
    };
    phase = 'write-supporting-artifacts';
    const writes = await Promise.allSettled([
      io.writeFile(resolve(outputRoot, 'source.json'), `${JSON.stringify(source, null, 2)}\n`),
      io.writeFile(resolve(outputRoot, 'packed.json'), `${JSON.stringify(result, null, 2)}\n`),
      io.writeFile(resolve(outputRoot, 'index.html'), renderHtml({ source, result, report })),
    ]);
    const rejected = writes.find(write => write.status === 'rejected');
    if (rejected) throw rejected.reason;
    phase = 'publish-report';
    await writeJsonAtomically(io, resolve(outputRoot, 'report.json'), report);
    return { outputRoot, report, source, result };
  } catch (error) {
    const failureReport = {
      ...failureBase,
      failurePhase: phase,
      lastTrustworthyEvidence: {
        phase:'source-received',
        sourceId:source?.id || null,
        sourceSchema:source?.schema || null,
        input:source?.input ? structuredClone(source.input) : null,
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

export async function admitMuscleCompartmentPackingVisualInspection({
  outDir = 'artifacts/muscle-compartment-packing-v0',
  inspection,
  io: ioOverrides = {},
} = {}) {
  const outputRoot = resolve(outDir);
  const io = { ...DEFAULT_IO, ...ioOverrides };
  if (
    typeof inspection?.observedAt !== 'string' || inspection.observedAt.length === 0 ||
    !Array.isArray(inspection.images) || inspection.images.length === 0 ||
    !inspection.verdict || Object.values(inspection.verdict).some(value => value !== true)
  ) {
    throw new Error('muscle packing visual admission requires timestamp, images, and all-positive inspected verdict');
  }
  const stateCounts = inspection.images.reduce((counts, image) => {
    if (image?.state === 'before' || image?.state === 'packed') {
      counts[image.state] += 1;
    }
    return counts;
  }, { before:0, packed:0 });
  if (stateCounts.before !== 1 || stateCounts.packed !== 1 || inspection.images.length !== 2) {
    throw new Error('muscle packing visual admission requires exactly one before and exactly one packed capture');
  }
  const reportPath = resolve(outputRoot, 'report.json');
  const indexPath = resolve(outputRoot, 'index.html');
  const sourcePath = resolve(outputRoot, 'source.json');
  const packedPath = resolve(outputRoot, 'packed.json');
  const [pendingReportBytes, indexBytes, sourceBytes, packedBytes] = await Promise.all([
    io.readFile(reportPath), io.readFile(indexPath), io.readFile(sourcePath), io.readFile(packedPath),
  ]);
  const pendingReport = JSON.parse(String(pendingReportBytes));
  if (
    pendingReport.schema !== REPORT_SCHEMA || pendingReport.status !== 'complete' ||
    pendingReport.route?.requested !== WITNESS_ROUTE ||
    pendingReport.route?.effective !== WITNESS_ROUTE ||
    pendingReport.route?.fallbackUsed !== false ||
    pendingReport.visualInspection?.status !== 'pending-agent-inspection'
  ) {
    throw new Error('muscle packing visual admission requires current pending report and exact effective route');
  }
  const images = [];
  for (const image of inspection.images) {
    if (
      typeof image?.path !== 'string' || image.path.length === 0 ||
      !Array.isArray(image.viewport) || image.viewport.length !== 2 ||
      !image.viewport.every(value => Number.isInteger(value) && value > 0) ||
      typeof image.state !== 'string' || !['before','packed'].includes(image.state)
    ) {
      throw new Error('muscle packing visual admission image metadata is incomplete');
    }
    const imagePath = resolve(outputRoot, image.path);
    if (!imagePath.startsWith(`${outputRoot}/`)) {
      throw new Error(`muscle packing visual admission image escapes output root: ${image.path}`);
    }
    const bytes = await io.readFile(imagePath);
    if (bytes.length === 0) throw new Error(`muscle packing visual admission rejects blank or empty capture: ${image.path}`);
    images.push({ ...structuredClone(image), byteLength:bytes.length, sha256:sha256(bytes) });
  }
  const receipt = {
    schema: INSPECTION_SCHEMA,
    status: 'passed-agent-inspection',
    observedAt: inspection.observedAt,
    route: { ...structuredClone(pendingReport.route), url:inspection.url || null },
    backend: inspection.backend ? structuredClone(inspection.backend) : null,
    capture: inspection.capture ? structuredClone(inspection.capture) : null,
    bindings: {
      indexHtmlSha256: sha256(indexBytes),
      sourceJsonSha256: sha256(sourceBytes),
      packedJsonSha256: sha256(packedBytes),
      pendingReportSha256: sha256(pendingReportBytes),
    },
    images,
    verdict: structuredClone(inspection.verdict),
  };
  const report = {
    ...pendingReport,
    visualInspection: {
      status:'passed-agent-inspection',
      artifact:'index.html',
      receipt:'visual-inspection.json',
      ...receipt.bindings,
    },
  };
  await writeJsonAtomically(io, resolve(outputRoot, 'visual-inspection.json'), receipt);
  await writeJsonAtomically(io, reportPath, report);
  return { outputRoot, report, receipt };
}

async function main() {
  if (process.argv[2] === '--admit-visual') {
    const outDir = process.argv[3] || 'artifacts/muscle-compartment-packing-v0';
    const inspectionPath = process.argv[4];
    if (!inspectionPath) throw new Error('visual admission requires an inspection JSON path');
    const inspection = JSON.parse(await readFile(resolve(inspectionPath), 'utf8'));
    const admitted = await admitMuscleCompartmentPackingVisualInspection({ outDir, inspection });
    console.log(JSON.stringify({
      status:admitted.report.visualInspection.status,
      outputRoot:admitted.outputRoot,
      route:admitted.receipt.route,
      bindings:admitted.receipt.bindings,
    }));
    return;
  }
  const outDir = process.argv[2] || 'artifacts/muscle-compartment-packing-v0';
  const result = await writeMuscleCompartmentPackingWitness({ outDir });
  console.log(JSON.stringify({
    status:result.report.status,
    outputRoot:result.outputRoot,
    route:result.report.route,
    metrics:result.report.result.metrics,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.stack || error.message); process.exitCode=1; });
}
