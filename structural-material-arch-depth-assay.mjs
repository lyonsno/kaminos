import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  buildArchStructuralProxy,
  solveArchStructuralForce,
  fractureArchStructuralProxy,
} from './structural-material-arch-core.js';
import { buildArchProfileFromGlb } from './structural-material-arch-profile.mjs';

const root = dirname(fileURLToPath(import.meta.url));

export function carveArchBoundaryNotch(profile, specification) {
  const { side, region } = specification;
  if (!['left', 'right'].includes(side)) throw new Error('arch notch side must be left or right');
  if (!region || !['minX', 'maxX', 'minY', 'maxY'].every(key => Number.isFinite(region[key])) ||
      region.maxX <= region.minX || region.maxY <= region.minY) {
    throw new Error('arch notch needs a finite non-empty XY region');
  }
  const { columns, rows, occupancy, bounds } = profile;
  const dx = (bounds.max[0] - bounds.min[0]) / columns;
  const dy = (bounds.max[1] - bounds.min[1]) / rows;
  const nextOccupancy = [...occupancy];
  const nextDepth = profile.depthEnvelope ? [...profile.depthEnvelope] : null;
  const regionCells = new Set();
  const seeds = [];
  for (let row = 0; row < rows; row += 1) {
    const y = bounds.min[1] + (row + 0.5) * dy;
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      if (!occupancy[index]) continue;
      const x = bounds.min[0] + (column + 0.5) * dx;
      if (x < region.minX || x > region.maxX || y < region.minY || y > region.maxY) continue;
      regionCells.add(index);
      const exteriorColumn = side === 'left' ? column - 1 : column + 1;
      const exterior = exteriorColumn < 0 || exteriorColumn >= columns ||
        !occupancy[row * columns + exteriorColumn];
      if (exterior) seeds.push(index);
    }
  }
  if (!seeds.length) throw new Error('controlled arch notch selected no exterior-boundary cells');
  const removed = new Set(seeds);
  const queue = [...seeds];
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head];
    const column = index % columns;
    const row = Math.floor(index / columns);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nextColumn = column + dc;
      const nextRow = row + dr;
      if (nextColumn < 0 || nextColumn >= columns || nextRow < 0 || nextRow >= rows) continue;
      const next = nextRow * columns + nextColumn;
      if (!regionCells.has(next) || removed.has(next)) continue;
      removed.add(next);
      queue.push(next);
    }
  }
  const removedCells = [...removed].sort((a, b) => a - b);
  for (const index of removedCells) {
    nextOccupancy[index] = false;
    if (nextDepth) nextDepth[index] = null;
  }
  return {
    ...profile,
    occupancy: nextOccupancy,
    ...(nextDepth ? { depthEnvelope: nextDepth } : {}),
    controlledNotch: { operation: 'exterior-boundary-cell-removal-v0', side, region, removedCells },
  };
}

function locateContact(state, x, y) {
  const candidates = state.nodes.filter(node => node.layer === Math.floor(state.layers / 2) && !node.pinned);
  if (!candidates.length) throw new Error('arch has no movable crown contact candidate');
  return candidates.reduce((best, node) =>
    (node.x - x) ** 2 + (node.y - y) ** 2 < (best.x - x) ** 2 + (best.y - y) ** 2 ? node : best);
}

function contactPatchCells(state, contact, patchRadius) {
  const layer = Math.floor(state.layers / 2);
  return [...new Map(state.nodes
    .filter(node => node.layer === layer && !node.pinned &&
      Math.hypot(node.x - contact.x, node.y - contact.y) <= patchRadius + 1e-9)
    .map(node => [`${node.column}:${node.row}`, { column: node.column, row: node.row }])).values()]
    .sort((a, b) => a.row - b.row || a.column - b.column);
}

function componentSummary(state, cells) {
  const keys = new Set(cells.map(cell => `${cell.column}:${cell.row}`));
  const summaries = state.components.map(component => ({
    componentId: component.id,
    componentSize: component.size,
    pinnedNodeCount: 0,
    loadedNodeCount: 0,
  }));
  for (const node of state.nodes) {
    const summary = summaries[node.componentId];
    if (node.pinned) summary.pinnedNodeCount += 1;
    if (keys.has(`${node.column}:${node.row}`)) summary.loadedNodeCount += 1;
  }
  return summaries.map(summary => ({
    ...summary,
    hasPinnedSupport: summary.pinnedNodeCount > 0,
  }));
}

function loadComponentSummary(state, cells) {
  return componentSummary(state, cells).filter(component => component.loadedNodeCount > 0);
}

function supportedContact(state, contactCells) {
  const components = loadComponentSummary(state, contactCells);
  return components.length > 0 && components.every(component => component.hasPinnedSupport);
}

export function runArchQuasistaticFracture(profile, settings) {
  const state = buildArchStructuralProxy(profile, {
    layers: settings.layers,
    depth: settings.uniformDepth,
    depthMode: settings.depthMode,
  });
  const contact = locateContact(state, settings.contact.x, settings.contact.y);
  const contactCells = contactPatchCells(state, contact, settings.contactPatchRadius);
  const history = [];
  let current = state;
  let status = 'stable';
  let terminal = null;

  while (true) {
    const liveBondsAtStart = current.bonds.filter(bond => bond.alive).length;
    if (!supportedContact(current, contactCells)) {
      status = 'load-path-separated';
      terminal = {
        reason: 'loaded-contact-component-has-no-pinned-support',
        contact: { column: contact.column, row: contact.row },
        contactCells,
        loadedContactComponents: loadComponentSummary(current, contactCells),
        components: componentSummary(current, contactCells),
        componentSizes: current.components.map(component => component.size).sort((a, b) => b - a),
      };
      break;
    }
    const solveStarted = performance.now();
    const solved = solveArchStructuralForce(current, {
      ...settings.contact,
      force: settings.force,
      patchRadius: settings.contactPatchRadius,
      iterations: settings.iterations,
    });
    const solveElapsedMs = performance.now() - solveStarted;
    const priorEventCount = solved.events.length;
    const fractured = fractureArchStructuralProxy(solved, { threshold: settings.fractureThreshold });
    const events = fractured.events.slice(priorEventCount);
    const localBounds = {
      minX: settings.notchComparisonRegion.minX - settings.notchComparisonMargin,
      maxX: settings.notchComparisonRegion.maxX + settings.notchComparisonMargin,
      minY: settings.notchComparisonRegion.minY - settings.notchComparisonMargin,
      maxY: settings.notchComparisonRegion.maxY + settings.notchComparisonMargin,
    };
    const inNotchZone = point => point.x >= localBounds.minX && point.x <= localBounds.maxX &&
      point.y >= localBounds.minY && point.y <= localBounds.maxY;
    const localStrains = solved.bonds.filter(bond => bond.alive && inNotchZone(bond.midpoint))
      .map(bond => bond.lastStrain);
    const localEvents = events.filter(event => inNotchZone(event.midpoint));
    const pins = solved.nodes.filter(node => node.pinned);
    const maxPinnedDisplacement = Math.max(...pins.map(node => Math.hypot(
      node.displacement.x, node.displacement.y, node.displacement.z,
    )));
    if (solved.load.relativeResidual > settings.maxRelativeResidual || maxPinnedDisplacement !== 0) {
      throw new Error('arch quasistatic solve violated residual or support-pin contract');
    }
    history.push({
      epoch: history.length,
      liveBondsAtStart,
      contact: solved.load.contact,
      contactCells: solved.load.contactCells,
      loadedNodeCount: solved.load.loadedNodeCount,
      requestedForce: solved.load.requestedForce,
      effectiveForce: solved.load.effectiveForce,
      forcePerNode: solved.load.forcePerNode,
      travel: solved.load.travel,
      peakStrain: solved.maxStrain,
      solve: {
        elapsedMs: solveElapsedMs,
        iterations: solved.load.iterations,
        iterationBudget: solved.load.iterationBudget,
        relativeResidual: solved.load.relativeResidual,
      },
      fracture: {
        threshold: settings.fractureThreshold,
        newBrokenBonds: events.length,
        failedBonds: events.map(event => ({
          bondId: event.bondId,
          midpoint: event.midpoint,
          strain: event.strain,
          energy: event.energy,
        })),
        totalBrokenBonds: fractured.bonds.length - fractured.bonds.filter(bond => bond.alive).length,
        newEventEnergy: events.reduce((sum, event) => sum + event.energy, 0),
        notchZone: {
          bounds: localBounds,
          liveBondCount: localStrains.length,
          peakLiveStrain: localStrains.length ? Math.max(...localStrains) : 0,
          meanLiveStrain: localStrains.length
            ? localStrains.reduce((sum, strain) => sum + strain, 0) / localStrains.length
            : 0,
          newCrackEvents: localEvents.length,
          newCrackEnergy: localEvents.reduce((sum, event) => sum + event.energy, 0),
        },
        componentSizes: fractured.components.map(component => component.size).sort((a, b) => b - a),
        components: componentSummary(fractured, contactCells),
        loadedContactComponents: loadComponentSummary(fractured, contactCells),
        connectivityEpoch: fractured.connectivityEpoch,
        supportPins: pins.length,
        maxPinnedDisplacement,
      },
    });
    current = fractured;
    if (!events.length) {
      status = 'stable';
      terminal = { reason: 'no-live-bond-exceeded-fracture-threshold' };
      break;
    }
  }

  return {
    status,
    terminal,
    history,
    totalBrokenBonds: current.bonds.length - current.bonds.filter(bond => bond.alive).length,
    finalComponents: current.components.map(component => component.size).sort((a, b) => b - a),
    finalConnectivityEpoch: current.connectivityEpoch,
    postBreakReequilibration: history.length > 1
      ? 'same-force linear spring solve on newly live bonds from fixed reference geometry'
      : status === 'load-path-separated'
        ? 'stopped-before-next-solve-because-loaded-component-lost-pinned-support'
        : 'none-required-before-first-damage-result',
    detachedMotion: false,
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const settings = {
  resolution: { columns: 48, rows: 36 },
  sharedBounds: { min: [-0.5, -0.39], max: [0.5, 0.39] },
  layers: 3,
  uniformDepth: 0.36,
  depthModes: ['uniform', 'surface-envelope'],
  contact: { x: -0.05, y: 0.29 },
  contactPatchRadius: 0,
  forces: [0.25, 0.5, 0.75, 2],
  fractureThreshold: 0.04,
  iterations: 1200,
  maxRelativeResidual: 1e-6,
  controlledNotch: {
    side: 'left',
    region: { minX: -0.42, maxX: -0.34, minY: 0.2, maxY: 0.27 },
  },
  notchComparisonMargin: 0.04,
  meaningfulTravelRelativeDelta: 0.02,
};

function profileSummary(profile) {
  return {
    source: profile.source,
    occupiedCells: profile.occupancy.filter(Boolean).length,
    meshTopology: profile.meshTopology,
    depthCoverageCells: profile.depthEnvelope.filter(Boolean).length,
    depthSpanQuantiles: [0.1, 0.5, 0.9, 0.95].map(quantile => {
      const spans = profile.depthEnvelope.filter(Boolean).map(cell => cell.maxZ - cell.minZ).sort((a, b) => a - b);
      return { quantile, span: spans[Math.floor((spans.length - 1) * quantile)] };
    }),
    controlledNotch: profile.controlledNotch || null,
  };
}

export function runArchDepthAssay(sourcePath, options = {}) {
  const configuration = { ...settings, contactPatchRadius: options.contactPatchRadius ?? settings.contactPatchRadius };
  if (!Number.isFinite(configuration.contactPatchRadius) || configuration.contactPatchRadius < 0) {
    throw new Error('contact patch radius must be finite and nonnegative');
  }
  const sourceBytes = readFileSync(sourcePath);
  const profile = buildArchProfileFromGlb(sourcePath, settings.resolution.columns,
    settings.resolution.rows, settings.sharedBounds);
  const notchedProfile = carveArchBoundaryNotch(profile, settings.controlledNotch);
  const cases = {};
  for (const [shape, currentProfile] of [['intact', profile], ['controlled-notch', notchedProfile]]) {
    cases[shape] = {};
    for (const depthMode of settings.depthModes) {
      const graph = buildArchStructuralProxy(currentProfile, {
        layers: settings.layers,
        depth: settings.uniformDepth,
        depthMode,
      });
      if (graph.components.length !== 1) throw new Error(`${shape}/${depthMode} graph is disconnected at rest`);
      cases[shape][depthMode] = configuration.forces.map(force => runArchQuasistaticFracture(currentProfile, {
        ...configuration,
        notchComparisonRegion: settings.controlledNotch.region,
        depthMode,
        force,
      }));
    }
  }
  const contrast = {};
  for (const depthMode of settings.depthModes) {
    contrast[depthMode] = configuration.forces.map((force, index) => {
      const intact = cases.intact[depthMode][index];
      const notched = cases['controlled-notch'][depthMode][index];
      const intactFinal = intact.history.at(-1);
      const notchedFinal = notched.history.at(-1);
      const intactTravel = intactFinal?.travel ?? null;
      const notchedTravel = notchedFinal?.travel ?? null;
      const travelDelta = intactTravel === null || notchedTravel === null ? null : notchedTravel - intactTravel;
      const relativeTravelDelta = travelDelta === null || !intactTravel ? null : travelDelta / Math.abs(intactTravel);
      const intactLocalCracks = intact.history.reduce((sum, epoch) => sum + epoch.fracture.notchZone.newCrackEvents, 0);
      const notchedLocalCracks = notched.history.reduce((sum, epoch) => sum + epoch.fracture.notchZone.newCrackEvents, 0);
      return {
        force,
        intact: {
          status: intact.status,
          brokenBonds: intact.totalBrokenBonds,
          travel: intactTravel,
          components: intact.finalComponents,
          damageSolves: intact.history.length,
        },
        controlledNotch: {
          status: notched.status,
          brokenBonds: notched.totalBrokenBonds,
          travel: notchedTravel,
          components: notched.finalComponents,
          damageSolves: notched.history.length,
        },
        travelDelta,
        relativeTravelDelta,
        brokenBondDelta: notched.totalBrokenBonds - intact.totalBrokenBonds,
        intactLocalCrackEvents: intactLocalCracks,
        controlledNotchLocalCrackEvents: notchedLocalCracks,
        localCrackDelta: notchedLocalCracks - intactLocalCracks,
        responseDistinguishable: intact.status !== notched.status ||
          intact.totalBrokenBonds !== notched.totalBrokenBonds ||
          notchedLocalCracks !== intactLocalCracks ||
          (relativeTravelDelta !== null && Math.abs(relativeTravelDelta) >= configuration.meaningfulTravelRelativeDelta),
      };
    });
  }
  const depthAwareContrast = contrast['surface-envelope'];
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const dirtyPaths = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter(Boolean).map(line => line.slice(3));
  const implementationPaths = [
    'structural-material-arch-core.js',
    'structural-material-arch-profile.mjs',
    'structural-material-arch-depth-assay.mjs',
  ];
  return {
    schema: 'kaminos.structural-material.arch-depth-assay.v0',
    status: 'passed',
    claim: 'a single open TRELLIS arch surface supplies a per-cell Z envelope to a coarse spring graph; a controlled exterior notch and a uniform-depth control are compared under matched crown forces with quasistatic damage re-solved after each live-bond update',
    claimCeiling: [
      'surface-derived per-cell depth envelope; the GLB is open and no source-truth solid interior is claimed',
      'three graph layers fill the measured envelope as an explicit structural reconstruction',
      'single zero-span sample is expanded to the union of its measured Z point and the separate median lower/upper surfaces of valid 8-neighbors; the inferred cell is recorded and remains inside source bounds',
      'linear spring PCG in normalized proxy units; no calibrated stone constitutive law or SI force',
      'post-break solve is same-force linear re-equilibration from fixed reference geometry, not nonlinear residual deformation or history-dependent plasticity',
      'load-path separation is a quasistatic terminal condition; detached inertia, collision, mesh separation, GPU execution, and sound playback are not included',
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
      profile: profileSummary(profile),
      controlledNotchProfile: profileSummary(notchedProfile),
      sameSource: profile.source.sha256 === notchedProfile.source.sha256,
    },
    configuration,
    proxy: {
      cases: Object.fromEntries(Object.entries(cases).map(([shape, modes]) => [shape,
        Object.fromEntries(Object.entries(modes).map(([depthMode, runs]) => {
          const first = runs[0];
          const graph = buildArchStructuralProxy(shape === 'intact' ? profile : notchedProfile, {
            layers: settings.layers,
            depth: settings.uniformDepth,
            depthMode,
          });
          return [depthMode, {
            nodes: graph.nodes.length,
            bonds: graph.bonds.length,
            componentsAtRest: graph.components.length,
            inferredDepthCells: graph.inferredDepthCells,
            geometryAuthority: graph.geometryAuthority,
            exampleContact: first.history[0]?.contact || first.terminal?.contact || null,
            runs,
          }];
        }))])),
    },
    contrast,
    adjudication: {
      depthAwareNotchChangesMeasuredOutcome: depthAwareContrast.some(result => result.responseDistinguishable),
      matchedLoadPathStatusDiffers: depthAwareContrast.some(result => result.intact.status !== result.controlledNotch.status),
      additionalShoulderCracks: depthAwareContrast.filter(result => result.localCrackDelta > 0).map(result => ({
        force: result.force,
        intactEvents: result.intactLocalCrackEvents,
        notchEvents: result.controlledNotchLocalCrackEvents,
      })),
      damageSolveCountDiffers: depthAwareContrast.filter(result =>
        result.intact.damageSolves !== result.controlledNotch.damageSolves).map(result => ({
        force: result.force,
        intactSolves: result.intact.damageSolves,
        notchSolves: result.controlledNotch.damageSolves,
      })),
      interpretation: depthAwareContrast.some(result => result.responseDistinguishable)
        ? 'same-source controlled shoulder removal changes the depth-envelope proxy damage history under matched crown force; this supports geometry-conditioned behavior of the expressive proxy, not calibrated stone prediction'
        : 'controlled shoulder-notch effect is not resolved in the depth-envelope proxy at this rasterization and force ladder',
    },
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [sourceArgument, outputArgument, contactPatchArgument] = process.argv.slice(2);
  if (!sourceArgument || !outputArgument) {
    throw new Error('usage: node structural-material-arch-depth-assay.mjs <source.glb> <output.json> [contact-patch-radius]');
  }
  const sourcePath = resolve(process.cwd(), sourceArgument);
  const outputPath = resolve(process.cwd(), outputArgument);
  const contactPatchRadius = contactPatchArgument === undefined ? 0 : Number(contactPatchArgument);
  const report = {
    schema: 'kaminos.structural-material.arch-depth-assay.v0',
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
    configuration: { ...settings, contactPatchRadius },
    lastTrustworthyEvidence: `source path ${sourcePath} and output path ${outputPath} accepted; source not yet read`,
  };
  try {
    mkdirSync(dirname(outputPath), { recursive: true });
    report.phase = 'load-source-and-run-depth-assay';
    Object.assign(report, runArchDepthAssay(sourcePath, { contactPatchRadius }));
    report.phase = 'complete';
    report.lastTrustworthyEvidence = `same-source intact/notch and uniform/depth-envelope force ladders completed at contact patch radius ${contactPatchRadius}`;
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({
      output: outputPath,
      route: report.route,
      sourceSha256: report.source.sha256,
      adjudication: report.adjudication,
      contrast: report.contrast,
    }, null, 2));
  } catch (error) {
    report.status = 'failed';
    report.error = { phase: report.phase, message: error.message, stack: error.stack };
    report.lastTrustworthyEvidence = report.lastTrustworthyEvidence || 'no source-derived evidence';
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.error(`arch depth assay failed during ${report.phase}: ${error.stack || error.message}`);
    console.error(`durable report: ${outputPath}`);
    process.exitCode = 1;
  }
}
