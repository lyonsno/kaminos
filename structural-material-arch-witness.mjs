import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  buildArchStructuralProxy,
  solveArchStructuralForce,
  fractureArchStructuralProxy,
  bindArchStructuralProxy,
} from './structural-material-arch-core.js';

const root = dirname(fileURLToPath(import.meta.url));
const outputPath = process.argv[2];
if (!outputPath) throw new Error('usage: node structural-material-arch-witness.mjs <output.json>');
const absoluteOutputPath = resolve(process.cwd(), outputPath);
const report = {
  schema: 'kaminos.structural-material.arch-paired-witness.v0',
  status: 'running',
  phase: 'preflight',
  lastTrustworthyEvidence: 'explicit output path recorded; no input asset has been read',
};

try {
const witnessRoot = resolve(root, 'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness');
const baseRoot = resolve(root, 'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24');
const settings = {
  contact: { x: -0.05, y: 0.29 },
  forceCases: [0.25, 0.5, 0.75, 2],
  fractureThreshold: 0.04,
  iterations: 600,
  layers: 3,
  depth: 0.36,
  sharedBounds: { min: [-0.5, -0.39], max: [0.5, 0.39] },
  shoulderWindow: { minX: -0.19, maxX: -0.07, minY: 0.16, minDistanceFromContact: 0.05 },
};

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readProfile(name) {
  report.phase = `load-${name}-profile-and-glb`;
  const profilePath = resolve(witnessRoot, `${name}-profile.json`);
  const profileBytes = readFileSync(profilePath);
  const profile = JSON.parse(profileBytes.toString('utf8'));
  const sourcePath = resolve(baseRoot, name === 'intact' ? 'trellis-intact/output.glb' : 'trellis-outer-notch/output.glb');
  const sourceBytes = readFileSync(sourcePath);
  if (profile.source?.kind !== 'trellis-glb' || profile.source.sha256 !== sha256(sourceBytes)) {
    throw new Error(`${name} profile source hash does not match its TRELLIS GLB`);
  }
  if (profile.columns !== 48 || profile.rows !== 36 || profile.occupancy.length !== profile.columns * profile.rows) {
    throw new Error(`${name} profile resolution or occupancy shape is invalid`);
  }
  if (JSON.stringify(profile.bounds) !== JSON.stringify(settings.sharedBounds)) {
    throw new Error(`${name} profile does not use the declared shared bounds`);
  }
  report.lastTrustworthyEvidence = `${name} profile hash matches its source GLB and has the declared 48x36 shared-bounds occupancy`;
  return {
    profile,
    identity: {
      glb: `artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/${name === 'intact' ? 'trellis-intact' : 'trellis-outer-notch'}/output.glb`,
      glbSha256: sha256(sourceBytes),
      profile: `artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/${name}-profile.json`,
      profileSha256: sha256(profileBytes),
      occupiedCells: profile.occupancy.filter(Boolean).length,
      extraction: profile.extraction,
    },
  };
}

const profiles = Object.fromEntries(['intact', 'outer-notch'].map(name => [name, readProfile(name)]));
report.phase = 'build-structural-graphs';
const states = Object.fromEntries(Object.entries(profiles).map(([name, entry]) => [
  name,
  buildArchStructuralProxy(entry.profile, { layers: settings.layers, depth: settings.depth }),
]));
report.lastTrustworthyEvidence = 'both projected profiles produced one connected 3-layer structural graph';

function componentSizes(state) {
  return state.components.map(component => component.size).sort((a, b) => b - a);
}

function eventEnergy(state) {
  return state.events.reduce((sum, event) => sum + event.energy, 0);
}

function summarize(name, force) {
  report.phase = `solve-fracture-bind-${name}-force-${force}`;
  const base = states[name];
  const solveStarted = performance.now();
  const solved = solveArchStructuralForce(base, {
    ...settings.contact,
    force,
    iterations: settings.iterations,
  });
  const solveElapsedMs = performance.now() - solveStarted;
  const cracked = fractureArchStructuralProxy(solved, { threshold: settings.fractureThreshold });
  const contactDistance = event => Math.hypot(
    event.midpoint.x - settings.contact.x,
    event.midpoint.y - settings.contact.y,
  );
  const shoulderEvents = cracked.events.filter(event =>
    event.midpoint.x > settings.shoulderWindow.minX &&
    event.midpoint.x < settings.shoulderWindow.maxX &&
    event.midpoint.y > settings.shoulderWindow.minY &&
    contactDistance(event) > settings.shoulderWindow.minDistanceFromContact,
  );
  const pins = solved.nodes.filter(node => node.pinned);
  const maxPinnedDisplacement = Math.max(...pins.map(node => Math.hypot(
    node.displacement.x, node.displacement.y, node.displacement.z,
  )));
  const brokenIds = cracked.events.map(event => event.bondId);
  const bound = bindArchStructuralProxy(cracked, { bondIds: brokenIds });
  const bindEvents = bound.events.filter(event => event.kind === 'bind');
  const brokenAfterBind = bound.bonds.filter(bond => !bond.alive).length;
  const displacementPreserved = bound.nodes.every((node, index) =>
    node.displacement.x === cracked.nodes[index].displacement.x &&
    node.displacement.y === cracked.nodes[index].displacement.y &&
    node.displacement.z === cracked.nodes[index].displacement.z,
  );
  if (solved.load.relativeResidual > 1e-6 || maxPinnedDisplacement !== 0) {
    throw new Error(`${name} force ${force} failed solve residual or support invariants`);
  }
  if (!displacementPreserved || brokenAfterBind !== 0 || bound.components.length !== 1) {
    throw new Error(`${name} force ${force} Bind did not restore connectivity without erasing deformation`);
  }
  report.lastTrustworthyEvidence = `${name} force ${force} solved, thresholded, and rebound with residual ${solved.load.relativeResidual}`;
  return {
    force,
    contact: solved.load.contact,
    requestedForce: solved.load.requestedForce,
    effectiveForce: solved.load.effectiveForce,
    travel: solved.load.travel,
    peakStrain: solved.maxStrain,
    solver: {
      elapsedMs: solveElapsedMs,
      iterations: solved.load.iterations,
      iterationBudget: solved.load.iterationBudget,
      relativeResidual: solved.load.relativeResidual,
      shearWeight: solved.load.shearWeight,
    },
    support: { pinnedNodes: pins.length, maxDisplacement: maxPinnedDisplacement },
    fracture: {
      threshold: settings.fractureThreshold,
      brokenBonds: cracked.events.length,
      shoulderEvents: shoulderEvents.length,
      componentSizes: componentSizes(cracked),
      connectivityEpoch: cracked.connectivityEpoch,
      eventEnergy: eventEnergy(cracked),
      displacementIsSolvedBeforeBreakRemoval: true,
      postFractureReequilibration: false,
    },
    bind: {
      repairedBonds: bindEvents.length,
      remainingBrokenBonds: brokenAfterBind,
      componentSizes: componentSizes(bound),
      displacementPreserved,
      eventEnergy: bindEvents.reduce((sum, event) => sum + event.energy, 0),
    },
  };
}

const runs = Object.fromEntries(['intact', 'outer-notch'].map(name => [
  name,
  settings.forceCases.map(force => summarize(name, force)),
]));
report.phase = 'adjudicate-paired-results';
const atForce = (name, force) => runs[name].find(run => run.force === force);
if (atForce('intact', 0.5).fracture.brokenBonds !== 0 || atForce('outer-notch', 0.5).fracture.brokenBonds === 0) {
  throw new Error('the matched onset comparison no longer distinguishes the outer-notch profile at force 0.5');
}
if (atForce('outer-notch', 0.75).fracture.shoulderEvents === 0 ||
    atForce('outer-notch', 0.75).fracture.shoulderEvents <= atForce('intact', 0.75).fracture.shoulderEvents) {
  throw new Error('the notched shoulder does not retain the expected geometry-localized crack evidence');
}
if (atForce('intact', 2).fracture.componentSizes.length !== 1 ||
    atForce('outer-notch', 2).fracture.componentSizes.length < 2) {
  throw new Error('the high-force comparison no longer distinguishes persistent connectivity');
}

const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const dirtyPaths = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
  .split('\n').filter(Boolean).map(line => line.slice(3));
const implementationPaths = ['structural-material-arch-core.js', 'structural-material-arch-profile.mjs', 'structural-material-arch-witness.mjs'];
Object.assign(report, {
  schema: 'kaminos.structural-material.arch-paired-witness.v0',
  claim: 'the notched projected-geometry proxy cracks at a lower matched crown force, then localizes damage at the outer shoulder and splits under high force while the intact proxy remains connected',
  claimCeiling: [
    'CPU expressive spring proxy, not GPU execution or engineering-exact stone prediction',
    'separate TRELLIS reconstructions share raster bounds and proxy rules but are not an exact mesh ablation',
    'the 3-layer extruded silhouette is not the imported mesh interior or a watertight volume',
    'crack events are thresholded from the intact linear solve; no post-fracture re-equilibration is performed',
    'event energy is material-derived causal data; no acoustic playback is claimed',
  ],
  route: {
    requested: 'local Node.js CPU witness',
    effective: 'local Node.js CPU / shear-regularized linear spring PCG',
    fallback: false,
    node: process.version,
    sourceRevision,
    sourceDirtyPaths: dirtyPaths,
  },
  implementationSha256: Object.fromEntries(implementationPaths.map(path => [path, sha256(readFileSync(resolve(root, path)))])),
  sources: Object.fromEntries(Object.entries(profiles).map(([name, entry]) => [name, entry.identity])),
  configuration: settings,
  units: 'normalized proxy units; no SI calibration',
  proxy: Object.fromEntries(Object.entries(states).map(([name, state]) => [name, {
    schema: state.schema,
    geometryAuthority: state.geometryAuthority,
    solverAuthority: state.solverAuthority,
    nodes: state.nodes.length,
    bonds: state.bonds.length,
    componentsAtRest: state.components.length,
    pinnedNodes: state.nodes.filter(node => node.pinned).length,
  }])),
  runs,
});

report.status = 'passed';
report.phase = 'complete';
report.lastTrustworthyEvidence = 'paired onset, shoulder localization, split, and Bind predicates all passed';
writeFileSync(absoluteOutputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  output: absoluteOutputPath,
  route: report.route.effective,
  results: Object.fromEntries(Object.entries(runs).map(([name, cases]) => [name, cases.map(run => ({
    force: run.force,
    travel: run.travel,
    peakStrain: run.peakStrain,
    brokenBonds: run.fracture.brokenBonds,
    components: run.fracture.componentSizes,
    eventEnergy: run.fracture.eventEnergy,
    residual: run.solver.relativeResidual,
  }))])),
}, null, 2));
} catch (error) {
  report.status = 'failed';
  report.error = { phase: report.phase, message: error.message, stack: error.stack };
  writeFileSync(absoluteOutputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(`arch witness failed during ${report.phase}: ${error.stack || error.message}`);
  console.error(`durable report: ${absoluteOutputPath}`);
  process.exitCode = 1;
}
