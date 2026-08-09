import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createNBodyRosetteFixture,
  runNBodyRosetteCounterfeitAssay,
} from './nbody-packing-assay-core.mjs';

export const NBODY_PACKING_ASSAY_WITNESS_ROUTE =
  'nbody-packing-rosette-orbitable-v0';

const REPORT_SCHEMA = 'kaminos.nbody-packing-assay-witness-report.v0';
const VISUAL_INSPECTION_SCHEMA = 'kaminos.nbody-packing-assay-visual-inspection.v0';
const PRIMARY_PATHS = Object.freeze(['fixture.json', 'result.json', 'index.html']);
const VISUAL_STATES = Object.freeze(['known-feasible', 'crowded', 'sequential-counterfeit']);
const VISUAL_MODES = Object.freeze(['volume', 'slice']);
const VISUAL_VERDICT_KEYS = Object.freeze([
  'nonblank',
  'orbitable',
  'statesLegible',
  'opaqueOverlapTruthLegible',
  'stableIdentityLegible',
  'attachmentsBoneCompartmentLegible',
  'metricsMatchMarkers',
  'packingSemanticsNotInverted',
  'textContained',
]);
const DEFAULT_IO = { mkdir, readFile, rename, unlink, writeFile };

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatMetric(value) {
  if (!Number.isFinite(value)) return 'non-finite';
  if (Math.abs(value) < 1e-6) return value.toExponential(2);
  return value.toFixed(5);
}

async function writeJsonAtomically(io, path, value) {
  const temporaryPath = `${path}.tmp`;
  await io.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await io.rename(temporaryPath, path);
}

async function clearPrimaryArtifacts(io, outputRoot) {
  const settled = await Promise.allSettled(PRIMARY_PATHS.map(async path => {
    try {
      await io.unlink(resolve(outputRoot, path));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }));
  const failures = settled.flatMap((entry, index) => entry.status === 'rejected'
    ? [{ path:PRIMARY_PATHS[index], reason:entry.reason?.message || String(entry.reason) }]
    : []);
  return failures.length === 0
    ? { status:'cleared', paths:[...PRIMARY_PATHS] }
    : { status:'failed', paths:[...PRIMARY_PATHS], failures };
}

export function renderNBodyPackingAssayHtml({ fixture, result, report }) {
  const payload = JSON.stringify({
    fixture,
    result,
    route:report.route,
  });
  const states = [
    ['known-feasible', 'Known feasible'],
    ['crowded', 'Crowded input'],
    ['sequential-counterfeit', 'Local counterfeit'],
  ];
  const stateButtons = states.map(([state, label]) =>
    `<button data-state="${state}">${escapeHtml(label)}</button>`,
  ).join('');
  const known = result.states.knownFeasible.metrics;
  const crowded = result.states.crowded.metrics;
  const counterfeit = result.states.sequentialCounterfeit.metrics;
  const selected = result.counterfeit.selectedPair;
  const distal = result.counterfeit.exportedDebt;
  const colors = ['#ff7b72', '#f2cc60', '#56d4dd', '#a98cff', '#69a7ff'];
  const legend = fixture.contactGraph.members.map((id, index) =>
    `<span><i class="swatch" style="background:${colors[index]}"></i>${escapeHtml(id.replace('rosette-', ''))}</span>`,
  ).join('');
  return `<!doctype html>
<html lang="en" data-witness-state="crowded" data-witness-mode="volume">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>N-body packing rosette · known witness / counterfeit</title>
  <style>
    :root { color-scheme:dark; font-family:Inter,ui-sans-serif,system-ui,sans-serif; }
    * { box-sizing:border-box; }
    body { margin:0; overflow:hidden; background:#07090d; color:#f4eee3; }
    #viewport { position:fixed; inset:0; }
    canvas { display:block; width:100%; height:100%; }
    .panel { position:fixed; z-index:4; top:16px; left:16px; width:min(470px,calc(100vw - 32px)); max-height:calc(100vh - 32px); overflow:auto; padding:15px 16px; border:1px solid #ffffff24; border-radius:14px; background:#0a1018ed; box-shadow:0 18px 70px #000b; backdrop-filter:blur(14px); }
    h1 { margin:0 0 4px; font:650 18px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:-.025em; }
    .authority { margin:0 0 7px; color:#e5b77d; font:700 10px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.07em; text-transform:uppercase; }
    .status { margin:0 0 8px; color:#ff8f8f; font:700 11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace; }
    .explanation { margin:0 0 11px; color:#afbbc8; font-size:10px; line-height:1.4; }
    .button-row { display:flex; gap:7px; margin:8px 0; }
    button { flex:1; min-width:0; padding:8px 7px; border:1px solid #ffffff24; border-radius:8px; color:#dce6f0; background:#111923; cursor:pointer; font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace; }
    button[aria-pressed="true"] { color:#071016; background:#e7d1a8; border-color:#fff1d0; }
    .mode button[aria-pressed="true"] { background:#9fd7f1; border-color:#d6f3ff; }
    .metrics { display:grid; grid-template-columns:1.35fr repeat(3,.72fr); gap:4px 8px; margin-top:11px; font:10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace; }
    .metrics .head { color:#8998a7; text-transform:uppercase; font-size:8px; letter-spacing:.07em; }
    .metrics .value { text-align:right; color:#dce6f0; }
    .metrics .known { color:#89deb5; }
    .metrics .counterfeit { color:#ff9999; }
    .debt { display:grid; grid-template-columns:1fr auto auto; gap:4px 8px; margin-top:12px; color:#c1ccd8; font:10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace; }
    .debt .head { color:#8998a7; text-transform:uppercase; font-size:8px; }
    .debt .value { text-align:right; }
    .improved { color:#8ce6be; }
    .worsened { color:#ff8f8f; }
    .truth { margin:11px 0 0; padding:8px 9px; border-left:3px solid #ff4f64; background:#34131aa8; color:#ffd0d5; font:10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; }
    .legend { display:flex; flex-wrap:wrap; gap:6px 12px; margin-top:11px; color:#aeb9c6; font-size:9px; }
    .swatch { display:inline-block; width:8px; height:8px; margin-right:4px; border-radius:50%; }
    .hint { position:fixed; z-index:3; right:16px; bottom:14px; max-width:420px; padding:9px 12px; border-radius:9px; background:#080c12d4; color:#aeb8c4; font-size:10px; text-align:right; }
    @media (max-width:700px) { .panel { top:8px; left:8px; width:calc(100vw - 16px); padding:11px; } .hint { display:none; } }
  </style>
  <script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/"}}</script>
</head>
<body>
  <div id="viewport"></div>
  <section class="panel" aria-label="N-body packing assay controls and evidence">
    <h1>Five-body global-debt falsifier</h1>
    <p class="authority">Synthetic known-feasible assay · no anatomical admission</p>
    <p class="status">${escapeHtml(result.status)}</p>
    <p class="explanation">The packed witness is manufactured first; the crowded input is derived from it. The local counterfeit relieves west→center while exporting pressure into center→east. Aggregate improvement is deliberately insufficient.</p>
    <div class="button-row">${stateButtons}</div>
    <div class="button-row mode">
      <button data-mode="volume">Volumetric context</button>
      <button data-mode="slice">Opaque overlap truth</button>
    </div>
    <div class="metrics">
      <span class="head">physical residual</span><span class="head value">known</span><span class="head value">crowded</span><span class="head value">counterfeit</span>
      <span>pairwise penetration</span><span class="value known">${formatMetric(known.pairwisePenetration)}</span><span class="value">${formatMetric(crowded.pairwisePenetration)}</span><span class="value counterfeit">${formatMetric(counterfeit.pairwisePenetration)}</span>
      <span>skeletal penetration</span><span class="value known">${formatMetric(known.skeletalPenetration)}</span><span class="value">${formatMetric(crowded.skeletalPenetration)}</span><span class="value counterfeit">${formatMetric(counterfeit.skeletalPenetration)}</span>
      <span>compartment escape</span><span class="value known">${formatMetric(known.compartmentEscape)}</span><span class="value">${formatMetric(crowded.compartmentEscape)}</span><span class="value counterfeit">${formatMetric(counterfeit.compartmentEscape)}</span>
      <span>endpoint drift</span><span class="value known">${formatMetric(known.endpointDrift)}</span><span class="value">${formatMetric(crowded.endpointDrift)}</span><span class="value counterfeit">${formatMetric(counterfeit.endpointDrift)}</span>
      <span>max volume error</span><span class="value known">${formatMetric(known.maximumRelativeVolumeError)}</span><span class="value">${formatMetric(crowded.maximumRelativeVolumeError)}</span><span class="value counterfeit">${formatMetric(counterfeit.maximumRelativeVolumeError)}</span>
    </div>
    <div class="debt">
      <span class="head">pressure-chain edge</span><span class="head value">before</span><span class="head value">after</span>
      <span>west → center selected</span><span class="value">${formatMetric(selected.beforePenetration)}</span><span class="value improved">${formatMetric(selected.afterPenetration)}</span>
      <span>center → east distal</span><span class="value">${formatMetric(distal.beforePenetration)}</span><span class="value worsened">${formatMetric(distal.afterPenetration)}</span>
    </div>
    <p class="truth">Rejected: distal pressure debt survives despite locally and globally lower aggregate overlap. Red slice markers are measured belt-plane interpenetrations, not decorative contact hints.</p>
    <div class="legend">${legend}<span><i class="swatch" style="background:#f5f1e8"></i>attachments</span><span><i class="swatch" style="background:#cbd8e4"></i>bone</span><span><i class="swatch" style="background:#ff334f"></i>penetration</span></div>
  </section>
  <div class="hint">Drag to orbit · wheel to zoom · switch states under one camera · slice mode makes all belt occupancy opaque</div>
  <script type="module">
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    const payload=${payload};
    const colors=[0xff7b72,0xf2cc60,0x56d4dd,0xa98cff,0x69a7ff];
    const stateKeys=['known-feasible','crowded','sequential-counterfeit'];
    const stateData={
      'known-feasible':payload.result.states.knownFeasible,
      'crowded':payload.result.states.crowded,
      'sequential-counterfeit':payload.result.states.sequentialCounterfeit,
    };
    const viewport=document.querySelector('#viewport');
    const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.08;
    renderer.setClearColor(0x07090d,1);
    viewport.append(renderer.domElement);
    const scene=new THREE.Scene();
    scene.fog=new THREE.FogExp2(0x07090d,.095);
    const camera=new THREE.PerspectiveCamera(38,1,.01,100);
    camera.position.set(3.0,2.2,3.15);
    const controls=new OrbitControls(camera,renderer.domElement);
    controls.target.set(0,0,0); controls.enableDamping=true; controls.dampingFactor=.08;
    controls.minDistance=1.7; controls.maxDistance=7;
    scene.add(new THREE.HemisphereLight(0xcde3ff,0x241510,2.15));
    const key=new THREE.DirectionalLight(0xffead1,4.1); key.position.set(3,4,2); scene.add(key);
    const rim=new THREE.DirectionalLight(0x6e8fff,2.5); rim.position.set(-3,1,-4); scene.add(rim);
    function material(color,opacity=1,depthWrite=opacity>=1){
      return new THREE.MeshPhysicalMaterial({color,roughness:.38,metalness:.015,clearcoat:.2,transparent:opacity<1,opacity,depthWrite});
    }
    function line(points,color,opacity=1,depthTest=true){
      const geometry=new THREE.BufferGeometry().setFromPoints(points.map(point=>new THREE.Vector3(...point)));
      return new THREE.Line(geometry,new THREE.LineBasicMaterial({color,transparent:opacity<1,opacity,depthTest}));
    }
    function capsuleBetween(a,b,radius,mat){
      const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b);
      const delta=end.clone().sub(start),span=delta.length();
      const mesh=new THREE.Mesh(new THREE.CapsuleGeometry(radius,Math.max(.001,span-radius*2),8,20),mat);
      mesh.position.copy(start).add(end).multiplyScalar(.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
      return mesh;
    }
    function carrierSurface(centerline,mat){
      const radialSegments=24,vertices=[],indices=[];
      let priorNormal=null;
      for(let knotIndex=0;knotIndex<centerline.length;knotIndex++){
        const knot=centerline[knotIndex],position=new THREE.Vector3(...knot.position);
        const previous=new THREE.Vector3(...centerline[Math.max(0,knotIndex-1)].position);
        const next=new THREE.Vector3(...centerline[Math.min(centerline.length-1,knotIndex+1)].position);
        const tangent=next.sub(previous).normalize();
        const reference=Math.abs(tangent.y)<.9?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0);
        const normal=new THREE.Vector3().crossVectors(tangent,reference).normalize();
        if(priorNormal&&normal.dot(priorNormal)<0)normal.multiplyScalar(-1);
        const binormal=new THREE.Vector3().crossVectors(tangent,normal).normalize();
        priorNormal=normal.clone();
        for(let radialIndex=0;radialIndex<radialSegments;radialIndex++){
          const angle=radialIndex/radialSegments*Math.PI*2;
          const vertex=position.clone().addScaledVector(normal,Math.cos(angle)*knot.radius).addScaledVector(binormal,Math.sin(angle)*knot.radius);
          vertices.push(vertex.x,vertex.y,vertex.z);
        }
      }
      for(let knotIndex=0;knotIndex<centerline.length-1;knotIndex++){
        for(let radialIndex=0;radialIndex<radialSegments;radialIndex++){
          const nextRadial=(radialIndex+1)%radialSegments;
          const left=knotIndex*radialSegments+radialIndex,leftNext=knotIndex*radialSegments+nextRadial;
          const right=(knotIndex+1)*radialSegments+radialIndex,rightNext=(knotIndex+1)*radialSegments+nextRadial;
          indices.push(left,right,leftNext,leftNext,right,rightNext);
        }
      }
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
      geometry.setIndex(indices); geometry.computeVertexNormals();
      return new THREE.Mesh(geometry,mat);
    }
    function beltSample(muscle){
      const left=muscle.centerline[2],right=muscle.centerline[3];
      return {position:left.position.map((value,axis)=>(value+right.position[axis])*.5),radius:(left.radius+right.radius)*.5};
    }
    function addVolumeMuscle(group,muscle,index){
      group.add(carrierSurface(muscle.centerline,material(colors[index],.43,false)));
      group.add(line(muscle.centerline.map(knot=>knot.position),colors[index],.95));
      for(const endpoint of [muscle.centerline[0],muscle.centerline.at(-1)]){
        const handle=new THREE.Mesh(new THREE.SphereGeometry(.035,16,12),material(0xf5f1e8,.98));
        handle.position.set(...endpoint.position); group.add(handle);
      }
    }
    function addSliceMuscle(group,muscle,index){
      const belt=beltSample(muscle);
      const disc=new THREE.Mesh(new THREE.CylinderGeometry(belt.radius,belt.radius,.045,48),material(colors[index],1,true));
      disc.position.set(belt.position[0],0,belt.position[2]); group.add(disc);
      const outline=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CylinderGeometry(belt.radius,belt.radius,.047,48)),new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:.55}));
      outline.position.copy(disc.position); group.add(outline);
    }
    function addPenetrations(group,state){
      const byId=new Map(state.muscles.map(muscle=>[muscle.id,muscle]));
      for(const pair of state.belt.pairs){
        if(!(pair.penetration>0))continue;
        const left=beltSample(byId.get(pair.members[0])),right=beltSample(byId.get(pair.members[1]));
        const midpoint=[(left.position[0]+right.position[0])*.5,0,(left.position[2]+right.position[2])*.5];
        const marker=new THREE.Mesh(new THREE.SphereGeometry(Math.max(.022,pair.penetration*.72),20,14),new THREE.MeshBasicMaterial({color:0xff334f,depthTest:false}));
        marker.position.set(...midpoint); marker.renderOrder=10; group.add(marker);
        const connector=line([[left.position[0],0,left.position[2]],[right.position[0],0,right.position[2]]],0xff334f,.95,false);
        connector.renderOrder=10; group.add(connector);
      }
    }
    const compartment=payload.fixture.knownFeasible.compartment;
    const size=compartment.maximum.map((value,index)=>value-compartment.minimum[index]);
    const center=compartment.maximum.map((value,index)=>(value+compartment.minimum[index])*.5);
    const box=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(...size)),new THREE.LineDashedMaterial({color:0x86a6c8,transparent:true,opacity:.28,dashSize:.05,gapSize:.035}));
    box.computeLineDistances(); box.position.set(...center); scene.add(box);
    for(const obstacle of payload.fixture.knownFeasible.obstacles){
      scene.add(capsuleBetween(obstacle.start,obstacle.end,obstacle.radius,material(0xcbd8e4,.94)));
      const xray=capsuleBetween(obstacle.start,obstacle.end,obstacle.radius*1.015,new THREE.MeshBasicMaterial({color:0xb9d8ef,wireframe:true,transparent:true,opacity:.3,depthTest:false}));
      xray.renderOrder=5; scene.add(xray);
    }
    const groups={};
    for(const stateKey of stateKeys){
      const volume=new THREE.Group(),slice=new THREE.Group(),penetrations=new THREE.Group();
      stateData[stateKey].muscles.forEach((muscle,index)=>{addVolumeMuscle(volume,muscle,index);addSliceMuscle(slice,muscle,index);});
      addPenetrations(penetrations,stateData[stateKey]);
      scene.add(volume,slice,penetrations); groups[stateKey]={volume,slice,penetrations};
    }
    const slicePlane=new THREE.Mesh(new THREE.BoxGeometry(1.58,.012,1.58),new THREE.MeshBasicMaterial({color:0x8fb8d7,transparent:true,opacity:.08,depthWrite:false}));
    scene.add(slicePlane);
    let activeState='crowded',activeMode='volume';
    function show(){
      for(const stateKey of stateKeys){
        const active=stateKey===activeState;
        groups[stateKey].volume.visible=active&&activeMode==='volume';
        groups[stateKey].slice.visible=active&&activeMode==='slice';
        groups[stateKey].penetrations.visible=active;
      }
      slicePlane.visible=activeMode==='slice';
      document.querySelectorAll('[data-state]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.state===activeState)));
      document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===activeMode)));
      document.documentElement.dataset.witnessState=activeState;
      document.documentElement.dataset.witnessMode=activeMode;
    }
    document.querySelectorAll('[data-state]').forEach(button=>button.addEventListener('click',()=>{activeState=button.dataset.state;show();}));
    document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{activeMode=button.dataset.mode;show();}));
    const params=new URLSearchParams(location.search);
    if(stateKeys.includes(params.get('state')))activeState=params.get('state');
    if(['volume','slice'].includes(params.get('mode')))activeMode=params.get('mode');
    function resize(){const width=Math.max(1,viewport.clientWidth),height=Math.max(1,viewport.clientHeight);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}
    new ResizeObserver(resize).observe(viewport); resize(); show();
    renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
    document.documentElement.dataset.witnessLoaded='true';
    document.documentElement.dataset.witnessRoute=payload.route.effective;
  </script>
</body>
</html>`;
}

export async function writeNBodyPackingAssayWitness({
  outDir = 'artifacts/nbody-packing-rosette-assay-v0',
  fixture = createNBodyRosetteFixture(),
  requestedConfig,
  io:ioOverrides = {},
} = {}) {
  const io = { ...DEFAULT_IO, ...ioOverrides };
  const outputRoot = resolve(outDir);
  let phase = 'prepare-output';
  let stalePrimaryCleanup = { status:'not-attempted', paths:[...PRIMARY_PATHS] };
  const route = {
    requested:NBODY_PACKING_ASSAY_WITNESS_ROUTE,
    effective:NBODY_PACKING_ASSAY_WITNESS_ROUTE,
    fallbackUsed:false,
  };
  try {
    await io.mkdir(outputRoot, { recursive:true });
    phase = 'clear-stale-primary';
    stalePrimaryCleanup = await clearPrimaryArtifacts(io, outputRoot);
    if (stalePrimaryCleanup.status !== 'cleared') {
      throw new Error('N-body witness could not clear stale primary artifacts');
    }
    phase = 'build-assay';
    const result = runNBodyRosetteCounterfeitAssay({
      fixture,
      ...(requestedConfig === undefined ? {} : { requestedConfig }),
    });
    if (result.status !== 'counterfeit-rejected-global-debt') {
      throw new Error(`N-body witness requires rejected counterfeit, got ${result.status}`);
    }
    const reportCore = {
      schema:REPORT_SCHEMA,
      status:'complete-pending-visual-inspection',
      route,
      input:structuredClone(result.input),
      fixture: {
        id:fixture.id,
        schema:fixture.schema,
        sha256:fixture.identity.sha256,
        memberCount:fixture.contactGraph.members.length,
        pressureChain:structuredClone(fixture.pressureChain),
      },
      result: {
        schema:result.schema,
        status:result.status,
        sha256:result.identity.sha256,
        selectedPair:structuredClone(result.counterfeit.selectedPair),
        exportedDebt:structuredClone(result.counterfeit.exportedDebt),
        admission:structuredClone(result.admission),
      },
      claims: {
        knownFeasibility:'supported-by-manufactured-witness',
        deterministicCrowding:'supported-by-exact-derivation',
        localCounterfeitDiscrimination:'supported-by-physical-residual-contract',
        globalSolverCorrectness:'not-assayed',
        anatomicalCorrectness:'not-assayed',
        fasciaMechanics:'not-assayed',
      },
      visualInspection: {
        status:'pending-agent-inspection',
        artifact:'index.html',
        requiredStates:['known-feasible', 'crowded', 'sequential-counterfeit'],
        requiredModes:['volume', 'slice'],
      },
      stalePrimaryCleanup,
    };
    const fixtureBytes = Buffer.from(`${JSON.stringify(fixture, null, 2)}\n`);
    const resultBytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
    const htmlBytes = Buffer.from(renderNBodyPackingAssayHtml({
      fixture,
      result,
      report:reportCore,
    }));
    const report = {
      ...reportCore,
      bindings: {
        fixtureJsonSha256:sha256(fixtureBytes),
        resultJsonSha256:sha256(resultBytes),
        indexHtmlSha256:sha256(htmlBytes),
      },
    };
    phase = 'write-primary-artifacts';
    const writes = await Promise.allSettled([
      io.writeFile(resolve(outputRoot, 'fixture.json'), fixtureBytes),
      io.writeFile(resolve(outputRoot, 'result.json'), resultBytes),
      io.writeFile(resolve(outputRoot, 'index.html'), htmlBytes),
    ]);
    const rejected = writes.find(write => write.status === 'rejected');
    if (rejected) throw rejected.reason;
    phase = 'publish-report';
    await writeJsonAtomically(io, resolve(outputRoot, 'report.json'), report);
    return { outputRoot, fixture, result, report };
  } catch (error) {
    const failureReport = {
      schema:REPORT_SCHEMA,
      status:'failed',
      route,
      failurePhase:phase,
      lastTrustworthyEvidence: {
        phase:'fixture-received',
        fixtureId:fixture?.id || null,
        fixtureSchema:fixture?.schema || null,
        recordedFixtureSha256:fixture?.identity?.sha256 || null,
      },
      stalePrimaryCleanup,
      error: { name:error.name, message:error.message },
    };
    const reportPath = phase === 'prepare-output'
      ? `${outputRoot}.failure-report.json`
      : resolve(outputRoot, 'report.json');
    error.failureReportPath = reportPath;
    try {
      await io.mkdir(dirname(reportPath), { recursive:true });
      await writeJsonAtomically(io, reportPath, failureReport);
    } catch (reportError) {
      error.failureReportError = reportError;
    }
    throw error;
  }
}

export async function admitNBodyPackingAssayVisualInspection({
  outDir = 'artifacts/nbody-packing-rosette-assay-v0',
  inspection,
  io:ioOverrides = {},
} = {}) {
  const io = { ...DEFAULT_IO, ...ioOverrides };
  const outputRoot = resolve(outDir);
  if (
    typeof inspection?.observedAt !== 'string' || inspection.observedAt.length === 0 ||
    typeof inspection?.baseUrl !== 'string' || inspection.baseUrl.length === 0 ||
    typeof inspection?.summary !== 'string' || inspection.summary.length === 0 ||
    !Array.isArray(inspection?.images)
  ) {
    throw new Error('N-body visual admission requires observedAt, baseUrl, summary, and images');
  }
  const verdictKeys = Object.keys(inspection.verdict || {}).sort();
  if (
    JSON.stringify(verdictKeys) !== JSON.stringify([...VISUAL_VERDICT_KEYS].sort()) ||
    VISUAL_VERDICT_KEYS.some(key => inspection.verdict[key] !== true)
  ) {
    throw new Error('N-body visual admission requires the exact all-positive verdict contract');
  }
  const expectedCombinations = new Set(
    VISUAL_STATES.flatMap(state => VISUAL_MODES.map(mode => `${state}|${mode}`)),
  );
  const effectiveCombinations = inspection.images.map(image => `${image?.state}|${image?.mode}`);
  if (
    inspection.images.length !== expectedCombinations.size ||
    new Set(effectiveCombinations).size !== expectedCombinations.size ||
    effectiveCombinations.some(key => !expectedCombinations.has(key))
  ) {
    throw new Error('N-body visual admission requires every state/mode combination exactly once');
  }

  const reportPath = resolve(outputRoot, 'report.json');
  const fixturePath = resolve(outputRoot, 'fixture.json');
  const resultPath = resolve(outputRoot, 'result.json');
  const indexPath = resolve(outputRoot, 'index.html');
  const [reportBytes, fixtureBytes, resultBytes, indexBytes] = await Promise.all([
    io.readFile(reportPath),
    io.readFile(fixturePath),
    io.readFile(resultPath),
    io.readFile(indexPath),
  ]);
  const report = JSON.parse(String(reportBytes));
  if (
    report.schema !== REPORT_SCHEMA ||
    report.status !== 'complete-pending-visual-inspection' ||
    report.route?.requested !== NBODY_PACKING_ASSAY_WITNESS_ROUTE ||
    report.route?.effective !== NBODY_PACKING_ASSAY_WITNESS_ROUTE ||
    report.route?.fallbackUsed !== false ||
    report.visualInspection?.status !== 'pending-agent-inspection'
  ) {
    throw new Error('N-body visual admission requires the current exact pending witness report');
  }
  const bindingChecks = {
    fixtureJsonSha256:sha256(fixtureBytes),
    resultJsonSha256:sha256(resultBytes),
    indexHtmlSha256:sha256(indexBytes),
  };
  if (JSON.stringify(bindingChecks) !== JSON.stringify(report.bindings)) {
    throw new Error('N-body visual admission rejects stale or mismatched primary artifacts');
  }

  const baseUrl = new URL(inspection.baseUrl);
  const images = [];
  for (const image of inspection.images) {
    if (
      typeof image.path !== 'string' || image.path.length === 0 ||
      typeof image.captureReportPath !== 'string' || image.captureReportPath.length === 0
    ) {
      throw new Error('N-body visual admission image paths are incomplete');
    }
    const imagePath = resolve(outputRoot, image.path);
    const captureReportPath = resolve(outputRoot, image.captureReportPath);
    if (
      !imagePath.startsWith(`${outputRoot}/`) ||
      !captureReportPath.startsWith(`${outputRoot}/`)
    ) {
      throw new Error('N-body visual admission image or capture report escapes output root');
    }
    const [imageBytes, captureReportBytes] = await Promise.all([
      io.readFile(imagePath),
      io.readFile(captureReportPath),
    ]);
    if (imageBytes.length === 0) {
      throw new Error(`N-body visual admission rejects blank capture: ${image.path}`);
    }
    const captureReport = JSON.parse(String(captureReportBytes));
    const captureUrl = new URL(captureReport.invocation?.url || inspection.baseUrl);
    const effectiveImageSha256 = sha256(imageBytes);
    if (
      captureReport.schema !== 'kaminos.receipt-bearing-browser-capture.v0' ||
      captureReport.status !== 'complete' ||
      captureReport.route?.requested !== 'independent-headless-screenshot-v0' ||
      captureReport.route?.effective !== 'independent-headless-screenshot-v0' ||
      captureReport.route?.fallbackUsed !== false ||
      captureReport.browser?.effective?.installedStableChrome !== false ||
      captureReport.browser?.fallbackPolicy !== 'independent-artifact-or-fail-no-stable-chrome' ||
      captureUrl.origin !== baseUrl.origin ||
      captureUrl.pathname !== baseUrl.pathname ||
      captureUrl.searchParams.get('state') !== image.state ||
      captureUrl.searchParams.get('mode') !== image.mode ||
      !captureReport.primaryOutput?.path?.endsWith(`/${image.path}`)
    ) {
      throw new Error(`N-body visual admission capture route mismatch: ${image.state}/${image.mode}`);
    }
    if (
      captureReport.primaryOutput.sha256 !== effectiveImageSha256 ||
      captureReport.primaryOutput.sizeBytes !== imageBytes.length
    ) {
      throw new Error(`N-body visual admission capture primary hash mismatch: ${image.state}/${image.mode}`);
    }
    images.push({
      state:image.state,
      mode:image.mode,
      path:image.path,
      byteLength:imageBytes.length,
      sha256:effectiveImageSha256,
      captureReportPath:image.captureReportPath,
      captureReportSha256:sha256(captureReportBytes),
      viewport:structuredClone(captureReport.invocation.viewport),
      capture: {
        route:structuredClone(captureReport.route),
        url:captureReport.invocation.url,
        browser: {
          kind:captureReport.browser.effective.kind,
          installedStableChrome:captureReport.browser.effective.installedStableChrome,
          fallbackPolicy:captureReport.browser.fallbackPolicy,
        },
      },
    });
  }
  if (new Set(images.map(image => image.sha256)).size !== images.length) {
    throw new Error('N-body visual admission requires distinct pixels for all six state/mode captures');
  }
  const receipt = {
    schema:VISUAL_INSPECTION_SCHEMA,
    status:'passed-agent-inspection',
    observedAt:inspection.observedAt,
    route:{ ...structuredClone(report.route), baseUrl:inspection.baseUrl },
    bindings: {
      ...bindingChecks,
      pendingReportSha256:sha256(reportBytes),
    },
    images,
    verdict:structuredClone(inspection.verdict),
    summary:inspection.summary,
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  const admittedReport = {
    ...report,
    status:'complete-visual-inspected',
    visualInspection: {
      status:'passed-agent-inspection',
      artifact:'index.html',
      receipt:'visual-inspection.json',
      receiptSha256:sha256(receiptBytes),
      summary:inspection.summary,
    },
  };
  await io.writeFile(resolve(outputRoot, 'visual-inspection.json'), receiptBytes);
  await writeJsonAtomically(io, reportPath, admittedReport);
  return { outputRoot, report:admittedReport, receipt };
}

async function main() {
  const outDir = process.argv[2] || 'artifacts/nbody-packing-rosette-assay-v0';
  const written = await writeNBodyPackingAssayWitness({ outDir });
  process.stdout.write(`${JSON.stringify({
    status:written.report.status,
    outputRoot:written.outputRoot,
    route:written.report.route,
    result:written.report.result,
    bindings:written.report.bindings,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
