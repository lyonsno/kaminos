#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const manifestPath = args.get('--manifest') ? resolve(args.get('--manifest')) : null;
const outDir = resolve(args.get('--out-dir') || '/tmp/kaminos-generated-asset-clay-witness');
const baseUrl = args.get('--base-url') || 'http://127.0.0.1:18138/';
const expectedServerRoot = args.get('--expected-server-root') ? resolve(args.get('--expected-server-root')) : resolve('.');
const debugPortStart = Number(args.get('--debug-port-start') || 19500);
const settleMs = Number(args.get('--settle-ms') || 6500);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const reportPath = resolve(args.get('--report') || `${outDir}/generated-asset-clay-witness-report.json`);
const contactSheetPath = resolve(args.get('--contact-sheet') || `${outDir}/generated-asset-clay-contact-sheet.png`);
const contactSheetHtmlPath = contactSheetPath.replace(/\.png$/i, '.html');
const routeIdentity = 'kaminos.generated-asset-clay-geometry-witness.v0';

function nowIso() {
  return new Date().toISOString();
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
}

function fail(message, partial = {}) {
  const report = {
    schema: routeIdentity,
    routeIdentity,
    status: 'failed',
    failedAt: nowIso(),
    failure: { message },
    manifestPath,
    outDir,
    baseUrl,
    expectedServerRoot,
    contactSheet: partial.contactSheet || null,
    assets: partial.assets || [],
  };
  writeReport(report);
  console.error(JSON.stringify({ report: reportPath, status: 'failed', failure: report.failure }, null, 2));
  process.exit(1);
}

function loadManifest(path) {
  if (!path) fail('--manifest is required');
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`could not read manifest: ${error.message}`);
  }
  const assets = Array.isArray(data) ? data : data.assets;
  if (!Array.isArray(assets) || assets.length === 0) {
    fail('manifest must contain a non-empty assets array');
  }
  return {
    schema: data.schema || 'ad-hoc',
    assets: assets.map((asset, index) => {
      const glbPath = asset.path || asset.glbPath || asset.bakedGlb || asset.source;
      if (!glbPath) fail(`asset ${index} is missing path/glbPath/bakedGlb/source`);
      const label = asset.label || asset.id || basename(glbPath);
      return {
        id: String(asset.id || label || `asset-${index}`),
        label: String(label),
        path: resolve(glbPath),
        notes: asset.notes || null,
      };
    }),
  };
}

function kaminosUrlFor(asset) {
  const url = new URL(baseUrl);
  url.searchParams.set('glb_path', asset.path);
  url.searchParams.set('glb_label', asset.label);
  url.searchParams.set('glb_material', 'clay');
  return url.href;
}

function runSceneObjectWitness(asset, index) {
  const safeId = asset.id.replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || `asset-${index}`;
  const screenshot = resolve(outDir, `${String(index + 1).padStart(2, '0')}-${safeId}.png`);
  const report = resolve(outDir, `${String(index + 1).padStart(2, '0')}-${safeId}.json`);
  const kaminosUrl = kaminosUrlFor(asset);
  const childArgs = [
    'scene-object-witness.mjs',
    '--url', kaminosUrl,
    '--scenario', 'direct-glb-clay-load',
    '--out', screenshot,
    '--report', report,
    '--debug-port', String(debugPortStart + index),
    '--expected-server-root', expectedServerRoot,
    '--settle-ms', String(settleMs),
  ];
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, childArgs, {
    cwd: resolve('.'),
    encoding: 'utf8',
    timeout: 90000,
  });
  let witnessReport = null;
  try {
    witnessReport = JSON.parse(readFileSync(report, 'utf8'));
  } catch {
    witnessReport = null;
  }
  return {
    ...asset,
    routeIdentity,
    materialMode: 'clay',
    kaminosUrl,
    screenshot,
    witnessReport: report,
    status: result.status === 0 ? 'emitted' : 'failed',
    durationMs: Date.now() - startedAt,
    exitStatus: result.status,
    signal: result.signal,
    stdoutTail: (result.stdout || '').slice(-2000),
    stderrTail: (result.stderr || '').slice(-2000),
    clayMaterial: witnessReport?.evidence?.directGlbLoad?.clayMaterial || witnessReport?.evidence?.directGlbLoad?.state?.clayMaterial || null,
    directGlbState: witnessReport?.evidence?.directGlbLoad?.state || null,
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function imageDataUri(path) {
  try {
    return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
  } catch {
    return '';
  }
}

function renderContactSheetHtml(assets) {
  const cards = assets.map(asset => {
    const img = imageDataUri(asset.screenshot);
    const failed = asset.status !== 'emitted';
    return `
      <article class="card ${failed ? 'failed' : ''}">
        <header>
          <div class="label">${escapeHtml(asset.label)}</div>
          <div class="status">${escapeHtml(asset.status)} · ${escapeHtml(asset.durationMs)}ms</div>
        </header>
        ${img ? `<img src="${img}" alt="${escapeHtml(asset.label)}">` : '<div class="missing">missing screenshot</div>'}
        <footer>
          <div>${escapeHtml(asset.path)}</div>
          <div>${escapeHtml(asset.clayMaterial?.status || 'no clay receipt')} · meshes ${escapeHtml(asset.clayMaterial?.meshCount ?? '?')}</div>
        </footer>
      </article>`;
  }).join('\n');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; background: #161616; color: #e8e2d9; font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .sheet { width: 1600px; min-height: 900px; padding: 28px; box-sizing: border-box; }
  h1 { margin: 0 0 6px; font-size: 22px; letter-spacing: 0; }
  .sub { color: #9b9388; font: 12px "SF Mono", monospace; margin-bottom: 18px; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; }
  .card { background: #202020; border: 1px solid #34302a; border-radius: 8px; overflow: hidden; }
  .card.failed { border-color: #733; }
  header { display: flex; justify-content: space-between; gap: 12px; padding: 11px 13px; border-bottom: 1px solid #302c27; }
  .label { font-weight: 700; color: #f2eee8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status { color: #a79d90; font: 11px "SF Mono", monospace; white-space: nowrap; }
  img { display: block; width: 100%; height: 330px; object-fit: cover; background: #050505; }
  .missing { height: 330px; display: flex; align-items: center; justify-content: center; color: #d66; background: #0b0b0b; }
  footer { padding: 9px 13px 11px; color: #8c847a; font: 10px "SF Mono", monospace; line-height: 1.45; }
</style>
</head>
<body>
<main class="sheet">
  <h1>Generated Asset Clay Geometry Witness</h1>
  <div class="sub">${escapeHtml(routeIdentity)} · ${escapeHtml(nowIso())} · textureless clay material via glb_material=clay</div>
  <section class="grid">${cards}</section>
</main>
</body>
</html>`;
}

function createContactSheet(assets) {
  const html = renderContactSheetHtml(assets);
  mkdirSync(dirname(contactSheetHtmlPath), { recursive: true });
  writeFileSync(contactSheetHtmlPath, html);
  const result = spawnSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--window-size=1600,900',
    `--screenshot=${contactSheetPath}`,
    `file://${contactSheetHtmlPath}`,
  ], {
    encoding: 'utf8',
    timeout: 60000,
  });
  return {
    path: contactSheetPath,
    html: contactSheetHtmlPath,
    status: result.status === 0 ? 'emitted' : 'failed',
    exitStatus: result.status,
    signal: result.signal,
    stdoutTail: (result.stdout || '').slice(-2000),
    stderrTail: (result.stderr || '').slice(-2000),
  };
}

const startedAt = Date.now();
mkdirSync(outDir, { recursive: true });
const manifest = loadManifest(manifestPath);
const assets = [];
for (let index = 0; index < manifest.assets.length; index++) {
  assets.push(runSceneObjectWitness(manifest.assets[index], index));
}
const contactSheet = createContactSheet(assets);
const status = assets.every(asset => asset.status === 'emitted') && contactSheet.status === 'emitted'
  ? 'emitted'
  : 'failed';
const finalReport = {
  schema: routeIdentity,
  routeIdentity,
  status,
  createdAt: nowIso(),
  durationMs: Date.now() - startedAt,
  manifestPath,
  manifestSchema: manifest.schema,
  outDir,
  baseUrl,
  expectedServerRoot,
  contactSheet,
  assets,
};
writeReport(finalReport);
console.log(JSON.stringify({ report: reportPath, status, contactSheet: contactSheet.path, emitted: assets.filter(a => a.status === 'emitted').length, failed: assets.filter(a => a.status !== 'emitted').length }, null, 2));
process.exit(status === 'emitted' ? 0 : 1);
