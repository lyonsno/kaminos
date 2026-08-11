import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createNBodyLongitudinalFalsifierFixture } from './nbody-packing-assay-core.mjs';
import {
  compileNBodyAdaptiveKktProblem,
  compileNBodyUnifiedKktProblem,
  createNBodyAdaptiveKktConfig,
  createNBodyUnifiedKktConfig,
  solveNBodyUnifiedKktCandidate,
} from './nbody-packing-unified-kkt.mjs';
import { validateReceiptBearingPng } from './lib/receipt-bearing-browser-capture.mjs';

export const NBODY_PACKING_ADAPTIVE_WITNESS_ROUTE =
  'nbody-packing-adaptive-carrier-comparison-v0';
export const NBODY_PACKING_ADAPTIVE_WITNESS_SCHEMA =
  'kaminos.nbody-packing-adaptive-carrier-witness-report.v0';

const STATES = Object.freeze(['crowded', 'two-dof-stalled', 'adaptive-packed', 'reference']);
const MODES = Object.freeze(['volume', 'slice']);
const PRIMARY_PATHS = Object.freeze([
  'fixture.json',
  'results.json',
  'index.html',
  'visual-inspection.json',
]);
const VISUAL_VERDICT_KEYS = Object.freeze([
  'nonblank',
  'orbitable',
  'sameCameraComparison',
  'crowdedCollisionLegible',
  'stalledDebtLegible',
  'adaptiveClearanceLegible',
  'stableIdentityLegible',
  'fixedAttachmentsLegible',
  'smoothCenterlinesLegible',
  'individualVolumeLegible',
  'packingSemanticsNotInverted',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function writeJsonAtomically(path, value) {
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, jsonBytes(value));
  await rename(temporaryPath, path);
}

async function clearPrimaryArtifacts(outputRoot) {
  const rows = [];
  for (const path of PRIMARY_PATHS) {
    try {
      await unlink(resolve(outputRoot, path));
      rows.push({ path, status:'removed' });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      rows.push({ path, status:'absent' });
    }
  }
  return rows;
}

function validateCandidates({ fixture, twoDofProblem, twoDofCandidate, adaptiveProblem, adaptiveCandidate }) {
  if (
    fixture.crowded.muscles.length !== 6 ||
    twoDofProblem.source.fixtureSha256 !== fixture.identity.sha256 ||
    adaptiveProblem.source.fixtureSha256 !== fixture.identity.sha256 ||
    twoDofCandidate.status !== 'stalled-unified-kkt-candidate' ||
    twoDofCandidate.failure?.phase !== 'unified-kkt-globalization-line-search' ||
    twoDofCandidate.selected.maximumPhysicalResidual < 0.1 ||
    adaptiveCandidate.status !== 'converged-unified-kkt-candidate' ||
    adaptiveCandidate.selected.maximumPhysicalResidual > 1e-7 ||
    adaptiveCandidate.selected.displacement.movedMemberCount !== 6 ||
    adaptiveCandidate.invariance.candidateEnumeration !== 'passed' ||
    twoDofCandidate.mechanism.oracleTargetCoordinatesConsumed !== false ||
    adaptiveCandidate.mechanism.oracleTargetCoordinatesConsumed !== false ||
    twoDofCandidate.mechanism.contactGraphRowsConsumed !== false ||
    adaptiveCandidate.mechanism.contactGraphRowsConsumed !== false
  ) {
    throw new Error('adaptive witness rejects substituted or inadmissible carrier comparison');
  }
}

export function renderNBodyPackingAdaptiveCarrierHtml({
  fixture,
  twoDofCandidate,
  adaptiveCandidate,
  report,
}) {
  const payload = JSON.stringify({ fixture, twoDofCandidate, adaptiveCandidate, route:report.route });
  return `<!doctype html>
<html lang="en" data-witness-loaded="false" data-witness-state="crowded" data-witness-mode="volume" data-fixture-sha256="${report.primaryIdentity?.fixtureSha256 || ''}" data-results-sha256="${report.primaryIdentity?.resultsSha256 || ''}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>N-body packing · adaptive carrier boundary</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;overflow:hidden;background:#07090d;color:#f5efe6}#viewport{position:fixed;inset:0}canvas{display:block;width:100%;height:100%}.panel{position:fixed;z-index:5;top:16px;left:16px;width:min(480px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;padding:15px 16px;border:1px solid #ffffff24;border-radius:14px;background:#0a1018ed;box-shadow:0 18px 70px #000b;backdrop-filter:blur(14px)}h1{margin:0 0 5px;font:650 18px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace}.authority{margin:0 0 7px;color:#e5b77d;font:700 10px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.07em;text-transform:uppercase}.explanation{margin:0 0 10px;color:#afbbc8;font-size:10px;line-height:1.4}.button-row{display:flex;flex-wrap:wrap;gap:7px;margin:7px 0}button{flex:1 1 150px;padding:8px 7px;border:1px solid #ffffff24;border-radius:8px;color:#dce6f0;background:#111923;cursor:pointer;font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace}button[aria-pressed="true"]{color:#071016;background:#e7d1a8;border-color:#fff1d0}.mode button[aria-pressed="true"]{background:#9fd7f1;border-color:#d6f3ff}.ledger{display:grid;grid-template-columns:1fr auto;gap:4px 10px;margin-top:11px;padding-top:10px;border-top:1px solid #ffffff1b;color:#c1ccd8;font:10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace}.ledger .head{color:#8998a7;text-transform:uppercase;font-size:8px;letter-spacing:.07em}.ledger .value{text-align:right}.good{color:#89deb5}.bad{color:#ff7188}.truth{margin:10px 0 0;padding:8px 9px;border-left:3px solid #65d9a6;background:#102d24b8;color:#baf1d8;font:10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}.warning{border-left-color:#ff5b72;background:#33131ab8;color:#ffc2cc}.legend{display:flex;flex-wrap:wrap;gap:5px 10px;margin-top:10px;color:#aeb9c6;font-size:9px}.swatch{display:inline-block;width:8px;height:8px;margin-right:4px;border-radius:50%}.hint{position:fixed;right:16px;bottom:14px;z-index:4;padding:9px 12px;border-radius:9px;background:#080c12d4;color:#aeb8c4;font-size:10px}@media(max-width:700px){.panel{top:8px;left:8px;width:calc(100vw - 16px);padding:11px}.hint{display:none}}
  </style>
  <script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/"}}</script>
</head>
<body>
  <div id="viewport"></div>
  <section class="panel">
    <h1>Adaptive carrier boundary · six-body</h1>
    <p class="authority">Manufactured-feasible synthetic assay · no anatomical admission</p>
    <p class="explanation">One fixed fixture isolates carrier expressivity. The first/second-sine carrier sees only the crowded carriers, bone, compartment, and hard inequalities. The manufactured reference is never solver input.</p>
    <div class="button-row states">
      <button data-state="crowded">Crowded input</button>
      <button data-state="two-dof-stalled">Two-DOF stalled · failed</button>
      <button data-state="adaptive-packed">Adaptive packed</button>
      <button data-state="reference">Manufactured reference</button>
    </div>
    <div class="button-row mode"><button data-mode="volume">transparent volume</button><button data-mode="slice">opaque slice</button></div>
    <div class="ledger">
      <span class="head">active state</span><span class="head value" id="active-label">crowded</span>
      <span>solver status</span><span class="value" id="solver-status"></span>
      <span>carrier DOF / member</span><span class="value" id="carrier-dof"></span>
      <span>pairwise penetration</span><span class="value" id="pairwise"></span>
      <span>skeletal penetration</span><span class="value" id="skeletal"></span>
      <span>compartment escape</span><span class="value" id="compartment"></span>
      <span>endpoint drift</span><span class="value" id="endpoint"></span>
      <span>maximum volume error</span><span class="value" id="volume"></span>
      <span>moved members</span><span class="value" id="moved"></span>
      <span>oracle / graph consumed</span><span class="value good">no / no</span>
    </div>
    <p class="truth" id="truth">Admission question: does the adaptive carrier remove the longitudinal collision and compartment debt while retaining attachments, volume, smoothness, and identity?</p>
    <div class="legend" id="legend"></div>
  </section>
  <div class="hint">drag to orbit · wheel to zoom · red = pair overlap · magenta = bone or compartment debt</div>
  <script type="module">
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    const payload=${payload};
    const colors=[0xff6b6b,0xf5c451,0x4ddbd3,0xa78bfa,0x66a7ff,0xff8bd1];
    const viewport=document.querySelector('#viewport');
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;renderer.setClearColor(0x07090d,1);viewport.append(renderer.domElement);
    const scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0x07090d,.08);const camera=new THREE.PerspectiveCamera(38,1,.01,100);camera.position.set(3.1,2.25,3.25);const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,0,0);controls.enableDamping=true;controls.dampingFactor=.08;controls.minDistance=1.7;controls.maxDistance=7;
    scene.add(new THREE.HemisphereLight(0xcde3ff,0x241510,2.2));const key=new THREE.DirectionalLight(0xffead1,4);key.position.set(3,4,2);scene.add(key);const rim=new THREE.DirectionalLight(0x6e8fff,2.4);rim.position.set(-3,1,-4);scene.add(rim);
    function material(color,opacity=1,depthWrite=opacity>=1){return new THREE.MeshPhysicalMaterial({color,roughness:.38,metalness:.015,clearcoat:.18,transparent:opacity<1,opacity,depthWrite,side:THREE.DoubleSide})}
    function line(points,color,opacity=1,depthTest=true){const geometry=new THREE.BufferGeometry().setFromPoints(points.map(point=>new THREE.Vector3(...point)));return new THREE.Line(geometry,new THREE.LineBasicMaterial({color,transparent:opacity<1,opacity,depthTest}))}
    function capsuleBetween(a,b,radius,mat){const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start),span=delta.length();const mesh=new THREE.Mesh(new THREE.CapsuleGeometry(radius,Math.max(.001,span-radius*2),8,20),mat);mesh.position.copy(start).add(end).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return mesh}
    function carrierSurface(centerline,mat){const radialSegments=24,vertices=[],indices=[];let priorNormal=null;for(let knotIndex=0;knotIndex<centerline.length;knotIndex++){const knot=centerline[knotIndex],position=new THREE.Vector3(...knot.position),previous=new THREE.Vector3(...centerline[Math.max(0,knotIndex-1)].position),next=new THREE.Vector3(...centerline[Math.min(centerline.length-1,knotIndex+1)].position),tangent=next.sub(previous).normalize(),reference=Math.abs(tangent.y)<.9?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0),normal=new THREE.Vector3().crossVectors(tangent,reference).normalize();if(priorNormal&&normal.dot(priorNormal)<0)normal.multiplyScalar(-1);const binormal=new THREE.Vector3().crossVectors(tangent,normal).normalize();priorNormal=normal.clone();for(let radialIndex=0;radialIndex<radialSegments;radialIndex++){const angle=radialIndex/radialSegments*Math.PI*2,vertex=position.clone().addScaledVector(normal,Math.cos(angle)*knot.radius).addScaledVector(binormal,Math.sin(angle)*knot.radius);vertices.push(vertex.x,vertex.y,vertex.z)}}for(let knotIndex=0;knotIndex<centerline.length-1;knotIndex++)for(let radialIndex=0;radialIndex<radialSegments;radialIndex++){const nextRadial=(radialIndex+1)%radialSegments,left=knotIndex*radialSegments+radialIndex,leftNext=knotIndex*radialSegments+nextRadial,right=(knotIndex+1)*radialSegments+radialIndex,rightNext=(knotIndex+1)*radialSegments+nextRadial;indices.push(left,right,leftNext,leftNext,right,rightNext)}const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();return new THREE.Mesh(geometry,mat)}
    function addMuscle(group,muscle,index,mode){if(mode==='volume'){group.add(carrierSurface(muscle.centerline,material(colors[index],.42,false)));group.add(line(muscle.centerline.map(knot=>knot.position),colors[index],1));for(const endpoint of [muscle.centerline[0],muscle.centerline.at(-1)]){const handle=new THREE.Mesh(new THREE.SphereGeometry(.034,16,12),material(0xf7f2e9,.98));handle.position.set(...endpoint.position);group.add(handle)}}else{for(const knotIndex of [2,3]){const knot=muscle.centerline[knotIndex],disc=new THREE.Mesh(new THREE.CylinderGeometry(knot.radius,knot.radius,.05,48),material(colors[index],1,true));disc.position.set(...knot.position);group.add(disc);const outline=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CylinderGeometry(knot.radius,knot.radius,.052,48)),new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:.58}));outline.position.copy(disc.position);group.add(outline)}}}
    function addDebtMarkers(group,muscles,source){for(let knotIndex=1;knotIndex<muscles[0].centerline.length-1;knotIndex++)for(let leftIndex=0;leftIndex<muscles.length;leftIndex++)for(let rightIndex=leftIndex+1;rightIndex<muscles.length;rightIndex++){const left=muscles[leftIndex].centerline[knotIndex],right=muscles[rightIndex].centerline[knotIndex],distance=Math.hypot(left.position[0]-right.position[0],left.position[1]-right.position[1],left.position[2]-right.position[2]),penetration=left.radius+right.radius-distance;if(!(penetration>1e-5))continue;const midpoint=left.position.map((value,axis)=>(value+right.position[axis])*.5),marker=new THREE.Mesh(new THREE.SphereGeometry(Math.min(.06,Math.max(.014,penetration*.55)),20,14),new THREE.MeshBasicMaterial({color:0xff2947,depthTest:false}));marker.position.set(...midpoint);marker.renderOrder=20;group.add(marker)}const compartment=source.compartment;for(const muscle of muscles)for(const knot of muscle.centerline){const escaped=knot.position.some((value,axis)=>value-knot.radius<compartment.minimum[axis]+compartment.clearance||value+knot.radius>compartment.maximum[axis]-compartment.clearance);if(escaped){const marker=new THREE.Mesh(new THREE.SphereGeometry(.035,16,12),new THREE.MeshBasicMaterial({color:0xff4edc,depthTest:false}));marker.position.set(...knot.position);marker.renderOrder=21;group.add(marker)}}}
    const states={crowded:{muscles:payload.fixture.crowded.muscles,metrics:payload.fixture.metrics.crowded,status:'input',dof:'—',moved:'—'},'two-dof-stalled':{...payload.twoDofCandidate.selected,status:payload.twoDofCandidate.status,dof:'2',moved:payload.twoDofCandidate.selected.displacement.movedMemberCount+' / 6'},'adaptive-packed':{...payload.adaptiveCandidate.selected,status:payload.adaptiveCandidate.status,dof:'4',moved:payload.adaptiveCandidate.selected.displacement.movedMemberCount+' / 6'},reference:{muscles:payload.fixture.knownFeasible.muscles,metrics:payload.fixture.metrics.knownFeasible,status:'existence witness',dof:'—',moved:'—'}};
    const groups={};for(const [stateKey,state] of Object.entries(states)){const volume=new THREE.Group(),slice=new THREE.Group(),markers=new THREE.Group();state.muscles.forEach((muscle,index)=>{addMuscle(volume,muscle,index,'volume');addMuscle(slice,muscle,index,'slice')});addDebtMarkers(markers,state.muscles,payload.fixture.knownFeasible);scene.add(volume,slice,markers);groups[stateKey]={volume,slice,markers,state}}
    const environment=new THREE.Group(),source=payload.fixture.knownFeasible,compartment=source.compartment,size=compartment.maximum.map((value,index)=>value-compartment.minimum[index]),center=compartment.maximum.map((value,index)=>(value+compartment.minimum[index])*.5),box=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(...size)),new THREE.LineDashedMaterial({color:0x86a6c8,transparent:true,opacity:.3,dashSize:.05,gapSize:.035}));box.computeLineDistances();box.position.set(...center);environment.add(box);for(const obstacle of source.obstacles)environment.add(capsuleBetween(obstacle.start,obstacle.end,obstacle.radius,material(0xcbd8e4,.94)));scene.add(environment);
    const lowerPlane=new THREE.Mesh(new THREE.BoxGeometry(1.76,.012,1.76),new THREE.MeshBasicMaterial({color:0x8fb8d7,transparent:true,opacity:.055,depthWrite:false}));lowerPlane.position.y=source.muscles[0].centerline[2].position[1];scene.add(lowerPlane);const upperPlane=lowerPlane.clone();upperPlane.position.y=source.muscles[0].centerline[3].position[1];scene.add(upperPlane);
    let activeState='crowded',activeMode='volume';const format=value=>Number.isFinite(value)?(Math.abs(value)<1e-6?value.toExponential(2):value.toFixed(5)):'—';
    function show(){for(const [stateKey,stateGroups] of Object.entries(groups)){const active=stateKey===activeState;stateGroups.volume.visible=active&&activeMode==='volume';stateGroups.slice.visible=active&&activeMode==='slice';stateGroups.markers.visible=active}lowerPlane.visible=upperPlane.visible=activeMode==='slice';const active=states[activeState],metrics=active.metrics||{};document.querySelector('#active-label').textContent=activeState;document.querySelector('#solver-status').textContent=active.status;document.querySelector('#solver-status').className='value '+(activeState==='two-dof-stalled'?'bad':activeState==='adaptive-packed'?'good':'');document.querySelector('#carrier-dof').textContent=active.dof;for(const [id,key] of [['pairwise','pairwisePenetration'],['skeletal','skeletalPenetration'],['compartment','compartmentEscape'],['endpoint','endpointDrift'],['volume','maximumRelativeVolumeError']])document.querySelector('#'+id).textContent=format(metrics[key]);document.querySelector('#moved').textContent=active.moved;const truth=document.querySelector('#truth');truth.textContent=activeState==='two-dof-stalled'?'Stalled is failure evidence, not a packed result: remaining red or magenta debt is part of the result.':'Admission question: does the adaptive carrier remove the longitudinal collision and compartment debt while retaining attachments, volume, smoothness, and identity?';truth.classList.toggle('warning',activeState==='two-dof-stalled');document.querySelectorAll('[data-state]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.state===activeState)));document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===activeMode)));document.documentElement.dataset.witnessState=activeState;document.documentElement.dataset.witnessMode=activeMode;document.querySelector('#legend').innerHTML=active.muscles.map((muscle,index)=>'<span><i class="swatch" style="background:#'+colors[index].toString(16).padStart(6,'0')+'"></i>'+muscle.id+'</span>').join('')}
    document.querySelectorAll('[data-state]').forEach(button=>button.addEventListener('click',()=>{activeState=button.dataset.state;show()}));document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{activeMode=button.dataset.mode;show()}));const params=new URLSearchParams(location.search);if(${JSON.stringify(STATES)}.includes(params.get('state')))activeState=params.get('state');if(${JSON.stringify(MODES)}.includes(params.get('mode')))activeMode=params.get('mode');function resize(){const width=Math.max(1,viewport.clientWidth),height=Math.max(1,viewport.clientHeight);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix()}new ResizeObserver(resize).observe(viewport);resize();show();renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera)});document.documentElement.dataset.witnessLoaded='true';document.documentElement.dataset.witnessRoute=payload.route.effective;
  </script>
</body>
</html>`;
}

export async function writeNBodyPackingAdaptiveCarrierWitness({
  outDir = 'artifacts/nbody-packing-adaptive-carrier-v0',
  twoDofConfig = createNBodyUnifiedKktConfig(),
  adaptiveConfig = createNBodyAdaptiveKktConfig(),
} = {}) {
  const outputRoot = resolve(outDir);
  const route = { requested:NBODY_PACKING_ADAPTIVE_WITNESS_ROUTE, effective:NBODY_PACKING_ADAPTIVE_WITNESS_ROUTE, fallbackUsed:false };
  let phase = 'build-fixture';
  let lastTrustworthyEvidence = { phase:'none' };
  let stalePrimaryCleanup = [];
  try {
    const fixture = createNBodyLongitudinalFalsifierFixture();
    lastTrustworthyEvidence = { phase:'fixture-built', fixtureSha256:fixture.identity.sha256 };
    phase = 'solve-two-dof';
    const twoDofProblem = compileNBodyUnifiedKktProblem(fixture);
    const twoDofCandidate = solveNBodyUnifiedKktCandidate({ problem:twoDofProblem, requestedConfig:twoDofConfig });
    lastTrustworthyEvidence = { ...lastTrustworthyEvidence, phase:'two-dof-solved', twoDofCandidateSha256:twoDofCandidate.identity.sha256 };
    phase = 'solve-adaptive';
    const adaptiveProblem = compileNBodyAdaptiveKktProblem(fixture);
    const adaptiveCandidate = solveNBodyUnifiedKktCandidate({ problem:adaptiveProblem, requestedConfig:adaptiveConfig });
    validateCandidates({ fixture, twoDofProblem, twoDofCandidate, adaptiveProblem, adaptiveCandidate });
    lastTrustworthyEvidence = { ...lastTrustworthyEvidence, phase:'comparison-contract-admitted', adaptiveCandidateSha256:adaptiveCandidate.identity.sha256 };
    phase = 'prepare-output';
    await mkdir(outputRoot, { recursive:true });
    stalePrimaryCleanup = await clearPrimaryArtifacts(outputRoot);
    const fixtureBytes = jsonBytes(fixture);
    const resultsBytes = jsonBytes({ twoDof:{ problem:twoDofProblem, candidate:twoDofCandidate }, adaptive:{ problem:adaptiveProblem, candidate:adaptiveCandidate } });
    const reportCore = {
      schema:NBODY_PACKING_ADAPTIVE_WITNESS_SCHEMA,
      status:'complete-pending-visual-inspection',
      route,
      fixtureSha256:fixture.identity.sha256,
      primaryIdentity:{
        fixtureSha256:sha256(fixtureBytes),
        resultsSha256:sha256(resultsBytes),
      },
      comparison:{
        twoDof:{ problemSha256:twoDofProblem.identity.sha256, candidateSha256:twoDofCandidate.identity.sha256, status:twoDofCandidate.status, failurePhase:twoDofCandidate.failure?.phase, maximumPhysicalResidual:twoDofCandidate.selected.maximumPhysicalResidual },
        adaptive:{ problemSha256:adaptiveProblem.identity.sha256, candidateSha256:adaptiveCandidate.identity.sha256, status:adaptiveCandidate.status, maximumPhysicalResidual:adaptiveCandidate.selected.maximumPhysicalResidual, traversalEquivalence:adaptiveCandidate.invariance.candidateEnumeration },
      },
      visualInspection:{ status:'pending-agent-inspection', artifact:'index.html', requiredStates:[...STATES], requiredModes:[...MODES] },
      claimCeiling:{
        authority:'bounded-synthetic-carrier-boundary-pending-visual-inspection',
        admittedClaim:'generic first/second-sine carrier closes one opposed-longitudinal six-body fixture that the first-sine-only carrier cannot close',
        rankingAuthority:'hard admission and direct visual comparison only',
        anatomicalAdmission:'none',
        nonGoals:['arbitrary-deformation-closure','authenticated-anatomy','fascia-or-skin-mechanics','production-performance','global-optimality'],
      },
      stalePrimaryCleanup,
    };
    const htmlBytes = Buffer.from(renderNBodyPackingAdaptiveCarrierHtml({ fixture, twoDofCandidate, adaptiveCandidate, report:reportCore }));
    const report = { ...reportCore, bindings:{ fixtureJsonSha256:sha256(fixtureBytes), resultsJsonSha256:sha256(resultsBytes), indexHtmlSha256:sha256(htmlBytes) } };
    phase = 'write-primary-artifacts';
    await Promise.all([
      writeFile(resolve(outputRoot, 'fixture.json'), fixtureBytes),
      writeFile(resolve(outputRoot, 'results.json'), resultsBytes),
      writeFile(resolve(outputRoot, 'index.html'), htmlBytes),
    ]);
    lastTrustworthyEvidence = { ...lastTrustworthyEvidence, phase:'primary-artifacts-written', bindings:report.bindings };
    phase = 'publish-report';
    await writeJsonAtomically(resolve(outputRoot, 'report.json'), report);
    return { outputRoot, fixture, twoDofProblem, twoDofCandidate, adaptiveProblem, adaptiveCandidate, report };
  } catch (error) {
    const failureReport = { schema:NBODY_PACKING_ADAPTIVE_WITNESS_SCHEMA, status:'failed', route:{ requested:route.requested, effective:null, fallbackUsed:false }, failurePhase:phase, lastTrustworthyEvidence, stalePrimaryCleanup, error:{ name:error.name, message:error.message } };
    const reportPath = phase === 'build-fixture' ? `${outputRoot}.failure-report.json` : resolve(outputRoot, 'report.json');
    await mkdir(dirname(reportPath), { recursive:true });
    await writeJsonAtomically(reportPath, failureReport);
    throw error;
  }
}

export async function admitNBodyPackingAdaptiveVisualInspection({
  outDir = 'artifacts/nbody-packing-adaptive-carrier-v0',
  inspection,
} = {}) {
  const outputRoot = resolve(outDir);
  if (typeof inspection?.observedAt !== 'string' || !inspection.observedAt || typeof inspection?.summary !== 'string' || !inspection.summary) {
    throw new Error('adaptive visual admission requires observedAt and summary');
  }
  if (JSON.stringify(Object.keys(inspection.verdict || {}).sort()) !== JSON.stringify([...VISUAL_VERDICT_KEYS].sort()) || VISUAL_VERDICT_KEYS.some(key => inspection.verdict[key] !== true)) {
    throw new Error('adaptive visual admission requires the exact all-positive verdict');
  }
  const reportPath = resolve(outputRoot, 'report.json');
  const report = JSON.parse(String(await readFile(reportPath)));
  if (report.schema !== NBODY_PACKING_ADAPTIVE_WITNESS_SCHEMA || report.status !== 'complete-pending-visual-inspection' || report.route?.effective !== NBODY_PACKING_ADAPTIVE_WITNESS_ROUTE || report.route?.fallbackUsed !== false) {
    throw new Error('adaptive visual admission requires the exact pending witness route');
  }
  for (const [path, binding] of [['fixture.json','fixtureJsonSha256'],['results.json','resultsJsonSha256'],['index.html','indexHtmlSha256']]) {
    if (sha256(await readFile(resolve(outputRoot, path))) !== report.bindings[binding]) throw new Error(`adaptive visual admission rejects stale ${path}`);
  }
  const captures = [];
  for (const state of STATES) for (const mode of MODES) {
    const stem = `${state}-${mode}`;
    const pngBytes = await readFile(resolve(outputRoot, `${stem}.png`));
    const captureReportBytes = await readFile(resolve(outputRoot, `${stem}-capture-report.json`));
    const captureReport = JSON.parse(String(captureReportBytes));
    const expectedDataset = validateNBodyPackingAdaptiveCaptureBinding({
      captureReport,
      state,
      mode,
      report,
      pngSha256:sha256(pngBytes),
    });
    validateReceiptBearingPng(pngBytes, { width:1400, height:900 });
    captures.push({ state, mode, png:`${stem}.png`, pngSha256:sha256(pngBytes), captureReport:`${stem}-capture-report.json`, captureReportSha256:sha256(captureReportBytes), dataset:expectedDataset, browserKind:captureReport.browser.effective.kind });
  }
  if (new Set(captures.map(row => row.pngSha256)).size !== captures.length) throw new Error('adaptive visual admission rejects duplicate state pixels');
  const receiptCore = { schema:'kaminos.nbody-packing-adaptive-carrier-visual-inspection.v0', status:'passed-agent-inspection', observedAt:inspection.observedAt, summary:inspection.summary, verdict:structuredClone(inspection.verdict), route:structuredClone(report.route), captures, claimCeiling:structuredClone(report.claimCeiling) };
  const receipt = { ...receiptCore, identity:{ sha256:sha256(jsonBytes(receiptCore)) } };
  const receiptBytes = jsonBytes(receipt);
  await writeFile(resolve(outputRoot, 'visual-inspection.json'), receiptBytes);
  const updatedReport = { ...report, status:'complete-agent-visual-inspected', visualInspection:{ status:'passed-agent-inspection', artifact:'visual-inspection.json', receiptSha256:sha256(receiptBytes), captureCount:captures.length, requiredStates:[...STATES], requiredModes:[...MODES] }, claimCeiling:{ ...report.claimCeiling, authority:'bounded-synthetic-carrier-boundary-agent-visual-inspected' }, bindings:{ ...report.bindings, visualInspectionJsonSha256:sha256(receiptBytes), captureReceiptSetSha256:sha256(jsonBytes(captures)) } };
  await writeJsonAtomically(reportPath, updatedReport);
  return { report:updatedReport, receipt };
}

export function validateNBodyPackingAdaptiveCaptureBinding({
  captureReport,
  state,
  mode,
  report,
  pngSha256,
}) {
  const expectedDataset = {
    witnessLoaded:'true',
    witnessState:state,
    witnessMode:mode,
    witnessRoute:NBODY_PACKING_ADAPTIVE_WITNESS_ROUTE,
    fixtureSha256:report.bindings?.fixtureJsonSha256,
    resultsSha256:report.bindings?.resultsJsonSha256,
  };
  if (
    captureReport.status !== 'complete' ||
    captureReport.route?.effective !== 'independent-headless-screenshot-v0' ||
    captureReport.route?.fallbackUsed !== false ||
    captureReport.browser?.effective?.installedStableChrome !== false ||
    captureReport.process?.cleanup?.status !== 'complete-no-process-group-remains' ||
    captureReport.process?.profileCleanup?.status !== 'complete-removed' ||
    JSON.stringify(captureReport.domReceipt?.dataset) !== JSON.stringify(expectedDataset) ||
    captureReport.sourceDocument?.status !== 'complete' ||
    captureReport.sourceDocument?.sha256 !== report.bindings?.indexHtmlSha256 ||
    captureReport.primaryOutput?.sha256 !== pngSha256
  ) {
    const primaryMismatch =
      captureReport.domReceipt?.dataset?.fixtureSha256 !== report.bindings?.fixtureJsonSha256 ||
      captureReport.domReceipt?.dataset?.resultsSha256 !== report.bindings?.resultsJsonSha256 ||
      captureReport.sourceDocument?.sha256 !== report.bindings?.indexHtmlSha256;
    throw new Error(primaryMismatch
      ? 'adaptive visual admission rejects primary witness identity mismatch'
      : `adaptive visual admission rejects stale or substituted ${state}-${mode}`);
  }
  return expectedDataset;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const outDir = process.argv[2] || 'artifacts/nbody-packing-adaptive-carrier-v0';
  const result = await writeNBodyPackingAdaptiveCarrierWitness({ outDir });
  process.stdout.write(`${JSON.stringify({ outputRoot:result.outputRoot, report:result.report }, null, 2)}\n`);
}
