#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'kaminos.volume.native-grid-causal-comparison.v0';
const ORACLE_SCHEMA = 'kaminos.volume.layer-coefficient-render-oracle.v0';
const COMPANION_SCHEMA = 'kaminos.volume.grid96-full-support-companion.v0';
const JOB_TYPE = 'kaminos_native_grid_bilinear_causal_oracle_0718';
const DEPOSITION_SCALE = 'native-cell-width-from-effective-source-grid-v0';
const FOOTPRINT = 'flow-tangent-five-tap-bilinear-v0';
const COEFFICIENT_BOUNDARY = 'per-sample-pre-tone-map-emission-extinction-v0';
const SHARED_TRANSMITTANCE = 'ridge-plus-non-ridge-extinction-one-running-transmittance-v0';
const KERNEL_GEOMETRY = 'base-footprint-plus-flow-kernel-second-moment-tangent-covariance-v0';
const ORDER_APPROXIMATION = 'camera-depth-96-bin-one-running-transmittance-v0';
const GRID96_ADAPTER_SHA256 = 'b967c04a50b37d6c64dd1857ec521f61202708f6920c125503500f702ddea87f';
const GRID96_ADAPTER_IDENTITY = 'sha256:bbb2618c9769a495a01372a129397f8e8682cae21dd7743b93c4addd9cb9e588';
const GRID96_FEATURE_ORDER_AUTHORITY = 'consumer-pinned-exact-grid96-source-adapter-feature-order-v0';
const ORACLE_CWD = dirname(fileURLToPath(import.meta.url));
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function readJson(path, label) {
  require(existsSync(path), `${label} is missing: ${path}`);
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not readable JSON: ${error.message}`);
  }
  require(value && typeof value === 'object' && !Array.isArray(value), `${label} must be a JSON object`);
  return value;
}

function routeValue(tokens, option) {
  const index = tokens.indexOf(option);
  require(index >= 0 && index + 1 < tokens.length, `Greenroom effective route omitted ${option}`);
  return tokens[index + 1];
}

function validateReceipt(path, reportPath, report, manifestPath) {
  const receipt = readJson(path, 'Greenroom receipt');
  require(receipt.status === 'done', 'Greenroom receipt did not complete');
  require(receipt.job_type === JOB_TYPE, 'Greenroom job type drifted');
  require(receipt.failure_phase == null, 'Greenroom receipt carries a failure phase');
  require(receipt.effective_timeout == null, 'Greenroom route imposed a timeout');
  require(receipt.ignored_params == null || Object.keys(receipt.ignored_params).length === 0, 'Greenroom ignored requested parameters');
  require(resolve(receipt.output_dir) === dirname(resolve(reportPath)), 'Greenroom output directory does not own the oracle report');
  require(resolve(receipt.input_path) === resolve(manifestPath), 'Greenroom input path does not own the oracle manifest');
  require(resolve(receipt.effective_cwd) === resolve(ORACLE_CWD), 'Greenroom effective cwd drifted from the oracle source worktree');
  require(receipt.effective_env?.PYTHONPATH === '.', 'Greenroom PYTHONPATH route drifted');
  const tokens = String(receipt.effective_route || '').trim().split(/\s+/);
  require(tokens[0] === '/private/tmp/kaminos-mlx-residual-venv/bin/python' && tokens[1] === 'volume-layer-coefficient-render-oracle.py', 'Greenroom effective runner drifted');
  require(resolve(routeValue(tokens, '--manifest')) === resolve(manifestPath), 'Greenroom manifest route drifted');
  require(resolve(routeValue(tokens, '--capture-report')) === resolve(report.inputIdentity.captureReport.path), 'Greenroom capture report route drifted');
  require(resolve(routeValue(tokens, '--out-dir')) === dirname(resolve(reportPath)), 'Greenroom output route drifted');
  require(resolve(routeValue(tokens, '--report')) === resolve(reportPath), 'Greenroom report route drifted');
  require(routeValue(tokens, '--state-step') === '120', 'Greenroom state step route drifted');
  require(routeValue(tokens, '--depth-bins') === '96', 'Greenroom depth-bin route drifted');
  require(routeValue(tokens, '--footprint-mode') === 'bilinear', 'Greenroom effective footprint mode drifted');
  require(!tokens.includes('--path-scale'), 'cross-grid route froze rather than independently calibrated the optical scalar');
  for (const field of ['started_at', 'finished_at']) require(Number.isFinite(receipt[field]), `Greenroom receipt ${field} is missing`);
  for (const field of ['startedAtUnix', 'finishedAtUnix']) require(Number.isFinite(report[field]), `oracle report ${field} is missing`);
  require(receipt.started_at <= report.startedAtUnix && report.startedAtUnix <= report.finishedAtUnix && report.finishedAtUnix <= receipt.finished_at, 'Greenroom receipt does not time-bind the oracle report');
  return receipt;
}

function validatePng(path, label) {
  require(existsSync(path), `${label} image is missing: ${path}`);
  require(statSync(path).size >= 60, `${label} image is blank or partial: ${path}`);
  const signature = readFileSync(path).subarray(0, PNG_SIGNATURE.length);
  require(signature.equals(PNG_SIGNATURE), `${label} image is not PNG data: ${path}`);
}

function validateOracle(path, expectedGrid, manifestPath) {
  const report = readJson(path, `Grid${expectedGrid} oracle report`);
  require(report.schema === ORACLE_SCHEMA, `Grid${expectedGrid} oracle schema drifted`);
  require(report.status === 'complete' && report.failurePhase == null, `Grid${expectedGrid} oracle is incomplete`);
  const effective = report.effective || {};
  require(effective.sourceGrid === expectedGrid, `Grid${expectedGrid} report is resized or mislabeled`);
  require(Number.isFinite(effective.nativeCellWidthWorld) && Math.abs(effective.nativeCellWidthWorld - (2 / expectedGrid)) < 1e-15, `Grid${expectedGrid} native cell width does not equal 2/grid`);
  require(effective.stateStep === 120, `Grid${expectedGrid} state step drifted`);
  require(Number.isInteger(effective.rowCount) && effective.rowCount > 0, `Grid${expectedGrid} has no candidate rows`);
  require(effective.sampleCap == null && effective.droppedRowCount === 0, `Grid${expectedGrid} rows were capped or dropped`);
  require(report.requested?.depthBins === 96, `Grid${expectedGrid} depth bins drifted`);
  require(report.requested?.footprintMode === 'bilinear' && effective.footprintMode === FOOTPRINT, `Grid${expectedGrid} footprint treatment drifted`);
  require(effective.depositionScaleIdentity === DEPOSITION_SCALE, `Grid${expectedGrid} native-cell deposition scale drifted`);
  require(effective.coefficientBoundary === COEFFICIENT_BOUNDARY, `Grid${expectedGrid} coefficient boundary drifted`);
  require(effective.sharedTransmittanceIdentity === SHARED_TRANSMITTANCE, `Grid${expectedGrid} optical recurrence drifted`);
  require(effective.kernelGeometry === KERNEL_GEOMETRY, `Grid${expectedGrid} kernel geometry drifted`);
  require(effective.orderApproximation === ORDER_APPROXIMATION, `Grid${expectedGrid} order approximation drifted`);
  require(report.calibration?.identity === 'camera-10-only-global-optical-path-fit-v0', `Grid${expectedGrid} calibration policy drifted`);
  require(report.calibration?.cameraIndex === 10 && report.calibration?.calibrationBoundaryHit === false, `Grid${expectedGrid} calibration is invalid or boundary-limited`);
  require(Number.isFinite(report.calibration?.pathScale) && report.calibration.pathScale > 0 && report.calibration.pathScale === effective.pathScale, `Grid${expectedGrid} calibration scale is zero, nonfinite, or inconsistent`);
  require(Number.isInteger(effective.coefficientSignal?.nonzeroCount) && effective.coefficientSignal.nonzeroCount > 0, `Grid${expectedGrid} coefficient signal is empty`);
  require(report.massAccounting?.allNominalKernelMassConserved === true, `Grid${expectedGrid} changed nominal optical mass`);
  require(report.massAccounting?.imageMetricAuthority === 'decision-bearing-exact-frozen-viewport-v0', `Grid${expectedGrid} image metrics lack frozen-viewport authority`);
  const inputManifest = report.inputIdentity?.manifest || {};
  require(resolve(inputManifest.path) === resolve(manifestPath), `Grid${expectedGrid} effective manifest path drifted`);
  require(inputManifest.sha256 === sha256File(manifestPath), `Grid${expectedGrid} effective manifest hash drifted`);
  if (expectedGrid === 96) {
    require(inputManifest.sha256 === GRID96_ADAPTER_SHA256, 'Grid96 adapter bytes are not the exact source-pinned object');
    require(inputManifest.identity === GRID96_ADAPTER_IDENTITY, 'Grid96 adapter semantic identity drifted');
    require(report.descriptorReceipt?.featureOrderAuthority === GRID96_FEATURE_ORDER_AUTHORITY, 'Grid96 feature order authority is not the source-pinned adapter exception');
  }
  const capture = report.inputIdentity?.captureReport || {};
  require(existsSync(capture.path) && capture.sha256 === sha256File(capture.path), `Grid${expectedGrid} capture report hash drifted`);
  const cohort = report.inputIdentity?.cameraCohort || {};
  require(cohort.cameraCount === 21 && Array.isArray(cohort.cameras) && cohort.cameras.length === 21, `Grid${expectedGrid} camera cohort is partial`);
  require(new Set(cohort.cameras.map(row => row.cameraIndex)).size === 21, `Grid${expectedGrid} camera cohort repeats an index`);
  require(cohort.cameras.every((row, index) => row.cameraIndex === index && row.width === 314 && row.height === 242 && row.cameraPoseHash && row.effectiveCameraPoseHash), `Grid${expectedGrid} camera cohort geometry drifted`);
  const cameras = report.metrics?.cameras || [];
  require(cameras.length === 21 && cameras.every((row, index) => row.cameraIndex === index), `Grid${expectedGrid} metric rows are partial or reordered`);
  require(cameras[10].split === 'calibration' && cameras.filter(row => row.split === 'heldOut').length === 20, `Grid${expectedGrid} calibration or held-view roles drifted`);
  const finiteMetric = (value, label) => require(Number.isFinite(value) && value >= 0, `Grid${expectedGrid} metric ${label} is missing, nonfinite, or negative`);
  for (const row of cameras) {
    for (const field of ['mae', 'targetTopTailLumaUnderfit', 'targetWispUnderfit', 'structuredDotSpectralPower']) finiteMetric(row.expanded?.[field], `camera ${row.cameraIndex} expanded.${field}`);
    finiteMetric(row.raster?.projectedFragments, `camera ${row.cameraIndex} raster.projectedFragments`);
  }
  require(report.artifacts?.cameraCount === 21, `Grid${expectedGrid} artifact count drifted`);
  require(resolve(report.artifacts?.gallery) === join(dirname(resolve(path)), 'index.html'), `Grid${expectedGrid} gallery escaped its oracle report directory`);
  require(report.artifacts?.imageLedger && typeof report.artifacts.imageLedger === 'object', `Grid${expectedGrid} image ledger is missing`);
  return report;
}

function mean(rows, field) {
  return rows.reduce((sum, row) => sum + field(row), 0) / rows.length;
}

function summarize(report) {
  const held = report.metrics.cameras.filter(row => row.split === 'heldOut');
  return {
    cameraCount: held.length,
    mae: mean(held, row => row.expanded.mae),
    targetTopTailLumaUnderfit: mean(held, row => row.expanded.targetTopTailLumaUnderfit),
    targetWispUnderfit: mean(held, row => row.expanded.targetWispUnderfit),
    structuredDotSpectralPower: mean(held, row => row.expanded.structuredDotSpectralPower),
    projectedFragmentsMean: mean(held, row => row.raster.projectedFragments),
  };
}

function copyImages(stage, grid, report, reportPath) {
  const sourceRoot = dirname(resolve(reportPath));
  const rows = [];
  const ledger = {};
  for (let index = 0; index < 21; index += 1) {
    const sourcePrefix = `camera-${String(index).padStart(2, '0')}`;
    const outputs = {};
    for (const [role, suffix] of [
      ['target', 'shared-transport-target'],
      ['expanded', 'expanded-shared-transport'],
      ['residual', 'expanded-residual'],
    ]) {
      const source = join(sourceRoot, `${sourcePrefix}-${suffix}.png`);
      validatePng(source, `Grid${grid} camera ${index} ${role}`);
      const sourceRelative = basename(source);
      const sourceDescriptor = report.artifacts.imageLedger[sourceRelative] || {};
      require(sourceDescriptor.path === sourceRelative, `Grid${grid} image ledger path drifted for ${sourceRelative}`);
      require(sourceDescriptor.bytes === statSync(source).size, `Grid${grid} image byte count drifted for ${sourceRelative}`);
      require(sourceDescriptor.sha256 === sha256File(source), `Grid${grid} image hash drifted for ${sourceRelative}`);
      const relative = join('images', `grid${grid}-camera-${String(index).padStart(2, '0')}-${role}.png`);
      copyFileSync(source, join(stage, relative));
      ledger[relative] = { path: relative, bytes: sourceDescriptor.bytes, sha256: sourceDescriptor.sha256, source: sourceRelative };
      outputs[role] = relative;
    }
    rows.push(outputs);
  }
  return { rows, ledger };
}

function pageHtml(rows, summary) {
  const data = JSON.stringify(rows);
  const metrics = JSON.stringify(summary);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Native Grid Causal Comparison</title><style>
:root{color-scheme:dark;--bg:#111315;--panel:#191c1f;--line:#3a4147;--text:#f4f3ef;--muted:#abb2b8;--cyan:#58d3d8;--orange:#ffad5a;--red:#ff6666}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:13px/1.4 system-ui,sans-serif;letter-spacing:0}header{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:18px;padding:10px 14px;background:#15181beF;border-bottom:1px solid var(--line);backdrop-filter:blur(8px)}h1{font-size:15px;margin:0;white-space:nowrap}.controls{display:flex;align-items:center;gap:10px;min-width:0;flex:1}.controls label{display:flex;align-items:center;gap:8px;color:var(--muted);min-width:180px;flex:1}input{accent-color:var(--cyan);width:100%}button{width:34px;height:30px;border:1px solid var(--line);background:var(--panel);color:var(--text);font-size:18px;cursor:pointer}button:hover{border-color:var(--cyan)}#cameraLabel{font-variant-numeric:tabular-nums;min-width:62px;text-align:center}.grid{display:grid;grid-template-columns:70px repeat(3,minmax(0,1fr));gap:8px;padding:12px}.grid h2,.grid h3{margin:0;display:flex;align-items:center}.grid h2{font-size:13px}.grid h3{font-size:11px;color:var(--muted);justify-content:center}.cell{position:relative;aspect-ratio:314/242;background:#050607;border:1px solid var(--line);overflow:hidden}.cell img{display:block;width:100%;height:100%;object-fit:contain}.g96{color:var(--cyan)}.g160{color:var(--orange)}aside{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;padding:0 14px 14px}table{width:100%;border-collapse:collapse;background:var(--panel)}th,td{padding:7px 9px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums}th:first-child,td:first-child{text-align:left;color:var(--muted)}a{color:var(--cyan)}@media(max-width:760px){header{position:static;display:block}h1{white-space:normal;margin-bottom:9px}.controls{display:grid;grid-template-columns:34px minmax(0,1fr) 34px}.controls label{min-width:0}.grid{grid-template-columns:44px repeat(3,minmax(0,1fr));gap:4px;padding:8px}.grid h2{font-size:11px}.grid h3{font-size:9px}.cell{min-width:0}aside{grid-template-columns:minmax(0,1fr);padding:0 8px 10px}}
</style></head><body><header><h1>Native Grid96 / Grid160 Causal Comparison</h1><div class="controls"><button id="prev" title="Previous camera">&#8592;</button><label>Camera <input id="camera" type="range" min="0" max="20" value="10"></label><button id="next" title="Next camera">&#8594;</button><span id="cameraLabel">10 / 20</span></div></header><main><section class="grid"><span></span><h3>Intrinsic target</h3><h3>Bilinear splats</h3><h3>Residual</h3><h2 class="g96">Grid96</h2><div class="cell"><img id="g96target"></div><div class="cell"><img id="g96expanded"></div><div class="cell"><img id="g96residual"></div><h2 class="g160">Grid160</h2><div class="cell"><img id="g160target"></div><div class="cell"><img id="g160expanded"></div><div class="cell"><img id="g160residual"></div></section><aside><table id="metricTable"></table><table><tr><th>Evidence</th><th>Identity</th></tr><tr><td>Camera cohort</td><td>21 exact poses</td></tr><tr><td>Fit camera</td><td>10 independently</td></tr><tr><td>Deposition</td><td>native cell bilinear</td></tr><tr><td>Report</td><td><a href="report.json">JSON</a></td></tr></table></aside></main><script>
const rows=${data},metrics=${metrics},camera=document.getElementById('camera'),fmt=v=>Number(v).toPrecision(5);function render(){const i=+camera.value;for(const grid of [96,160])for(const role of ['target','expanded','residual'])document.getElementById('g'+grid+role).src=rows[i]['grid'+grid][role];document.getElementById('cameraLabel').textContent=i+' / 20';}function table(){const fields=[['Held cameras','cameraCount'],['MAE','mae'],['Peak underfit','targetTopTailLumaUnderfit'],['Wisp underfit','targetWispUnderfit'],['Dot power','structuredDotSpectralPower'],['Fragments mean','projectedFragmentsMean']];document.getElementById('metricTable').innerHTML='<tr><th>Held-view mean</th><th class="g96">Grid96</th><th class="g160">Grid160</th></tr>'+fields.map(([label,key])=>'<tr><td>'+label+'</td><td>'+fmt(metrics.grid96[key])+'</td><td>'+fmt(metrics.grid160[key])+'</td></tr>').join('');}camera.oninput=render;document.getElementById('prev').onclick=()=>{camera.value=Math.max(0,+camera.value-1);render()};document.getElementById('next').onclick=()=>{camera.value=Math.min(20,+camera.value+1);render()};table();render();
</script></body></html>`;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function failureReport(error) {
  return {
    schema: SCHEMA,
    status: 'failed',
    failurePhase,
    error: error.stack || String(error),
    lastTrustworthyEvidence,
    requested,
  };
}

try {
  const required = [
    'grid96-companion', 'expected-grid96-companion-sha256', 'expected-grid96-companion-identity',
    'grid96-adapter', 'grid96-report', 'grid96-receipt', 'grid160-cockpit-manifest',
    'grid160-oracle-manifest', 'grid160-report', 'grid160-receipt', 'out-dir', 'report',
  ];
  for (const key of required) require(requested[key], `--${key} is required`);
  const outDir = resolve(requested['out-dir']);
  const reportPath = resolve(requested.report);
  require(reportPath === join(outDir, 'report.json'), '--report must be the canonical report.json inside --out-dir');
  const paths = Object.fromEntries(required.filter(key => !key.startsWith('expected-') && !['out-dir', 'report'].includes(key)).map(key => [key, resolve(requested[key])]));
  lastTrustworthyEvidence = { paths };

  failurePhase = 'source-identity-validation';
  const companion = readJson(paths['grid96-companion'], 'Grid96 companion');
  require(companion.schema === COMPANION_SCHEMA && companion.status === 'complete', 'Grid96 companion is incomplete or wrong-schema');
  require(sha256File(paths['grid96-companion']) === requested['expected-grid96-companion-sha256'], 'Grid96 companion file hash drifted');
  require(companion.identity === requested['expected-grid96-companion-identity'], 'Grid96 companion semantic identity drifted');
  const cockpitSha = sha256File(paths['grid160-cockpit-manifest']);
  require(companion.components?.comparison?.sha256 === cockpitSha, 'Grid160 cockpit manifest is not the companion-bound comparison object');

  failurePhase = 'cross-grid-identity-validation';
  const reports = {
    grid96: validateOracle(paths['grid96-report'], 96, paths['grid96-adapter']),
    grid160: validateOracle(paths['grid160-report'], 160, paths['grid160-oracle-manifest']),
  };
  require(reports.grid96.inputIdentity.cameraCohort.identity === reports.grid160.inputIdentity.cameraCohort.identity, 'native grids do not share the exact camera cohort');
  const cohortCanonical96 = stableJson(reports.grid96.inputIdentity.cameraCohort.cameras);
  const cohortCanonical160 = stableJson(reports.grid160.inputIdentity.cameraCohort.cameras);
  require(cohortCanonical96 === cohortCanonical160, 'native grids share a camera label but not camera rows');

  failurePhase = 'greenroom-receipt-validation';
  const receipts = {
    grid96: validateReceipt(paths['grid96-receipt'], paths['grid96-report'], reports.grid96, paths['grid96-adapter']),
    grid160: validateReceipt(paths['grid160-receipt'], paths['grid160-report'], reports.grid160, paths['grid160-oracle-manifest']),
  };
  lastTrustworthyEvidence = {
    companion: { path: paths['grid96-companion'], sha256: sha256File(paths['grid96-companion']), identity: companion.identity },
    cockpit: { path: paths['grid160-cockpit-manifest'], sha256: cockpitSha },
    reports: Object.fromEntries(Object.entries(reports).map(([key, value]) => [key, { path: paths[`${key}-report`], sourceGrid: value.effective.sourceGrid, rowCount: value.effective.rowCount }])),
  };

  failurePhase = 'artifact-assembly';
  const stage = join(dirname(outDir), `.${basename(outDir)}.stage-${process.pid}`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(stage, 'images'), { recursive: true });
  const copied = {
    grid96: copyImages(stage, 96, reports.grid96, paths['grid96-report']),
    grid160: copyImages(stage, 160, reports.grid160, paths['grid160-report']),
  };
  const rows = Array.from({ length: 21 }, (_, index) => ({ index, grid96: copied.grid96.rows[index], grid160: copied.grid160.rows[index] }));
  const metrics = { grid96: summarize(reports.grid96), grid160: summarize(reports.grid160) };
  const report = {
    schema: SCHEMA,
    status: 'complete',
    failurePhase: null,
    requested,
    identity: {
      grid96: { sourceGrid: 96, companionIdentity: companion.identity, companionSha256: sha256File(paths['grid96-companion']), adapterSha256: sha256File(paths['grid96-adapter']), rowCount: reports.grid96.effective.rowCount, pathScale: reports.grid96.effective.pathScale },
      grid160: { sourceGrid: 160, cockpitManifestSha256: cockpitSha, oracleManifestSha256: sha256File(paths['grid160-oracle-manifest']), rowCount: reports.grid160.effective.rowCount, pathScale: reports.grid160.effective.pathScale },
      depositionScaleIdentity: DEPOSITION_SCALE,
      footprintIdentity: FOOTPRINT,
      coefficientBoundary: COEFFICIENT_BOUNDARY,
      sharedTransmittanceIdentity: SHARED_TRANSMITTANCE,
      orderApproximation: ORDER_APPROXIMATION,
    },
    cameraCohort: reports.grid96.inputIdentity.cameraCohort,
    greenroom: {
      grid96: { jobId: receipts.grid96.job_id || null, jobType: receipts.grid96.job_type, effectiveRoute: receipts.grid96.effective_route, effectiveCwd: receipts.grid96.effective_cwd, effectiveEnv: receipts.grid96.effective_env, effectiveTimeout: receipts.grid96.effective_timeout },
      grid160: { jobId: receipts.grid160.job_id || null, jobType: receipts.grid160.job_type, effectiveRoute: receipts.grid160.effective_route, effectiveCwd: receipts.grid160.effective_cwd, effectiveEnv: receipts.grid160.effective_env, effectiveTimeout: receipts.grid160.effective_timeout },
    },
    massAuthority: { grid96: reports.grid96.massAccounting, grid160: reports.grid160.massAccounting },
    metrics: { grid96: { heldOut: metrics.grid96 }, grid160: { heldOut: metrics.grid160 } },
    artifacts: { page: 'index.html', imageCount: 126, cameraCount: 21, imageLedger: { ...copied.grid96.ledger, ...copied.grid160.ledger } },
    claimBoundary: {
      supports: 'native-source-lattice-versus-matched-deposit-space-bilinear-causal-comparison-v0',
      doesNotSupport: ['resized-grid inference', 'learner behavior', 'shipping renderer economics', 'broad footprint blur promotion'],
    },
  };
  writeJson(join(stage, 'report.json'), report);
  writeFileSync(join(stage, 'index.html'), pageHtml(rows, metrics));
  failurePhase = 'atomic-publication';
  const backup = `${outDir}.previous-${process.pid}`;
  rmSync(backup, { recursive: true, force: true });
  if (existsSync(outDir)) renameSync(outDir, backup);
  renameSync(stage, outDir);
  rmSync(backup, { recursive: true, force: true });
  console.log(JSON.stringify({ status: 'complete', report: reportPath, page: join(outDir, 'index.html') }, null, 2));
} catch (error) {
  const reportPath = requested.report ? resolve(requested.report) : null;
  if (reportPath) writeJson(reportPath, failureReport(error));
  console.error(`native grid causal comparison failed during ${failurePhase}: ${error.message}`);
  process.exitCode = 1;
}
