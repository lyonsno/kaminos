import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const FIBROUS_HEAD_RETURN_MANIFEST_SCHEMA = 'kaminos.fibrous-head-return-manifest.v0';
export const FIBROUS_HEAD_RETURN_COMPLETION_SCHEMA = 'kaminos.fibrous-head-return-completion-receipt.v0';
export const FIBROUS_HEAD_RETURN_REPORT_SCHEMA = 'kaminos.fibrous-head-return-preflight-report.v0';

const SHA256 = /^[a-f0-9]{64}$/;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  if (typeof value === 'number' && Object.is(value, -0)) return 0;
  return value;
}

function equalJson(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function baseReport(manifest) {
  return {
    schema: FIBROUS_HEAD_RETURN_REPORT_SCHEMA,
    receiptId: manifest?.receiptId ?? null,
    state: 'preflight_failed',
    scientificAdmission: false,
    visualAdmission: 'unreviewed',
    claimCeiling: manifest?.claimCeiling ?? null,
    lastTrustworthyEvidence: 'none',
    source: manifest?.source ?? null,
    route: manifest?.reconstruction ?? null,
    regions: manifest?.regions ?? [],
    products: [],
    missing: [],
    blank: [],
    mismatched: [],
    failure: null,
  };
}

function failure(manifest, state, phase, message, extra = {}) {
  return {
    ...baseReport(manifest),
    state,
    failure: { phase, message },
    ...extra,
  };
}

function validateManifest(manifest) {
  if (!manifest || manifest.schema !== FIBROUS_HEAD_RETURN_MANIFEST_SCHEMA) {
    return `manifest schema must be ${FIBROUS_HEAD_RETURN_MANIFEST_SCHEMA}`;
  }
  for (const [name, entry] of [
    ['skull', manifest.source?.skull],
    ['generated image', manifest.source?.generatedImage],
  ]) {
    if (!entry?.path || !SHA256.test(entry.sha256 ?? '')) return `${name} requires a path and sha256`;
  }
  if (!manifest.source.generatedImage.prompt) return 'generated image prompt is required';
  if (!manifest.source.camera?.id || !manifest.source.camera?.authority) return 'source camera identity is required';
  if (!manifest.reconstruction?.jobId || !manifest.reconstruction?.requestedRouteId) {
    return 'reconstruction job and requested route identity are required';
  }
  if (!manifest.reconstruction.config || typeof manifest.reconstruction.config !== 'object') {
    return 'reconstruction config is required';
  }
  const kinds = manifest.observationContract?.requiredKinds;
  const views = manifest.observationContract?.requiredViewIds;
  if (!Array.isArray(kinds) || kinds.length === 0 || new Set(kinds).size !== kinds.length) {
    return 'observation kinds must be a nonempty unique array';
  }
  if (!Array.isArray(views) || views.length === 0 || new Set(views).size !== views.length) {
    return 'observation views must be a nonempty unique array';
  }
  if (!Array.isArray(manifest.regions) || manifest.regions.length === 0) return 'at least one candidate region is required';
  return null;
}

function validateBoundSource(manifest, sourceEvidence) {
  for (const [key, label] of [['skull', 'skull'], ['generatedImage', 'generated image']]) {
    const observed = sourceEvidence?.[key];
    const expected = manifest.source[key];
    if (!observed?.exists) return `${label} is missing`;
    if (!(observed.byteLength > 0)) return `${label} is blank`;
    if (observed.sha256 !== expected.sha256) return `${label} digest mismatch`;
  }
  return null;
}

function requiredProductIds(manifest) {
  return manifest.observationContract.requiredViewIds.flatMap(viewId =>
    manifest.observationContract.requiredKinds.map(kind => `${kind}@${viewId}`));
}

export function evaluateFibrousHeadReturn({ manifest, status, sourceEvidence, completionReceipt, productEvidence = {} }) {
  const manifestError = validateManifest(manifest);
  if (manifestError) return failure(manifest, 'invalid_manifest', 'manifest-validation', manifestError);

  const sourceError = validateBoundSource(manifest, sourceEvidence);
  if (sourceError) return failure(manifest, 'invalid_source', 'source-binding', sourceError);

  const sourceBound = { lastTrustworthyEvidence: 'source_and_generated_image_identity' };
  if (!status || typeof status.schema !== 'string' || !status.schema.endsWith('.greenroom_job_watch.v1')) {
    return failure(manifest, 'invalid_status', 'route-status', 'unrecognized Greenroom status schema', sourceBound);
  }
  if (status.job_id !== manifest.reconstruction.jobId) {
    return failure(manifest, 'invalid_identity', 'route-status', 'Greenroom job identity mismatch', sourceBound);
  }
  if (!status.terminal) {
    if (status.succeeded || !['pending', 'running'].includes(status.state)) {
      return failure(manifest, 'invalid_status', 'route-status', 'nonterminal Greenroom status is internally inconsistent', sourceBound);
    }
    return {
      ...baseReport(manifest),
      state: 'pending_input',
      ...sourceBound,
      missing: ['terminal_reconstruction_receipt'],
      routeObservation: {
        state: status.state,
        bucket: status.bucket,
        terminal: false,
        timedOut: Boolean(status.timed_out),
      },
    };
  }

  if (!status.succeeded) {
    return failure(manifest, 'route_failed', 'reconstruction', status.error_message ?? 'reconstruction route failed', {
      ...sourceBound,
      routeObservation: {
        state: status.state,
        bucket: status.bucket,
        terminal: true,
        exitCode: status.exit_code ?? null,
        failurePhase: status.failure_phase ?? null,
      },
    });
  }
  if (status.effective_route !== manifest.reconstruction.requestedRouteId) {
    return failure(manifest, 'invalid_route', 'route-binding', 'effective route mismatch', sourceBound);
  }
  if (!completionReceipt) {
    return failure(manifest, 'partial_output', 'completion-receipt', 'terminal success lacks a completion receipt', {
      ...sourceBound,
      missing: ['completion_receipt'],
    });
  }
  if (completionReceipt.schema !== FIBROUS_HEAD_RETURN_COMPLETION_SCHEMA) {
    return failure(manifest, 'invalid_receipt', 'completion-receipt', 'unrecognized completion receipt schema', sourceBound);
  }
  if (completionReceipt.jobId !== manifest.reconstruction.jobId) {
    return failure(manifest, 'invalid_identity', 'completion-receipt', 'completion job identity mismatch', sourceBound);
  }
  if (completionReceipt.sourceSha256 !== manifest.source.generatedImage.sha256) {
    return failure(manifest, 'invalid_source', 'completion-receipt', 'completion source digest mismatch', sourceBound);
  }
  if (completionReceipt.requestedRouteId !== manifest.reconstruction.requestedRouteId
      || completionReceipt.effectiveRouteId !== manifest.reconstruction.requestedRouteId) {
    return failure(manifest, 'invalid_route', 'completion-receipt', 'effective route mismatch', sourceBound);
  }
  if (!equalJson(completionReceipt.config, manifest.reconstruction.config)) {
    return failure(manifest, 'invalid_config', 'completion-receipt', 'effective reconstruction config mismatch', sourceBound);
  }

  const products = Array.isArray(completionReceipt.products) ? completionReceipt.products : [];
  const duplicateIds = [];
  const declaredById = new Map();
  for (const product of products) {
    const id = `${product.kind}@${product.viewId}`;
    if (declaredById.has(id)) duplicateIds.push(id);
    declaredById.set(id, product);
  }
  if (duplicateIds.length > 0) {
    return failure(manifest, 'invalid_receipt', 'observation-binding', 'duplicate observation product identities', {
      ...sourceBound,
      mismatched: [...new Set(duplicateIds)].sort(),
    });
  }

  const requiredIds = requiredProductIds(manifest);
  const missing = requiredIds.filter(id => !declaredById.has(id));
  const blank = requiredIds.filter(id => {
    const declared = declaredById.get(id);
    if (!declared) return false;
    const observed = productEvidence[id];
    return !(declared.byteLength > 0) || (observed && !(observed.byteLength > 0));
  });
  const mismatched = requiredIds.filter(id => {
    const declared = declaredById.get(id);
    const observed = productEvidence[id];
    if (!declared || !observed) return false;
    return !observed.exists || observed.sha256 !== declared.sha256 || observed.byteLength !== declared.byteLength;
  });
  if (missing.length > 0 || blank.length > 0 || mismatched.length > 0) {
    return {
      ...baseReport(manifest),
      state: 'partial_output',
      lastTrustworthyEvidence: 'route_bound_partial_observation_set',
      missing,
      blank,
      mismatched,
      products,
      failure: {
        phase: 'observation-binding',
        message: 'required observation set is missing, blank, or digest-mismatched',
      },
    };
  }

  return {
    ...baseReport(manifest),
    state: 'cast_ready_for_triage',
    lastTrustworthyEvidence: 'route_bound_complete_observation_set',
    products: requiredIds.map(id => declaredById.get(id)),
  };
}

async function hashFile(path) {
  try {
    const fileStat = await stat(path);
    if (!fileStat.isFile()) return { exists: false, sha256: null, byteLength: 0 };
    const bytes = await readFile(path);
    return {
      exists: true,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.byteLength,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, sha256: null, byteLength: 0 };
    throw error;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, path);
}

export async function runFibrousHeadReturnPreflight({ manifestPath, statusPath, reportPath, completionReceiptPath = null, now = () => new Date().toISOString() }) {
  let manifest = null;
  let report;
  try {
    manifest = await readJson(manifestPath);
    const status = await readJson(statusPath);
    const completionReceipt = completionReceiptPath ? await readJson(completionReceiptPath) : null;
    const sourceEvidence = {
      skull: await hashFile(manifest.source?.skull?.path),
      generatedImage: await hashFile(manifest.source?.generatedImage?.path),
    };
    const productEvidence = {};
    for (const product of completionReceipt?.products ?? []) {
      productEvidence[`${product.kind}@${product.viewId}`] = await hashFile(product.path);
    }
    report = evaluateFibrousHeadReturn({ manifest, status, sourceEvidence, completionReceipt, productEvidence });
  } catch (error) {
    report = failure(manifest, 'preflight_failed', 'input-read', error.message);
  }
  report = {
    ...report,
    evaluatedAt: now(),
    inputs: { manifestPath, statusPath, completionReceiptPath },
  };
  await writeJsonAtomic(reportPath, report);
  return report;
}
