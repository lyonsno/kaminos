#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'kaminos.volume.grid96-layer-retention-comparison.v0';
const COHORT_SCHEMA = 'kaminos.volume.grid96-layer-retention-cohort.v0';
const ORACLE_SCHEMA = 'kaminos.volume.layer-coefficient-render-oracle.v0';
const SOCKET_IDENTITY = 'sha256:120a275c49ce7ae3456a9202ca3da55df5c51ab743b1c49ec71924abadae658d';
const JOB_TYPE = 'kaminos_grid96_layer_retention_oracle_0718';
const FOOTPRINT = 'flow-tangent-five-tap-bilinear-v0';
const PATH_SCALE = 3.8845837491755066;
const ROW_COUNT = 370194;
const ORACLE_CWD = dirname(fileURLToPath(import.meta.url));
const USAGE = '--cohort-manifest <path> --out-dir <path> --report <out-dir/report.json> | --verify-bundle <report.json>';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const levels = [['p50', 0.5], ['p75', 0.75], ['p90', 0.9], ['p95', 0.95], ['p99', 0.99]];
const expectedArmCoordinates = new Map(
  ['ridge', 'nonRidge'].flatMap(layer => levels.map(([label, mass]) => [`${layer === 'ridge' ? 'ridge' : 'nonridge'}-${label}`, { layer, label, mass }]))
);

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

function validateFileDescriptor(descriptor, label, expectedShape = null) {
  require(descriptor && typeof descriptor === 'object', `${label} descriptor is missing`);
  const path = resolve(descriptor.path || '');
  require(existsSync(path) && statSync(path).isFile(), `${label} is missing: ${path}`);
  require(statSync(path).size === descriptor.bytes && descriptor.bytes > 0, `${label} is blank or partial`);
  require(sha256File(path) === descriptor.sha256, `${label} hash drifted`);
  if (expectedShape) require(stableJson(descriptor.shape) === stableJson(expectedShape), `${label} shape drifted`);
  return path;
}

function validatePng(path, descriptor, label) {
  require(existsSync(path) && statSync(path).size >= 60, `${label} image is missing, blank, or partial`);
  require(readFileSync(path).subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE), `${label} is not PNG data`);
  require(descriptor?.path === basename(path), `${label} imageLedger path drifted`);
  require(descriptor?.bytes === statSync(path).size, `${label} imageLedger byte count drifted`);
  require(descriptor?.sha256 === sha256File(path), `${label} imageLedger hash drifted`);
}

function bundleDescriptor(root, relative, label) {
  require(typeof relative === 'string' && relative && !relative.startsWith('/'), `${label} path must be relative`);
  const path = resolve(root, relative);
  require(path.startsWith(`${resolve(root)}/`), `${label} path escaped the comparison root`);
  require(existsSync(path) && statSync(path).isFile(), `${label} is missing: ${path}`);
  const bytes = statSync(path).size;
  require(bytes > 0, `${label} is blank or partial`);
  return { path: relative, bytes, sha256: sha256File(path) };
}

function verifyComparisonBundle(reportPath) {
  const path = resolve(reportPath);
  const root = dirname(path);
  const report = readJson(path, 'comparison bundle report');
  require(report.schema === SCHEMA && report.status === 'complete', 'comparison bundle report is incomplete or wrong-schema');
  const artifacts = report.artifacts || {};
  const ledger = artifacts.artifactLedger;
  const imageLedger = artifacts.imageLedger;
  require(ledger && typeof ledger === 'object' && !Array.isArray(ledger), 'comparison artifactLedger is missing');
  require(imageLedger && typeof imageLedger === 'object' && !Array.isArray(imageLedger), 'comparison imageLedger is missing');
  const imageKeys = Object.keys(imageLedger).sort();
  require(imageKeys.length === artifacts.copiedImageCount && imageKeys.length > 0, 'comparison copiedImageCount is not observed from imageLedger');
  const expectedKeys = ['cohort-manifest.json', 'index.html', ...imageKeys].sort();
  require(stableJson(Object.keys(ledger).sort()) === stableJson(expectedKeys), 'comparison artifactLedger is partial or contains unexpected entries');
  require(stableJson(artifacts.gallery) === stableJson(ledger['index.html']), 'comparison gallery descriptor drifted from artifactLedger');
  require(stableJson(artifacts.cohortManifest) === stableJson(ledger['cohort-manifest.json']), 'comparison cohort descriptor drifted from artifactLedger');
  for (const relative of expectedKeys) {
    const descriptor = ledger[relative];
    require(descriptor?.path === relative, `${relative} artifactLedger path drifted`);
    const observed = bundleDescriptor(root, relative, relative);
    require(observed.bytes === descriptor.bytes, `${relative} is blank or partial`);
    require(observed.sha256 === descriptor.sha256, `${relative} hash drifted`);
    if (relative.startsWith('images/')) {
      require(stableJson(imageLedger[relative]) === stableJson(descriptor), `${relative} imageLedger drifted from artifactLedger`);
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

function validateReceipt(path, reportPath, report, cohortRow) {
  const receipt = readJson(path, `${cohortRow.key || 'control'} Greenroom receipt`);
  require(receipt.status === 'done' && receipt.failure_phase == null && receipt.exit_code === 0, `${cohortRow.key || 'control'} Greenroom job did not complete`);
  require(receipt.job_type === JOB_TYPE, `${cohortRow.key || 'control'} Greenroom job type drifted`);
  require(receipt.effective_timeout == null, `${cohortRow.key || 'control'} Greenroom route imposed a timeout`);
  require(receipt.ignored_params == null || Object.keys(receipt.ignored_params).length === 0, `${cohortRow.key || 'control'} Greenroom ignored parameters`);
  require(resolve(receipt.output_dir) === dirname(resolve(reportPath)), `${cohortRow.key || 'control'} output directory drifted`);
  require(resolve(receipt.effective_cwd) === resolve(ORACLE_CWD), `${cohortRow.key || 'control'} effective cwd drifted`);
  require(receipt.effective_env?.PYTHONPATH === '.', `${cohortRow.key || 'control'} PYTHONPATH drifted`);
  const tokens = String(receipt.effective_route || '').trim().split(/\s+/);
  require(tokens[0] === '/private/tmp/kaminos-mlx-residual-venv/bin/python' && tokens[1] === 'volume-layer-coefficient-render-oracle.py', `${cohortRow.key || 'control'} effective runner drifted`);
  require(resolve(routeValue(tokens, '--report')) === resolve(reportPath), `${cohortRow.key || 'control'} report route drifted`);
  require(routeValue(tokens, '--state-step') === '120' && routeValue(tokens, '--depth-bins') === '96', `${cohortRow.key || 'control'} state or depth route drifted`);
  require(routeValue(tokens, '--footprint-mode') === 'bilinear', `${cohortRow.key || 'control'} footprint route drifted`);
  require(Number(routeValue(tokens, '--path-scale')) === PATH_SCALE, `${cohortRow.key || 'control'} path-scale route drifted`);
  require(resolve(routeValue(tokens, '--importance-socket')) === resolve(report.layerImportance.socket.path), `${cohortRow.key || 'control'} importance socket route drifted`);
  require(Number(routeValue(tokens, '--ridge-retained-mass')) === report.requested.importanceControls.ridgeRetainedMass, `${cohortRow.key || 'control'} Ridge coordinate route drifted`);
  require(Number(routeValue(tokens, '--nonridge-retained-mass')) === report.requested.importanceControls.nonRidgeRetainedMass, `${cohortRow.key || 'control'} Non-Ridge coordinate route drifted`);
  for (const field of ['started_at', 'finished_at']) require(Number.isFinite(receipt[field]), `${cohortRow.key || 'control'} receipt ${field} is missing`);
  require(receipt.started_at <= report.startedAtUnix && report.finishedAtUnix <= receipt.finished_at, `${cohortRow.key || 'control'} receipt does not time-bind report`);
  return receipt;
}

function validateOracle(path, cohortRow) {
  const label = cohortRow.key || 'control';
  const report = readJson(path, `${label} oracle report`);
  require(report.schema === ORACLE_SCHEMA && report.status === 'complete' && report.failurePhase == null, `${label} oracle is incomplete or wrong-schema`);
  const effective = report.effective || {};
  require(effective.sourceGrid === 96 && effective.rowCount === ROW_COUNT && effective.stateStep === 120, `${label} effective Grid96 state or row identity drifted`);
  require(effective.sampleCap == null && effective.droppedRowCount === 0, `${label} source rows were capped or dropped`);
  require(effective.footprintMode === FOOTPRINT && effective.pathScale === PATH_SCALE, `${label} footprint or optical path drifted`);
  require(report.requested?.depthBins === 96 && report.requested?.footprintMode === 'bilinear', `${label} requested deposition identity drifted`);
  require(report.massAccounting?.allNominalKernelMassConserved === true, `${label} nominal coefficient mass changed`);
  const importance = report.layerImportance;
  require(importance?.identity === 'independent-ridge-nonridge-conserved-optical-mass-prefix-v0', `${label} layer-retention identity drifted`);
  require(importance.socket?.identity === SOCKET_IDENTITY, `${label} r4 socket identity drifted`);
  require(importance.geometryRowCount === ROW_COUNT && importance.geometryRowsDropped === 0, `${label} geometryRowsDropped is nonzero or row count drifted`);
  require(importance.candidateSupportChanged === false && importance.coefficientsMoved === false, `${label} changed support or positions`);
  for (const [layer, key] of [['ridge', 'ridge'], ['nonRidge', 'nonRidge']]) {
    const row = importance[key];
    require(row?.rowSelectionCap == null, `${label} ${layer} rowSelectionCap is not null`);
    require(Number.isInteger(row.selectedParentCount) && row.selectedParentCount > 0, `${label} ${layer} selected no parents`);
    require(row.totalParentCount === ROW_COUNT, `${label} ${layer} total parent count drifted`);
    validateFileDescriptor(row.selectedNativeCellArtifact, `${label} ${layer} selectedNativeCellArtifact`, [row.selectedParentCount]);
  }
  const controls = report.requested.importanceControls || {};
  const expected = cohortRow.key ? expectedArmCoordinates.get(cohortRow.key) : null;
  if (!expected) {
    require(controls.ridgeRetainedMass === 1 && controls.nonRidgeRetainedMass === 1, 'control is not exact 1.0/1.0 full parent');
  } else if (expected.layer === 'ridge') {
    require(controls.ridgeRetainedMass === expected.mass && controls.nonRidgeRetainedMass === 1, `${label} requested coordinates drifted`);
  } else {
    require(controls.ridgeRetainedMass === 1 && controls.nonRidgeRetainedMass === expected.mass, `${label} requested coordinates drifted`);
  }
  const cohort = report.inputIdentity?.cameraCohort || {};
  require(cohort.cameraCount === 21 && Array.isArray(cohort.cameras) && cohort.cameras.length === 21, `${label} camera cohort is partial`);
  const cameras = report.metrics?.cameras || [];
  require(cameras.length === 21 && cameras.every((row, index) => row.cameraIndex === index), `${label} camera metrics are partial or reordered`);
  require(cameras[10].split === 'calibration' && cameras.filter(row => row.split === 'heldOut').length === 20, `${label} camera split roles drifted`);
  require(report.artifacts?.cameraCount === 21 && Object.keys(report.artifacts?.imageLedger || {}).length === 189, `${label} imageLedger is partial`);
  const transmittanceLedger = report.artifacts?.transmittanceLedger || {};
  require(Object.keys(transmittanceLedger).length === 21, `${label} transmittanceLedger is partial`);
  for (let index = 0; index < 21; index += 1) {
    const key = `camera-${String(index).padStart(2, '0')}`;
    validateFileDescriptor(transmittanceLedger[key], `${label} ${key} transmittance`, [242, 314]);
  }
  return report;
}

function transmittanceDelta(controlDescriptor, armDescriptor) {
  const control = readFileSync(controlDescriptor.path);
  const arm = readFileSync(armDescriptor.path);
  require(control.length === arm.length && control.length === 242 * 314 * 4, 'transmittance payload lengths drifted');
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

function summarizeArm(control, arm, coordinate) {
  const held = arm.metrics.cameras.filter(row => row.split === 'heldOut');
  const controlHeld = control.metrics.cameras.filter(row => row.split === 'heldOut');
  const transmittance = arm.metrics.cameras.map((row, index) => ({
    cameraIndex: index,
    split: row.split,
    ...transmittanceDelta(control.artifacts.transmittanceLedger[`camera-${String(index).padStart(2, '0')}`], arm.artifacts.transmittanceLedger[`camera-${String(index).padStart(2, '0')}`]),
  }));
  const heldTrans = transmittance.filter(row => row.split === 'heldOut');
  const selected = arm.layerImportance[coordinate.layer];
  return {
    key: coordinate.key, layer: coordinate.layer, label: coordinate.label,
    requestedRetainedMassFraction: coordinate.mass,
    effectiveRetainedMassFraction: selected.effectiveRetainedMassFraction,
    selectedParentCount: selected.selectedParentCount,
    positiveParentCount: selected.positiveParentCount,
    selectedFractionOfAllParents: selected.selectedParentCount / ROW_COUNT,
    heldOut: {
      cameraCount: held.length,
      mae: mean(held, row => row.expanded.mae),
      maeDeltaFromFull: mean(held, row => row.expanded.mae) - mean(controlHeld, row => row.expanded.mae),
      peakUnderfit: mean(held, row => row.expanded.targetTopTailLumaUnderfit),
      wispUnderfit: mean(held, row => row.expanded.targetWispUnderfit),
      dotPower: mean(held, row => row.expanded.structuredDotSpectralPower),
      transmittanceMaeFromFull: mean(heldTrans, row => row.mae),
      transmittanceRmseFromFull: mean(heldTrans, row => row.rmse),
      transmittanceMaximumFromFull: Math.max(...heldTrans.map(row => row.maximum)),
    },
    cameras: transmittance,
  };
}

function copyImage(stage, sourceRoot, report, sourceName, outputName, label) {
  const source = join(sourceRoot, sourceName);
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
    for (const [role, suffix] of [
      ['target', 'shared-transport-target'], ['expanded', 'expanded-shared-transport'],
      ['ridgeContribution', 'ridge-contribution'], ['nonRidgeContribution', 'nonridge-contribution'],
    ]) controlImages[role] = copyImage(stage, controlRoot, control, `${prefix}-${suffix}.png`, `control-${prefix}-${role}.png`, `control ${prefix} ${role}`);
    const armImages = {};
    for (const [key, report] of Object.entries(arms)) {
      const layer = expectedArmCoordinates.get(key).layer;
      const contribution = layer === 'ridge' ? 'ridge-contribution' : 'nonridge-contribution';
      const sourceRoot = dirname(armPaths[key]);
      armImages[key] = {
        expanded: copyImage(stage, sourceRoot, report, `${prefix}-expanded-shared-transport.png`, `${key}-${prefix}-expanded.png`, `${key} ${prefix} expanded`),
        contribution: copyImage(stage, sourceRoot, report, `${prefix}-${contribution}.png`, `${key}-${prefix}-contribution.png`, `${key} ${prefix} contribution`),
      };
    }
    rows.push({ cameraIndex: index, control: controlImages, arms: armImages });
  }
  return rows;
}

function pageHtml(rows, summaries) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Grid96 Layer Retention</title><style>
:root{color-scheme:dark;--bg:#101214;--surface:#181b1e;--line:#3a4146;--text:#f3f2ed;--muted:#aeb6bc;--cyan:#54d2d5;--amber:#ffb15e;--red:#ff6d66}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:13px/1.4 system-ui,sans-serif;letter-spacing:0}header{position:sticky;top:0;z-index:4;display:flex;align-items:center;gap:16px;padding:9px 12px;background:#141719f2;border-bottom:1px solid var(--line)}h1{font-size:15px;margin:0;white-space:nowrap}.controls{display:flex;align-items:center;gap:9px;flex:1}.controls label{display:flex;align-items:center;gap:7px;color:var(--muted)}input[type=range]{accent-color:var(--cyan);min-width:130px}select,button{height:30px;border:1px solid var(--line);background:var(--surface);color:var(--text)}button{width:34px;font-size:18px;cursor:pointer}.segments{display:flex}.segments button{width:auto;padding:0 12px;font-size:12px}.segments button.active{border-color:var(--cyan);color:var(--cyan)}main{padding:10px}.visuals{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.visual h2{font-size:11px;color:var(--muted);margin:0 0 4px}.frame{aspect-ratio:314/242;background:#050607;border:1px solid var(--line);overflow:hidden}.frame img{display:block;width:100%;height:100%;object-fit:contain}.lower{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px;max-width:calc(66.666% - 3px)}.compare{position:relative}.compare img:last-child{position:absolute;inset:0;clip-path:inset(0 50% 0 0)}.divider{position:absolute;top:0;bottom:0;left:50%;width:1px;background:var(--cyan)}.blend{display:flex;align-items:center;gap:8px;margin:8px 0;color:var(--muted)}.blend input{flex:1}.telemetry{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin-top:10px}table{width:100%;border-collapse:collapse;background:var(--surface)}th,td{padding:7px 9px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums}th:first-child,td:first-child{text-align:left;color:var(--muted)}.status{color:var(--cyan)}a{color:var(--cyan)}@media(max-width:760px){header{position:static;display:block}h1{margin-bottom:8px;white-space:normal}.controls{display:grid;grid-template-columns:34px minmax(0,1fr) 34px}.controls label{grid-column:1/-1}.segments{grid-column:1/-1}.visuals{grid-template-columns:minmax(0,1fr)}.lower,.telemetry{grid-template-columns:minmax(0,1fr);max-width:none}.controls select{grid-column:1/-1}}
</style></head><body><header><h1>Grid96 Layer Retention</h1><div class="controls"><button id="prev" title="Previous camera">&#8592;</button><label>Camera <input id="camera" type="range" min="0" max="20" value="10"><span id="cameraLabel">10 / 20</span></label><button id="next" title="Next camera">&#8594;</button><div class="segments"><button id="ridge" class="active">Ridge</button><button id="nonRidge">Non-Ridge</button></div><select id="mass" aria-label="Retained optical mass"><option value="p50">50% mass</option><option value="p75">75% mass</option><option value="p90" selected>90% mass</option><option value="p95">95% mass</option><option value="p99">99% mass</option></select></div></header><main><section class="visuals"><div class="visual"><h2>Intrinsic target</h2><div class="frame"><img id="target"></div></div><div class="visual"><h2>Full parents</h2><div class="frame"><img id="full"></div></div><div class="visual"><h2 id="retainedTitle">Retained parents</h2><div class="frame"><img id="retained"></div></div></section><section class="lower"><div class="visual"><h2 id="fullLayerTitle">Full layer contribution</h2><div class="frame"><img id="fullLayer"></div></div><div class="visual"><h2>Full / retained wipe</h2><div class="frame compare"><img id="wipeFull"><img id="wipeRetained"><span class="divider"></span></div><label class="blend">Blend <input id="blend" type="range" min="0" max="100" value="50"></label></div></section><section class="telemetry"><table id="metrics"></table><table><tr><th>Evidence</th><th>Identity</th></tr><tr><td>Status</td><td class="status">checksum-bound</td></tr><tr><td>Geometry rows</td><td>370,194 fixed</td></tr><tr><td>Camera cohort</td><td>21 exact poses</td></tr><tr><td>Path scale</td><td>3.884583749</td></tr><tr><td>Report</td><td><a href="report.json">JSON</a></td></tr></table></section></main><script>
const rows=${JSON.stringify(rows)},summaries=${JSON.stringify(summaries)};let layer='ridge';const $=id=>document.getElementById(id),camera=$('camera'),mass=$('mass'),fmt=v=>Number(v).toPrecision(5);function key(){return (layer==='ridge'?'ridge':'nonridge')+'-'+mass.value}function render(){const i=+camera.value,row=rows[i],k=key(),s=summaries[k],role=layer==='ridge'?'ridgeContribution':'nonRidgeContribution';$('cameraLabel').textContent=i+' / 20';$('target').src=row.control.target;$('full').src=row.control.expanded;$('retained').src=row.arms[k].expanded;$('fullLayer').src=row.control[role];$('wipeFull').src=row.control[role];$('wipeRetained').src=row.arms[k].contribution;$('retainedTitle').textContent=mass.options[mass.selectedIndex].text+' retained';$('fullLayerTitle').textContent=(layer==='ridge'?'Ridge':'Non-Ridge')+' contribution';$('metrics').innerHTML='<tr><th>'+k+'</th><th>Held mean</th></tr>'+[['Selected parents',s.selectedParentCount],['All-parent fraction',s.selectedFractionOfAllParents],['Effective optical mass',s.effectiveRetainedMassFraction],['Target MAE',s.heldOut.mae],['MAE delta vs full',s.heldOut.maeDeltaFromFull],['Peak underfit',s.heldOut.peakUnderfit],['Wisp underfit',s.heldOut.wispUnderfit],['Dot power',s.heldOut.dotPower],['Transmittance MAE vs full',s.heldOut.transmittanceMaeFromFull]].map(([a,b])=>'<tr><td>'+a+'</td><td>'+fmt(b)+'</td></tr>').join('')}function setLayer(next){layer=next;$('ridge').classList.toggle('active',layer==='ridge');$('nonRidge').classList.toggle('active',layer==='nonRidge');render()}camera.oninput=render;mass.oninput=render;$('ridge').onclick=()=>setLayer('ridge');$('nonRidge').onclick=()=>setLayer('nonRidge');$('prev').onclick=()=>{camera.value=Math.max(0,+camera.value-1);render()};$('next').onclick=()=>{camera.value=Math.min(20,+camera.value+1);render()};$('blend').oninput=()=>{const b=+$('blend').value;$('wipeRetained').style.clipPath='inset(0 '+(100-b)+'% 0 0)';document.querySelector('.divider').style.left=b+'%'};render();
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
  if (process.argv.includes('--help')) {
    console.log(USAGE);
    process.exit(0);
  }
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
  const cohort = readJson(cohortPath, 'layer-retention cohort manifest');
  require(cohort.schema === COHORT_SCHEMA && cohort.status === 'complete', 'cohort manifest is incomplete or wrong-schema');
  require(cohort.control?.report && cohort.control?.receipt, 'cohort control is missing report or receipt');
  require(Array.isArray(cohort.arms) && cohort.arms.length === expectedArmCoordinates.size, 'cohort must contain exactly ten arms');
  require(new Set(cohort.arms.map(row => row.key)).size === expectedArmCoordinates.size, 'cohort arm keys repeat');
  require(cohort.arms.every(row => expectedArmCoordinates.has(row.key)), 'cohort contains an unexpected arm coordinate');
  require([...expectedArmCoordinates.keys()].every(key => cohort.arms.some(row => row.key === key)), 'cohort is missing an expected arm coordinate');
  lastTrustworthyEvidence = { cohort: { path: cohortPath, sha256: sha256File(cohortPath) } };

  failurePhase = 'oracle-validation';
  const controlPath = resolve(cohort.control.report);
  const control = validateOracle(controlPath, { key: null });
  const arms = {}; const armPaths = {};
  for (const row of cohort.arms) {
    armPaths[row.key] = resolve(row.report);
    arms[row.key] = validateOracle(armPaths[row.key], row);
  }
  const identity = report => ({
    manifest: report.inputIdentity.manifest,
    captureReport: report.inputIdentity.captureReport,
    cameraCohort: report.inputIdentity.cameraCohort,
    frozenStateBinding: report.frozenStateBinding,
    pathScale: report.effective.pathScale,
    socket: report.layerImportance.socket,
  });
  const controlIdentity = stableJson(identity(control));
  for (const [key, report] of Object.entries(arms)) require(stableJson(identity(report)) === controlIdentity, `${key} does not share exact full-control source/camera/socket identity`);
  for (const layer of ['ridge', 'nonRidge']) {
    const keys = levels.map(([label]) => `${layer === 'ridge' ? 'ridge' : 'nonridge'}-${label}`);
    const counts = keys.map(key => arms[key].layerImportance[layer].selectedParentCount);
    require(counts.every((value, index) => index === 0 || value >= counts[index - 1]), `${layer} selected-parent counts are not monotone`);
  }

  failurePhase = 'greenroom-receipt-validation';
  const receipts = { control: validateReceipt(resolve(cohort.control.receipt), controlPath, control, { key: null }) };
  for (const row of cohort.arms) receipts[row.key] = validateReceipt(resolve(row.receipt), armPaths[row.key], arms[row.key], row);
  lastTrustworthyEvidence = {
    cohort: { path: cohortPath, sha256: sha256File(cohortPath) },
    control: { report: controlPath, sha256: sha256File(controlPath), jobId: receipts.control.job_id },
    arms: Object.fromEntries(Object.keys(arms).map(key => [key, { report: armPaths[key], sha256: sha256File(armPaths[key]), jobId: receipts[key].job_id }])),
  };

  failurePhase = 'metric-assembly';
  const summaries = Object.fromEntries([...expectedArmCoordinates].map(([key, coordinate]) => [key, summarizeArm(control, arms[key], { key, ...coordinate })]));
  const stage = join(dirname(outDir), `.${basename(outDir)}.stage-${process.pid}`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(stage, 'images'), { recursive: true });
  failurePhase = 'artifact-assembly';
  const rows = copyVisuals(stage, control, controlPath, arms, armPaths);
  writeFileSync(join(stage, 'index.html'), pageHtml(rows, summaries));
  copyFileSync(cohortPath, join(stage, 'cohort-manifest.json'));
  const imageRelatives = [...new Set(rows.flatMap(row => [
    ...Object.values(row.control),
    ...Object.values(row.arms).flatMap(images => Object.values(images)),
  ]))].sort();
  const imageLedger = Object.fromEntries(imageRelatives.map(relative => [relative, bundleDescriptor(stage, relative, relative)]));
  const artifactLedger = {
    'index.html': bundleDescriptor(stage, 'index.html', 'comparison gallery'),
    'cohort-manifest.json': bundleDescriptor(stage, 'cohort-manifest.json', 'comparison cohort manifest'),
    ...imageLedger,
  };
  const report = {
    schema: SCHEMA, status: 'complete', failurePhase: null,
    identity: `sha256:${createHash('sha256').update(stableJson({ cohort: sha256File(cohortPath), control: sha256File(controlPath), arms: Object.fromEntries(Object.keys(arms).map(key => [key, sha256File(armPaths[key])])) })).digest('hex')}`,
    cohort: { path: cohortPath, sha256: sha256File(cohortPath), expectedArmCoordinates: Object.fromEntries(expectedArmCoordinates) },
    sourceIdentity: identity(control),
    control: lastTrustworthyEvidence.control,
    arms: lastTrustworthyEvidence.arms,
    summaries,
    artifacts: {
      gallery: artifactLedger['index.html'],
      cohortManifest: artifactLedger['cohort-manifest.json'],
      copiedImageCount: imageRelatives.length,
      cameraCount: 21,
      imageLedger,
      artifactLedger,
      verification: null,
    },
  };
  writeJson(join(stage, 'report.json'), report);
  report.artifacts.verification = verifyComparisonBundle(join(stage, 'report.json'));
  writeJson(join(stage, 'report.json'), report);
  verifyComparisonBundle(join(stage, 'report.json'));
  rmSync(outDir, { recursive: true, force: true });
  renameSync(stage, outDir);
  const finalVerification = verifyComparisonBundle(reportPath);
  console.log(JSON.stringify({ status: 'complete', report: reportPath, gallery: join(outDir, 'index.html'), identity: report.identity, verification: finalVerification }, null, 2));
} catch (error) {
  const reportPath = requested.report ? resolve(requested.report) : null;
  if (reportPath) writeJson(reportPath, failureReport(error));
  console.error(`grid96 layer-retention comparison failed during ${failurePhase}: ${error.message}`);
  process.exitCode = 1;
}
