#!/usr/bin/env node

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createShapeBearingCollarWitnessDataset } from './analytical-elbow-collar-assay-core.mjs';
import {
  createAnalyticalElbowConsumerExport,
  createAnalyticalElbowDescriptor,
} from './analytical-elbow-core.mjs';

export const COLLAR_WITNESS_ROUTE = 'analytical-elbow-collar-failure-witness';
const REPORT_SCHEMA = 'kaminos.shape-bearing-collar-witness-report.v0';
const DEFAULT_IO = Object.freeze({ mkdir, rename, writeFile });

function jsonForHtml(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

async function writeJsonAtomically(io, path, value) {
  const temporaryPath = `${path}.tmp`;
  await io.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await io.rename(temporaryPath, path);
}

function renderHtml(dataset) {
  return `<!doctype html>
<html lang="en" data-witness-route="${COLLAR_WITNESS_ROUTE}" data-witness-loaded="false">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shape-bearing collar failure witness</title>
  <style>
    :root { color-scheme:dark; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; background:#111513; color:#eef2ed; }
    * { box-sizing:border-box; }
    body { margin:0; min-width:320px; overflow-x:hidden; background:#111513; }
    main { min-height:100vh; }
    header { position:sticky; z-index:5; top:0; display:grid; grid-template-columns:minmax(250px,1fr) auto; gap:18px; align-items:center; min-width:0; padding:13px 18px; border-bottom:1px solid #414b45; background:#151b17f5; backdrop-filter:blur(8px); }
    h1 { margin:0; font:650 17px/1.2 ui-sans-serif,system-ui,sans-serif; letter-spacing:0; }
    .claim { margin:4px 0 0; color:#c7a960; font-size:10px; line-height:1.4; overflow-wrap:anywhere; }
    .toolbar { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:8px; }
    .control { display:flex; gap:2px; padding:2px; border:1px solid #475249; border-radius:5px; background:#101411; }
    button { min-width:34px; min-height:30px; padding:6px 9px; border:0; border-radius:3px; background:transparent; color:#cbd3cd; font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace; cursor:pointer; }
    button:hover { background:#263028; }
    button[aria-pressed="true"] { background:#d4b65e; color:#171a17; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1px; background:#39413c; }
    article { min-width:0; background:#111513; }
    .cell-head { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:14px; padding:9px 12px; border-bottom:1px solid #303833; }
    h2 { margin:0; font:650 12px/1.2 ui-sans-serif,system-ui,sans-serif; letter-spacing:0; }
    .metric { color:#aeb8b1; font-size:9px; white-space:nowrap; }
    .viewport { position:relative; aspect-ratio:16/9; min-height:260px; overflow:hidden; background:#0d100e; }
    canvas { display:block; width:100%; height:100%; touch-action:none; cursor:grab; }
    canvas:active { cursor:grabbing; }
    .regions { position:absolute; left:10px; bottom:9px; display:flex; flex-wrap:wrap; gap:7px 11px; max-width:calc(100% - 20px); pointer-events:none; font-size:9px; color:#d4d9d5; text-shadow:0 1px 2px #000; }
    .regions span::before { content:''; display:inline-block; width:8px; height:8px; margin-right:5px; border-radius:50%; vertical-align:-1px; background:var(--swatch); box-shadow:0 0 0 1px #ffffff55; }
    .identity { padding:9px 14px 12px; border-top:1px solid #303833; color:#8f9b93; font-size:9px; line-height:1.6; overflow-wrap:anywhere; }
    .legend { display:grid; grid-template-columns:auto minmax(120px,360px) auto; gap:9px; align-items:center; padding:11px 18px; border-top:1px solid #414b45; }
    .ramp { height:9px; border:1px solid #5c665f; border-radius:2px; background:linear-gradient(90deg,#248e8a 0%,#d5bd4d 50%,#ef6a43 75%,#d92967 100%); }
    .legend strong { font-size:9px; }
    .legend span { color:#9ca79f; font-size:9px; }
    @media (max-width:760px) {
      header { position:static; grid-template-columns:1fr; gap:9px; padding:12px; }
      .toolbar { justify-content:flex-start; }
      .grid { grid-template-columns:1fr; }
      .viewport { min-height:0; aspect-ratio:4/3; }
      .metric { max-width:150px; white-space:normal; text-align:right; overflow-wrap:anywhere; }
      .legend { padding:10px 12px; }
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
        <h1>Shape-bearing collar · exact failure witness</h1>
        <p class="claim">Synthetic sleeve control only · paused · corrective freedom not yet implemented</p>
      </div>
      <div class="toolbar">
        <div class="control" role="group" aria-label="Camera preset">
          <button type="button" data-camera="profile" aria-pressed="true">Profile</button>
          <button type="button" data-camera="three-quarter" aria-pressed="false">3/4</button>
        </div>
        <div class="control" role="group" aria-label="Overlays">
          <button type="button" data-toggle="regions" aria-pressed="true">Regions</button>
          <button type="button" data-toggle="wireframe" aria-pressed="false">Wire</button>
          <button type="button" data-toggle="rest" aria-pressed="false">Rest</button>
        </div>
      </div>
    </header>
    <section class="grid" aria-label="Collar failure comparison">
      ${dataset.cases.map((entry, index) => `
      <article data-case="${entry.id}">
        <div class="cell-head">
          <h2>${entry.flexionDegrees}° · ${entry.collarHalfWidth === 0 ? 'hard split' : `collar ${entry.collarHalfWidth}`}</h2>
          <div class="metric">edge ${(Math.expm1(entry.metrics.maximumAbsoluteLogEdgeStrain) * 100).toFixed(1)}% · area ${(Math.expm1(entry.metrics.maximumAbsoluteLogAreaStrain) * 100).toFixed(1)}%</div>
        </div>
        <div class="viewport" data-viewport="${index}">
          <div class="regions">
            <span style="--swatch:#52d6c5">parent rigid</span>
            <span style="--swatch:#f0c84b">collar</span>
            <span style="--swatch:#6ea4ff">child rigid</span>
          </div>
        </div>
        <div class="identity">requested ${COLLAR_WITNESS_ROUTE} · effective ${COLLAR_WITNESS_ROUTE} · source ${dataset.source.id} / ${dataset.source.effectiveRoute}</div>
      </article>`).join('')}
    </section>
    <div class="legend">
      <strong>low strain</strong><div class="ramp"></div><strong>high strain</strong>
      <span></span><span>qualification threshold ${(dataset.visualContract.heatThresholdLogStrain).toFixed(4)} log strain · magenta marks inversion</span><span></span>
    </div>
  </main>
  <script id="collar-witness-data" type="application/json">${jsonForHtml(dataset)}</script>
  <script type="module">
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

    const data = JSON.parse(document.querySelector('#collar-witness-data').textContent);
    const renderers = [];
    const parameters = new URLSearchParams(window.location.search);
    let cameraPreset = data.visualContract.cameraPresets.includes(parameters.get('camera'))
      ? parameters.get('camera')
      : 'profile';
    const overlays = {
      regions:parameters.get('regions') !== '0',
      wireframe:parameters.get('wire') === '1',
      rest:parameters.get('rest') === '1',
    };

    document.querySelectorAll('[data-camera]').forEach(button =>
      button.setAttribute('aria-pressed', String(button.dataset.camera === cameraPreset))
    );
    document.querySelectorAll('[data-toggle]').forEach(button =>
      button.setAttribute('aria-pressed', String(overlays[button.dataset.toggle]))
    );

    window.__KAMINOS_COLLAR_WITNESS__ = {
      status:'loading',
      paused:true,
      animationActive:false,
      requestedRoute:data.requestedRoute,
      effectiveRoute:data.effectiveRoute,
      fallbackUsed:data.fallbackUsed,
      source:data.source,
      thresholds:data.thresholds,
      cases:data.visualContract.comparisonCases,
      cameraPreset,
      overlays:{ ...overlays },
      panels:[],
    };

    function heatColor(value, inverted) {
      if (inverted) return new THREE.Color(0xd92967);
      const threshold = data.visualContract.heatThresholdLogStrain;
      const t = Math.min(1, value / (threshold * 2.2));
      const stops = [
        [0, new THREE.Color(0x248e8a)],
        [0.5, new THREE.Color(0xd5bd4d)],
        [0.75, new THREE.Color(0xef6a43)],
        [1, new THREE.Color(0xd92967)],
      ];
      for (let index = 1; index < stops.length; index += 1) {
        if (t <= stops[index][0]) {
          const [leftAt, left] = stops[index - 1];
          const [rightAt, right] = stops[index];
          return left.clone().lerp(right, (t - leftAt) / (rightAt - leftAt));
        }
      }
      return stops.at(-1)[1].clone();
    }

    function buildSurface(entry, field, materialOptions = {}) {
      const positions = [];
      const colors = [];
      for (const triangle of entry.triangles) {
        const color = field === 'posed'
          ? heatColor(triangle.maximumAbsoluteLogEdgeStrain, triangle.inverted)
          : new THREE.Color(0xc8d0ca);
        for (const vertexIndex of triangle.indices) {
          positions.push(...entry.vertices[vertexIndex][field]);
          colors.push(color.r, color.g, color.b);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        vertexColors:true,
        roughness:0.68,
        metalness:0,
        side:THREE.DoubleSide,
        ...materialOptions,
      }));
    }

    function buildRegionPoints(entry) {
      const group = new THREE.Group();
      const colors = {
        'parent-rigid':0x52d6c5,
        collar:0xf0c84b,
        'child-rigid':0x6ea4ff,
      };
      for (const region of Object.keys(colors)) {
        const positions = entry.vertices
          .filter(vertex => vertex.region === region)
          .flatMap(vertex => vertex.posed);
        if (positions.length === 0) continue;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const points = new THREE.Points(geometry, new THREE.PointsMaterial({
          color:colors[region], size:3.4, sizeAttenuation:false, transparent:true, opacity:0.9,
        }));
        group.add(points);
      }
      return group;
    }

    function applyCamera(panel) {
      const position = cameraPreset === 'profile' ? [0, 0, 5.2] : [3.5, 1.8, 4.2];
      panel.camera.position.set(...position);
      panel.controls.target.set(0, 0.08, 0);
      panel.controls.update();
    }

    function renderPanel(panel) {
      panel.renderer.render(panel.scene, panel.camera);
      panel.drawCount += 1;
      const state = window.__KAMINOS_COLLAR_WITNESS__.panels[panel.index];
      if (state) state.drawCount = panel.drawCount;
    }

    function resizePanel(panel) {
      const width = Math.max(1, panel.viewport.clientWidth);
      const height = Math.max(1, panel.viewport.clientHeight);
      panel.renderer.setSize(width, height, false);
      panel.camera.aspect = width / height;
      panel.camera.updateProjectionMatrix();
      renderPanel(panel);
    }

    data.cases.forEach((entry, index) => {
      const viewport = document.querySelector('[data-viewport="' + index + '"]');
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0d100e);
      const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 30);
      const renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      viewport.prepend(renderer.domElement);
      scene.add(new THREE.HemisphereLight(0xf4ead8, 0x202a25, 2.3));
      const key = new THREE.DirectionalLight(0xffe2b0, 3.2);
      key.position.set(3, 4.5, 4);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0x6bc9bd, 1.6);
      rim.position.set(-4, 1, -3);
      scene.add(rim);
      const posed = buildSurface(entry, 'posed');
      scene.add(posed);
      const wire = new THREE.LineSegments(
        new THREE.WireframeGeometry(posed.geometry),
        new THREE.LineBasicMaterial({ color:0xf5f1df, transparent:true, opacity:0.34 }),
      );
      wire.visible = overlays.wireframe;
      scene.add(wire);
      const rest = buildSurface(entry, 'rest', { wireframe:true, transparent:true, opacity:0.22, depthWrite:false });
      rest.visible = overlays.rest;
      scene.add(rest);
      const regions = buildRegionPoints(entry);
      regions.visible = overlays.regions;
      scene.add(regions);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false;
      controls.enablePan = false;
      controls.minDistance = 3.2;
      controls.maxDistance = 8;
      const panel = { index, viewport, scene, camera, renderer, controls, wire, rest, regions, drawCount:0 };
      renderers.push(panel);
      controls.addEventListener('change', () => renderPanel(panel));
      applyCamera(panel);
      new ResizeObserver(() => resizePanel(panel)).observe(viewport);
      resizePanel(panel);
      window.__KAMINOS_COLLAR_WITNESS__.panels.push({
        id:entry.id,
        flexionDegrees:entry.flexionDegrees,
        collarHalfWidth:entry.collarHalfWidth,
        vertexCount:entry.vertices.length,
        triangleCount:entry.triangles.length,
        invertedTriangleCount:entry.metrics.invertedTriangleCount,
        maximumAbsoluteLogEdgeStrain:entry.metrics.maximumAbsoluteLogEdgeStrain,
        drawCount:panel.drawCount,
      });
    });

    document.querySelectorAll('[data-camera]').forEach(button => {
      button.addEventListener('click', () => {
        cameraPreset = button.dataset.camera;
        document.querySelectorAll('[data-camera]').forEach(candidate =>
          candidate.setAttribute('aria-pressed', String(candidate === button))
        );
        renderers.forEach(panel => { applyCamera(panel); renderPanel(panel); });
        window.__KAMINOS_COLLAR_WITNESS__.cameraPreset = cameraPreset;
      });
    });

    document.querySelectorAll('[data-toggle]').forEach(button => {
      button.addEventListener('click', () => {
        const key = button.dataset.toggle;
        overlays[key] = !overlays[key];
        button.setAttribute('aria-pressed', String(overlays[key]));
        renderers.forEach(panel => {
          panel[key].visible = overlays[key];
          renderPanel(panel);
        });
        window.__KAMINOS_COLLAR_WITNESS__.overlays = { ...overlays };
      });
    });

    window.__KAMINOS_COLLAR_WITNESS__.status = 'complete';
    document.documentElement.dataset.witnessLoaded = 'true';
  </script>
</body>
</html>`;
}

export async function writeShapeBearingCollarWitness({
  outDir,
  source = createAnalyticalElbowConsumerExport(
    createAnalyticalElbowDescriptor(),
    { flexionDegrees: [0, 35, 80] },
  ),
  io: ioOverrides = {},
}) {
  const outputRoot = resolve(outDir);
  const io = { ...DEFAULT_IO, ...ioOverrides };
  let phase = 'prepare-output';
  const failureBase = {
    schema: REPORT_SCHEMA,
    status: 'failed',
    route: { requested:COLLAR_WITNESS_ROUTE, effective:null, fallbackUsed:false },
    source: {
      id:source?.sourceId ?? null,
      schema:source?.sourceSchema ?? null,
      requestedRoute:source?.requestedRoute ?? null,
      effectiveRoute:source?.effectiveRoute ?? null,
      fallbackUsed:source?.fallbackUsed ?? null,
    },
  };
  try {
    await io.mkdir(outputRoot, { recursive:true });
    phase = 'create-exact-dataset';
    const dataset = createShapeBearingCollarWitnessDataset({ source });
    const report = {
      schema:REPORT_SCHEMA,
      status:'complete',
      route:{
        requested:dataset.requestedRoute,
        effective:dataset.effectiveRoute,
        fallbackUsed:dataset.fallbackUsed,
      },
      source:structuredClone(dataset.source),
      thresholds:structuredClone(dataset.thresholds),
      visualContract:structuredClone(dataset.visualContract),
      cases:dataset.cases.map(entry => ({
        id:entry.id,
        flexionDegrees:entry.flexionDegrees,
        collarHalfWidth:entry.collarHalfWidth,
        vertexCount:entry.vertices.length,
        triangleCount:entry.triangles.length,
        qualifies:entry.qualifies,
        metrics:structuredClone(entry.metrics),
      })),
      claimCeiling:dataset.claimCeiling,
    };
    phase = 'write-artifacts';
    await writeJsonAtomically(io, resolve(outputRoot, 'dataset.json'), dataset);
    await io.writeFile(resolve(outputRoot, 'index.html'), renderHtml(dataset));
    await writeJsonAtomically(io, resolve(outputRoot, 'report.json'), report);
    return { outputRoot, dataset, report };
  } catch (error) {
    const failureReport = {
      ...failureBase,
      failurePhase:phase,
      error:{ name:error.name, message:error.message },
      lastTrustworthyEvidence:phase === 'prepare-output'
        ? null
        : { phase:'source-received', sourceId:source?.sourceId ?? null },
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

async function main() {
  const outDir = process.argv[2] ||
    'artifacts/analytical-elbow-shape-bearing-collar-witness-v0';
  const result = await writeShapeBearingCollarWitness({ outDir });
  console.log(JSON.stringify({
    status:result.report.status,
    outputRoot:result.outputRoot,
    route:result.report.route,
    caseCount:result.report.cases.length,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
