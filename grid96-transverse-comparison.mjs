#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'kaminos.volume.grid96-transverse-comparison.v0';
const COHORT_SCHEMA = 'kaminos.volume.grid96-transverse-cohort.v0';
const ORACLE_SCHEMA = 'kaminos.volume.layer-coefficient-render-oracle.v0';
const TRANSVERSE_IDENTITY = 'rank-one-tangent-plus-world-normal-binormal-symmetric-placement-v0';
const SOCKET_IDENTITY = 'sha256:b424b2eeb4bc30b2210ab5a3c5e2aebd16eb9ff270c9add32802926fd8f5f9e1';
const SOCKET_SHA256 = '739d60e8965d923acd10761331b5d1310d4dba75a7484a006217032d185d14c0';
const BASIS_SHA256 = '3713938c8e664cf746d10fe4ed2b9c8082d8673d887e595becabbc67b0cb3cf5';
const TRANSVERSE_JOB_TYPE = 'kaminos_grid96_transverse_oracle_0718';
const CONTROL_JOB_TYPE = 'kaminos_grid96_layer_retention_oracle_0718';
const TRANSVERSE_FOOTPRINT = TRANSVERSE_IDENTITY;
const CONTROL_FOOTPRINT = 'flow-tangent-five-tap-bilinear-v0';
const PATH_SCALE = 3.8845837491755066;
const ROW_COUNT = 370194;
const VALID_ROWS = 294904;
const INVALID_ROWS = 75290;
const ORACLE_CWD = dirname(fileURLToPath(import.meta.url));
const USAGE = '--cohort-manifest <path> --out-dir <path> --report <out-dir/report.json> | --verify-bundle <report.json>';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const expectedArmCoordinates = new Map([
  ['n1-b0', { normal: 1, binormal: 0, label: 'Normal 1.0 / Binormal 0.0' }],
  ['n0-b1', { normal: 0, binormal: 1, label: 'Normal 0.0 / Binormal 1.0' }],
  ['n05-b05', { normal: 0.5, binormal: 0.5, label: 'Normal 0.5 / Binormal 0.5' }],
  ['n1-b1', { normal: 1, binormal: 1, label: 'Normal 1.0 / Binormal 1.0' }],
  ['n15-b15', { normal: 1.5, binormal: 1.5, label: 'Normal 1.5 / Binormal 1.5' }],
]);

const requested = Object.fromEntries(process.argv.slice(2).reduce((rows, value, index, argv) => {
  if (value.startsWith('--')) rows.push([value.slice(2), argv[index + 1]]);
  return rows;
}, []));
let failurePhase = 'argument-validation';
let lastTrustworthyEvidence = { requested };

function require(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function readJson(path, label) {
  require(existsSync(path), `${label} is missing: ${path}`);
  let value;
  try { value = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { throw new Error(`${label} is not readable JSON: ${error.message}`); }
  require(value && typeof value === 'object' && !Array.isArray(value), `${label} must be a JSON object`);
  return value;
}

function routeValue(tokens, option) {
  const index = tokens.indexOf(option);
  require(index >= 0 && index + 1 < tokens.length, `Greenroom effective route omitted ${option}`);
  return tokens[index + 1];
}

function descriptor(root, relative, label) {
  require(typeof relative === 'string' && relative && !relative.startsWith('/'), `${label} path must be relative`);
  const path = resolve(root, relative);
  require(path.startsWith(`${resolve(root)}/`), `${label} path escaped bundle root`);
  require(existsSync(path) && statSync(path).isFile(), `${label} is missing: ${path}`);
  const bytes = statSync(path).size;
  require(bytes > 0, `${label} is blank or partial`);
  return { path: relative, bytes, sha256: sha256File(path) };
}

function validatePng(path, imageDescriptor, label) {
  require(existsSync(path) && statSync(path).size >= 60, `${label} image is missing, blank, or partial`);
  require(readFileSync(path).subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE), `${label} is not PNG data`);
  require(imageDescriptor?.path === basename(path), `${label} imageLedger path drifted`);
  require(imageDescriptor?.bytes === statSync(path).size, `${label} imageLedger byte count drifted`);
  require(imageDescriptor?.sha256 === sha256File(path), `${label} imageLedger hash drifted`);
}

function validateBinary(artifact, label, expectedShape) {
  require(artifact && typeof artifact === 'object', `${label} descriptor is missing`);
  const path = resolve(artifact.path || '');
  require(existsSync(path) && statSync(path).isFile(), `${label} is missing: ${path}`);
  require(artifact.bytes > 0 && statSync(path).size === artifact.bytes, `${label} is blank or partial`);
  require(sha256File(path) === artifact.sha256, `${label} hash drifted`);
  require(stableJson(artifact.shape) === stableJson(expectedShape), `${label} shape drifted`);
  return path;
}

function verifyComparisonBundle(reportPath) {
  const path = resolve(reportPath);
  const root = dirname(path);
  const report = readJson(path, 'transverse comparison report');
  require(report.schema === SCHEMA && report.status === 'complete', 'comparison report is incomplete or wrong-schema');
  const artifacts = report.artifacts || {};
  const ledger = artifacts.artifactLedger;
  const imageLedger = artifacts.imageLedger;
  require(ledger && typeof ledger === 'object' && !Array.isArray(ledger), 'comparison artifactLedger is missing');
  require(imageLedger && typeof imageLedger === 'object' && !Array.isArray(imageLedger), 'comparison imageLedger is missing');
  const imageKeys = Object.keys(imageLedger).sort();
  require(imageKeys.length === artifacts.copiedImageCount && imageKeys.length > 0, 'copiedImageCount is not observed from imageLedger');
  const expectedKeys = ['cohort-manifest.json', 'index.html', ...imageKeys].sort();
  require(stableJson(Object.keys(ledger).sort()) === stableJson(expectedKeys), 'artifactLedger is partial or contains unexpected entries');
  require(stableJson(artifacts.gallery) === stableJson(ledger['index.html']), 'gallery descriptor drifted');
  require(stableJson(artifacts.cohortManifest) === stableJson(ledger['cohort-manifest.json']), 'cohort descriptor drifted');
  for (const relative of expectedKeys) {
    const observed = descriptor(root, relative, relative);
    require(observed.bytes === ledger[relative]?.bytes, `${relative} is blank or partial`);
    require(observed.sha256 === ledger[relative]?.sha256, `${relative} hash drifted`);
    if (relative.startsWith('images/')) {
      require(stableJson(imageLedger[relative]) === stableJson(ledger[relative]), `${relative} imageLedger drifted`);
      require(readFileSync(resolve(root, relative)).subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE), `${relative} is not PNG data`);
    }
  }
  return {
    identity: 'comparison-page-cohort-and-displayed-image-ledger-v0',
    artifactCount: expectedKeys.length,
    copiedImageCount: imageKeys.length,
    gallerySha256: ledger['index.html'].sha256,
    cohortManifestSha256: ledger['cohort-manifest.json'].sha256,
  };
}

function validateReceipt(path, reportPath, row, transverse) {
  const receipt = readJson(path, `${row.key || 'control'} Greenroom receipt`);
  require(receipt.status === 'done' && receipt.failure_phase == null && receipt.exit_code === 0, `${row.key || 'control'} Greenroom job did not complete`);
  require(receipt.job_type === (transverse ? TRANSVERSE_JOB_TYPE : CONTROL_JOB_TYPE), `${row.key || 'control'} Greenroom job type drifted`);
  require(receipt.effective_timeout == null, `${row.key || 'control'} Greenroom route imposed a timeout`);
  require(receipt.ignored_params == null || Object.keys(receipt.ignored_params).length === 0, `${row.key || 'control'} Greenroom ignored parameters`);
  require(resolve(receipt.output_dir) === dirname(resolve(reportPath)), `${row.key || 'control'} output directory drifted`);
  require(resolve(receipt.effective_cwd) === resolve(ORACLE_CWD), `${row.key || 'control'} effective cwd drifted`);
  require(receipt.effective_env?.PYTHONPATH === '.', `${row.key || 'control'} PYTHONPATH drifted`);
  const tokens = String(receipt.effective_route || '').trim().split(/\s+/);
  require(tokens[0] === '/private/tmp/kaminos-mlx-residual-venv/bin/python' && tokens[1] === 'volume-layer-coefficient-render-oracle.py', `${row.key || 'control'} runner drifted`);
  require(resolve(routeValue(tokens, '--report')) === resolve(reportPath), `${row.key || 'control'} report route drifted`);
  require(routeValue(tokens, '--state-step') === '120' && routeValue(tokens, '--depth-bins') === '96', `${row.key || 'control'} state or depth route drifted`);
  require(Number(routeValue(tokens, '--path-scale')) === PATH_SCALE, `${row.key || 'control'} path scale drifted`);
  if (transverse) {
    const coordinate = expectedArmCoordinates.get(row.key);
    require(routeValue(tokens, '--footprint-mode') === 'transverse', `${row.key} footprint route drifted`);
    require(Number(routeValue(tokens, '--transverse-normal-scale')) === coordinate.normal, `${row.key} normal scale route drifted`);
    require(Number(routeValue(tokens, '--transverse-binormal-scale')) === coordinate.binormal, `${row.key} binormal scale route drifted`);
    require(Number(routeValue(tokens, '--ridge-retained-mass')) === 1 && Number(routeValue(tokens, '--nonridge-retained-mass')) === 1, `${row.key} is not full-parent retention`);
  } else {
    require(routeValue(tokens, '--footprint-mode') === 'bilinear', 'control is not rank-one bilinear');
  }
  return receipt;
}

function validateCommonOracle(report, label) {
  require(report.schema === ORACLE_SCHEMA && report.status === 'complete' && report.failurePhase == null, `${label} oracle is incomplete or wrong-schema`);
  require(report.effective?.sourceGrid === 96 && report.effective?.rowCount === ROW_COUNT && report.effective?.stateStep === 120, `${label} Grid96 state identity drifted`);
  require(report.effective?.sampleCap == null && report.effective?.droppedRowCount === 0, `${label} source rows were capped or dropped`);
  require(report.effective?.pathScale === PATH_SCALE && report.requested?.depthBins === 96, `${label} path or depth identity drifted`);
  require(report.massAccounting?.allNominalKernelMassConserved === true, `${label} allNominalKernelMassConserved is false`);
  const importance = report.layerImportance;
  require(importance?.geometryRowCount === ROW_COUNT && importance?.geometryRowsDropped === 0, `${label} geometryRowsDropped is nonzero`);
  require(importance?.candidateSupportChanged === false && importance?.coefficientsMoved === false, `${label} changed candidate support or coefficients`);
  require(importance?.ridge?.rowSelectionCap == null && importance?.nonRidge?.rowSelectionCap == null, `${label} installed a selection cap`);
  require(importance?.ridge?.requestedRetainedMassFraction === 1 && importance?.nonRidge?.requestedRetainedMassFraction === 1, `${label} is not full-parent retention`);
  const cohort = report.inputIdentity?.cameraCohort || {};
  require(cohort.cameraCount === 21 && cohort.cameras?.length === 21, `${label} camera cohort is partial`);
  require(report.metrics?.cameras?.length === 21 && report.metrics.cameras.every((camera, index) => camera.cameraIndex === index), `${label} camera metrics are partial or reordered`);
  require(report.metrics.cameras[10].split === 'calibration' && report.metrics.cameras.filter(camera => camera.split === 'heldOut').length === 20, `${label} split roles drifted`);
  require(report.artifacts?.cameraCount === 21 && Object.keys(report.artifacts?.imageLedger || {}).length === 189, `${label} imageLedger is partial`);
  require(Object.keys(report.artifacts?.transmittanceLedger || {}).length === 21, `${label} transmittanceLedger is partial`);
  for (let index = 0; index < 21; index += 1) validateBinary(report.artifacts.transmittanceLedger[`camera-${String(index).padStart(2, '0')}`], `${label} camera ${index} transmittance`, [242, 314]);
}

function validateControl(path) {
  const report = readJson(path, 'rank-one control oracle');
  validateCommonOracle(report, 'control');
  require(report.effective.footprintMode === CONTROL_FOOTPRINT && report.requested.footprintMode === 'bilinear', 'control footprint identity drifted');
  return report;
}

function validateTransverse(path, row) {
  const report = readJson(path, `${row.key} transverse oracle`);
  validateCommonOracle(report, row.key);
  const coordinate = expectedArmCoordinates.get(row.key);
  require(report.effective.footprintMode === TRANSVERSE_FOOTPRINT && report.requested.footprintMode === 'transverse', `${row.key} transverse footprint identity drifted`);
  require(report.requested.footprintControls.transverseNormalScale === coordinate.normal, `${row.key} requested normal scale drifted`);
  require(report.requested.footprintControls.transverseBinormalScale === coordinate.binormal, `${row.key} requested binormal scale drifted`);
  const socket = report.effective.transverseBasis;
  require(socket?.identity === SOCKET_IDENTITY && socket?.sha256 === SOCKET_SHA256, `${row.key} transverse socket identity or hash drifted`);
  require(socket?.basisArtifact?.sha256 === BASIS_SHA256, `${row.key} transverse basis payload hash drifted`);
  require(socket?.rowCount === ROW_COUNT && socket?.basisValidRowCount === VALID_ROWS && socket?.basisInvalidRowCount === INVALID_ROWS, `${row.key} transverse basis coverage drifted`);
  require(socket?.fallbackRowCount === 0 && socket?.sampleCap == null && socket?.droppedRowCount === 0 && socket?.hashVerificationSkipped === false, `${row.key} transverse socket used fallback, cap, drop, or skipped hashes`);
  for (const camera of report.metrics.cameras) {
    const placement = camera.raster?.transversePlacement;
    require(placement?.identity === TRANSVERSE_IDENTITY, `${row.key} camera ${camera.cameraIndex} placement identity drifted`);
    require(placement.basisValidRows === VALID_ROWS && placement.basisInvalidRows === INVALID_ROWS, `${row.key} camera ${camera.cameraIndex} basis coverage drifted`);
    require(placement.normalScale === coordinate.normal && placement.binormalScale === coordinate.binormal, `${row.key} camera ${camera.cameraIndex} effective width drifted`);
    require(placement.childrenUseOwnProjectedDepth === true && placement.invalidRowsUseRankOneWithoutFallback === true, `${row.key} camera ${camera.cameraIndex} placement semantics drifted`);
    require(placement.fallbackRowCount === 0 && placement.rowSelectionCap == null, `${row.key} camera ${camera.cameraIndex} used fallback or cap`);
  }
  return report;
}

function identity(report) {
  return {
    manifest: report.inputIdentity.manifest,
    captureReport: report.inputIdentity.captureReport,
    cameraCohort: report.inputIdentity.cameraCohort,
    frozenStateBinding: report.frozenStateBinding,
    pathScale: report.effective.pathScale,
    importanceSocket: report.layerImportance.socket,
  };
}

function transmittanceDelta(controlDescriptor, armDescriptor) {
  const control = readFileSync(controlDescriptor.path);
  const arm = readFileSync(armDescriptor.path);
  require(control.length === arm.length && control.length === 242 * 314 * 4, 'transmittance payload length drifted');
  let absolute = 0; let squared = 0; let maximum = 0;
  for (let offset = 0; offset < control.length; offset += 4) {
    const a = control.readFloatLE(offset); const b = arm.readFloatLE(offset);
    require(Number.isFinite(a) && Number.isFinite(b) && a >= 0 && a <= 1 && b >= 0 && b <= 1, 'transmittance payload contains invalid values');
    const delta = Math.abs(a - b); absolute += delta; squared += delta * delta; maximum = Math.max(maximum, delta);
  }
  const count = control.length / 4;
  return { mae: absolute / count, rmse: Math.sqrt(squared / count), maximum };
}

function mean(rows, field) { return rows.reduce((sum, row) => sum + field(row), 0) / rows.length; }

function summarize(control, arm, coordinate) {
  const held = arm.metrics.cameras.filter(row => row.split === 'heldOut');
  const controlHeld = control.metrics.cameras.filter(row => row.split === 'heldOut');
  const transmittance = arm.metrics.cameras.map((row, index) => ({
    cameraIndex: index, split: row.split,
    ...transmittanceDelta(control.artifacts.transmittanceLedger[`camera-${String(index).padStart(2, '0')}`], arm.artifacts.transmittanceLedger[`camera-${String(index).padStart(2, '0')}`]),
  }));
  const heldTrans = transmittance.filter(row => row.split === 'heldOut');
  return {
    ...coordinate,
    heldOut: {
      cameraCount: held.length,
      mae: mean(held, row => row.expanded.mae),
      maeDeltaFromRankOne: mean(held, row => row.expanded.mae) - mean(controlHeld, row => row.expanded.mae),
      peakUnderfit: mean(held, row => row.expanded.targetTopTailLumaUnderfit),
      peakUnderfitDeltaFromRankOne: mean(held, row => row.expanded.targetTopTailLumaUnderfit) - mean(controlHeld, row => row.expanded.targetTopTailLumaUnderfit),
      wispUnderfit: mean(held, row => row.expanded.targetWispUnderfit),
      wispUnderfitDeltaFromRankOne: mean(held, row => row.expanded.targetWispUnderfit) - mean(controlHeld, row => row.expanded.targetWispUnderfit),
      dotPower: mean(held, row => row.expanded.structuredDotSpectralPower),
      dotPowerDeltaFromRankOne: mean(held, row => row.expanded.structuredDotSpectralPower) - mean(controlHeld, row => row.expanded.structuredDotSpectralPower),
      transmittanceMaeFromRankOne: mean(heldTrans, row => row.mae),
      transmittanceRmseFromRankOne: mean(heldTrans, row => row.rmse),
      transmittanceMaximumFromRankOne: Math.max(...heldTrans.map(row => row.maximum)),
      projectedFragments: mean(held, row => row.raster.projectedFragments),
      projectedFragmentsRatioToRankOne: mean(held, row => row.raster.projectedFragments) / mean(controlHeld, row => row.raster.projectedFragments),
    },
    cameras: transmittance,
  };
}

function copyImage(stage, root, report, sourceName, outputName, label) {
  const source = join(root, sourceName);
  validatePng(source, report.artifacts.imageLedger[sourceName], label);
  const relative = join('images', outputName);
  copyFileSync(source, join(stage, relative));
  return relative;
}

function copyVisuals(stage, control, controlPath, arms, armPaths) {
  const rows = [];
  for (let index = 0; index < 21; index += 1) {
    const prefix = `camera-${String(index).padStart(2, '0')}`;
    const controlRoot = dirname(controlPath);
    const controlImages = {};
    for (const [role, suffix] of [['target', 'shared-transport-target'], ['expanded', 'expanded-shared-transport'], ['residual', 'expanded-residual']]) {
      controlImages[role] = copyImage(stage, controlRoot, control, `${prefix}-${suffix}.png`, `control-${prefix}-${role}.png`, `control ${prefix} ${role}`);
    }
    const armImages = {};
    for (const [key, report] of Object.entries(arms)) {
      const root = dirname(armPaths[key]);
      armImages[key] = {};
      for (const [role, suffix] of [['expanded', 'expanded-shared-transport'], ['residual', 'expanded-residual'], ['ridge', 'ridge-contribution'], ['nonRidge', 'nonridge-contribution']]) {
        armImages[key][role] = copyImage(stage, root, report, `${prefix}-${suffix}.png`, `${key}-${prefix}-${role}.png`, `${key} ${prefix} ${role}`);
      }
    }
    rows.push({ cameraIndex: index, control: controlImages, arms: armImages });
  }
  return rows;
}

function pageHtml(rows, summaries, maeRanking, structureRanking) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Grid96 Transverse Footprint Assay</title><style>
:root{color-scheme:dark;--bg:#0e1011;--surface:#181b1d;--line:#3b4246;--text:#f3f2ed;--muted:#acb5ba;--cyan:#55d7d5;--amber:#ffb35f}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:13px/1.4 system-ui,sans-serif;letter-spacing:0}header{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:16px;padding:9px 12px;background:#131618f2;border-bottom:1px solid var(--line)}h1{font-size:15px;margin:0;white-space:nowrap}.controls{display:flex;align-items:center;gap:9px;flex:1}.controls label{display:flex;align-items:center;gap:7px;color:var(--muted)}input[type=range]{accent-color:var(--cyan);min-width:130px}select,button{height:30px;border:1px solid var(--line);background:var(--surface);color:var(--text)}button{width:34px;font-size:18px;cursor:pointer}main{padding:10px}.visuals{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.visual h2{font-size:11px;color:var(--muted);margin:0 0 4px}.frame{aspect-ratio:314/242;background:#050607;border:1px solid var(--line);overflow:hidden}.frame img{display:block;width:100%;height:100%;object-fit:contain}.lower{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:8px}.compare{position:relative}.compare img:last-of-type{position:absolute;inset:0;clip-path:inset(0 50% 0 0)}.divider{position:absolute;top:0;bottom:0;left:50%;width:1px;background:var(--cyan)}.blend{display:flex;align-items:center;gap:8px;margin-top:7px;color:var(--muted)}.blend input{flex:1}.telemetry{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:10px;margin-top:10px}table{width:100%;border-collapse:collapse;background:var(--surface)}th,td{padding:7px 9px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums}th:first-child,td:first-child{text-align:left;color:var(--muted)}.good{color:var(--cyan)}.warn{color:var(--amber)}a{color:var(--cyan)}@media(max-width:760px){header{position:static;display:block}h1{margin-bottom:8px;white-space:normal}.controls{display:grid;grid-template-columns:34px minmax(0,1fr) 34px}.controls label,.controls select{grid-column:1/-1}.visuals,.lower,.telemetry{grid-template-columns:minmax(0,1fr)}}
</style></head><body><header><h1>Grid96 Transverse Footprint Assay</h1><div class="controls"><button id="prev" title="Previous camera">&#8592;</button><label>Camera <input id="camera" type="range" min="0" max="20" value="10"><span id="cameraLabel">10 / 20</span></label><button id="next" title="Next camera">&#8594;</button><select id="arm" aria-label="World transverse coordinate">${[...expectedArmCoordinates].map(([key, value]) => `<option value="${key}">${value.label}</option>`).join('')}</select></div></header><main><section class="visuals"><div class="visual"><h2>Intrinsic target</h2><div class="frame"><img id="target"></div></div><div class="visual"><h2>Rank-one tangent baseline</h2><div class="frame"><img id="baseline"></div></div><div class="visual"><h2 id="candidateTitle">World-transverse candidate</h2><div class="frame"><img id="candidate"></div></div></section><section class="lower"><div class="visual"><h2>Candidate residual</h2><div class="frame"><img id="residual"></div></div><div class="visual"><h2>Candidate Ridge contribution</h2><div class="frame"><img id="ridge"></div></div><div class="visual"><h2>Baseline / candidate wipe</h2><div class="frame compare"><img id="wipeBase"><img id="wipeCandidate"><span class="divider"></span></div><label class="blend">Wipe <input id="blend" type="range" min="0" max="100" value="50"></label></div></section><section class="telemetry"><table id="metrics"></table><table><tr><th>Evidence</th><th>Identity</th></tr><tr><td>Status</td><td class="good">checksum-bound</td></tr><tr><td>Basis-valid rows</td><td>294,904 / 370,194</td></tr><tr><td>Invalid-row policy</td><td>rank-one, no fallback</td></tr><tr><td>Camera cohort</td><td>21 exact poses</td></tr><tr><td>Minimum held wisp</td><td>${structureRanking[0]}</td></tr><tr><td>Minimum held MAE</td><td>${maeRanking[0]}</td></tr><tr><td>Report</td><td><a href="report.json">JSON</a></td></tr></table></section></main><script>
const rows=${JSON.stringify(rows)},summaries=${JSON.stringify(summaries)},maeRanking=${JSON.stringify(maeRanking)},structureRanking=${JSON.stringify(structureRanking)};const $=id=>document.getElementById(id),camera=$('camera'),arm=$('arm'),fmt=v=>Number(v).toPrecision(6);arm.value=structureRanking[0];function render(){const i=+camera.value,k=arm.value,row=rows[i],s=summaries[k];$('cameraLabel').textContent=i+' / 20'+(i===10?' calibration':' held-out');$('target').src=row.control.target;$('baseline').src=row.control.expanded;$('candidate').src=row.arms[k].expanded;$('residual').src=row.arms[k].residual;$('ridge').src=row.arms[k].ridge;$('wipeBase').src=row.control.expanded;$('wipeCandidate').src=row.arms[k].expanded;$('candidateTitle').textContent=s.label+' world-transverse';const entries=[['Held target MAE',s.heldOut.mae],['MAE delta vs rank-one',s.heldOut.maeDeltaFromRankOne],['Peak underfit',s.heldOut.peakUnderfit],['Peak delta vs rank-one',s.heldOut.peakUnderfitDeltaFromRankOne],['Wisp underfit',s.heldOut.wispUnderfit],['Wisp delta vs rank-one',s.heldOut.wispUnderfitDeltaFromRankOne],['Dot power',s.heldOut.dotPower],['Dot delta vs rank-one',s.heldOut.dotPowerDeltaFromRankOne],['Transmittance MAE vs rank-one',s.heldOut.transmittanceMaeFromRankOne],['Projected fragment ratio',s.heldOut.projectedFragmentsRatioToRankOne]];$('metrics').innerHTML='<tr><th>'+k+'</th><th>Held mean</th></tr>'+entries.map(([a,b])=>'<tr><td>'+a+'</td><td class="'+(a.includes('delta')?(b<=0?'good':'warn'):'')+'">'+fmt(b)+'</td></tr>').join('')}camera.oninput=render;arm.oninput=render;$('prev').onclick=()=>{camera.value=Math.max(0,+camera.value-1);render()};$('next').onclick=()=>{camera.value=Math.min(20,+camera.value+1);render()};$('blend').oninput=()=>{const b=+$('blend').value;$('wipeCandidate').style.clipPath='inset(0 '+(100-b)+'% 0 0)';document.querySelector('.divider').style.left=b+'%'};render();
</script></body></html>`;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function failureReport(error) {
  return { schema: SCHEMA, status: 'failed', failurePhase, error: error.stack || String(error), lastTrustworthyEvidence, requested };
}

try {
  if (process.argv.includes('--help')) { console.log(USAGE); process.exit(0); }
  if (requested['verify-bundle']) {
    failurePhase = 'bundle-verification';
    console.log(JSON.stringify({ status: 'verified', report: resolve(requested['verify-bundle']), ...verifyComparisonBundle(requested['verify-bundle']) }, null, 2));
    process.exit(0);
  }
  for (const key of ['cohort-manifest', 'out-dir', 'report']) require(requested[key], `--${key} is required`);
  const cohortPath = resolve(requested['cohort-manifest']);
  const outDir = resolve(requested['out-dir']);
  const reportPath = resolve(requested.report);
  require(reportPath === join(outDir, 'report.json'), '--report must be canonical report.json inside --out-dir');
  failurePhase = 'cohort-validation';
  const cohort = readJson(cohortPath, 'transverse cohort manifest');
  require(cohort.schema === COHORT_SCHEMA && cohort.status === 'complete', 'cohort manifest is incomplete or wrong-schema');
  require(cohort.control?.report && cohort.control?.receipt, 'cohort control is missing report or receipt');
  require(Array.isArray(cohort.arms) && cohort.arms.length === expectedArmCoordinates.size, 'cohort must contain exactly five arms');
  require(new Set(cohort.arms.map(row => row.key)).size === expectedArmCoordinates.size, 'cohort arm keys repeat');
  require(cohort.arms.every(row => expectedArmCoordinates.has(row.key)), 'cohort contains an unexpected coordinate');
  require([...expectedArmCoordinates.keys()].every(key => cohort.arms.some(row => row.key === key)), 'cohort is missing an expected coordinate');
  lastTrustworthyEvidence = { cohort: { path: cohortPath, sha256: sha256File(cohortPath) } };

  failurePhase = 'oracle-validation';
  const controlPath = resolve(cohort.control.report);
  const control = validateControl(controlPath);
  const arms = {}; const armPaths = {};
  for (const row of cohort.arms) {
    armPaths[row.key] = resolve(row.report);
    arms[row.key] = validateTransverse(armPaths[row.key], row);
  }
  const fixedIdentity = stableJson(identity(control));
  for (const [key, report] of Object.entries(arms)) require(stableJson(identity(report)) === fixedIdentity, `${key} does not share exact source, camera, state, path, and importance identity`);

  failurePhase = 'greenroom-receipt-validation';
  const receipts = { control: validateReceipt(resolve(cohort.control.receipt), controlPath, cohort.control, false) };
  for (const row of cohort.arms) receipts[row.key] = validateReceipt(resolve(row.receipt), armPaths[row.key], row, true);
  lastTrustworthyEvidence = {
    cohort: { path: cohortPath, sha256: sha256File(cohortPath) },
    control: { report: controlPath, sha256: sha256File(controlPath), jobId: receipts.control.job_id },
    arms: Object.fromEntries(Object.keys(arms).map(key => [key, { report: armPaths[key], sha256: sha256File(armPaths[key]), jobId: receipts[key].job_id }])),
  };

  failurePhase = 'metric-assembly';
  const summaries = Object.fromEntries([...expectedArmCoordinates].map(([key, coordinate]) => [key, summarize(control, arms[key], { key, ...coordinate })]));
  const maeRanking = Object.keys(summaries).sort((a, b) => summaries[a].heldOut.mae - summaries[b].heldOut.mae);
  const structureRanking = Object.keys(summaries).sort((a, b) => summaries[a].heldOut.wispUnderfit - summaries[b].heldOut.wispUnderfit);
  const stage = join(dirname(outDir), `.${basename(outDir)}.stage-${process.pid}`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(stage, 'images'), { recursive: true });
  failurePhase = 'artifact-assembly';
  const rows = copyVisuals(stage, control, controlPath, arms, armPaths);
  writeFileSync(join(stage, 'index.html'), pageHtml(rows, summaries, maeRanking, structureRanking));
  copyFileSync(cohortPath, join(stage, 'cohort-manifest.json'));
  const imageRelatives = [...new Set(rows.flatMap(row => [...Object.values(row.control), ...Object.values(row.arms).flatMap(images => Object.values(images))]))].sort();
  const imageLedger = Object.fromEntries(imageRelatives.map(relative => [relative, descriptor(stage, relative, relative)]));
  const artifactLedger = {
    'index.html': descriptor(stage, 'index.html', 'comparison gallery'),
    'cohort-manifest.json': descriptor(stage, 'cohort-manifest.json', 'comparison cohort'),
    ...imageLedger,
  };
  const report = {
    schema: SCHEMA, status: 'complete', failurePhase: null,
    identity: `sha256:${createHash('sha256').update(stableJson({ cohort: sha256File(cohortPath), control: sha256File(controlPath), arms: Object.fromEntries(Object.keys(arms).map(key => [key, sha256File(armPaths[key])])) })).digest('hex')}`,
    cohort: { path: cohortPath, sha256: sha256File(cohortPath), expectedArmCoordinates: Object.fromEntries(expectedArmCoordinates) },
    sourceIdentity: identity(control), transverseBasis: arms[structureRanking[0]].effective.transverseBasis,
    control: lastTrustworthyEvidence.control, arms: lastTrustworthyEvidence.arms,
    summaries, maeRanking, structureRanking,
    artifacts: {
      gallery: artifactLedger['index.html'], cohortManifest: artifactLedger['cohort-manifest.json'],
      copiedImageCount: imageRelatives.length, cameraCount: 21, imageLedger, artifactLedger, verification: null,
    },
  };
  writeJson(join(stage, 'report.json'), report);
  report.artifacts.verification = verifyComparisonBundle(join(stage, 'report.json'));
  writeJson(join(stage, 'report.json'), report);
  verifyComparisonBundle(join(stage, 'report.json'));
  rmSync(outDir, { recursive: true, force: true });
  renameSync(stage, outDir);
  const finalVerification = verifyComparisonBundle(reportPath);
  console.log(JSON.stringify({ status: 'complete', report: reportPath, gallery: join(outDir, 'index.html'), identity: report.identity, maeRanking, structureRanking, verification: finalVerification }, null, 2));
} catch (error) {
  const reportPath = requested.report ? resolve(requested.report) : null;
  if (reportPath) writeJson(reportPath, failureReport(error));
  console.error(`Grid96 transverse comparison failed during ${failurePhase}: ${error.message}`);
  process.exitCode = 1;
}
