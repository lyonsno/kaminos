#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const SCHEMA = 'kaminos.volume.native-low-training-grid-comparison.v0';
const IDENTITY = 'native96-control-vs-128-zero-shot-vs-96-trained-v0';
const PAIR_AUTHORITY = 'downsampled-same-high-history-input-to-exact-high-target';
const TRAINING_AUTHORITY = 'phase-aligned-high-filtered-to-low-grid-v0';
const INPUT_AUTHORITY = 'native-low-simulator-state-no-synthetic-downsample-v0';
const RENDER_COMPOSITION = 'splat-only-v0';
const args = parseArgs(process.argv.slice(2));
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-native-low-training-grid-comparison'));
const reportPath = join(outDir, 'manifest.json');
let phase = 'argument-validation';
let evidence = {};

try {
  mkdirSync(outDir, { recursive: true });
  const paths = {
    native: requiredPath('--native-manifest'),
    baselineApplication: requiredPath('--baseline-application-manifest'),
    baselineWitness: requiredPath('--baseline-witness-manifest'),
    candidateApplication: requiredPath('--candidate-application-manifest'),
    candidateWitness: requiredPath('--candidate-witness-manifest'),
  };
  evidence = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, {
    path, sha256: sha256File(path),
  }]));

  phase = 'input-validation';
  const native = readJson(paths.native);
  const baseline = validateApplication(readJson(paths.baselineApplication), 128, true, 'baseline');
  const candidate = validateApplication(readJson(paths.candidateApplication), 96, false, 'candidate');
  require(native.schema === 'kaminos.volume.full-grid-field-export.v0', 'native schema mismatch');
  require(native.status === 'captured' && native.failurePhase === null, 'native source is not captured');
  require(native.grid === 96, `native source grid must be 96, got ${native.grid}`);
  require(native.effectiveRoute === 'native-3d-compute-fluid-raymarch-v0', 'native route mismatch');
  require(baseline.sameNativeStateIdentity === candidate.sameNativeStateIdentity, 'applications do not share native state identity');

  const baselineWitness = validateWitness(
    readJson(paths.baselineWitness), baseline, evidence.native, 'baseline',
  );
  const candidateWitness = validateWitness(
    readJson(paths.candidateWitness), candidate, evidence.native, 'candidate',
  );
  require(
    baselineWitness.sameNativeStateIdentity === candidateWitness.sameNativeStateIdentity,
    'witnesses do not share native state identity',
  );

  phase = 'artifact-write';
  const copied = {
    native96Control: copyImage(baselineWitness.control.image, 'native96-control.png'),
    baseline128Trained: copyImage(baselineWitness.treatment.image, 'baseline-128-trained-zero-shot.png'),
    candidate96Trained: copyImage(candidateWitness.treatment.image, 'candidate-96-trained-transfer.png'),
  };
  require(
    new Set(Object.values(copied).map(item => item.sha256)).size === 3,
    'comparison roles resolved to duplicate image payloads',
  );
  const roles = {
    native96Control: {
      label: 'Native 96 control',
      authority: 'untouched-independently-stepped-native-96-v0',
      grid: 96,
      image: copied.native96Control,
    },
    baseline128Trained: {
      label: '128-trained zero-shot',
      authority: 'phase-aligned-160-to-128-trained-applied-to-native-96-v0',
      modelIdentity: baseline.model.identity,
      modelTrainedLowGrid: 128,
      applicationLowGrid: 96,
      outputGrid: 160,
      crossGridApplication: true,
      trainingInputAuthority: baseline.model.trainingInputAuthority || null,
      trainingPairAuthority: baseline.model.trainingPairAuthority,
      image: copied.baseline128Trained,
    },
    candidate96Trained: {
      label: '96-trained transfer',
      authority: 'phase-aligned-160-to-96-trained-applied-to-native-96-v0',
      modelIdentity: candidate.model.identity,
      modelTrainedLowGrid: 96,
      applicationLowGrid: 96,
      outputGrid: 160,
      crossGridApplication: false,
      trainingInputAuthority: candidate.model.trainingInputAuthority,
      trainingPairAuthority: candidate.model.trainingPairAuthority,
      image: copied.candidate96Trained,
    },
  };
  const report = {
    schema: SCHEMA,
    identity: IDENTITY,
    status: 'captured',
    failurePhase: null,
    sameNativeStateIdentity: baseline.sameNativeStateIdentity,
    inputAuthority: INPUT_AUTHORITY,
    runtimeTruthAvailable: false,
    truthHighAvailableAtNativePhase: false,
    renderer: {
      requested: RENDER_COMPOSITION,
      effectiveForAllRoles: RENDER_COMPOSITION,
      raymarchExcludedFromDiscriminant: true,
    },
    sources: evidence,
    roles,
    limitations: [
      'Both learned models were trained from one same-high-history filtered pair, not native deployment-phase truth.',
      'The historical 128-trained model predates the explicit trainingInputAuthority field; its pair authority remains recorded.',
      'This same-state still comparison measures transfer character, not temporal stability or native-phase fidelity to unavailable truth.',
    ],
    operatorArtifact: {
      path: join(outDir, 'index.html'),
      authority: 'three-role-same-native-state-splat-only-comparison-v0',
    },
  };
  writeJson(reportPath, report);
  writeFileSync(join(outDir, 'index.html'), htmlPage(report), 'utf8');
  console.log(JSON.stringify({ status: 'captured', manifest: reportPath, operatorArtifact: report.operatorArtifact.path }, null, 2));
} catch (error) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeJson(reportPath, {
    schema: SCHEMA,
    identity: IDENTITY,
    status: 'failed',
    failurePhase: phase,
    error: error?.stack || String(error),
    lastTrustworthyEvidence: evidence,
  });
  console.error(error?.stack || String(error));
  process.exitCode = 1;
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values.set(key, true);
    else { values.set(key, next); index += 1; }
  }
  return values;
}

function requiredPath(name) {
  const value = args.get(name);
  require(value && value !== true, `missing ${name}`);
  const path = resolve(String(value));
  require(existsSync(path), `${name} does not exist: ${path}`);
  return path;
}

function require(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function validateApplication(value, trainedLowGrid, crossGridApplication, label) {
  require(value.schema === 'kaminos.volume.native-low-selective-composition.v0', `${label} application schema mismatch`);
  require(value.status === 'captured' && value.failurePhase === null, `${label} application is not captured`);
  require(value.inputAuthority === INPUT_AUTHORITY, `${label} application input authority mismatch`);
  require(value.runtimeTruthAvailable === false, `${label} application exposes runtime truth`);
  require(value.relationship?.applicationLowGrid === 96, `${label} application low grid mismatch`);
  require(value.relationship?.outputGrid === 160, `${label} output grid mismatch`);
  require(value.relationship?.trainedLowGrid === trainedLowGrid, `${label} trained low grid mismatch`);
  require(value.relationship?.crossGridApplication === crossGridApplication, `${label} cross-grid identity mismatch`);
  require(value.relationship?.syntheticDownsampleApplied === false, `${label} application used a synthetic downsample`);
  require(value.model?.trainingPairAuthority === PAIR_AUTHORITY, `${label} training pair authority mismatch`);
  require(value.model?.features?.lowFieldCount === 17, `${label} model lacks all 17 low fields`);
  require(value.model?.features?.squaredLowFieldCount === 17, `${label} model lacks all 17 squared low fields`);
  if (label === 'candidate') {
    require(value.model?.trainingInputAuthority === TRAINING_AUTHORITY, 'candidate training input authority mismatch');
    require(value.model?.trainingInputSyntheticDownsample === true, 'candidate must record synthetic training downsample');
    require(value.model?.nativeDeploymentInputSeenDuringTraining === false, 'candidate must deny native deployment input during training');
  }
  return value;
}

function validateWitness(value, application, nativeDescriptor, label) {
  require(value.schema === 'kaminos.volume.native-low-selective-witness.v0', `${label} witness schema mismatch`);
  require(value.status === 'captured' && value.failurePhase === null, `${label} witness is not captured`);
  require(value.renderer?.requested === RENDER_COMPOSITION, `${label} requested renderer mismatch`);
  require(value.renderer?.controlEffective === RENDER_COMPOSITION, `${label} control renderer fallback`);
  require(value.renderer?.treatmentEffective === RENDER_COMPOSITION, `${label} treatment renderer fallback`);
  require(value.renderer?.raymarchExcludedFromDiscriminant === true, `${label} witness includes raymarch contamination`);
  require(value.sameNativeStateIdentity === application.sameNativeStateIdentity, `${label} witness/application state mismatch`);
  require(value.sources?.nativeManifest?.sha256 === nativeDescriptor.sha256, `${label} native manifest checksum mismatch`);
  require(value.sources?.predictedManifest?.sha256 === sha256File(
    label === 'baseline' ? evidence.baselineApplication.path : evidence.candidateApplication.path,
  ), `${label} application manifest checksum mismatch`);
  for (const role of ['nativeLowControl', 'nativeLowSelectivePredicted']) {
    require(value.roles?.[role]?.sameNativeStateIdentity === application.sameNativeStateIdentity, `${label} ${role} state mismatch`);
    validateImage(value.roles?.[role]?.image, `${label} ${role}`);
  }
  return {
    sameNativeStateIdentity: value.sameNativeStateIdentity,
    control: value.roles.nativeLowControl,
    treatment: value.roles.nativeLowSelectivePredicted,
  };
}

function validateImage(descriptor, label) {
  require(descriptor && typeof descriptor === 'object', `${label} image descriptor is missing`);
  const path = resolve(String(descriptor.path || ''));
  require(existsSync(path), `${label} image is missing: ${path}`);
  require(statSync(path).size === descriptor.byteLength && descriptor.byteLength > 24, `${label} image byte length mismatch`);
  require(sha256File(path) === descriptor.sha256, `${label} image checksum mismatch`);
  const bytes = readFileSync(path);
  require(bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), `${label} image is not PNG`);
}

function copyImage(descriptor, name) {
  validateImage(descriptor, name);
  const path = join(outDir, name);
  copyFileSync(resolve(descriptor.path), path);
  return { path, relativePath: basename(path), byteLength: statSync(path).size, sha256: sha256File(path) };
}

function htmlPage(report) {
  const roleOrder = ['native96Control', 'baseline128Trained', 'candidate96Trained'];
  const panels = roleOrder.map(key => {
    const role = report.roles[key];
    const detail = key === 'native96Control'
      ? 'Untouched independently stepped source'
      : `trained ${role.modelTrainedLowGrid} -> output ${role.outputGrid}`;
    return `<figure><figcaption><strong>${role.label}</strong><span>${detail}</span></figcaption><a href="${role.image.relativePath}" target="_blank"><img src="${role.image.relativePath}" alt="${role.label}"></a></figure>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><title>Native 96 training-grid comparison</title><style>
  :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#09090b;color:#f4f4f5;font:14px system-ui,sans-serif}header{position:sticky;top:0;z-index:2;padding:12px 18px;background:#18181b;border-bottom:1px solid #3f3f46}h1{margin:0 0 4px;font-size:18px;letter-spacing:0}p{margin:0;color:#a1a1aa}.strip{display:grid;grid-template-columns:repeat(3,minmax(900px,1fr));gap:1px;min-width:2700px;background:#27272a}figure{margin:0;background:#000}figcaption{height:58px;padding:10px 14px;background:#18181b;display:flex;flex-direction:column;border-bottom:1px solid #3f3f46}figcaption strong{font-size:16px}figcaption span{color:#a1a1aa;margin-top:3px}img{display:block;width:100%;height:auto;image-rendering:auto}a{display:block}.note{padding:12px 18px;color:#a1a1aa;border-top:1px solid #3f3f46}</style><header><h1>Native 96: control vs training-grid transfer</h1><p>Same native state, splat-only, no runtime truth. Click any panel for the original PNG.</p></header><main class="strip">${panels}</main><div class="note">The 128-trained baseline is cross-grid zero-shot. The 96-trained candidate is matched to the deployment grid but was still trained from a filtered high-history pair, not native-phase truth.</div>`;
}
