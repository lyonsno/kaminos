import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildArchStructuralProxy } from './structural-material-arch-core.js';
import { buildArchProfileFromGlb } from './structural-material-arch-profile.mjs';
import {
  ARCH_DEPTH_ASSAY_SETTINGS,
  carveArchBoundaryNotch,
  runArchQuasistaticFracture,
} from './structural-material-arch-depth-assay.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const implementationPaths = [
  'structural-material-arch-core.js',
  'structural-material-arch-profile.mjs',
  'structural-material-arch-depth-assay.mjs',
  'structural-material-arch-contact-interior-assay.mjs',
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function resultSummary(result) {
  const last = result.history.at(-1);
  return {
    status: result.status,
    terminalReason: result.terminal?.reason ?? null,
    totalBrokenBonds: result.totalBrokenBonds,
    finalComponents: result.finalComponents,
    damageSolves: result.history.length,
    finalTravel: last?.travel ?? null,
    localCrackEvents: result.history.reduce((sum, epoch) => sum + epoch.fracture.notchZone.newCrackEvents, 0),
  };
}

export function runArchContactInteriorAssay(sourcePath, options = {}) {
  const started = performance.now();
  const configuration = {
    resolution: ARCH_DEPTH_ASSAY_SETTINGS.resolution,
    sharedBounds: ARCH_DEPTH_ASSAY_SETTINGS.sharedBounds,
    layers: ARCH_DEPTH_ASSAY_SETTINGS.layers,
    uniformDepth: ARCH_DEPTH_ASSAY_SETTINGS.uniformDepth,
    depthMode: 'surface-envelope',
    contact: ARCH_DEPTH_ASSAY_SETTINGS.contact,
    contactPatchRadius: options.contactPatchRadius ?? 0.032,
    force: options.force ?? 2,
    iterations: ARCH_DEPTH_ASSAY_SETTINGS.iterations,
    maxRelativeResidual: ARCH_DEPTH_ASSAY_SETTINGS.maxRelativeResidual,
    fractureThreshold: ARCH_DEPTH_ASSAY_SETTINGS.fractureThreshold,
    notchComparisonRegion: ARCH_DEPTH_ASSAY_SETTINGS.controlledNotch.region,
    notchComparisonMargin: ARCH_DEPTH_ASSAY_SETTINGS.notchComparisonMargin,
    contactDepthModes: ['through-thickness', 'camera-facing-surface'],
    interiorModes: ['continuous', 'radial-voussoir-joints'],
    radialJointCount: 9,
    jointStiffnessRatio: 0.35,
    jointStrength: 0.025,
  };
  if (!Number.isFinite(configuration.contactPatchRadius) || configuration.contactPatchRadius < 0) {
    throw new Error('contact patch radius must be finite and nonnegative');
  }
  if (!Number.isFinite(configuration.force) || configuration.force <= 0) {
    throw new Error('assay force must be finite and positive');
  }
  const sourceBytes = readFileSync(sourcePath);
  const profile = buildArchProfileFromGlb(sourcePath, configuration.resolution.columns,
    configuration.resolution.rows, configuration.sharedBounds);
  const notchedProfile = carveArchBoundaryNotch(profile, ARCH_DEPTH_ASSAY_SETTINGS.controlledNotch);
  const shapes = [['intact', profile], ['controlled-notch', notchedProfile]];
  const cases = [];
  for (const [shape, currentProfile] of shapes) {
    for (const contactDepthMode of configuration.contactDepthModes) {
      for (const interiorMode of configuration.interiorModes) {
        const proxy = buildArchStructuralProxy(currentProfile, {
          layers: configuration.layers,
          depth: configuration.uniformDepth,
          depthMode: configuration.depthMode,
          interiorMode,
          radialJointCount: configuration.radialJointCount,
          jointStiffnessRatio: configuration.jointStiffnessRatio,
          jointStrength: configuration.jointStrength,
        });
        if (proxy.components.length !== 1) {
          throw new Error(`${shape}/${contactDepthMode}/${interiorMode} proxy is disconnected at rest`);
        }
        const result = runArchQuasistaticFracture(currentProfile, {
          ...ARCH_DEPTH_ASSAY_SETTINGS,
          ...configuration,
          contactDepthMode,
          interiorMode,
          force: configuration.force,
        });
        cases.push({
          shape,
          contactDepthMode,
          interiorMode,
          proxy: {
            nodes: proxy.nodes.length,
            bonds: proxy.bonds.length,
            componentsAtRest: proxy.components.length,
            jointBonds: proxy.bonds.filter(bond => bond.kind === 'joint').length,
            geometryAuthority: proxy.geometryAuthority,
            interiorConstruction: proxy.interiorConstruction,
          },
          summary: resultSummary(result),
          result,
        });
      }
    }
  }
  const paired = (contactDepthMode, interiorMode) => {
    const intact = cases.find(item => item.shape === 'intact' &&
      item.contactDepthMode === contactDepthMode && item.interiorMode === interiorMode);
    const notched = cases.find(item => item.shape === 'controlled-notch' &&
      item.contactDepthMode === contactDepthMode && item.interiorMode === interiorMode);
    const intactSignal = [intact.summary.status, intact.summary.totalBrokenBonds,
      intact.summary.damageSolves, intact.summary.finalTravel, intact.summary.localCrackEvents];
    const notchedSignal = [notched.summary.status, notched.summary.totalBrokenBonds,
      notched.summary.damageSolves, notched.summary.finalTravel, notched.summary.localCrackEvents];
    return {
      intact: intact.summary,
      controlledNotch: notched.summary,
      localCrackDelta: notched.summary.localCrackEvents - intact.summary.localCrackEvents,
      brokenBondDelta: notched.summary.totalBrokenBonds - intact.summary.totalBrokenBonds,
      responseDistinguishable: JSON.stringify(intactSignal) !== JSON.stringify(notchedSignal),
    };
  };
  const contrasts = Object.fromEntries(configuration.contactDepthModes.map(contactDepthMode => [contactDepthMode,
    Object.fromEntries(configuration.interiorModes.map(interiorMode => [interiorMode,
      paired(contactDepthMode, interiorMode)]))]));
  const notchResponseFlipsWithInterior = configuration.contactDepthModes.filter(contactDepthMode => {
    const continuousDelta = contrasts[contactDepthMode].continuous.localCrackDelta;
    const jointedDelta = contrasts[contactDepthMode]['radial-voussoir-joints'].localCrackDelta;
    return Math.sign(continuousDelta) !== Math.sign(jointedDelta);
  });
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const dirtyPaths = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter(Boolean).map(line => line.slice(3));
  return {
    schema: 'kaminos.structural-material.arch-contact-interior-sensitivity.v0',
    status: 'passed',
    claim: 'a matched CPU proxy assay varies the crown load depth footprint and an authored radial weak-joint interior independently on the same open TRELLIS arch profile, with and without the same exterior notch',
    claimCeiling: [
      'the mesh supplies projected occupancy and sampled surface depth envelopes only; its open topology does not define an internal solid or material joints',
      'camera-facing-surface means the single maximum-Z proxy layer and preserves the same total prescribed force; it is not triangle collision or resolved contact pressure',
      'radial voussoir joints are an explicit geometry-conditioned counterfactual from the rasterized opening, not structure authored or inferred as source truth',
      'joint stiffness and strength are normalized proxy parameters; the linear spring solver is not a calibrated stone or masonry law',
      'quasistatic connectivity loss does not model detached motion, remeshing, collision, or rendered mesh fracture',
      'CPU evidence only; no WebGPU execution, sound playback, or consumer-coupled arch rendering is claimed',
    ],
    route: {
      requested: 'local Node.js CPU experiment',
      effective: 'local Node.js CPU / shear-regularized linear-spring PCG',
      fallback: false,
      node: process.version,
      sourceRevision,
      sourceDirtyPaths: dirtyPaths,
      implementationSha256: Object.fromEntries(implementationPaths.map(path =>
        [path, sha256(readFileSync(resolve(root, path)))])),
    },
    source: {
      path: sourcePath,
      sha256: sha256(sourceBytes),
      meshTopology: profile.meshTopology,
      occupiedCells: profile.occupancy.filter(Boolean).length,
      depthEnvelopeCells: profile.depthEnvelope.filter(Boolean).length,
      controlledNotchRemovedCells: notchedProfile.controlledNotch.removedCells,
      sameSourceForIntactAndNotch: profile.source.sha256 === notchedProfile.source.sha256,
    },
    configuration,
    contrasts,
    adjudication: {
      allCasesReachedLoadPathSeparation: cases.every(item => item.summary.status === 'load-path-separated'),
      notchLocalCrackContrastFlipsWithInterior: notchResponseFlipsWithInterior.length > 0,
      contactModesWithFlippedNotchContrast: notchResponseFlipsWithInterior,
      interpretation: notchResponseFlipsWithInterior.length
        ? 'the controlled-notch local-crack contrast changes sign under the authored radial-joint interior; the witness is sensitive to contact and interior assumptions and does not identify which interior is source-true'
        : 'the tested notch-local crack contrast keeps its sign across the two interior assumptions at this configuration; this does not identify which interior is source-true',
    },
    cases,
    elapsedMs: performance.now() - started,
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [sourceArgument, outputArgument, patchRadiusArgument, forceArgument] = process.argv.slice(2);
  if (!sourceArgument || !outputArgument) {
    throw new Error('usage: node structural-material-arch-contact-interior-assay.mjs <source.glb> <output.json> [contact-patch-radius] [force]');
  }
  const sourcePath = resolve(process.cwd(), sourceArgument);
  const outputPath = resolve(process.cwd(), outputArgument);
  const report = {
    schema: 'kaminos.structural-material.arch-contact-interior-sensitivity.v0',
    status: 'running',
    phase: 'preflight',
    route: {
      requested: 'local Node.js CPU experiment',
      effective: 'local Node.js CPU / shear-regularized linear-spring PCG',
      fallback: false,
      node: process.version,
    },
    requestedSourcePath: sourcePath,
    outputPath,
    configuration: {
      contactPatchRadius: patchRadiusArgument === undefined ? 0.032 : Number(patchRadiusArgument),
      force: forceArgument === undefined ? 2 : Number(forceArgument),
    },
    lastTrustworthyEvidence: `source path ${sourcePath} and output path ${outputPath} accepted; source not yet read`,
  };
  try {
    mkdirSync(dirname(outputPath), { recursive: true });
    report.phase = 'load-source-and-run-contact-interior-assay';
    Object.assign(report, runArchContactInteriorAssay(sourcePath, {
      contactPatchRadius: report.configuration.contactPatchRadius,
      force: report.configuration.force,
    }));
    report.phase = 'complete';
    report.lastTrustworthyEvidence = 'all eight matched intact/notch, contact-depth, and interior-topology cases completed';
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({
      output: outputPath,
      route: report.route,
      sourceSha256: report.source.sha256,
      adjudication: report.adjudication,
      cases: report.cases.map(item => ({
        shape: item.shape,
        contactDepthMode: item.contactDepthMode,
        interiorMode: item.interiorMode,
        status: item.summary.status,
        totalBrokenBonds: item.summary.totalBrokenBonds,
        components: item.summary.finalComponents.length,
        damageSolves: item.summary.damageSolves,
        localCrackEvents: item.summary.localCrackEvents,
        finalTravel: item.summary.finalTravel,
        loadedNodeCount: item.result.history[0]?.loadedNodeCount,
      })),
      elapsedMs: report.elapsedMs,
    }, null, 2));
  } catch (error) {
    report.status = 'failed';
    report.error = { phase: report.phase, message: error.message, stack: error.stack };
    report.lastTrustworthyEvidence = report.lastTrustworthyEvidence || 'no source-derived evidence';
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.error(`arch contact/interior assay failed during ${report.phase}: ${error.stack || error.message}`);
    console.error(`durable report: ${outputPath}`);
    process.exitCode = 1;
  }
}
