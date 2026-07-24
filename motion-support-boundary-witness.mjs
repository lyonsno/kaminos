#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  createMotionContactProbeRequest,
  resolveMotionContactConstraints,
  solveMotionSupportPrepass,
} from './motion-support-core.js';
import {
  createAxialBodySupportFootprint,
  createHillMotionSupportIdentity,
  createHillSampledSupportSurface,
} from './hill-motion-support-adapter.js';
import {
  sampleHillTerrainSurface,
  validateAxialCrawlerRegistration,
} from './motion-ready-719024-core.js';
import { decodeHillMotionAffordancePacket } from './motion-core.js';

function parseArguments(argv) {
  const result = {
    output: '',
    expectedSurfaceRevision: '',
    probeMode: 'complete',
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--output') {
      result.output = value || '';
      index++;
    } else if (argument === '--expected-surface-revision') {
      result.expectedSurfaceRevision = value || '';
      index++;
    } else if (argument === '--probe-mode') {
      result.probeMode = value || '';
      index++;
    } else {
      throw new Error(`unknown argument ${argument}`);
    }
  }
  if (!result.output) throw new Error('motion support witness requires --output');
  if (!['complete', 'missing-last'].includes(result.probeMode)) {
    throw new Error('motion support witness probe mode must be complete or missing-last');
  }
  return result;
}

function errorRecord(error) {
  return {
    name: error?.name || 'Error',
    message: String(error?.message || error),
    stack: String(error?.stack || ''),
  };
}

const requested = parseArguments(process.argv.slice(2));
const outputPath = resolve(requested.output);
const report = {
  schema: 'kaminos.motion-support-boundary-witness-report.v0',
  status: 'fail',
  failurePhase: 'fixture-load',
  requested: {
    output: outputPath,
    expectedSurfaceRevision: requested.expectedSurfaceRevision || null,
    probeMode: requested.probeMode,
  },
  effective: {
    route: 'motion-support-core + hill-motion-support-adapter',
    supportSurface: null,
    probeMode: requested.probeMode,
    fixture: 'artifacts/motion-ready-719024',
  },
  evidence: {},
  error: null,
};

try {
  const packet = JSON.parse(await readFile(
    new URL('artifacts/motion-ready-719024/hill/motion-affordance-packet.json', import.meta.url),
    'utf8',
  ));
  const data = JSON.parse(await readFile(
    new URL('artifacts/motion-ready-719024/hill/motion-affordance-data.json', import.meta.url),
    'utf8',
  ));
  const registration = validateAxialCrawlerRegistration(JSON.parse(await readFile(
    new URL('artifacts/motion-ready-719024/registration.json', import.meta.url),
    'utf8',
  )));
  const atlas = JSON.parse(await readFile(
    new URL('artifacts/motion-ready-719024/contact-atlas.json', import.meta.url),
    'utf8',
  ));
  const hillSource = decodeHillMotionAffordancePacket({ packet, data });
  const identity = createHillMotionSupportIdentity(packet);
  const surface = createHillSampledSupportSurface(hillSource, identity);
  const footprint = createAxialBodySupportFootprint(registration, {
    id: 'motion-ready-719024:axial-footprint',
    registrationId: 'motion-ready-719024:registration:cb519913ad863441',
    scale: 1.14,
  });
  report.effective.supportSurface = { ...identity };
  report.effective.body = {
    id: footprint.id,
    registrationId: footprint.registrationId,
    scale: footprint.scale,
  };

  report.failurePhase = 'support-prepass';
  const bounds = hillSource.worldBounds;
  const base = [
    bounds.x.min + (bounds.x.max - bounds.x.min) * 0.54,
    0,
    bounds.z.min + (bounds.z.max - bounds.z.min) * 0.43,
  ];
  base[1] = sampleHillTerrainSurface(hillSource, base[0], base[2]).height;
  const common = {
    rootSurface: base,
    forward: [0.77, 0, -0.64],
    clearance: 0.018,
    lateralExcursion: 0.1,
    maxPitchRadians: Math.PI / 5,
    maxBendRadiansPerStation: Math.PI / 10,
    maxSuspensionLift: 0.114,
    expectedSurfaceRevision: requested.expectedSurfaceRevision || identity.revision,
  };
  const stationary = solveMotionSupportPrepass(surface, footprint, {
    ...common,
    id: 'stationary-hill-prepass',
  });
  report.evidence.stationaryPrepass = {
    schema: stationary.schema,
    id: stationary.id,
    plannerDisposition: stationary.support.plannerDisposition,
    minimumNormalizedMargin: stationary.support.compliance.minimumNormalizedMargin,
    rootLift: stationary.support.rootLift,
    sampleCount: stationary.support.samples.length,
  };

  report.failurePhase = 'short-rail-prepass';
  const offsets = [
    [-0.04, 0.033],
    [-0.02, 0.016],
    [0, 0],
    [0.02, -0.016],
    [0.04, -0.033],
  ];
  const shortRail = offsets.map(([xOffset, zOffset], index) => {
    const sampled = surface.sample(base[0] + xOffset, base[2] + zOffset);
    return solveMotionSupportPrepass(surface, footprint, {
      ...common,
      id: `short-rail-prepass:${index}`,
      rootSurface: sampled.world,
    });
  });
  report.evidence.shortRail = {
    schema: 'kaminos.motion-support-prepass-sequence.v0',
    prepassCount: shortRail.length,
    ids: shortRail.map(prepass => prepass.id),
    plannerDispositions: shortRail.map(prepass => prepass.support.plannerDisposition),
    minimumNormalizedMargin: Math.min(
      ...shortRail.map(prepass => prepass.support.compliance.minimumNormalizedMargin),
    ),
    maximumRootLiftDelta: Math.max(
      ...shortRail.slice(1).map((prepass, index) => (
        Math.abs(prepass.support.rootLift - shortRail[index].support.rootLift)
      )),
    ),
  };

  report.failurePhase = 'probe-request';
  const request = createMotionContactProbeRequest(stationary, atlas, {
    id: 'stationary-hill-probes:C',
    phase: 1.3,
    poseId: 'molten-low-frequency:C',
  });
  const probes = request.patches.map((patch, index) => {
    const longitudinal = index < 2 ? -0.31 : 0.31;
    const lateral = index % 2 === 0 ? footprint.halfWidth * 0.72 : -footprint.halfWidth * 0.72;
    const x = stationary.rootSurface[0]
      + stationary.frame.forward[0] * longitudinal
      + stationary.frame.right[0] * lateral;
    const z = stationary.rootSurface[2]
      + stationary.frame.forward[2] * longitudinal
      + stationary.frame.right[2] * lateral;
    const terrain = surface.sample(x, z);
    return {
      id: patch.id,
      worldPosition: [x, terrain.world[1] + 0.012 + index * 0.004, z],
    };
  });
  if (requested.probeMode === 'missing-last') probes.pop();
  const probeSet = {
    schema: 'kaminos.motion-contact-probe-set.v0',
    requestId: request.id,
    prepassId: request.prepassId,
    supportSurface: { ...request.supportSurface },
    body: { ...request.body },
    contactAtlas: { ...request.contactAtlas },
    poseId: request.poseId,
    phase: request.phase,
    patches: probes,
  };

  report.failurePhase = 'contact-resolution';
  const constraints = resolveMotionContactConstraints(
    surface,
    stationary,
    request,
    probeSet,
  );
  report.evidence.contactConstraints = {
    schema: constraints.schema,
    id: constraints.id,
    patchCount: constraints.patches.length,
    contactStates: Object.fromEntries(
      constraints.patches.map(patch => [patch.id, patch.contactState]),
    ),
    maximumAbsoluteDistance: Math.max(
      ...constraints.patches.map(patch => Math.abs(patch.signedDistance)),
    ),
  };
  report.status = 'pass';
  report.failurePhase = null;
} catch (error) {
  report.error = errorRecord(error);
} finally {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}

if (report.status !== 'pass') {
  console.error(`${report.failurePhase}: ${report.error?.message || 'unknown failure'}`);
  process.exitCode = 1;
} else {
  console.log(outputPath);
}
