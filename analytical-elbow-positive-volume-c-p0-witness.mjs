#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createShapeBearingCollarWitnessDataset } from './analytical-elbow-collar-assay-core.mjs';
import { createAnalyticalElbowCP0Bundle } from './analytical-elbow-positive-volume-c-p0-core.mjs';
import { createAnalyticalElbowWToP0Input } from './analytical-elbow-positive-volume-w-to-p0-core.mjs';
import {
  createAnalyticalElbowConsumerExport,
  createAnalyticalElbowDescriptor,
} from './analytical-elbow-core.mjs';

export const C_P0_WITNESS_ROUTE =
  'analytical-elbow-positive-volume-c-p0-witness';

const DATA_SCHEMA =
  'kaminos.analytical-elbow-positive-volume-c-p0-witness-data.v0';
const REPORT_SCHEMA =
  'kaminos.analytical-elbow-positive-volume-c-p0-witness-report.v0';
const DEFAULT_BUNDLE_PATH =
  'artifacts/analytical-elbow-positive-volume-c-p0-v0/c-p0.json';
const DEFAULT_IO = Object.freeze({ mkdir, readFile, rename, writeFile });

function subtract(left, right) {
  return left.map((value, index) => value - right[index]);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(left, right) {
  return left.reduce((total, value, index) => total + value * right[index], 0);
}

function length(vector) {
  return Math.sqrt(dot(vector, vector));
}

function triangleArea(vertices, indices, field) {
  const [left, middle, right] = indices.map(index => vertices[index][field]);
  return length(cross(subtract(middle, left), subtract(right, left))) / 2;
}

function edgeStrain(vertices, leftIndex, rightIndex) {
  const left = vertices[leftIndex];
  const right = vertices[rightIndex];
  const rest = length(subtract(left.rest, right.rest));
  const posed = length(subtract(left.posed, right.posed));
  return Math.abs(Math.log(posed / rest));
}

function triangleEvidence(vertices, triangle) {
  const indices = triangle.vertexIndices ?? triangle.indices;
  const restArea = triangleArea(vertices, indices, 'rest');
  const posedArea = triangleArea(vertices, indices, 'posed');
  const restNormal = cross(
    subtract(vertices[indices[1]].rest, vertices[indices[0]].rest),
    subtract(vertices[indices[2]].rest, vertices[indices[0]].rest),
  );
  const posedNormal = cross(
    subtract(vertices[indices[1]].posed, vertices[indices[0]].posed),
    subtract(vertices[indices[2]].posed, vertices[indices[0]].posed),
  );
  const strains = [
    edgeStrain(vertices, indices[0], indices[1]),
    edgeStrain(vertices, indices[1], indices[2]),
    edgeStrain(vertices, indices[2], indices[0]),
  ];
  return {
    id: triangle.id,
    index: triangle.index,
    indices:[...indices],
    maximumAbsoluteLogEdgeStrain:Math.max(...strains),
    absoluteLogAreaStrain:Math.abs(Math.log(posedArea / restArea)),
    inverted:dot(restNormal, posedNormal) < 0,
  };
}

function applyEmbedding(entry, positions) {
  const position = [0, 0, 0];
  entry.nodeIds.forEach((nodeId, index) => {
    const node = positions.get(nodeId);
    if (!node) throw new Error(`missing posed cage node ${nodeId}`);
    for (let axis = 0; axis < 3; axis += 1) {
      position[axis] += node[axis] * entry.weights[index];
    }
  });
  return position;
}

function exactScalarControl() {
  const source = createAnalyticalElbowConsumerExport(
    createAnalyticalElbowDescriptor(),
    { flexionDegrees:[0, 35, 80] },
  );
  const dataset = createShapeBearingCollarWitnessDataset({ source });
  const entry = dataset.cases.find(candidate =>
    candidate.flexionDegrees === 35 && candidate.collarHalfWidth === 0.72
  );
  if (!entry) throw new Error('frozen scalar 35-degree collar control is missing');
  return { dataset, entry };
}

function validateBundle(bundle) {
  const report = bundle?.report;
  if (bundle?.schema !== 'kaminos.analytical-elbow-positive-volume-c-p0-bundle.v0' ||
      bundle.status !== 'complete' || report?.status !== 'C_P0_COMPLETE' ||
      report.requestedRoute !== 'analytical-elbow-positive-volume-c-p0' ||
      report.effectiveRoute !== report.requestedRoute ||
      report.fallbackUsed !== false) {
    throw new Error('canonical C(P0) route identity is required');
  }
  if (report.controlComparison?.status !== 'NUMERICAL_CANDIDATE' ||
      !report.controlComparison.candidateRuns?.includes('w-derived')) {
    throw new Error('reviewed W-derived C(P0) numerical candidate is required');
  }
  const run = report.runs.find(candidate => candidate.initialization === 'w-derived');
  const hardVetoes = Object.values(run?.hardVetoes ?? {});
  if (!run?.finalGeometry?.posedNodes || hardVetoes.length === 0 ||
      !hardVetoes.every(veto => veto?.pass === true)) {
    throw new Error('hard-valid W-derived C(P0) final geometry is required');
  }
  return run;
}

export function createAnalyticalElbowCP0WitnessDataset({
  bundle = createAnalyticalElbowCP0Bundle(),
} = {}) {
  const run = validateBundle(bundle);
  const predecessor = createAnalyticalElbowWToP0Input();
  const { dataset:controlDataset, entry:control } = exactScalarControl();
  const source = predecessor.rowWInput.source;
  if (source.vertices.length !== control.vertices.length ||
      source.triangles.length !== control.triangles.length) {
    throw new Error('candidate and frozen control topology identity mismatch');
  }

  const positions = new Map(
    run.finalGeometry.posedNodes.map(node => [node.id, node.position]),
  );
  const embedding = new Map(
    predecessor.cageManifest.embedding.map(entry => [entry.surfaceVertexId, entry]),
  );
  const candidateVertices = source.vertices.map((vertex, index) => ({
    id:vertex.id,
    index:vertex.index,
    region:vertex.region,
    rest:[...vertex.rest],
    posed:embedding.has(vertex.id)
      ? applyEmbedding(embedding.get(vertex.id), positions)
      : [...predecessor.rowWInput.construction.posedVertices[index].position],
  }));
  const candidateTriangles = source.triangles.map(triangle =>
    triangleEvidence(candidateVertices, triangle)
  );

  return {
    schema:DATA_SCHEMA,
    status:'complete',
    requestedRoute:C_P0_WITNESS_ROUTE,
    effectiveRoute:C_P0_WITNESS_ROUTE,
    fallbackUsed:false,
    source:{
      id:source.id,
      semanticHash:source.semanticHash,
      candidateRoute:bundle.report.effectiveRoute,
      scalarControlRoute:controlDataset.effectiveRoute,
    },
    comparison:{
      status:bundle.report.controlComparison.status,
      candidateInitialization:'w-derived',
      candidateQ95AbsoluteLogEdgeStrain:run.comparison.q95AbsoluteLogEdgeStrain,
      scalarControlQ95AbsoluteLogEdgeStrain:
        run.comparison.scalarControlQ95AbsoluteLogEdgeStrain,
      improvement:
        run.comparison.scalarControlQ95AbsoluteLogEdgeStrain -
        run.comparison.q95AbsoluteLogEdgeStrain,
    },
    cases:[
      {
        id:'scalar-control-35-collar-0.72',
        label:'Scalar 0.72 control',
        classification:'REJECTED_SCALAR_CONTROL',
        vertices:control.vertices.map(vertex => ({
          id:vertex.id,
          index:vertex.index,
          region:vertex.region,
          rest:[...vertex.rest],
          posed:[...vertex.posed],
        })),
        triangles:control.triangles.map(triangle => ({
          id:triangle.id,
          index:triangle.index,
          indices:[...triangle.indices],
          maximumAbsoluteLogEdgeStrain:triangle.maximumAbsoluteLogEdgeStrain,
          absoluteLogAreaStrain:triangle.absoluteLogAreaStrain,
          inverted:triangle.inverted,
        })),
        q95AbsoluteLogEdgeStrain:run.comparison.scalarControlQ95AbsoluteLogEdgeStrain,
      },
      {
        id:'c-p0-w-derived-35',
        label:'W-seeded P0 candidate',
        classification:'NUMERICAL_CANDIDATE',
        vertices:candidateVertices,
        triangles:candidateTriangles,
        q95AbsoluteLogEdgeStrain:run.comparison.q95AbsoluteLogEdgeStrain,
      },
    ],
    visualContract:{
      startsPaused:true,
      animationActive:false,
      cameraPresets:['profile', 'three-quarter'],
      heatThresholdLogStrain:Math.log(1.15),
      decisionPredicate:
        'candidate retains authored transition shape without flattening, pinching, or erasure',
    },
    claimCeiling:
      'visual consumer candidate on one synthetic 35-degree sleeve; no transfer, anatomy, production, or product claim',
  };
}

function jsonForHtml(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function renderHtml(dataset) {
  return `<!doctype html>
<html lang="en" data-witness-route="${C_P0_WITNESS_ROUTE}" data-witness-loaded="false">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Positive-volume C(P0) visual witness</title>
  <style>
    :root{color-scheme:dark;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#111513;color:#eef2ed}*{box-sizing:border-box}body{margin:0;min-width:320px;background:#111513}header{display:grid;grid-template-columns:minmax(260px,1fr) auto;gap:18px;align-items:center;padding:13px 18px;border-bottom:1px solid #414b45;background:#151b17}h1{margin:0;font:650 17px/1.2 ui-sans-serif,system-ui,sans-serif;letter-spacing:0}.claim{margin:4px 0 0;color:#c7a960;font-size:10px;line-height:1.4}.toolbar{display:flex;gap:8px}.control{display:flex;gap:2px;padding:2px;border:1px solid #475249;border-radius:5px;background:#101411}button{min-width:38px;min-height:30px;padding:6px 9px;border:0;border-radius:3px;background:transparent;color:#cbd3cd;font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;cursor:pointer}button[aria-pressed=true]{background:#d4b65e;color:#171a17}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:#39413c}article{min-width:0;background:#111513}.cell-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:10px 12px;border-bottom:1px solid #303833}h2{margin:0;font:650 12px/1.2 ui-sans-serif,system-ui,sans-serif;letter-spacing:0}.metric{color:#aeb8b1;font-size:9px;white-space:nowrap}.viewport{position:relative;aspect-ratio:16/9;min-height:300px;overflow:hidden;background:#0d100e}canvas{display:block;width:100%;height:100%;touch-action:none}.regions{position:absolute;left:10px;bottom:9px;display:flex;gap:11px;pointer-events:none;font-size:9px;text-shadow:0 1px 2px #000}.regions span:before{content:'';display:inline-block;width:8px;height:8px;margin-right:5px;border-radius:50%;vertical-align:-1px;background:var(--swatch)}.identity{padding:9px 12px;border-top:1px solid #303833;color:#8f9b93;font-size:9px;line-height:1.5;overflow-wrap:anywhere}.decision{padding:11px 18px;border-top:1px solid #414b45;color:#cbd3cd;font-size:10px}.legend{display:grid;grid-template-columns:auto minmax(120px,360px) auto;gap:9px;align-items:center;margin-top:7px}.ramp{height:9px;border:1px solid #5c665f;background:linear-gradient(90deg,#248e8a,#d5bd4d 50%,#ef6a43 75%,#d92967)}@media(max-width:760px){header{grid-template-columns:1fr}.toolbar{justify-content:flex-start}.grid{grid-template-columns:1fr}.cell-head{grid-template-columns:1fr;gap:4px}.viewport{min-height:0;aspect-ratio:4/3}.metric{white-space:normal}}
  </style>
  <script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.171.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.171.0/examples/jsm/"}}</script>
</head>
<body><main>
  <header><div><h1>Positive-volume cage · visual admission</h1><p class="claim">Exact 35° synthetic sleeve · scalar control versus W-seeded P0 · paused</p></div><div class="toolbar"><div class="control"><button data-camera="profile" aria-pressed="true">Profile</button><button data-camera="three-quarter" aria-pressed="false">3/4</button></div><div class="control"><button data-toggle="regions" aria-pressed="true">Regions</button><button data-toggle="wireframe" aria-pressed="false">Wire</button><button data-toggle="rest" aria-pressed="false">Rest</button></div></div></header>
  <section class="grid">${dataset.cases.map((entry,index)=>`<article data-case="${entry.id}"><div class="cell-head"><h2>${entry.label}</h2><div class="metric">q95 ${(Math.expm1(entry.q95AbsoluteLogEdgeStrain)*100).toFixed(1)}% · ${entry.classification}</div></div><div class="viewport" data-viewport="${index}"><div class="regions"><span style="--swatch:#52d6c5">parent rigid</span><span style="--swatch:#f0c84b">collar</span><span style="--swatch:#6ea4ff">child rigid</span></div></div><div class="identity">requested ${C_P0_WITNESS_ROUTE} · effective ${C_P0_WITNESS_ROUTE} · source ${dataset.source.id}</div></article>`).join('')}</section>
  <div class="decision">${dataset.visualContract.decisionPredicate}<div class="legend"><strong>low strain</strong><div class="ramp"></div><strong>high strain</strong></div></div>
</main><script id="c-p0-witness-data" type="application/json">${jsonForHtml(dataset)}</script>
<script type="module">
import * as THREE from 'three'; import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
const data=JSON.parse(document.querySelector('#c-p0-witness-data').textContent); const params=new URLSearchParams(location.search); let cameraPreset=data.visualContract.cameraPresets.includes(params.get('camera'))?params.get('camera'):'profile'; const overlays={regions:params.get('regions')!=='0',wireframe:params.get('wire')==='1',rest:params.get('rest')==='1'}; const panels=[];
window.__KAMINOS_C_P0_WITNESS__={status:'loading',paused:true,animationActive:false,requestedRoute:data.requestedRoute,effectiveRoute:data.effectiveRoute,fallbackUsed:data.fallbackUsed,cameraPreset,overlays:{...overlays},panels:[]};
function heat(v,inverted){if(inverted)return new THREE.Color(0xd92967);const t=Math.min(1,v/(data.visualContract.heatThresholdLogStrain*2.2));const stops=[[0,0x248e8a],[.5,0xd5bd4d],[.75,0xef6a43],[1,0xd92967]];for(let i=1;i<stops.length;i++){if(t<=stops[i][0])return new THREE.Color(stops[i-1][1]).lerp(new THREE.Color(stops[i][1]),(t-stops[i-1][0])/(stops[i][0]-stops[i-1][0]));}return new THREE.Color(stops.at(-1)[1]);}
function surface(entry,field,options={}){const positions=[],colors=[];for(const triangle of entry.triangles){const color=field==='posed'?heat(triangle.maximumAbsoluteLogEdgeStrain,triangle.inverted):new THREE.Color(0xc8d0ca);for(const index of triangle.indices){positions.push(...entry.vertices[index][field]);colors.push(color.r,color.g,color.b);}}const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();return new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.68,side:THREE.DoubleSide,...options}));}
function camera(panel){panel.camera.position.set(...(cameraPreset==='profile'?[0,0,5.2]:[3.5,1.8,4.2]));panel.controls.target.set(0,.08,0);panel.controls.update();}
function render(panel){panel.renderer.render(panel.scene,panel.camera);panel.drawCount++;window.__KAMINOS_C_P0_WITNESS__.panels[panel.index].drawCount=panel.drawCount;}
data.cases.forEach((entry,index)=>{const viewport=document.querySelector('[data-viewport="'+index+'"]');const scene=new THREE.Scene();scene.background=new THREE.Color(0x0d100e);const cameraObject=new THREE.PerspectiveCamera(32,1,.01,30);const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;viewport.prepend(renderer.domElement);scene.add(new THREE.HemisphereLight(0xf4ead8,0x202a25,2.3));const key=new THREE.DirectionalLight(0xffe2b0,3.2);key.position.set(3,4.5,4);scene.add(key);const posed=surface(entry,'posed');scene.add(posed);const wire=surface(entry,'posed',{wireframe:true,color:0xffffff,vertexColors:false,transparent:true,opacity:.36});wire.visible=overlays.wireframe;scene.add(wire);const rest=surface(entry,'rest',{wireframe:true,color:0x91a69a,vertexColors:false,transparent:true,opacity:.28});rest.visible=overlays.rest;scene.add(rest);const controls=new OrbitControls(cameraObject,renderer.domElement);controls.enableDamping=false;controls.addEventListener('change',()=>render(panel));const panel={index,viewport,scene,camera:cameraObject,renderer,controls,wire,rest,drawCount:0};panels.push(panel);window.__KAMINOS_C_P0_WITNESS__.panels.push({id:entry.id,vertexCount:entry.vertices.length,triangleCount:entry.triangles.length,drawCount:0});camera(panel);const resize=()=>{const width=Math.max(1,viewport.clientWidth),height=Math.max(1,viewport.clientHeight);renderer.setSize(width,height,false);cameraObject.aspect=width/height;cameraObject.updateProjectionMatrix();render(panel)};new ResizeObserver(resize).observe(viewport);resize();});
function sync(){document.querySelectorAll('[data-camera]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.camera===cameraPreset)));document.querySelectorAll('[data-toggle]').forEach(button=>button.setAttribute('aria-pressed',String(overlays[button.dataset.toggle])));document.querySelectorAll('.regions').forEach(node=>node.style.display=overlays.regions?'flex':'none');for(const panel of panels){panel.wire.visible=overlays.wireframe;panel.rest.visible=overlays.rest;camera(panel);render(panel);}window.__KAMINOS_C_P0_WITNESS__.cameraPreset=cameraPreset;window.__KAMINOS_C_P0_WITNESS__.overlays={...overlays};}
document.querySelectorAll('[data-camera]').forEach(button=>button.addEventListener('click',()=>{cameraPreset=button.dataset.camera;sync()}));document.querySelectorAll('[data-toggle]').forEach(button=>button.addEventListener('click',()=>{overlays[button.dataset.toggle]=!overlays[button.dataset.toggle];sync()}));sync();document.documentElement.dataset.witnessLoaded='true';window.__KAMINOS_C_P0_WITNESS__.status='complete';
</script></body></html>`;
}

async function writeJsonAtomically(io, path, value) {
  const temporaryPath = `${path}.tmp`;
  await io.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await io.rename(temporaryPath, path);
}

export async function writeAnalyticalElbowCP0Witness({
  outDir,
  bundle = null,
  bundlePath = DEFAULT_BUNDLE_PATH,
  io = DEFAULT_IO,
} = {}) {
  const target = resolve(outDir ?? 'artifacts/analytical-elbow-positive-volume-c-p0-witness-v0');
  await io.mkdir(target, { recursive:true });
  let effectiveBundle = bundle;
  let candidateArtifactSha256 = null;
  try {
    if (effectiveBundle === null) {
      const bytes = await io.readFile(resolve(bundlePath));
      candidateArtifactSha256 = createHash('sha256').update(bytes).digest('hex');
      effectiveBundle = JSON.parse(bytes.toString('utf8'));
    }
    const dataset = createAnalyticalElbowCP0WitnessDataset({ bundle:effectiveBundle });
    const report = {
      schema:REPORT_SCHEMA,
      status:'complete',
      failurePhase:null,
      route:{ requested:dataset.requestedRoute, effective:dataset.effectiveRoute, fallbackUsed:false },
      source:{
        ...dataset.source,
        candidateArtifactPath:bundle === null ? bundlePath : null,
        candidateArtifactSha256,
      },
      comparison:dataset.comparison,
      visualContract:dataset.visualContract,
      primaryOutput:'analytical-elbow-positive-volume-c-p0-witness-v0',
      claimCeiling:dataset.claimCeiling,
    };
    await writeJsonAtomically(io, `${target}/dataset.json`, dataset);
    await io.writeFile(`${target}/index.html`, renderHtml(dataset));
    await writeJsonAtomically(io, `${target}/report.json`, report);
    return { dataset, report, outDir:target };
  } catch (error) {
    const report = {
      schema:REPORT_SCHEMA,
      status:'failed',
      failurePhase:'create-exact-dataset',
      lastTrustworthyEvidence:error.message,
      route:{
        requested:C_P0_WITNESS_ROUTE,
        effective:null,
        fallbackUsed:effectiveBundle?.report?.fallbackUsed ?? null,
      },
      primaryOutput:null,
      error:{ code:'c-p0-witness-failed', message:error.message },
      claimCeiling:'failed visual witness; no visual or composition claim',
    };
    await writeJsonAtomically(io, `${target}/report.json`, report);
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const outputIndex = process.argv.indexOf('--output');
  const outDir = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
  const result = await writeAnalyticalElbowCP0Witness({ outDir });
  process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
}
