#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createNBodyLocalizedChallengeSuite } from './nbody-packing-assay-core.mjs';
import {
  compileNBodyAdaptiveKktProblem,
  createNBodyAdaptiveKktConfig,
} from './nbody-packing-unified-kkt.mjs';
import {
  LOCALIZED_CHALLENGE_RESULT_SCHEMA,
  classifyNBodyLocalizedSameBasisOracle,
} from './nbody-packing-localized-challenge.mjs';
import { validateReceiptBearingPng } from './lib/receipt-bearing-browser-capture.mjs';

export const NBODY_PACKING_LOCALIZED_WITNESS_ROUTE =
  'nbody-packing-localized-boundary-v0';
export const NBODY_PACKING_LOCALIZED_HARD_WITNESS_ROUTE =
  'nbody-packing-localized-hard-boundary-v0';
export const NBODY_PACKING_RESTORATION_WITNESS_ROUTE =
  'nbody-packing-all-neighbor-restoration-v0';
export const NBODY_PACKING_LOCALIZED_WITNESS_SCHEMA =
  'kaminos.nbody-packing-localized-boundary-witness.v0';

const STATE_KEYS = Object.freeze([
  'pass-crowded',
  'last-pass',
  'fail-crowded',
  'first-fail',
  'same-basis-feasible',
  'reference',
]);
const VISUAL_VERDICT_KEYS = Object.freeze([
  'nonblank', 'orbitable', 'sameCameraComparison', 'crowdedDebtLegible',
  'lastPassClearanceLegible', 'firstFailDebtLegible',
  'sameBasisCorrectionLegible', 'stableIdentityLegible',
  'fixedAttachmentsLegible', 'individualVolumeLegible',
  'packingSemanticsNotInverted',
]);
const HARD_BOUNDARY_VISUAL_VERDICT_KEYS = Object.freeze([
  'nonblank', 'orbitable', 'sameCameraComparison', 'crowdedDebtLegible',
  'lastPassClearanceLegible', 'coldFailureGrosslyWrong',
  'warmStartResidualLegible', 'coordinateFloorResidualLegible',
  'manufacturedWitnessAuthorityCeilingLegible', 'stableIdentityLegible',
  'fixedAttachmentsLegible', 'individualVolumeLegible',
  'packingSemanticsNotInverted',
]);
const RESTORATION_VISUAL_VERDICT_KEYS = Object.freeze([
  ...HARD_BOUNDARY_VISUAL_VERDICT_KEYS,
  'restorationDeltaLegible', 'restorationResidualMarkersLegible',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function writeAtomically(targetPath, bytes) {
  const temporaryPath = `${targetPath}.tmp`;
  await writeFile(temporaryPath, bytes);
  await rename(temporaryPath, targetPath);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function renderNBodyPackingLocalizedSupersededHtml({
  replacementRoute = NBODY_PACKING_LOCALIZED_HARD_WITNESS_ROUTE,
} = {}) {
  const escapedRoute = escapeHtml(replacementRoute);
  return `<!doctype html>
<html lang="en" data-witness-loaded="false" data-witness-status="superseded" data-replacement-route="${escapedRoute}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Superseded localized packing witness</title>
<style>:root{color-scheme:dark;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07090d;color:#f5efe6}.card{max-width:720px;margin:24px;padding:28px;border:1px solid #ffffff2b;border-radius:16px;background:#101721}h1{margin-top:0;color:#ffcc79}code{color:#9fd7f1}.warning{color:#ff9aab}</style></head>
<body><main class="card"><h1>Superseded evidence surface</h1><p class="warning">This historical 0.20/0.24 witness is not current solver evidence and must not be used for visual admission.</p><p>The solver-globalization repair moved the observed boundary and changed traversal semantics. Use <code>${escapedRoute}</code> for the current inspected comparison.</p></main></body></html>
`;
}

export function renderNBodyPackingLocalizedChallengeHtml({
  payload,
  bindings,
  route = NBODY_PACKING_LOCALIZED_WITNESS_ROUTE,
}) {
  const defaultDisplay = {
    title:'Localized packing boundary · six bodies',
    authority:'Synthetic two-obstacle falsifier · no anatomical admission',
    explanation:'The carrier and solver are frozen. Severity 0.20 is the last passing continuation; 0.24 is the first solver stall. A one-coordinate search inside the same first/second-sine carrier finds a feasible neighbor, so this exact event is a <strong>globalization failure</strong>, not a representation failure.',
    orderedStates:[...STATE_KEYS],
    defaultState:'fail-crowded',
  };
  const display = { ...defaultDisplay, ...(payload.display || {}) };
  if (
    !Array.isArray(display.orderedStates) ||
    display.orderedStates.some(key => !Object.hasOwn(payload.states, key)) ||
    !display.orderedStates.includes(display.defaultState)
  ) throw new Error('localized witness display state order or default is invalid');
  const stateButtons = display.orderedStates.map(key =>
    `<button data-state="${escapeHtml(key)}">${escapeHtml(payload.states[key].label)}</button>`,
  ).join('');
  const serialized = JSON.stringify({ ...payload, display, route });
  return `<!doctype html>
<html lang="en" data-witness-loaded="false" data-witness-state="${escapeHtml(display.defaultState)}" data-witness-mode="volume" data-witness-route="${escapeHtml(route)}" data-fixtures-sha256="${bindings.fixturesSha256}" data-results-sha256="${bindings.resultsSha256}">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>N-body packing · localized pass/fail boundary</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;overflow:hidden;background:#07090d;color:#f5efe6}#viewport{position:fixed;inset:0}canvas{display:block;width:100%;height:100%}.panel{position:fixed;z-index:5;top:14px;left:14px;width:min(520px,calc(100vw - 28px));max-height:calc(100vh - 28px);overflow:auto;padding:14px 15px;border:1px solid #ffffff24;border-radius:14px;background:#0a1018ef;box-shadow:0 18px 70px #000b;backdrop-filter:blur(14px)}h1{margin:0 0 5px;font:650 18px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace}.authority{margin:0 0 7px;color:#e5b77d;font:700 10px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.07em;text-transform:uppercase}.explanation{margin:0 0 9px;color:#afbbc8;font-size:10px;line-height:1.42}.button-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:7px 0}button{padding:8px 6px;border:1px solid #ffffff24;border-radius:8px;color:#dce6f0;background:#111923;cursor:pointer;font:600 9px/1.1 ui-monospace,SFMono-Regular,Menlo,monospace}button[aria-pressed="true"]{color:#071016;background:#e7d1a8;border-color:#fff1d0}.modes{display:flex}.modes button{flex:1}.modes button[aria-pressed="true"]{background:#9fd7f1;border-color:#d6f3ff}.ledger{display:grid;grid-template-columns:1fr auto;gap:4px 10px;margin-top:10px;padding-top:9px;border-top:1px solid #ffffff1b;color:#c1ccd8;font:10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace}.ledger .head{color:#8998a7;text-transform:uppercase;font-size:8px;letter-spacing:.07em}.value{text-align:right}.good{color:#89deb5}.bad{color:#ff7188}.truth{margin:9px 0 0;padding:8px 9px;border-left:3px solid #65d9a6;background:#102d24b8;color:#baf1d8;font:10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}.truth.warning{border-left-color:#ff5b72;background:#33131ab8;color:#ffc2cc}.legend{display:flex;flex-wrap:wrap;gap:5px 10px;margin-top:9px;color:#aeb9c6;font-size:9px}.swatch{display:inline-block;width:8px;height:8px;margin-right:4px;border-radius:50%}.hint{position:fixed;right:14px;bottom:12px;z-index:4;padding:8px 11px;border-radius:9px;background:#080c12d4;color:#aeb8c4;font-size:10px}@media(max-width:700px){.panel{top:7px;left:7px;width:calc(100vw - 14px);padding:10px}.hint{display:none}}
  </style>
  <script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/"}}</script>
</head>
<body><div id="viewport"></div><section class="panel">
  <h1>${escapeHtml(display.title)}</h1>
  <p class="authority">${escapeHtml(display.authority)}</p>
  <p class="explanation">${display.explanation}</p>
  <div class="button-row states">${stateButtons}</div>
  <div class="button-row modes"><button data-mode="volume">transparent volume</button><button data-mode="slice">opaque slices</button></div>
  <div class="ledger"><span class="head">active state</span><span class="head value" id="active-label"></span><span>status</span><span class="value" id="status"></span><span>severity</span><span class="value" id="severity"></span><span>pairwise penetration</span><span class="value" id="pairwise"></span><span>skeletal penetration</span><span class="value" id="skeletal"></span><span>compartment escape</span><span class="value" id="compartment"></span><span>endpoint drift</span><span class="value" id="endpoint"></span><span>maximum volume error</span><span class="value" id="volume"></span><span>carrier DOF / member</span><span class="value">4 · frozen</span><span>oracle / graph in candidate</span><span class="value good">no / no</span></div>
  <p class="truth" id="truth"></p><div class="legend" id="legend"></div>
</section><div class="hint">drag to orbit · wheel to zoom · red = pair debt · magenta = bone or wall debt</div>
<script type="module">
import * as THREE from 'three';import{OrbitControls}from'three/addons/controls/OrbitControls.js';
const payload=${serialized},colors=[0xff6b6b,0xf5c451,0x4ddbd3,0xa78bfa,0x66a7ff,0xff8bd1],viewport=document.querySelector('#viewport');
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;renderer.setClearColor(0x07090d,1);viewport.append(renderer.domElement);
const scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0x07090d,.08);const camera=new THREE.PerspectiveCamera(38,1,.01,100);camera.position.set(3.1,2.25,3.25);const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,0,0);controls.enableDamping=true;controls.dampingFactor=.08;controls.minDistance=1.7;controls.maxDistance=7;scene.add(new THREE.HemisphereLight(0xcde3ff,0x241510,2.2));const key=new THREE.DirectionalLight(0xffead1,4);key.position.set(3,4,2);scene.add(key);const rim=new THREE.DirectionalLight(0x6e8fff,2.4);rim.position.set(-3,1,-4);scene.add(rim);
const mat=(color,opacity=1,depthWrite=opacity>=1)=>new THREE.MeshPhysicalMaterial({color,roughness:.38,metalness:.015,clearcoat:.18,transparent:opacity<1,opacity,depthWrite,side:THREE.DoubleSide});
function line(points,color){const geometry=new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p)));return new THREE.Line(geometry,new THREE.LineBasicMaterial({color}))}
function capsule(a,b,r,m){const s=new THREE.Vector3(...a),e=new THREE.Vector3(...b),d=e.clone().sub(s),mesh=new THREE.Mesh(new THREE.CapsuleGeometry(r,Math.max(.001,d.length()-r*2),8,20),m);mesh.position.copy(s).add(e).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return mesh}
function surface(centerline,m){const rs=24,v=[],ix=[];let prior=null;for(let k=0;k<centerline.length;k++){const knot=centerline[k],p=new THREE.Vector3(...knot.position),before=new THREE.Vector3(...centerline[Math.max(0,k-1)].position),after=new THREE.Vector3(...centerline[Math.min(centerline.length-1,k+1)].position),t=after.sub(before).normalize(),ref=Math.abs(t.y)<.9?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0),n=new THREE.Vector3().crossVectors(t,ref).normalize();if(prior&&n.dot(prior)<0)n.multiplyScalar(-1);const b=new THREE.Vector3().crossVectors(t,n).normalize();prior=n.clone();for(let r=0;r<rs;r++){const a=r/rs*Math.PI*2,q=p.clone().addScaledVector(n,Math.cos(a)*knot.radius).addScaledVector(b,Math.sin(a)*knot.radius);v.push(q.x,q.y,q.z)}}for(let k=0;k<centerline.length-1;k++)for(let r=0;r<rs;r++){const nr=(r+1)%rs,a=k*rs+r,b=k*rs+nr,c=(k+1)*rs+r,d=(k+1)*rs+nr;ix.push(a,c,b,b,c,d)}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(ix);g.computeVertexNormals();return new THREE.Mesh(g,m)}
function addMuscle(group,muscle,index,mode){if(mode==='volume'){group.add(surface(muscle.centerline,mat(colors[index],.42,false)));group.add(line(muscle.centerline.map(k=>k.position),colors[index]));for(const knot of [muscle.centerline[0],muscle.centerline.at(-1)]){const h=new THREE.Mesh(new THREE.SphereGeometry(.034,16,12),mat(0xf7f2e9,.98));h.position.set(...knot.position);group.add(h)}}else for(const ki of [2,3]){const knot=muscle.centerline[ki],disc=new THREE.Mesh(new THREE.CylinderGeometry(knot.radius,knot.radius,.05,48),mat(colors[index],1,true));disc.position.set(...knot.position);group.add(disc)}}
function closest(point,a,b){const p=new THREE.Vector3(...point),s=new THREE.Vector3(...a),e=new THREE.Vector3(...b),d=e.clone().sub(s),t=Math.max(0,Math.min(1,p.clone().sub(s).dot(d)/d.lengthSq()));return s.addScaledVector(d,t)}
const debtTolerance=1e-7;
function markers(group,muscles,source,emphasis=[]){for(let k=1;k<muscles[0].centerline.length-1;k++)for(let l=0;l<muscles.length;l++)for(let r=l+1;r<muscles.length;r++){const a=muscles[l].centerline[k],b=muscles[r].centerline[k],pen=a.radius+b.radius-Math.hypot(...a.position.map((v,i)=>v-b.position[i]));if(pen>debtTolerance){const m=new THREE.Mesh(new THREE.SphereGeometry(Math.min(.065,Math.max(.018,pen*.55)),20,14),new THREE.MeshBasicMaterial({color:0xff2947,depthTest:false}));m.position.set(...a.position.map((v,i)=>(v+b.position[i])*.5));m.renderOrder=20;group.add(m)}}for(const muscle of muscles)for(const knot of muscle.centerline){let debt=false;for(const obstacle of source.obstacles){const q=closest(knot.position,obstacle.start,obstacle.end);if(new THREE.Vector3(...knot.position).distanceTo(q)<knot.radius+obstacle.radius+(obstacle.clearance||0)-debtTolerance)debt=true}for(const axis of [0,2])if(knot.position[axis]-knot.radius<source.compartment.minimum[axis]+source.compartment.clearance-debtTolerance||knot.position[axis]+knot.radius>source.compartment.maximum[axis]-source.compartment.clearance+debtTolerance)debt=true;if(debt){const m=new THREE.Mesh(new THREE.SphereGeometry(.032,16,12),new THREE.MeshBasicMaterial({color:0xff4edc,depthTest:false}));m.position.set(...knot.position);m.renderOrder=21;group.add(m)}}for(const point of emphasis){const m=new THREE.Mesh(new THREE.SphereGeometry(.036,20,14),new THREE.MeshBasicMaterial({color:0xff1739,depthTest:false}));m.position.set(...point);m.renderOrder=30;group.add(m)}}
const groups={};for(const[key,state]of Object.entries(payload.states)){const volume=new THREE.Group(),slice=new THREE.Group(),debt=new THREE.Group();state.muscles.forEach((m,i)=>{addMuscle(volume,m,i,'volume');addMuscle(slice,m,i,'slice')});markers(debt,state.muscles,state.source,state.emphasisMarkers);scene.add(volume,slice,debt);groups[key]={volume,slice,debt,state}}
const env=new THREE.Group(),source=payload.environment,size=source.compartment.maximum.map((v,i)=>v-source.compartment.minimum[i]),center=source.compartment.maximum.map((v,i)=>(v+source.compartment.minimum[i])*.5),box=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(...size)),new THREE.LineDashedMaterial({color:0x86a6c8,transparent:true,opacity:.32,dashSize:.05,gapSize:.035}));box.computeLineDistances();box.position.set(...center);env.add(box);for(const o of source.obstacles)env.add(capsule(o.start,o.end,o.radius,mat(0xcbd8e4,.94)));scene.add(env);
let activeState=payload.display.defaultState,activeMode='volume';const fmt=v=>Number.isFinite(v)?(Math.abs(v)<1e-6?v.toExponential(2):v.toFixed(6)):'—';function show(){for(const[k,g]of Object.entries(groups)){const active=k===activeState;g.volume.visible=active&&activeMode==='volume';g.slice.visible=active&&activeMode==='slice';g.debt.visible=active}const s=payload.states[activeState],m=s.metrics||{};document.querySelector('#active-label').textContent=s.label;document.querySelector('#status').textContent=s.status;document.querySelector('#status').className='value '+(s.warning?'bad':'good');document.querySelector('#severity').textContent=s.severity??'reference';for(const[id,key]of[['pairwise','pairwisePenetration'],['skeletal','skeletalPenetration'],['compartment','compartmentEscape'],['endpoint','endpointDrift'],['volume','maximumRelativeVolumeError']])document.querySelector('#'+id).textContent=fmt(m[key]);const truth=document.querySelector('#truth');truth.textContent=s.truth;truth.classList.toggle('warning',!!s.warning);document.querySelectorAll('[data-state]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.state===activeState)));document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===activeMode)));document.documentElement.dataset.witnessState=activeState;document.documentElement.dataset.witnessMode=activeMode;document.querySelector('#legend').innerHTML=s.muscles.map((x,i)=>'<span><i class="swatch" style="background:#'+colors[i].toString(16).padStart(6,'0')+'"></i>'+x.id+'</span>').join('')}
document.querySelectorAll('[data-state]').forEach(b=>b.addEventListener('click',()=>{activeState=b.dataset.state;show()}));document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{activeMode=b.dataset.mode;show()}));const params=new URLSearchParams(location.search);if(payload.display.orderedStates.includes(params.get('state')))activeState=params.get('state');if(['volume','slice'].includes(params.get('mode')))activeMode=params.get('mode');function resize(){const w=Math.max(1,viewport.clientWidth),h=Math.max(1,viewport.clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}new ResizeObserver(resize).observe(viewport);resize();show();renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera)});document.documentElement.dataset.witnessLoaded='true';
</script></body></html>`;
}

export async function writeNBodyPackingLocalizedChallengeWitness({
  outDir = 'artifacts/nbody-packing-localized-challenge-v0',
  challengeResultPath = path.join(outDir, 'results.json'),
} = {}) {
  const outputRoot = path.resolve(outDir);
  let phase = 'read-challenge-result';
  let lastTrustworthyEvidence = { phase:'none' };
  await mkdir(outputRoot, { recursive:true });
  try {
    const challengeBytes = await readFile(path.resolve(challengeResultPath));
    const challenge = JSON.parse(String(challengeBytes));
    if (
      challenge.schema !== LOCALIZED_CHALLENGE_RESULT_SCHEMA ||
      challenge.status !== 'complete-boundary-found' ||
      !challenge.bracket?.lastPass || !challenge.bracket?.firstFail
    ) throw new Error('localized witness requires one complete last-pass/first-fail challenge result');
    lastTrustworthyEvidence = { phase:'challenge-result-read', challengeSha256:sha256(challengeBytes) };
    phase = 'bind-fixtures';
    const suite = createNBodyLocalizedChallengeSuite();
    const passFixture = suite.find(row => row.identity.sha256 === challenge.bracket.lastPass.fixtureSha256);
    const failFixture = suite.find(row => row.identity.sha256 === challenge.bracket.firstFail.fixtureSha256);
    const passRow = challenge.rows.find(row => row.fixtureSha256 === passFixture?.identity.sha256);
    const failRow = challenge.rows.find(row => row.fixtureSha256 === failFixture?.identity.sha256);
    if (!passFixture || !failFixture || !passRow || !failRow) {
      throw new Error('localized witness rejects substituted bracket fixture identity');
    }
    phase = 'classify-same-basis';
    const failProblem = compileNBodyAdaptiveKktProblem(failFixture);
    const oracle = classifyNBodyLocalizedSameBasisOracle({
      problem:failProblem,
      startVector:failRow.result.selected.vector,
      convergenceTolerance:1e-7,
      stepSchedule:[0.01],
      translationBounds:createNBodyAdaptiveKktConfig().translationBounds,
    });
    if (oracle.status !== 'same-basis-feasible-globalization-failure') {
      throw new Error('localized witness requires a feasible same-basis globalization counterexample');
    }
    lastTrustworthyEvidence = { ...lastTrustworthyEvidence, phase:'same-basis-classified', oracleSha256:oracle.identity.sha256 };
    phase = 'write-primary';
    const fixtures = { lastPass:passFixture, firstFail:failFixture };
    const comparison = { challenge, oracle };
    const fixtureBytes = jsonBytes(fixtures);
    const comparisonBytes = jsonBytes(comparison);
    const bindings = { fixturesSha256:sha256(fixtureBytes), resultsSha256:sha256(comparisonBytes) };
    const failedLeft = failRow.result.selected.muscles.find(row => row.id === 'density-06-00');
    const failedRight = failRow.result.selected.muscles.find(row => row.id === 'density-06-05');
    const failedPairMarker = failedLeft.centerline[2].position.map(
      (value, axis) => (value + failedRight.centerline[2].position[axis]) / 2,
    );
    const states = {
      'pass-crowded':{ label:'0.20 crowded input', severity:0.2, status:'input', warning:true, source:passFixture.crowded, muscles:passFixture.crowded.muscles, metrics:passFixture.metrics.crowded, truth:'Crowded input: localized pair, bone, or wall debt is deliberately visible before negotiation.' },
      'last-pass':{ label:'0.20 last pass', severity:0.2, status:passRow.result.status, warning:false, source:passFixture.crowded, muscles:passRow.result.selected.muscles, metrics:passRow.result.selected.metrics, truth:'Last pass: the frozen solver clears every hard residual at severity 0.20.' },
      'fail-crowded':{ label:'0.24 crowded input', severity:0.24, status:'input', warning:true, source:failFixture.crowded, muscles:failFixture.crowded.muscles, metrics:failFixture.metrics.crowded, truth:'First-fail input: the same localized pattern is continued to severity 0.24.' },
      'first-fail':{ label:'0.24 first fail', severity:0.24, status:failRow.result.status, warning:true, source:failFixture.crowded, muscles:failRow.result.selected.muscles, metrics:failRow.result.selected.metrics, emphasisMarkers:[failedPairMarker], truth:'Failure evidence, not packed output: one red pair contact remains after the line search stalls.' },
      'same-basis-feasible':{ label:'0.24 same-basis feasible', severity:0.24, status:oracle.status, warning:false, source:failFixture.crowded, muscles:oracle.selected.muscles, metrics:oracle.selected.metrics, truth:'A −0.01 change at coordinate 20 clears all debt in the same carrier. This proves globalization failure, not representation failure.' },
      reference:{ label:'Manufactured reference', severity:null, status:'existence witness', warning:false, source:failFixture.knownFeasible, muscles:failFixture.knownFeasible.muscles, metrics:failFixture.metrics.knownFeasible, truth:'Manufactured reference establishes fixture feasibility but is not candidate or oracle input.' },
    };
    const payload = { states, environment:{ compartment:failFixture.knownFeasible.compartment, obstacles:failFixture.knownFeasible.obstacles } };
    const htmlBytes = Buffer.from(renderNBodyPackingLocalizedChallengeHtml({ payload, bindings }));
    const reportCore = {
      schema:NBODY_PACKING_LOCALIZED_WITNESS_SCHEMA,
      status:'complete-pending-agent-visual-inspection',
      route:{ requested:NBODY_PACKING_LOCALIZED_WITNESS_ROUTE, effective:NBODY_PACKING_LOCALIZED_WITNESS_ROUTE, fallbackUsed:false },
      bracket:structuredClone(challenge.bracket),
      classification:{ status:oracle.status, oracleSha256:oracle.identity.sha256, coordinateIndex:oracle.selected.coordinateIndex, delta:oracle.selected.delta },
      bindings:{ ...bindings, indexHtmlSha256:sha256(htmlBytes), challengeResultSha256:sha256(challengeBytes) },
      requiredStates:[...STATE_KEYS],
      requiredModes:['volume','slice'],
      claimCeiling:{ admittedClaim:'the first observed 0.24 stall is a globalization failure because a feasible state exists in the identical 24-variable carrier', anatomicalAdmission:'none', nonGoals:['representation-limit-localization','arbitrary-N-closure','anatomical-plausibility','performance','optimality'] },
    };
    const report = { ...reportCore, identity:{ sha256:sha256(jsonBytes(reportCore)) } };
    await Promise.all([
      writeAtomically(path.join(outputRoot, 'fixtures.json'), fixtureBytes),
      writeAtomically(path.join(outputRoot, 'comparison.json'), comparisonBytes),
      writeAtomically(path.join(outputRoot, 'index.html'), htmlBytes),
      writeAtomically(path.join(outputRoot, 'report.json'), jsonBytes(report)),
    ]);
    return { outputRoot, report, fixtures, challenge, oracle };
  } catch (error) {
    const failure = { schema:NBODY_PACKING_LOCALIZED_WITNESS_SCHEMA, status:'failed', route:{ requested:NBODY_PACKING_LOCALIZED_WITNESS_ROUTE, effective:null, fallbackUsed:false }, failurePhase:phase, lastTrustworthyEvidence, error:{ name:error.name, message:error.message } };
    await writeAtomically(path.join(outputRoot, 'report.json'), jsonBytes(failure));
    throw error;
  }
}

export function validateNBodyPackingLocalizedCaptureBinding({
  captureReport,
  state,
  mode,
  report,
  pngSha256,
}) {
  const witnessRoute = report.route?.effective || NBODY_PACKING_LOCALIZED_WITNESS_ROUTE;
  const expectedDataset = {
    witnessLoaded:'true',
    witnessState:state,
    witnessMode:mode,
    witnessRoute,
    fixturesSha256:report.bindings.fixturesSha256,
    resultsSha256:report.bindings.resultsSha256,
  };
  if (
    captureReport.status !== 'complete' ||
    captureReport.route?.effective !== 'independent-headless-screenshot-v0' ||
    captureReport.route?.fallbackUsed !== false ||
    captureReport.browser?.effective?.installedStableChrome !== false ||
    captureReport.browser?.effective?.kind !== 'playwright-chromium-headless-shell' ||
    captureReport.process?.cleanup?.status !== 'complete-no-process-group-remains' ||
    captureReport.process?.profileCleanup?.status !== 'complete-removed' ||
    JSON.stringify(captureReport.domReceipt?.dataset) !== JSON.stringify(expectedDataset) ||
    captureReport.sourceDocument?.status !== 'complete' ||
    captureReport.sourceDocument?.sha256 !== report.bindings.indexHtmlSha256 ||
    captureReport.primaryOutput?.sha256 !== pngSha256
  ) throw new Error('localized capture binding rejects stale or substituted evidence');
  return expectedDataset;
}

export async function admitNBodyPackingLocalizedVisualInspection({
  outDir = 'artifacts/nbody-packing-localized-challenge-v0',
  inspection,
} = {}) {
  const outputRoot = path.resolve(outDir);
  const reportPath = path.join(outputRoot, 'report.json');
  const report = JSON.parse(String(await readFile(reportPath)));
  const verdictKeys = report.route?.effective === NBODY_PACKING_RESTORATION_WITNESS_ROUTE
    ? RESTORATION_VISUAL_VERDICT_KEYS
    : report.route?.effective === NBODY_PACKING_LOCALIZED_HARD_WITNESS_ROUTE
      ? HARD_BOUNDARY_VISUAL_VERDICT_KEYS
      : VISUAL_VERDICT_KEYS;
  if (
    typeof inspection?.observedAt !== 'string' || !inspection.observedAt ||
    typeof inspection?.summary !== 'string' || !inspection.summary ||
    JSON.stringify(Object.keys(inspection.verdict || {}).sort()) !==
      JSON.stringify([...verdictKeys].sort()) ||
    verdictKeys.some(key => inspection.verdict[key] !== true)
  ) throw new Error('localized visual admission requires exact all-positive agent verdict');
  if (
    report.schema !== NBODY_PACKING_LOCALIZED_WITNESS_SCHEMA ||
    report.status !== 'complete-pending-agent-visual-inspection' ||
    ![
      NBODY_PACKING_LOCALIZED_WITNESS_ROUTE,
      NBODY_PACKING_LOCALIZED_HARD_WITNESS_ROUTE,
      NBODY_PACKING_RESTORATION_WITNESS_ROUTE,
    ].includes(report.route?.effective) ||
    report.route?.fallbackUsed !== false
  ) throw new Error('localized visual admission requires exact pending witness');
  for (const [filename, binding] of [
    ['fixtures.json','fixturesSha256'],
    ['comparison.json','resultsSha256'],
    ['index.html','indexHtmlSha256'],
  ]) {
    if (sha256(await readFile(path.join(outputRoot, filename))) !== report.bindings[binding]) {
      throw new Error(`localized visual admission rejects stale ${filename}`);
    }
  }
  const captures = [];
  for (const state of report.requiredStates) for (const mode of report.requiredModes) {
    const stem = `${state}-${mode}`;
    const pngBytes = await readFile(path.join(outputRoot, `${stem}.png`));
    const captureReportBytes = await readFile(path.join(outputRoot, `${stem}-capture-report.json`));
    const captureReport = JSON.parse(String(captureReportBytes));
    validateReceiptBearingPng(pngBytes, { width:1400, height:900 });
    const dataset = validateNBodyPackingLocalizedCaptureBinding({
      captureReport, state, mode, report, pngSha256:sha256(pngBytes),
    });
    captures.push({
      state, mode, png:`${stem}.png`, pngSha256:sha256(pngBytes),
      captureReport:`${stem}-capture-report.json`,
      captureReportSha256:sha256(captureReportBytes), dataset,
    });
  }
  if (new Set(captures.map(row => row.pngSha256)).size !== captures.length) {
    throw new Error('localized visual admission rejects duplicate state pixels');
  }
  const receiptCore = {
    schema:'kaminos.nbody-packing-localized-visual-inspection.v0',
    status:'passed-agent-inspection',
    observedAt:inspection.observedAt,
    summary:inspection.summary,
    verdict:structuredClone(inspection.verdict),
    route:structuredClone(report.route),
    captures,
    claimCeiling:structuredClone(report.claimCeiling),
  };
  const receipt = { ...receiptCore, identity:{ sha256:sha256(jsonBytes(receiptCore)) } };
  const receiptBytes = jsonBytes(receipt);
  await writeAtomically(path.join(outputRoot, 'visual-inspection.json'), receiptBytes);
  const updatedCore = {
    ...report,
    status:'complete-agent-visual-inspected',
    visualInspection:{
      status:'passed-agent-inspection', artifact:'visual-inspection.json',
      receiptSha256:sha256(receiptBytes), captureCount:captures.length,
    },
    bindings:{
      ...report.bindings,
      visualInspectionSha256:sha256(receiptBytes),
      captureReceiptSetSha256:sha256(jsonBytes(captures)),
    },
  };
  delete updatedCore.identity;
  const updated = { ...updatedCore, identity:{ sha256:sha256(jsonBytes(updatedCore)) } };
  await writeAtomically(reportPath, jsonBytes(updated));
  return { report:updated, receipt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const outDir = process.argv[2] || 'artifacts/nbody-packing-localized-challenge-v0';
  const result = await writeNBodyPackingLocalizedChallengeWitness({ outDir });
  process.stdout.write(`${JSON.stringify({ outputRoot:result.outputRoot, report:result.report }, null, 2)}\n`);
}
