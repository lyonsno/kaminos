#!/usr/bin/env node

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createAnalyticalElbowConsumerExport,
  createAnalyticalElbowDescriptor,
} from './analytical-elbow-core.mjs';

const WITNESS_ROUTE = 'analytical-elbow-orbitable-v0';
const DEFAULT_IO = Object.freeze({ mkdir, rename, writeFile });

function jsonForHtml(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

async function writeJsonAtomically(io, path, value) {
  const temporaryPath = `${path}.tmp`;
  await io.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await io.rename(temporaryPath, path);
}

function renderHtml({ consumerExport, report }) {
  return `<!doctype html>
<html lang="en" data-witness-route="${WITNESS_ROUTE}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Analytical elbow witness</title>
  <style>
    :root { color-scheme:dark; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; background:#111513; color:#f2eee3; }
    * { box-sizing:border-box; }
    body { margin:0; min-width:320px; overflow:hidden; background:#111513; }
    main { display:grid; grid-template-rows:auto minmax(0,1fr) auto; width:100%; height:100vh; min-height:520px; }
    header { display:flex; align-items:center; justify-content:space-between; gap:24px; min-width:0; padding:16px 20px; border-bottom:1px solid #3f4943; background:#151b17; }
    .identity { min-width:0; }
    h1 { margin:0; font:650 18px/1.2 ui-sans-serif,system-ui,sans-serif; letter-spacing:0; }
    .authority { margin:4px 0 0; color:#d8b76d; font-size:11px; }
    .route { flex:0 1 auto; min-width:0; color:#98a59d; font-size:10px; line-height:1.5; text-align:right; overflow-wrap:anywhere; }
    .viewport { position:relative; min-width:0; min-height:0; overflow:hidden; }
    canvas { display:block; width:100%; height:100%; touch-action:none; }
    .legend { position:absolute; top:16px; left:18px; display:grid; gap:7px; margin:0; padding:0; list-style:none; pointer-events:none; color:#d9dfda; font-size:11px; text-shadow:0 1px 2px #000; }
    .legend span { display:inline-block; width:12px; height:12px; margin-right:8px; border:1px solid #ffffff55; vertical-align:-2px; }
    .humerus { background:#e8dcc1; }
    .ulna { background:#cbd8ca; }
    .flexor { background:#58b7a3; }
    .extensor { background:#df735f; }
    .attachment { background:#e3bd55; border-radius:50%; }
    .metrics { position:absolute; right:18px; bottom:16px; min-width:210px; padding:10px 12px; border:1px solid #4a554e; background:#111713e8; font-size:10px; line-height:1.6; pointer-events:none; }
    .metrics div { display:flex; justify-content:space-between; gap:20px; }
    .metrics span:first-child { color:#8f9b94; }
    footer { display:flex; align-items:center; justify-content:space-between; gap:18px; padding:12px 18px; border-top:1px solid #3f4943; background:#151b17; }
    .poses { display:flex; gap:2px; }
    button { min-width:72px; min-height:34px; padding:7px 12px; border:1px solid #536058; border-radius:4px; background:#202823; color:#dce2dd; font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace; cursor:pointer; }
    button[aria-pressed="true"] { border-color:#d8b76d; background:#d8b76d; color:#181b19; }
    .pose-status { color:#98a59d; font-size:10px; text-align:right; }
    @media (max-width:680px) {
      header { flex-direction:column; align-items:flex-start; gap:7px; padding:13px 14px; }
      .route { width:100%; max-width:none; text-align:left; }
      footer { align-items:flex-start; flex-direction:column; padding:10px 12px; }
      .poses { width:100%; }
      button { flex:1; min-width:0; }
      .pose-status { text-align:left; }
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
      <div class="identity">
        <h1>Analytical elbow · cage authority</h1>
        <p class="authority">Synthetic structural hypothesis · no species-level admission</p>
      </div>
      <div class="route">requested ${WITNESS_ROUTE}<br>effective ${WITNESS_ROUTE}</div>
    </header>
    <section class="viewport" aria-label="Orbitable analytical elbow">
      <ul class="legend">
        <li><span class="humerus"></span>humerus</li>
        <li><span class="ulna"></span>ulna + olecranon</li>
        <li><span class="flexor"></span>brachialis-like flexor</li>
        <li><span class="extensor"></span>triceps-like extensor</li>
        <li><span class="attachment"></span>attachment authority</li>
      </ul>
      <div class="metrics" id="metrics"></div>
    </section>
    <footer>
      <div class="poses" role="group" aria-label="Elbow pose">
        <button type="button" data-pose="0" aria-pressed="true">0°</button>
        <button type="button" data-pose="1" aria-pressed="false">35°</button>
        <button type="button" data-pose="2" aria-pressed="false">80°</button>
      </div>
      <div class="pose-status" id="pose-status">extension · authored volume retained</div>
    </footer>
  </main>
  <script id="elbow-data" type="application/json">${jsonForHtml(consumerExport)}</script>
  <script type="module">
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

    const data = JSON.parse(document.querySelector('#elbow-data').textContent);
    const viewport = document.querySelector('.viewport');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111513);
    scene.fog = new THREE.Fog(0x111513, 6, 11);

    const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 50);
    camera.position.set(4.2, 2.4, 5.1);
    const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    viewport.prepend(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.2, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 2.8;
    controls.maxDistance = 10;

    scene.add(new THREE.HemisphereLight(0xf4ead4, 0x25342d, 2.4));
    const key = new THREE.DirectionalLight(0xffe3b5, 3.6);
    key.position.set(3.5, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x72c9be, 2.2);
    rim.position.set(-4, 1.2, -3);
    scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(4.4, 72),
      new THREE.MeshStandardMaterial({ color:0x1a211c, roughness:0.92, metalness:0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.66;
    scene.add(ground);

    const boneMaterials = {
      humerus: new THREE.MeshStandardMaterial({ color:0xe8dcc1, roughness:0.72, metalness:0.02 }),
      ulna: new THREE.MeshStandardMaterial({ color:0xcbd8ca, roughness:0.72, metalness:0.02 }),
    };
    const jointMaterial = new THREE.MeshStandardMaterial({ color:0x7f8b83, roughness:0.58, transparent:true, opacity:0.5 });
    const attachmentMaterial = new THREE.MeshStandardMaterial({ color:0xe3bd55, roughness:0.42, emissive:0x49350b, emissiveIntensity:0.35 });
    const muscleMaterials = {
      'brachialis-like-flexor': new THREE.MeshStandardMaterial({ color:0x58b7a3, roughness:0.5, side:THREE.DoubleSide }),
      'monoarticular-triceps-like-extensor': new THREE.MeshStandardMaterial({ color:0xdf735f, roughness:0.52, side:THREE.DoubleSide }),
    };
    let poseGroup = null;

    function vector(values) { return new THREE.Vector3(...values); }

    function capsuleBetween(startValues, endValues, radius, material) {
      const start = vector(startValues);
      const end = vector(endValues);
      const direction = end.clone().sub(start);
      const totalLength = direction.length();
      const cylinderLength = Math.max(0.001, totalLength - radius * 2);
      const geometry = new THREE.CapsuleGeometry(radius, cylinderLength, 8, 18);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(start).add(end).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      return mesh;
    }

    function muscleMesh(muscle) {
      const positions = [];
      const indices = [];
      for (const vertex of muscle.cage.vertices) positions.push(...vertex.position);
      for (const quad of muscle.cage.quads) {
        indices.push(quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      return new THREE.Mesh(geometry, muscleMaterials[muscle.id]);
    }

    function lineThrough(samples, color) {
      const geometry = new THREE.BufferGeometry().setFromPoints(samples.map(sample => vector(sample.position)));
      return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent:true, opacity:0.72 }));
    }

    function disposeGroup(group) {
      group.traverse(object => {
        if (object.geometry) object.geometry.dispose();
      });
      scene.remove(group);
    }

    function showPose(index) {
      if (poseGroup) disposeGroup(poseGroup);
      const pose = data.poses[index];
      poseGroup = new THREE.Group();
      for (const segment of pose.segments) {
        const boneMaterial = boneMaterials[segment.id];
        poseGroup.add(capsuleBetween(
          segment.bone.worldStart,
          segment.bone.worldEnd,
          segment.bone.protectedCoreRadius,
          boneMaterial,
        ));
        for (const process of segment.processes) {
          poseGroup.add(capsuleBetween(
            process.worldStart,
            process.worldEnd,
            process.radius,
            boneMaterial,
          ));
        }
        for (const attachment of segment.attachments) {
          const marker = new THREE.Mesh(new THREE.SphereGeometry(0.055, 18, 12), attachmentMaterial);
          marker.position.copy(vector(attachment.worldPosition));
          poseGroup.add(marker);
        }
      }
      const joint = new THREE.Mesh(
        new THREE.SphereGeometry(pose.joint.protectedCoreRadius, 28, 18),
        jointMaterial,
      );
      joint.position.copy(vector(pose.joint.pivot));
      poseGroup.add(joint);
      for (const muscle of pose.muscles) {
        poseGroup.add(muscleMesh(muscle));
        poseGroup.add(lineThrough(muscle.path, muscle.id.includes('flexor') ? 0xb7fff0 : 0xffc2b5));
      }
      scene.add(poseGroup);
      const minimumClearance = Math.min(...pose.muscles.map(muscle => muscle.metrics.minimumProtectedCoreClearance));
      const maximumVolumeError = Math.max(...pose.muscles.map(muscle => muscle.metrics.volumeRelativeError));
      document.querySelector('#metrics').innerHTML =
        '<div><span>Flexion</span><strong>' + pose.effectiveFlexionDegrees + '°</strong></div>' +
        '<div><span>Min cage clearance</span><strong>' + minimumClearance.toFixed(3) + '</strong></div>' +
        '<div><span>Max volume error</span><strong>' + maximumVolumeError.toExponential(1) + '</strong></div>' +
        '<div><span>Material drift</span><strong>' + pose.metrics.materialIdentityViolationCount + '</strong></div>';
      document.querySelector('#pose-status').textContent =
        (index === 0 ? 'extension' : index === 1 ? 'mid flexion' : 'deep flexion') +
        ' · authored volume retained';
      document.querySelectorAll('[data-pose]').forEach((button, buttonIndex) => {
        button.setAttribute('aria-pressed', String(buttonIndex === index));
      });
    }

    document.querySelectorAll('[data-pose]').forEach(button => {
      button.addEventListener('click', () => showPose(Number(button.dataset.pose)));
    });

    function resize() {
      const width = Math.max(1, viewport.clientWidth);
      const height = Math.max(1, viewport.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(viewport);
    resize();
    const requestedPose = Number(new URLSearchParams(window.location.search).get('pose') || 0);
    showPose(Number.isInteger(requestedPose) && requestedPose >= 0 && requestedPose < data.poses.length ? requestedPose : 0);
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });
    document.documentElement.dataset.witnessLoaded = 'true';
  </script>
</body>
</html>`;
}

export async function writeAnalyticalElbowWitness({
  outDir,
  descriptor = createAnalyticalElbowDescriptor(),
  io: ioOverrides = {},
}) {
  const outputRoot = resolve(outDir);
  const io = { ...DEFAULT_IO, ...ioOverrides };
  let phase = 'prepare-output';
  const failureBase = {
    schema: 'kaminos.analytical-elbow-witness-report.v0',
    status: 'failed',
    route: {
      requested: WITNESS_ROUTE,
      effective: null,
      fallbackUsed: false,
    },
    source: {
      id: descriptor?.id || null,
      schema: descriptor?.schema || null,
      authority: descriptor?.authority?.kind || null,
      anatomicalAdmission: descriptor?.authority?.anatomicalAdmission || null,
    },
  };
  try {
    await io.mkdir(outputRoot, { recursive: true });
    phase = 'solve-consumer-export';
    const consumerExport = createAnalyticalElbowConsumerExport(descriptor, {
      flexionDegrees: [0, 35, 80],
      pathSampleCount: 25,
      radialSegmentCount: 8,
      requestedRoute: 'analytical-cage',
    });
    const report = {
      schema: failureBase.schema,
      status: 'complete',
      route: {
        requested: WITNESS_ROUTE,
        effective: WITNESS_ROUTE,
        fallbackUsed: false,
      },
      source: failureBase.source,
      consumerRoute: {
        requested: consumerExport.requestedRoute,
        effective: consumerExport.effectiveRoute,
        fallbackUsed: consumerExport.fallbackUsed,
      },
      claimBoundary: structuredClone(descriptor.claimBoundary),
      poses: consumerExport.poses.map(pose => ({
        flexionDegrees: pose.effectiveFlexionDegrees,
        clearanceViolationCount: pose.metrics.clearanceViolationCount,
        materialIdentityViolationCount: pose.metrics.materialIdentityViolationCount,
        muscles: pose.muscles.map(muscle => ({
          id: muscle.id,
          realizedVolume: muscle.metrics.realizedVolume,
          volumeRelativeError: muscle.metrics.volumeRelativeError,
          minimumProtectedCoreClearance:
            muscle.metrics.minimumProtectedCoreClearance,
        })),
      })),
    };
    if (report.poses.some(pose =>
      pose.clearanceViolationCount !== 0 ||
      pose.materialIdentityViolationCount !== 0
    )) {
      throw new Error('analytical elbow witness failed structural admission');
    }
    phase = 'write-artifacts';
    await writeJsonAtomically(io, resolve(outputRoot, 'descriptor.json'), descriptor);
    await writeJsonAtomically(
      io,
      resolve(outputRoot, 'consumer-export.json'),
      consumerExport,
    );
    await io.writeFile(
      resolve(outputRoot, 'index.html'),
      renderHtml({ consumerExport, report }),
    );
    await writeJsonAtomically(io, resolve(outputRoot, 'report.json'), report);
    return { outputRoot, report, consumerExport };
  } catch (error) {
    const failureReport = {
      ...failureBase,
      failurePhase: phase,
      error: {
        name: error.name,
        message: error.message,
      },
      lastTrustworthyEvidence: {
        phase: 'descriptor-received',
        sourceId: descriptor?.id || null,
        sourceSchema: descriptor?.schema || null,
      },
    };
    const failureReportPath = phase === 'prepare-output'
      ? `${outputRoot}.failure-report.json`
      : resolve(outputRoot, 'report.json');
    error.failureReportPath = failureReportPath;
    try {
      await io.mkdir(dirname(failureReportPath), { recursive: true });
      await writeJsonAtomically(
        io,
        failureReportPath,
        failureReport,
      );
    } catch (reportError) {
      error.failureReportError = reportError;
    }
    throw error;
  }
}

async function main() {
  const outDir = process.argv[2] ||
    'artifacts/analytical-elbow-witness-v0';
  const result = await writeAnalyticalElbowWitness({ outDir });
  console.log(JSON.stringify({
    status: result.report.status,
    outputRoot: result.outputRoot,
    route: result.report.route,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
