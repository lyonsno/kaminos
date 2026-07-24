#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  createSmoothFittedProxyRigBinding,
  createSmoothFittedProxyRigProbeBinding,
  evaluateMotionContactProbeRequest,
} from './lirm-reference-fitted-armature-core.mjs';
import {
  locateEditablePrimitive,
  normalizePositions,
  parseGlb,
  readAccessor,
} from './lirm-smooth-fitted-proxy-rig-assay.mjs';

export const MOTION_CONTACT_PROBE_ADAPTER_ROUTE =
  'kaminos/fitted-proxy-rig/motion-contact-probe-adapter-v0';

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!value || !name.startsWith('--')) throw new Error(`missing value for ${name}`);
    options[name.slice(2)] = value;
  }
  for (const name of ['source', 'registration', 'contact-atlas', 'input', 'out-dir']) {
    if (!options[name]) throw new Error(`motion contact probe exercise requires --${name}`);
  }
  return options;
}

function finiteResponse(response, requestedIds) {
  return response?.schema === 'kaminos.motion-contact-probe-set.v0'
    && Array.isArray(response.patches)
    && response.patches.length === requestedIds.length
    && response.patches.every((patch, index) => (
      patch.id === requestedIds[index]
      && Array.isArray(patch.worldPosition)
      && patch.worldPosition.length === 3
      && patch.worldPosition.every(Number.isFinite)
    ));
}

export async function runMotionContactProbeHandshakeExercise({
  sourcePath,
  registrationPath,
  contactAtlasPath,
  inputPath,
  outDir,
} = {}) {
  const outputRoot = resolve(outDir);
  await mkdir(outputRoot, { recursive: true });
  const reportPath = resolve(outputRoot, 'report.json');
  const fixturePath = resolve(outputRoot, 'stationary-hill-request-response.json');
  const startedAt = Date.now();
  const report = {
    schema: 'kaminos.motion-contact-probe-handshake-exercise.v0',
    status: 'running',
    failurePhase: null,
    requestedRoute: MOTION_CONTACT_PROBE_ADAPTER_ROUTE,
    effectiveRoute: null,
    inputs: {
      source: { path: sourcePath ? relative(outputRoot, resolve(sourcePath)) : null, sha256: null },
      registration: {
        path: registrationPath ? relative(outputRoot, resolve(registrationPath)) : null,
        sha256: null,
      },
      contactAtlas: {
        path: contactAtlasPath ? relative(outputRoot, resolve(contactAtlasPath)) : null,
        sha256: null,
      },
      handshake: { path: inputPath ? relative(outputRoot, resolve(inputPath)) : null, sha256: null },
    },
    outputInventory: {},
    results: {},
    timing: {
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: null,
      durationSeconds: null,
    },
    lastTrustworthyEvidence: 'invocation recorded; inputs not admitted',
    error: null,
  };
  await writeJsonAtomic(reportPath, report);
  let phase = 'input-admission';
  try {
    if (![sourcePath, registrationPath, contactAtlasPath, inputPath].every(path => path && existsSync(path))) {
      throw new Error('motion contact probe exercise requires existing source, registration, atlas, and input');
    }
    const [sourceBytes, registrationBytes, contactAtlasBytes, inputBytes] = await Promise.all([
      readFile(sourcePath),
      readFile(registrationPath),
      readFile(contactAtlasPath),
      readFile(inputPath),
    ]);
    report.inputs.source.sha256 = sha256(sourceBytes);
    report.inputs.registration.sha256 = sha256(registrationBytes);
    report.inputs.contactAtlas.sha256 = sha256(contactAtlasBytes);
    report.inputs.handshake.sha256 = sha256(inputBytes);
    const registration = JSON.parse(registrationBytes);
    const contactAtlas = JSON.parse(contactAtlasBytes);
    const input = JSON.parse(inputBytes);
    if (registration.schema !== 'kaminos.lirm-fitted-proxy-rig-registration.v0'
        || registration.donorSha256 !== report.inputs.source.sha256) {
      throw new Error('fitted registration does not bind the exact source GLB');
    }
    if (input.schema !== 'kaminos.motion-contact-probe-handshake-input.v0') {
      throw new Error('motion contact probe handshake input schema mismatch');
    }
    report.lastTrustworthyEvidence = 'exact source, registration, contact atlas, and handshake bytes admitted';

    phase = 'binding';
    await writeJsonAtomic(reportPath, report);
    const { json, binary } = parseGlb(sourceBytes);
    const primitive = locateEditablePrimitive(json);
    const sourcePositions = readAccessor(json, binary, primitive.attributes.POSITION, 'VEC3').values;
    const normalization = normalizePositions(sourcePositions);
    const binding = createSmoothFittedProxyRigBinding({
      positions: normalization.values,
      registration,
      sampleCount: input.adapterConfig.curveSampleCount,
    });
    const probeBinding = createSmoothFittedProxyRigProbeBinding({
      binding,
      contactAtlas,
      contactAtlasSha256: report.inputs.contactAtlas.sha256,
    });

    phase = 'probe-evaluation';
    const response = evaluateMotionContactProbeRequest({
      binding,
      probeBinding,
      request: input.request,
      prepass: input.prepass,
      normalization,
      contactPlaneY: input.adapterConfig.contactPlaneY,
      amplitude: input.adapterConfig.amplitude,
      poseId: input.adapterConfig.poseId,
    });
    const requestedIds = input.request.patches.map(patch => patch.id);
    if (!finiteResponse(response, requestedIds)) {
      throw new Error('motion contact probe producer returned a partial or non-finite response');
    }
    const fixture = {
      schema: 'kaminos.motion-contact-probe-handshake-fixture.v0',
      effectiveRoute: MOTION_CONTACT_PROBE_ADAPTER_ROUTE,
      source: {
        castSha256: report.inputs.source.sha256,
        fittedRegistrationSha256: report.inputs.registration.sha256,
        contactAtlasSha256: report.inputs.contactAtlas.sha256,
        handshakeInputSha256: report.inputs.handshake.sha256,
      },
      normalization: {
        center: normalization.center,
        scale: normalization.scale,
      },
      prepass: input.prepass,
      request: input.request,
      response,
    };
    await writeJsonAtomic(fixturePath, fixture);
    const fixtureBytes = await readFile(fixturePath);
    report.effectiveRoute = MOTION_CONTACT_PROBE_ADAPTER_ROUTE;
    report.outputInventory.fixture = {
      path: relative(outputRoot, fixturePath),
      bytes: fixtureBytes.length,
      sha256: sha256(fixtureBytes),
    };
    report.results = {
      requestId: response.requestId,
      prepassId: response.prepassId,
      supportSurface: response.supportSurface,
      body: response.body,
      poseId: response.poseId,
      phase: response.phase,
      patchIds: response.patches.map(patch => patch.id),
      patchWorldPositions: Object.fromEntries(
        response.patches.map(patch => [patch.id, patch.worldPosition]),
      ),
    };
    report.status = 'pass';
    report.lastTrustworthyEvidence = 'byte-bound deterministic request/response fixture written';
  } catch (error) {
    report.status = 'fail';
    report.error = {
      name: error?.name || 'Error',
      message: String(error?.message || error),
      stack: String(error?.stack || ''),
    };
    report.failurePhase = phase;
  } finally {
    const finishedAt = Date.now();
    report.timing.finishedAt = new Date(finishedAt).toISOString();
    report.timing.durationSeconds = (finishedAt - startedAt) / 1000;
    await writeJsonAtomic(reportPath, report);
  }
  return report;
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    const report = await runMotionContactProbeHandshakeExercise({
      sourcePath: options.source,
      registrationPath: options.registration,
      contactAtlasPath: options['contact-atlas'],
      inputPath: options.input,
      outDir: options['out-dir'],
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== 'pass') process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}
