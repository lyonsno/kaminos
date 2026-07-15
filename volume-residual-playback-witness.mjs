#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';

const PLAYBACK_SCHEMA = 'kaminos.volume.residual-playback-witness.v0';

function parseArgs(argv) {
  const args = {
    reports: [],
    outDir: '',
    title: 'Kaminos Residual Playback Witness',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--report') {
      const report = argv[index + 1];
      if (!report) throw new Error('--report requires a path');
      args.reports.push(report);
      index += 1;
    } else if (arg === '--out-dir') {
      args.outDir = argv[index + 1] || '';
      if (!args.outDir) throw new Error('--out-dir requires a path');
      index += 1;
    } else if (arg === '--title') {
      args.title = argv[index + 1] || '';
      if (!args.title) throw new Error('--title requires text');
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!args.reports.length) throw new Error('at least one --report is required');
  if (!args.outDir) throw new Error('--out-dir is required');
  return args;
}

function printHelp() {
  console.log(`Usage: node volume-residual-playback-witness.mjs --report residual-report.json [--report another.json] --out-dir witness-dir [--title "Title"]

Builds a browser-viewable residual playback/comparison witness from MLX residual reports.
The output directory contains index.html, playback-manifest.json, and copied relative image assets.`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function htmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function jsString(value) {
  return JSON.stringify(value ?? '');
}

function slugify(value) {
  return String(value ?? 'report')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'report';
}

function ensureFile(path, role) {
  if (!path || !existsSync(path)) {
    throw new Error(`missing ${role} image: ${path || '(empty)'}`);
  }
}

function copyAsset(sourcePath, outDir, reportSlug, role, index = null) {
  ensureFile(sourcePath, role);
  const extension = extname(sourcePath) || '.png';
  const assetDir = join(outDir, 'assets', reportSlug);
  mkdirSync(assetDir, { recursive: true });
  const prefix = index === null ? role : `${String(index + 1).padStart(3, '0')}-${role}`;
  const destination = join(assetDir, `${prefix}${extension}`);
  copyFileSync(sourcePath, destination);
  return relative(outDir, destination).split('/').join('/');
}

function effectiveReportLabel(report, reportPath, index) {
  const scale = Number(report.lowRenderScale);
  const scaleLabel = Number.isFinite(scale) ? `rs${String(Math.round(scale * 100)).padStart(3, '0')}` : `report-${index + 1}`;
  return `${scaleLabel}-${slugify(basename(dirname(reportPath)))}`;
}

function normalizeReport(reportPath, outDir, index) {
  const resolvedReportPath = resolve(reportPath);
  const report = readJson(resolvedReportPath);
  if (report.schema !== 'kaminos.volume.residual-upscale-mlx.v0') {
    throw new Error(`unsupported residual report schema for ${reportPath}: ${report.schema || '(missing)'}`);
  }
  if (!Array.isArray(report.previewFrames) || !report.previewFrames.length) {
    throw new Error(`residual report has no previewFrames: ${reportPath}`);
  }
  if (!report.temporalSequencePreview) {
    throw new Error(`residual report has no temporalSequencePreview: ${reportPath}`);
  }

  const reportSlug = effectiveReportLabel(report, resolvedReportPath, index);
  const frames = report.previewFrames.map((frame, frameIndex) => ({
    item: frame.item || report.temporalSequenceFrames?.[frameIndex]?.item || `frame-${frameIndex + 1}`,
    temporalSequenceId: report.temporalSequenceFrames?.[frameIndex]?.temporalSequenceId || null,
    temporalFrameIndex: report.temporalSequenceFrames?.[frameIndex]?.temporalFrameIndex ?? frameIndex,
    lowRenderScale: report.lowRenderScale,
    preview: copyAsset(frame.preview, outDir, reportSlug, 'preview', frameIndex),
    sourcePreview: frame.preview,
    diagnosticPreview: copyAsset(frame.diagnosticPreview || report.diagnosticPreview, outDir, reportSlug, 'diagnostic', frameIndex),
    sourceDiagnosticPreview: frame.diagnosticPreview || report.diagnosticPreview,
    previewFocus: frame.previewFocus || null,
  }));

  return {
    label: reportSlug,
    sourceReport: resolvedReportPath,
    corpusManifest: report.corpusManifest || null,
    schema: report.schema,
    lowRenderScale: report.lowRenderScale,
    modelArch: report.modelArch || null,
    pairAuthority: report.pairAuthority || null,
    imageAuthority: report.imageAuthority || null,
    modelArtifactAuthority: report.modelArtifactAuthority || null,
    previewMode: report.previewMode || null,
    previewFrameCount: report.previewFrameCount || null,
    selectedPairCount: report.selectedPairCount ?? null,
    trainPairCount: report.trainPairCount ?? null,
    evalPairCount: report.evalPairCount ?? null,
    baselinePsnr: report.baselinePsnr ?? null,
    modelPsnr: report.modelPsnr ?? null,
    deltaPsnr: report.deltaPsnr ?? null,
    edgeBandDeltaPsnr: report.edgeBandDeltaPsnr ?? null,
    targetEdgeBandDeltaPsnr: report.targetEdgeBandDeltaPsnr ?? null,
    temporalDeltaPsnr: report.temporalDeltaPsnr ?? null,
    temporalFlickerAmplification: report.temporalFlickerAmplification ?? null,
    temporalSequencePreview: copyAsset(report.temporalSequencePreview, outDir, reportSlug, 'temporal-sequence'),
    sourceTemporalSequencePreview: report.temporalSequencePreview,
    frameCount: frames.length,
    frames,
  };
}

function formatNumber(value, digits = 4) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : 'n/a';
}

function renderMetricRows(reports) {
  return reports.map(report => `
    <tr>
      <td>${htmlEscape(report.label)}</td>
      <td>${htmlEscape(report.lowRenderScale)}</td>
      <td>${htmlEscape(report.trainPairCount)} / ${htmlEscape(report.evalPairCount)}</td>
      <td>${formatNumber(report.baselinePsnr)}</td>
      <td>${formatNumber(report.modelPsnr)}</td>
      <td class="hot">+${formatNumber(report.deltaPsnr)}</td>
      <td class="hot">+${formatNumber(report.edgeBandDeltaPsnr)}</td>
      <td class="hot">+${formatNumber(report.targetEdgeBandDeltaPsnr)}</td>
      <td>+${formatNumber(report.temporalDeltaPsnr)}</td>
      <td>${formatNumber(report.temporalFlickerAmplification, 3)}×</td>
    </tr>`).join('');
}

function renderReportSections(reports) {
  return reports.map((report, reportIndex) => `
    <section class="report" id="report-${reportIndex}">
      <div class="report-head">
        <div>
          <h2>${htmlEscape(report.label)}</h2>
          <p class="muted">Low / Model / Target / Diff strips copied from MLX residual report previews.</p>
        </div>
        <div class="pill">scale ${htmlEscape(report.lowRenderScale)}</div>
      </div>
      <div class="identity-grid">
        <div><b>pair authority</b><span>${htmlEscape(report.pairAuthority)}</span></div>
        <div><b>image authority</b><span>${htmlEscape(report.imageAuthority)}</span></div>
        <div><b>model authority</b><span>${htmlEscape(report.modelArtifactAuthority)}</span></div>
        <div><b>source report</b><span>${htmlEscape(report.sourceReport)}</span></div>
        <div><b>corpus</b><span>${htmlEscape(report.corpusManifest)}</span></div>
        <div><b>preview mode</b><span>${htmlEscape(report.previewMode)}</span></div>
      </div>
      <div class="player" data-report-index="${reportIndex}">
        <div class="player-bar">
          <button type="button" data-action="play">Play</button>
          <button type="button" data-action="pause">Pause</button>
          <label>Frame <input type="range" min="0" max="${Math.max(0, report.frames.length - 1)}" value="0" data-role="scrubber"></label>
          <span data-role="frame-label">1 / ${report.frames.length}</span>
        </div>
        <div class="strip-label">Low / Model / Target / Diff</div>
        <div class="frame-stack">
          ${report.frames.map((frame, frameIndex) => `
            <figure data-frame-index="${frameIndex}" class="${frameIndex === 0 ? 'active' : ''}">
              <img src="${htmlEscape(frame.preview)}" alt="${htmlEscape(report.label)} frame ${frameIndex + 1} low model target diff">
              <figcaption>${htmlEscape(frame.item)} · temporal frame ${htmlEscape(frame.temporalFrameIndex)}</figcaption>
            </figure>`).join('')}
        </div>
      </div>
      <details>
        <summary>Error / mask diagnostic strips</summary>
        <div class="diagnostics">
          ${report.frames.map((frame, frameIndex) => `
            <figure>
              <img src="${htmlEscape(frame.diagnosticPreview)}" alt="${htmlEscape(report.label)} frame ${frameIndex + 1} residual diagnostic">
              <figcaption>${htmlEscape(frame.item)}</figcaption>
            </figure>`).join('')}
        </div>
      </details>
      <details open>
        <summary>Temporal sequence preview</summary>
        <img class="wide" src="${htmlEscape(report.temporalSequencePreview)}" alt="${htmlEscape(report.label)} temporal sequence preview">
      </details>
    </section>`).join('');
}

function renderHtml(title, manifest) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #050708; color: #e9eef2; }
    body { margin: 0; padding: 28px; background: radial-gradient(circle at 20% 0%, #142026 0%, #050708 36rem); }
    h1, h2 { margin: 0 0 0.45rem; letter-spacing: -0.03em; }
    p { line-height: 1.45; }
    code { color: #9de1ff; }
    table { width: 100%; border-collapse: collapse; margin: 18px 0 28px; background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.08); }
    th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid rgba(255,255,255,0.07); font-size: 13px; }
    th { color: #9fb3bd; font-weight: 650; text-transform: uppercase; letter-spacing: 0.08em; font-size: 11px; }
    button { background: #177ddc; color: white; border: 0; border-radius: 8px; padding: 8px 12px; cursor: pointer; font-weight: 650; }
    input[type="range"] { vertical-align: middle; width: min(32vw, 360px); }
    img { max-width: 100%; display: block; border-radius: 10px; background: #000; }
    figure { margin: 0; }
    figcaption { color: #97aab3; font-size: 12px; margin-top: 6px; overflow-wrap: anywhere; }
    summary { cursor: pointer; color: #dce8ee; font-weight: 750; margin: 18px 0 10px; }
    .hero { max-width: 1180px; margin: 0 auto 24px; }
    .muted { color: #9fb3bd; }
    .hot { color: #ffcf78; font-weight: 750; }
    .report { max-width: 1180px; margin: 22px auto; padding: 18px; border: 1px solid rgba(255,255,255,0.10); border-radius: 18px; background: rgba(8, 14, 18, 0.82); box-shadow: 0 24px 70px rgba(0,0,0,0.3); }
    .report-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    .pill { border: 1px solid rgba(157,225,255,0.3); color: #9de1ff; border-radius: 999px; padding: 6px 10px; font-size: 13px; white-space: nowrap; }
    .identity-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 8px; margin: 14px 0 18px; }
    .identity-grid div { padding: 10px; border-radius: 10px; background: rgba(255,255,255,0.04); }
    .identity-grid b { display: block; color: #9fb3bd; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 5px; }
    .identity-grid span { display: block; overflow-wrap: anywhere; font-size: 12px; }
    .player { margin-top: 16px; }
    .player-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 10px; }
    .strip-label { color: #ffcf78; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; font-size: 12px; margin-bottom: 8px; }
    .frame-stack figure { display: none; }
    .frame-stack figure.active { display: block; }
    .diagnostics { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; }
    .wide { width: 100%; }
    .manifest-link { color: #9de1ff; }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <h1>${htmlEscape(title)}</h1>
      <p class="muted">Schema <code>${htmlEscape(manifest.schema)}</code>. This is a browser-viewable witness over saved residual outputs, not a live shader integration and not prerecorded product fire.</p>
      <p><a class="manifest-link" href="playback-manifest.json">playback-manifest.json</a></p>
      <table>
        <thead>
          <tr><th>Report</th><th>Scale</th><th>Train / Eval</th><th>Base PSNR</th><th>Model PSNR</th><th>Δ</th><th>Edge Δ</th><th>Target-edge Δ</th><th>Temporal Δ</th><th>Flicker</th></tr>
        </thead>
        <tbody>${renderMetricRows(manifest.reports)}</tbody>
      </table>
    </section>
    ${renderReportSections(manifest.reports)}
  </main>
  <script>
    const players = [...document.querySelectorAll('.player')];
    const timers = new WeakMap();
    function setFrame(player, index) {
      const frames = [...player.querySelectorAll('[data-frame-index]')];
      const bounded = Math.max(0, Math.min(frames.length - 1, Number(index) || 0));
      frames.forEach((frame, frameIndex) => frame.classList.toggle('active', frameIndex === bounded));
      player.querySelector('[data-role="scrubber"]').value = String(bounded);
      player.querySelector('[data-role="frame-label"]').textContent = String(bounded + 1) + ' / ' + String(frames.length);
    }
    function play(player) {
      if (timers.has(player)) return;
      const frames = [...player.querySelectorAll('[data-frame-index]')];
      const scrubber = player.querySelector('[data-role="scrubber"]');
      timers.set(player, setInterval(() => {
        const next = (Number(scrubber.value) + 1) % frames.length;
        setFrame(player, next);
      }, 260));
    }
    function pause(player) {
      const timer = timers.get(player);
      if (timer) clearInterval(timer);
      timers.delete(player);
    }
    for (const player of players) {
      player.querySelector('[data-role="scrubber"]').addEventListener('input', event => setFrame(player, event.target.value));
      player.querySelector('[data-action="play"]').addEventListener('click', () => play(player));
      player.querySelector('[data-action="pause"]').addEventListener('click', () => pause(player));
    }
  </script>
</body>
</html>`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.outDir);
  mkdirSync(outDir, { recursive: true });
  const reports = args.reports.map((reportPath, index) => normalizeReport(reportPath, outDir, index));
  const manifest = {
    schema: PLAYBACK_SCHEMA,
    createdAt: new Date().toISOString(),
    title: args.title,
    reportCount: reports.length,
    renderScales: [...new Set(reports.map(report => report.lowRenderScale))].sort((a, b) => Number(a) - Number(b)),
    reports,
  };
  writeFileSync(join(outDir, 'playback-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(outDir, 'index.html'), renderHtml(args.title, manifest));
  console.log(JSON.stringify({
    status: 'written',
    schema: PLAYBACK_SCHEMA,
    outDir,
    html: join(outDir, 'index.html'),
    manifest: join(outDir, 'playback-manifest.json'),
    reportCount: reports.length,
    renderScales: manifest.renderScales,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error?.message || error);
  process.exit(1);
}

