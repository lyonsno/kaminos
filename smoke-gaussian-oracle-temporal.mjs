#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SMOKE_GAUSSIAN_ORACLE_TEMPORAL_IDENTITY = 'smoke-gaussian-oracle-temporal-correspondence-v0';

const STATIC_FIT_IDENTITY = 'smoke-gaussian-oracle-static-fit-v0';
const EXPECTED_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const EXPECTED_PROTOTYPE = 'kaminos-volume-prototype-v0';
const EXPECTED_REPLAY = 'deterministic-replay-same-route-controls-fixed-step-v0';
const REQUIRED_CHANNELS = [
  'positionX', 'positionY', 'positionZ',
  'radius0', 'radius1', 'radius2',
  'extinctionMass',
  'velocityX', 'velocityY', 'velocityZ',
  'sourceVoxelCount',
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function resolveArtifactPath(anchorPath, artifactPath) {
  if (isAbsolute(artifactPath)) return artifactPath;
  const fromCwd = resolve(artifactPath);
  if (existsSync(fromCwd)) return fromCwd;
  return resolve(dirname(anchorPath), artifactPath);
}

function requirePositiveIntegerBudget(value) {
  const budget = Number(value);
  if (!Number.isInteger(budget) || budget <= 0) throw new Error(`positive integer budget required, got ${value}`);
  return budget;
}

function normalizeBudgets(budgets) {
  if (!Array.isArray(budgets) || budgets.length === 0) throw new Error('at least one positive integer budget is required');
  const normalized = budgets.map(requirePositiveIntegerBudget);
  return Array.from(new Set(normalized)).sort((left, right) => left - right);
}

async function readJson(path) {
  return JSON.parse((await readFile(path)).toString('utf8'));
}

async function loadManifest(reportPath, teacher) {
  if (!teacher?.manifestPath) throw new Error('static fit report lacks teacher manifest path');
  const manifestPath = resolveArtifactPath(reportPath, teacher.manifestPath);
  const bytes = await readFile(manifestPath);
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.effectiveRoute !== EXPECTED_ROUTE) throw new Error(`wrong effective route: ${manifest.effectiveRoute || '(missing)'}`);
  if (manifest.prototypeIdentity !== EXPECTED_PROTOTYPE) throw new Error(`wrong prototype identity: ${manifest.prototypeIdentity || '(missing)'}`);
  if (typeof manifest.backend !== 'string' || !manifest.backend.startsWith('WebGPU:')) throw new Error(`wrong backend: ${manifest.backend || '(missing)'}`);
  const replay = manifest.deterministicReplay || {};
  if (replay.identity !== EXPECTED_REPLAY || replay.authority !== 'same-route-controls-fixed-step-replay') {
    throw new Error('teacher manifest lacks deterministic same-route replay authority');
  }
  for (const key of ['effectiveRoute', 'prototypeIdentity', 'backend', 'grid']) {
    if (replay[key] !== manifest[key]) throw new Error(`teacher replay ${key} does not match manifest`);
  }
  const simStepCount = Number(replay.simStepCount ?? replay.completedSteps);
  if (!Number.isInteger(simStepCount) || simStepCount < 0) throw new Error('teacher manifest lacks integer sim step count');
  const worldSpace = manifest.worldSpace || {};
  if (worldSpace.transformAuthority !== 'native-volume-grid-world-transform-v0') {
    throw new Error('teacher manifest lacks native world-space transform authority');
  }
  return {
    manifestPath,
    manifestIdentity: `sha256:${sha256(bytes)}`,
    manifest,
    simStepCount,
  };
}

function channelMap(channelOrder) {
  const map = Object.fromEntries(channelOrder.map((name, index) => [name, index]));
  for (const name of REQUIRED_CHANNELS) {
    if (!Number.isInteger(map[name])) throw new Error(`Gaussian artifact lacks ${name} channel`);
  }
  return map;
}

async function loadGaussianRows(reportPath, budgetEntry) {
  const artifact = budgetEntry.artifact;
  if (!artifact || artifact.dtype !== 'float32' || artifact.byteOrder !== 'little-endian') throw new Error('Gaussian artifact is missing or incompatible');
  if (!Array.isArray(artifact.shape) || artifact.shape.length !== 2) throw new Error('Gaussian artifact shape is missing');
  if (artifact.shape[0] !== budgetEntry.activeGaussianCount) throw new Error('Gaussian artifact row count does not match active Gaussian count');
  if (!sameArray(artifact.channelOrder, artifact.channelOrder)) throw new Error('Gaussian channel order is malformed');
  const map = channelMap(artifact.channelOrder);
  const artifactPath = resolveArtifactPath(reportPath, artifact.path);
  const bytes = await readFile(artifactPath);
  if (bytes.byteLength !== artifact.byteLength) throw new Error('Gaussian artifact byte length mismatch');
  const artifactSha = `sha256:${sha256(bytes)}`;
  if (artifactSha !== artifact.sha256) throw new Error(`Gaussian artifact sha256 mismatch: ${artifactSha} != ${artifact.sha256}`);
  const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
  const stride = artifact.shape[1];
  if (values.length !== artifact.shape[0] * stride) throw new Error('Gaussian artifact float count mismatch');
  const rows = [];
  for (let index = 0; index < artifact.shape[0]; index += 1) {
    const offset = index * stride;
    rows.push({
      index,
      position: [values[offset + map.positionX], values[offset + map.positionY], values[offset + map.positionZ]],
      radii: [values[offset + map.radius0], values[offset + map.radius1], values[offset + map.radius2]],
      extinctionMass: values[offset + map.extinctionMass],
      velocity: [values[offset + map.velocityX], values[offset + map.velocityY], values[offset + map.velocityZ]],
      sourceVoxelCount: values[offset + map.sourceVoxelCount],
    });
  }
  return {
    artifactPath,
    artifactIdentity: artifactSha,
    channelOrder: artifact.channelOrder,
    rows,
  };
}

async function loadFitReport(reportPath, requestedBudgets) {
  const absoluteReportPath = resolve(reportPath);
  const reportBytes = await readFile(absoluteReportPath);
  const report = JSON.parse(reportBytes.toString('utf8'));
  if (report.schema !== 'kaminos.smoke-gaussian-oracle-static-fit-report.v0'
    || report.identity !== STATIC_FIT_IDENTITY
    || report.status !== 'passed') {
    throw new Error('static fit report is not a passed smoke Gaussian oracle fit');
  }
  if (report.hiddenBudgetCapApplied !== false) throw new Error('static fit report applied or omitted hidden budget cap accounting');
  const teacher = report.teacher || {};
  if (teacher.effectiveRoute !== EXPECTED_ROUTE) throw new Error(`wrong effective route: ${teacher.effectiveRoute || '(missing)'}`);
  if (teacher.prototypeIdentity !== EXPECTED_PROTOTYPE) throw new Error(`wrong prototype identity: ${teacher.prototypeIdentity || '(missing)'}`);
  if (typeof teacher.backend !== 'string' || !teacher.backend.startsWith('WebGPU:')) throw new Error(`wrong backend: ${teacher.backend || '(missing)'}`);
  if (teacher.worldSpace?.transformAuthority !== 'native-volume-grid-world-transform-v0') throw new Error('static fit report lacks native world-space authority');
  const manifest = await loadManifest(absoluteReportPath, teacher);
  if (!Array.isArray(report.budgetCurve)) throw new Error('static fit report lacks budget curve');
  const budgets = new Map();
  for (const budget of requestedBudgets) {
    const entry = report.budgetCurve.find(item => item.requestedBudget === budget);
    if (!entry) throw new Error(`static fit report lacks requested budget ${budget}`);
    if (entry.activeGaussianCount !== budget) throw new Error(`budget ${budget} has active count ${entry.activeGaussianCount}; refusing hidden cap/substitution`);
    if (entry.extinctionAccounting?.relativeError > 1e-5) throw new Error(`budget ${budget} does not conserve extinction`);
    budgets.set(budget, {
      entry,
      gaussian: await loadGaussianRows(absoluteReportPath, entry),
    });
  }
  return {
    reportPath: absoluteReportPath,
    reportIdentity: `sha256:${sha256(reportBytes)}`,
    declaredReportIdentity: report.reportIdentity || null,
    report,
    manifest,
    frame: {
      reportPath: absoluteReportPath,
      manifestPath: manifest.manifestPath,
      manifestIdentity: manifest.manifestIdentity,
      simStepCount: manifest.simStepCount,
      effectiveRoute: teacher.effectiveRoute,
      prototypeIdentity: teacher.prototypeIdentity,
      backend: teacher.backend,
      grid: teacher.grid,
      worldSpace: teacher.worldSpace,
      totalSmokeExtinction: teacher.totalSmokeExtinction,
      activeSmokeVoxelCount: teacher.activeSmokeVoxelCount,
    },
    budgets,
  };
}

function squaredDistance(left, right) {
  const dx = left[0] - right[0];
  const dy = left[1] - right[1];
  const dz = left[2] - right[2];
  return dx * dx + dy * dy + dz * dz;
}

function distance(left, right) {
  return Math.sqrt(squaredDistance(left, right));
}

function majorRadius(row) {
  return Math.max(...row.radii.map(value => Math.abs(value)));
}

function weightedCentroid(rows) {
  const center = [0, 0, 0];
  const mass = rows.reduce((sum, row) => sum + row.extinctionMass, 0);
  if (!(mass > 0)) return center;
  for (const row of rows) {
    for (let axis = 0; axis < 3; axis += 1) center[axis] += row.position[axis] * row.extinctionMass;
  }
  return center.map(component => component / mass);
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function nearestDistance(row, candidates) {
  if (candidates.length === 0) return Infinity;
  return Math.min(...candidates.map(candidate => distance(row.position, candidate.position)));
}

function summarizeRows(rows) {
  return {
    activeGaussianCount: rows.length,
    totalExtinction: rows.reduce((sum, row) => sum + row.extinctionMass, 0),
    centroid: weightedCentroid(rows),
    maxRadius: Math.max(...rows.map(majorRadius)),
    totalSourceVoxelCount: rows.reduce((sum, row) => sum + row.sourceVoxelCount, 0),
  };
}

function compactTopologyRows(rows, oppositeRows) {
  return rows.map(row => ({
    index: row.index,
    position: row.position,
    extinctionMass: row.extinctionMass,
    nearestDistance: nearestDistance(row, oppositeRows),
  }));
}

function resolveInheritedCorrespondence(previousFrame, nextFrame, budget) {
  const warmStart = nextFrame.report.warmStart;
  if (!warmStart) return null;
  if (warmStart.authority !== 'prior-static-fit-artifact-bounded-residual-v0') {
    throw new Error('warm-start frame lacks prior static fit authority');
  }
  const sourceReportPath = resolveArtifactPath(nextFrame.reportPath, warmStart.sourceReportPath);
  if (sourceReportPath !== previousFrame.reportPath) throw new Error('warm-start source report path does not match preceding frame');
  if (warmStart.sourceReportIdentity !== previousFrame.reportIdentity) throw new Error('warm-start source report identity does not match preceding frame bytes');
  if (warmStart.fromSimStepCount !== previousFrame.frame.simStepCount
    || warmStart.toSimStepCount !== nextFrame.frame.simStepCount) {
    throw new Error('warm-start sim-step linkage does not match frame transition');
  }
  const previousBudget = previousFrame.budgets.get(budget);
  const nextBudget = nextFrame.budgets.get(budget);
  const budgetWarmStart = nextBudget.entry.warmStart;
  if (budgetWarmStart?.authority !== 'prior-artifact-centers-bounded-residual-v0') {
    throw new Error(`warm-start budget ${budget} lacks prior artifact center authority`);
  }
  if (budgetWarmStart.initialArtifactIdentity !== previousBudget.gaussian.artifactIdentity) {
    throw new Error(`warm-start budget ${budget} initial artifact identity does not match preceding artifact`);
  }
  if (budgetWarmStart.initialActiveGaussianCount !== previousBudget.gaussian.rows.length
    || nextBudget.gaussian.rows.length !== previousBudget.gaussian.rows.length) {
    throw new Error(`warm-start budget ${budget} changed inherited row count without topology accounting`);
  }
  if (budgetWarmStart.maxCenterResidual !== warmStart.maxCenterResidual) {
    throw new Error(`warm-start budget ${budget} residual bound does not match frame authority`);
  }
  const matches = previousBudget.gaussian.rows.map((previous, index) => {
    const next = nextBudget.gaussian.rows[index];
    const predicted = previous.position.map((component, axis) => component + previous.velocity[axis]);
    return {
      previousIndex: index,
      nextIndex: index,
      distance: distance(previous.position, next.position),
      massDelta: next.extinctionMass - previous.extinctionMass,
      velocityPredictionError: distance(predicted, next.position),
    };
  });
  const displacements = matches.map(match => match.distance);
  const velocityErrors = matches.map(match => match.velocityPredictionError);
  if (Math.max(0, ...displacements) > warmStart.maxCenterResidual + 1e-6) {
    throw new Error(`warm-start budget ${budget} artifact exceeds its center residual bound`);
  }
  return {
    authority: 'checksum-bound-prior-artifact-row-index-v0',
    sourceLinkVerified: true,
    sourceReportPath,
    sourceReportIdentity: previousFrame.reportIdentity,
    sourceArtifactPath: previousBudget.gaussian.artifactPath,
    sourceArtifactIdentity: previousBudget.gaussian.artifactIdentity,
    inheritedActiveGaussianCount: previousBudget.gaussian.rows.length,
    matchedCount: matches.length,
    birthCount: 0,
    deathCount: 0,
    maxCenterResidual: warmStart.maxCenterResidual,
    meanDisplacement: displacements.reduce((sum, value) => sum + value, 0) / Math.max(1, displacements.length),
    p95Displacement: percentile(displacements, 95),
    maxDisplacement: Math.max(0, ...displacements),
    meanVelocityPredictionError: velocityErrors.reduce((sum, value) => sum + value, 0) / Math.max(1, velocityErrors.length),
    matchedAbsoluteMassDelta: matches.reduce((sum, match) => sum + Math.abs(match.massDelta), 0),
    maximumAppliedCenterResidual: budgetWarmStart.maximumAppliedCenterResidual,
    meanAppliedCenterResidual: budgetWarmStart.meanAppliedCenterResidual,
    clippedCenterUpdateCount: budgetWarmStart.clippedCenterUpdateCount,
    matches: matches.slice(0, 32),
  };
}

function matchTransition(previousFrame, nextFrame, budget, maxMatchDistanceMultiplier) {
  const previousBudget = previousFrame.budgets.get(budget);
  const nextBudget = nextFrame.budgets.get(budget);
  const previousRows = previousBudget.gaussian.rows;
  const nextRows = nextBudget.gaussian.rows;
  const previousSummary = summarizeRows(previousRows);
  const nextSummary = summarizeRows(nextRows);
  const maxMatchDistance = Math.max(previousSummary.maxRadius, nextSummary.maxRadius) * maxMatchDistanceMultiplier;
  const candidates = [];
  for (const previous of previousRows) {
    for (const next of nextRows) {
      candidates.push({
        previousIndex: previous.index,
        nextIndex: next.index,
        distance: distance(previous.position, next.position),
      });
    }
  }
  candidates.sort((left, right) => left.distance - right.distance);
  const matchedPrevious = new Set();
  const matchedNext = new Set();
  const matches = [];
  for (const candidate of candidates) {
    if (candidate.distance > maxMatchDistance) break;
    if (matchedPrevious.has(candidate.previousIndex) || matchedNext.has(candidate.nextIndex)) continue;
    matchedPrevious.add(candidate.previousIndex);
    matchedNext.add(candidate.nextIndex);
    const previous = previousRows[candidate.previousIndex];
    const next = nextRows[candidate.nextIndex];
    const predicted = previous.position.map((component, axis) => component + previous.velocity[axis]);
    matches.push({
      previousIndex: previous.index,
      nextIndex: next.index,
      distance: candidate.distance,
      massDelta: next.extinctionMass - previous.extinctionMass,
      velocityPredictionError: distance(predicted, next.position),
    });
  }
  const deaths = previousRows.filter(row => !matchedPrevious.has(row.index));
  const births = nextRows.filter(row => !matchedNext.has(row.index));
  const splits = previousRows.map(previous => {
    const children = nextRows
      .filter(next => distance(previous.position, next.position) <= maxMatchDistance)
      .map(next => next.index);
    const unmatchedChildren = children.filter(nextIndex => !matches.some(match => match.nextIndex === nextIndex));
    return children.length > 1 && unmatchedChildren.length > 0
      ? { previousIndex: previous.index, nextIndices: children, unmatchedNextIndices: unmatchedChildren }
      : null;
  }).filter(Boolean);
  const merges = nextRows.map(next => {
    const parents = previousRows
      .filter(previous => distance(previous.position, next.position) <= maxMatchDistance)
      .map(previous => previous.index);
    const unmatchedParents = parents.filter(previousIndex => !matches.some(match => match.previousIndex === previousIndex));
    return parents.length > 1 && unmatchedParents.length > 0
      ? { nextIndex: next.index, previousIndices: parents, unmatchedPreviousIndices: unmatchedParents }
      : null;
  }).filter(Boolean);
  const displacements = matches.map(match => match.distance);
  const velocityErrors = matches.map(match => match.velocityPredictionError);
  const centroidDrift = distance(previousSummary.centroid, nextSummary.centroid);
  const inheritedCorrespondence = resolveInheritedCorrespondence(previousFrame, nextFrame, budget);
  return {
    budget,
    from: {
      simStepCount: previousFrame.frame.simStepCount,
      reportPath: previousFrame.reportPath,
      artifactPath: previousBudget.gaussian.artifactPath,
      artifactIdentity: previousBudget.gaussian.artifactIdentity,
    },
    to: {
      simStepCount: nextFrame.frame.simStepCount,
      reportPath: nextFrame.reportPath,
      artifactPath: nextBudget.gaussian.artifactPath,
      artifactIdentity: nextBudget.gaussian.artifactIdentity,
    },
    correspondence: {
      matchAlgorithm: 'greedy-nearest-world-distance-threshold-v0',
      maxMatchDistanceMultiplier,
      maxMatchDistance,
      matchedCount: matches.length,
      matchFractionOfPrevious: previousRows.length ? matches.length / previousRows.length : 0,
      matchFractionOfNext: nextRows.length ? matches.length / nextRows.length : 0,
      meanDisplacement: displacements.reduce((sum, value) => sum + value, 0) / Math.max(1, displacements.length),
      p95Displacement: percentile(displacements, 95),
      maxDisplacement: Math.max(0, ...displacements),
      meanVelocityPredictionError: velocityErrors.reduce((sum, value) => sum + value, 0) / Math.max(1, velocityErrors.length),
      matches: matches.slice(0, 32),
    },
    inheritedCorrespondence,
    topology: {
      birthCount: births.length,
      deathCount: deaths.length,
      splitCount: splits.length,
      mergeCount: merges.length,
      births: compactTopologyRows(births, previousRows).slice(0, 32),
      deaths: compactTopologyRows(deaths, nextRows).slice(0, 32),
      splits: splits.slice(0, 32),
      merges: merges.slice(0, 32),
    },
    opticalDrift: {
      previousTotalExtinction: previousSummary.totalExtinction,
      nextTotalExtinction: nextSummary.totalExtinction,
      totalExtinctionDelta: nextSummary.totalExtinction - previousSummary.totalExtinction,
      totalExtinctionRelativeDelta: (nextSummary.totalExtinction - previousSummary.totalExtinction) / Math.max(previousSummary.totalExtinction, 1e-12),
      centroidDrift,
      matchedAbsoluteMassDelta: matches.reduce((sum, match) => sum + Math.abs(match.massDelta), 0),
    },
    supportDrift: {
      previousSupportLeakageFraction: previousBudget.entry.support?.supportLeakageFraction ?? null,
      nextSupportLeakageFraction: nextBudget.entry.support?.supportLeakageFraction ?? null,
      previousMaxThreeSigmaDiameter: previousBudget.entry.support?.maxThreeSigmaDiameter ?? null,
      nextMaxThreeSigmaDiameter: nextBudget.entry.support?.maxThreeSigmaDiameter ?? null,
      previousMaxRadius: previousSummary.maxRadius,
      nextMaxRadius: nextSummary.maxRadius,
    },
  };
}

function validateFrameSequence(frames) {
  const first = frames[0];
  for (const frame of frames) {
    if (frame.frame.effectiveRoute !== first.frame.effectiveRoute) throw new Error('frame sequence effective route mismatch');
    if (frame.frame.prototypeIdentity !== first.frame.prototypeIdentity) throw new Error('frame sequence prototype identity mismatch');
    if (frame.frame.backend !== first.frame.backend) throw new Error('frame sequence backend mismatch');
    if (frame.frame.grid !== first.frame.grid) throw new Error('frame sequence grid mismatch');
    if (JSON.stringify(frame.frame.worldSpace?.bounds) !== JSON.stringify(first.frame.worldSpace?.bounds)) throw new Error('frame sequence world-space bounds mismatch');
  }
  for (let index = 1; index < frames.length; index += 1) {
    if (!(frames[index].frame.simStepCount > frames[index - 1].frame.simStepCount)) {
      throw new Error('frame sequence is not strictly increasing by sim step');
    }
  }
}

function summarizeBudgetTransitions(budget, transitions) {
  const selected = transitions.filter(transition => transition.budget === budget);
  return {
    budget,
    transitionCount: selected.length,
    minMatchedCount: Math.min(...selected.map(transition => transition.correspondence.matchedCount)),
    maxBirthCount: Math.max(...selected.map(transition => transition.topology.birthCount)),
    maxDeathCount: Math.max(...selected.map(transition => transition.topology.deathCount)),
    maxSplitCount: Math.max(...selected.map(transition => transition.topology.splitCount)),
    maxMergeCount: Math.max(...selected.map(transition => transition.topology.mergeCount)),
    maxMeanDisplacement: Math.max(...selected.map(transition => transition.correspondence.meanDisplacement)),
    maxP95Displacement: Math.max(...selected.map(transition => transition.correspondence.p95Displacement)),
    maxRelativeExtinctionDrift: Math.max(...selected.map(transition => Math.abs(transition.opticalDrift.totalExtinctionRelativeDelta))),
    maxSupportLeakageFraction: Math.max(...selected.flatMap(transition => [
      transition.supportDrift.previousSupportLeakageFraction ?? 0,
      transition.supportDrift.nextSupportLeakageFraction ?? 0,
    ])),
  };
}

export async function analyzeSmokeGaussianTemporalCorrespondence({
  fitReports,
  outDir,
  budgets = [32, 64, 128],
  maxMatchDistanceMultiplier = 2.5,
} = {}) {
  if (!Array.isArray(fitReports) || fitReports.length < 2) throw new Error('at least two static fit reports are required');
  if (!outDir) throw new Error('outDir is required');
  const requestedBudgets = normalizeBudgets(budgets);
  const distanceMultiplier = Number(maxMatchDistanceMultiplier);
  if (!(distanceMultiplier > 0)) throw new Error('maxMatchDistanceMultiplier must be positive');
  await mkdir(outDir, { recursive: true });
  const frames = [];
  for (const reportPath of fitReports) frames.push(await loadFitReport(reportPath, requestedBudgets));
  frames.sort((left, right) => left.frame.simStepCount - right.frame.simStepCount);
  validateFrameSequence(frames);
  const budgetTransitions = [];
  for (let frameIndex = 1; frameIndex < frames.length; frameIndex += 1) {
    for (const budget of requestedBudgets) {
      budgetTransitions.push(matchTransition(frames[frameIndex - 1], frames[frameIndex], budget, distanceMultiplier));
    }
  }
  const report = {
    schema: 'kaminos.smoke-gaussian-oracle-temporal-correspondence-report.v0',
    identity: SMOKE_GAUSSIAN_ORACLE_TEMPORAL_IDENTITY,
    status: 'passed',
    createdAt: new Date().toISOString(),
    requestedBudgets,
    hiddenBudgetCapApplied: false,
    correspondenceAuthority: {
      routePolicy: 'same-native-route-same-world-space-static-fit-sequence',
      matchSpace: 'continuous-kaminos-volume-world-v0',
      matchAlgorithm: 'greedy-nearest-world-distance-threshold-v0',
      maxMatchDistanceMultiplier: distanceMultiplier,
      topologyEvents: 'unmatched-birth-death-plus-neighborhood-split-merge-risk-v0',
    },
    frameSequence: frames.map(frame => frame.frame),
    budgetTransitions,
    budgetSummaries: requestedBudgets.map(budget => summarizeBudgetTransitions(budget, budgetTransitions)),
  };
  const reportPath = join(outDir, 'temporal-report.json');
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  await writeFile(reportPath, bytes);
  report.reportPath = reportPath;
  report.reportIdentity = `sha256:${sha256(bytes)}`;
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith('--')) continue;
    if (value && !value.startsWith('--')) {
      args.set(key, value);
      index += 1;
    } else {
      args.set(key, true);
    }
  }
  return args;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const fitReports = String(args.get('--fit-reports') || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const outDir = args.get('--out-dir');
  const budgets = String(args.get('--budgets') || '32,64,128')
    .split(',')
    .map(value => Number(value.trim()))
    .filter(value => value || value === 0);
  const maxMatchDistanceMultiplier = Number(args.get('--max-match-distance-multiplier') || 2.5);
  try {
    const report = await analyzeSmokeGaussianTemporalCorrespondence({
      fitReports,
      outDir,
      budgets,
      maxMatchDistanceMultiplier,
    });
    console.log(JSON.stringify({
      status: report.status,
      identity: report.identity,
      reportPath: report.reportPath,
      budgets: report.budgetSummaries,
    }, null, 2));
  } catch (error) {
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}
