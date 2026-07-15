import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SCHEMA = 'kaminos-boundary-splat-supervision-corpus-v0';
const AUTHORITY = 'live-simulator-frozen-state-candidate-raymarch-v0';
const COMPOSITION_IDENTITY = 'boundary-splat-supervision-multi-cohort-composition-v0';
const SEQUENCE_AUTHORITY = 'explicit-multi-corpus-cohort-composition-v0';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function exactArray(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${label} order must equal ${JSON.stringify(expected)}`);
  }
}

function exactObject(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} must match across source corpora`);
}

async function atomicJsonWrite(path, value) {
  const outputPath = resolve(path);
  await mkdir(dirname(outputPath), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const temporaryPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, bytes);
  await rename(temporaryPath, outputPath);
  return { path: outputPath, bytes, sha256: sha256(bytes) };
}

function validateCohorts(cohorts) {
  if (!Array.isArray(cohorts) || cohorts.length < 2) throw new Error('at least two cohorts are required');
  const labels = new Set();
  for (const [index, cohort] of cohorts.entries()) {
    if (!cohort || typeof cohort !== 'object') throw new Error(`cohort ${index} must be an object`);
    if (typeof cohort.label !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(cohort.label)) {
      throw new Error(`cohort ${index} label must be a stable path-safe identity`);
    }
    if (labels.has(cohort.label)) throw new Error('cohort labels must be unique');
    labels.add(cohort.label);
    if (typeof cohort.manifestPath !== 'string' || cohort.manifestPath.length === 0) {
      throw new Error(`cohort ${cohort.label} manifest path must be nonblank`);
    }
  }
}

function validateManifest(manifest, label, reference) {
  if (!manifest || typeof manifest !== 'object') throw new Error(`${label} corpus must be an object`);
  if (manifest.schema !== SCHEMA) throw new Error(`${label} corpus schema must be ${SCHEMA}`);
  if (manifest.authority !== AUTHORITY) throw new Error(`${label} corpus authority must be ${AUTHORITY}`);
  if (!Array.isArray(manifest.candidateOrder) || manifest.candidateOrder.length === 0) throw new Error(`${label} candidate order is missing`);
  if (!Array.isArray(manifest.featureOrder) || manifest.featureOrder.length === 0) throw new Error(`${label} feature order is missing`);
  if (!Array.isArray(manifest.frames) || manifest.frames.length === 0) throw new Error(`${label} corpus frames are missing`);
  if (!manifest.warmup || typeof manifest.warmup !== 'object') throw new Error(`${label} corpus warmup receipt is missing`);
  if (reference) {
    exactArray(manifest.candidateOrder, reference.candidateOrder, `${label} candidate`);
    exactArray(manifest.featureOrder, reference.featureOrder, `${label} feature`);
    exactObject(manifest.warmup, reference.warmup, `${label} warmup receipt`);
  }
  const frameIds = new Set();
  for (const [index, frame] of manifest.frames.entries()) {
    if (!frame || typeof frame !== 'object') throw new Error(`${label} frame ${index} must be an object`);
    if (typeof frame.id !== 'string' || frame.id.length === 0) throw new Error(`${label} frame ${index} identity is missing`);
    if (frameIds.has(frame.id)) throw new Error(`${label} frame identities must be unique`);
    frameIds.add(frame.id);
    const inputRadius = frame.controlConditioning?.values?.inputRadius;
    if (typeof inputRadius !== 'number' || !Number.isFinite(inputRadius)) {
      throw new Error(`${label} frame ${index} input-radius conditioning is missing`);
    }
  }
}

export async function composeBoundarySplatSupervisionCorpora({ cohorts, outPath, reportPath }) {
  let failurePhase = 'arguments';
  let lastTrustworthyEvidence = null;
  try {
    validateCohorts(cohorts);
    if (typeof outPath !== 'string' || outPath.length === 0) throw new Error('output path must be nonblank');
    if (typeof reportPath !== 'string' || reportPath.length === 0) throw new Error('report path must be nonblank');

    failurePhase = 'input-read';
    const sources = [];
    for (const cohort of cohorts) {
      const manifestPath = resolve(cohort.manifestPath);
      const bytes = await readFile(manifestPath);
      if (bytes.length === 0) throw new Error(`${cohort.label} corpus is blank`);
      let manifest;
      try {
        manifest = JSON.parse(bytes.toString('utf8'));
      } catch (error) {
        throw new Error(`${cohort.label} corpus JSON is invalid: ${error.message}`);
      }
      sources.push({
        label: cohort.label,
        manifestPath,
        bytes,
        sha256: sha256(bytes),
        manifest,
      });
    }

    failurePhase = 'input-validation';
    for (const [index, source] of sources.entries()) {
      validateManifest(source.manifest, source.label, index === 0 ? null : sources[0].manifest);
    }
    lastTrustworthyEvidence = {
      sourceCorpora: sources.map(source => ({
        label: source.label,
        path: source.manifestPath,
        sha256: source.sha256,
        frameCount: source.manifest.frames.length,
      })),
    };

    failurePhase = 'composition';
    const combinedFrameIds = new Set();
    const frames = [];
    for (const source of sources) {
      for (const frame of source.manifest.frames) {
        const id = `${source.label}/${frame.id}`;
        if (combinedFrameIds.has(id)) throw new Error(`composed frame identity collision: ${id}`);
        combinedFrameIds.add(id);
        frames.push({ ...frame, id, cohort: source.label });
      }
    }
    const first = sources[0].manifest;
    const stepDeltas = new Set(sources.map(source => source.manifest.stepDeltaMs));
    const manifest = {
      schema: SCHEMA,
      authority: AUTHORITY,
      candidateOrder: first.candidateOrder,
      featureOrder: first.featureOrder,
      requestedFrameCount: frames.length,
      sameBrowserSequenceSuitable: false,
      sequenceAuthority: SEQUENCE_AUTHORITY,
      stepDeltaMs: stepDeltas.size === 1 ? first.stepDeltaMs : null,
      warmup: first.warmup,
      composition: {
        identity: COMPOSITION_IDENTITY,
        authority: 'source-hashed-cohort-concatenation-v0',
        structuralValidationOnly: true,
        downstreamValidationRequired: 'validateBoundarySplatSupervisionCorpus-v0',
        sources: lastTrustworthyEvidence.sourceCorpora,
      },
      frames,
    };

    failurePhase = 'output-write';
    const output = await atomicJsonWrite(outPath, manifest);
    const receipt = {
      schema: 'kaminos.boundary-splat-supervision-composition-report.v0',
      status: 'composed',
      failurePhase: null,
      error: null,
      identity: COMPOSITION_IDENTITY,
      lastTrustworthyEvidence,
      output: {
        path: output.path,
        sha256: output.sha256,
        bytes: output.bytes.length,
        frameCount: frames.length,
        cohortCount: sources.length,
      },
    };
    failurePhase = 'report-write';
    await atomicJsonWrite(reportPath, receipt);
    return receipt;
  } catch (error) {
    const report = {
      schema: 'kaminos.boundary-splat-supervision-composition-report.v0',
      status: 'failed',
      failurePhase,
      error: error?.message || String(error),
      identity: COMPOSITION_IDENTITY,
      lastTrustworthyEvidence,
      output: null,
    };
    if (typeof reportPath === 'string' && reportPath.length > 0) {
      try {
        await atomicJsonWrite(reportPath, report);
      } catch (reportError) {
        error.reportWriteError = reportError?.message || String(reportError);
      }
    }
    throw error;
  }
}

function parseCli(argv) {
  const cohorts = [];
  let outPath = null;
  let reportPath = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--cohort') {
      if (typeof value !== 'string') throw new Error('--cohort requires label=manifest-path');
      const split = value.indexOf('=');
      if (split <= 0 || split === value.length - 1) throw new Error('--cohort requires label=manifest-path');
      cohorts.push({ label: value.slice(0, split), manifestPath: value.slice(split + 1) });
      index += 1;
    } else if (arg === '--out') {
      outPath = value;
      index += 1;
    } else if (arg === '--report') {
      reportPath = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { cohorts, outPath, reportPath };
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  let options;
  try {
    options = parseCli(process.argv.slice(2));
    const receipt = await composeBoundarySplatSupervisionCorpora(options);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: 'failed',
      error: error?.message || String(error),
      reportPath: options?.reportPath || null,
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
