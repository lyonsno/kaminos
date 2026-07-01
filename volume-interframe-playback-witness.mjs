#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const SCHEMA = 'kaminos.volume.interframe-playback-witness.v0';
const SYNTHETIC_AUTHORITY = 'synthetic-comparison-not-live-simulator-output';

function parseArgs(argv) {
  const args = new Map();
  const extraCandidates = [];
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--candidate') {
      if (!value || value.startsWith('--')) throw new Error('--candidate requires id::path');
      extraCandidates.push(value);
      index += 1;
    } else if (key.startsWith('--')) {
      if (value && !value.startsWith('--')) {
        args.set(key, value);
        index += 1;
      } else {
        args.set(key, true);
      }
    }
  }
  args.set('--candidate', extraCandidates);
  return args;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function pathForHtml(outputPath, imagePath) {
  return relative(dirname(outputPath), imagePath).split('/').map(encodeURIComponent).join('/');
}

function parseExtraCandidate(raw, outPath) {
  const separator = raw.indexOf('::');
  if (separator <= 0) throw new Error(`candidate must be id::path, got ${raw}`);
  const id = raw.slice(0, separator).trim();
  const path = resolve(raw.slice(separator + 2).trim());
  return {
    id,
    sourceKind: 'external-probe',
    actualMiddleUsed: false,
    syntheticAuthority: SYNTHETIC_AUTHORITY,
    syntheticPath: path,
    syntheticSrc: pathForHtml(outPath, path),
  };
}

function baselineCandidate(report, baseline, outPath) {
  return {
    id: baseline.id,
    sourceKind: baseline.sourceKind || 'report-baseline',
    actualMiddleUsed: false,
    syntheticAuthority: baseline.syntheticAuthority || SYNTHETIC_AUTHORITY,
    syntheticPath: baseline.syntheticMiddle?.path,
    syntheticSrc: pathForHtml(outPath, baseline.syntheticMiddle?.path),
    metrics: baseline.metrics || null,
    failureModes: baseline.failureModes || [],
  };
}

function writeHtml(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  const frames = payload.frames;
  const candidates = payload.candidates;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kaminos Interframe Playback Witness</title>
<style>
  :root { color-scheme: dark; background: #07090b; color: #eef3f6; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 18px; background: #07090b; }
  header { display: grid; gap: 8px; max-width: 1180px; margin: 0 auto 14px; }
  h1 { margin: 0; font-size: 19px; letter-spacing: 0; }
  .meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
  .chip { border: 1px solid #20303a; background: #101820; padding: 8px 10px; min-height: 48px; }
  .chip b { display: block; font-size: 10px; color: #86a4b5; text-transform: uppercase; }
  .chip span { display: block; font-size: 12px; overflow-wrap: anywhere; }
  main { max-width: 1180px; margin: 0 auto; display: grid; gap: 12px; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; }
  .panel { border: 1px solid #1b2830; background: #0c1014; padding: 10px; }
  .panel h2 { margin: 0 0 4px; font-size: 14px; letter-spacing: 0; }
  .panel p { margin: 0 0 8px; color: #aebbc4; font-size: 12px; }
  .stage { position: relative; width: 100%; aspect-ratio: ${frames.width} / ${frames.height}; background: #000; overflow: hidden; }
  .stage img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; opacity: 0; animation: framePulse 900ms steps(1, end) infinite; }
  .stage img:nth-child(1) { animation-delay: 0ms; }
  .stage img:nth-child(2) { animation-delay: -600ms; }
  .stage img:nth-child(3) { animation-delay: -300ms; }
  @keyframes framePulse {
    0%, 33.32% { opacity: 1; }
    33.33%, 100% { opacity: 0; }
  }
  .timeline { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 8px; }
  .timeline div { border-top: 3px solid #385568; padding-top: 5px; color: #cbd6dc; font-size: 11px; overflow-wrap: anywhere; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
  .authority { color: #f0b85a; }
  @media (max-width: 760px) { body { padding: 10px; } .grid, .meta { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>Kaminos Interframe Playback Witness</h1>
  <div class="meta">
    <div class="chip"><b>Schema</b><span>${SCHEMA}</span></div>
    <div class="chip"><b>Route</b><span>${escapeHtml(payload.route)}</span></div>
    <div class="chip"><b>Frames</b><span>${escapeHtml(payload.frameLabel)}</span></div>
    <div class="chip"><b>Authority</b><span class="authority">${SYNTHETIC_AUTHORITY}</span></div>
  </div>
</header>
<main>
  <section class="grid">
    <article class="panel">
      <h2>Ground truth cadence</h2>
      <p>Real simulator frames: T0, actual middle T1, T2.</p>
      <div class="stage">
        <img src="${frames.t0Src}" alt="T0 live frame">
        <img src="${frames.actualSrc}" alt="Actual live middle frame">
        <img src="${frames.t2Src}" alt="T2 live frame">
      </div>
      <div class="timeline"><div>T0 real</div><div>T1 actual</div><div>T2 real</div></div>
    </article>
    <article class="panel">
      <h2>Frame labels</h2>
      <p>Use the synthetic cadence panels below to judge temporal coherence separately from single-frame pixel error.</p>
      <div class="timeline"><div>${escapeHtml(frames.t0Label)}</div><div>${escapeHtml(frames.actualLabel)}</div><div>${escapeHtml(frames.t2Label)}</div></div>
    </article>
  </section>
  <section class="cards">
    ${candidates.map(candidate => `<article class="panel">
      <h2>Synthetic cadence: ${escapeHtml(candidate.id)}</h2>
      <p class="authority">${escapeHtml(candidate.syntheticAuthority)}; actualMiddleUsed=${escapeHtml(candidate.actualMiddleUsed)}</p>
      <div class="stage">
        <img src="${frames.t0Src}" alt="T0 live frame">
        <img src="${candidate.syntheticSrc}" alt="${escapeHtml(candidate.id)} synthetic middle frame">
        <img src="${frames.t2Src}" alt="T2 live frame">
      </div>
      <div class="timeline"><div>T0 real</div><div>${escapeHtml(candidate.id)}</div><div>T2 real</div></div>
    </article>`).join('\n')}
  </section>
</main>
</body>
</html>`;
  writeFileSync(path, html);
}

const args = parseArgs(process.argv.slice(2));
const reportPath = resolve(args.get('--report') || '/tmp/kaminos-interframe-route-aware-composite/report.json');
const outPath = resolve(args.get('--out') || `${dirname(reportPath)}/interframe-playback-witness.html`);
const report = readJson(reportPath);
const frames = {
  width: report.triplet?.width || 256,
  height: report.triplet?.height || 248,
  t0Src: pathForHtml(outPath, report.artifacts.t0),
  actualSrc: pathForHtml(outPath, report.artifacts.actualMiddle),
  t2Src: pathForHtml(outPath, report.artifacts.t2),
  t0Label: `T0 frame ${report.triplet?.t0?.frameCount ?? 'unknown'}`,
  actualLabel: `Actual T1 frame ${report.triplet?.actualMiddle?.frameCount ?? 'unknown'}`,
  t2Label: `T2 frame ${report.triplet?.t2?.frameCount ?? 'unknown'}`,
};
const reportCandidates = (report.baselines || [])
  .filter(baseline => baseline?.syntheticMiddle?.path)
  .map(baseline => baselineCandidate(report, baseline, outPath));
const extraCandidates = (args.get('--candidate') || []).map(raw => parseExtraCandidate(raw, outPath));
const payload = {
  schema: SCHEMA,
  route: report.triplet?.effectiveRoute || report.requestedRoute || 'unknown',
  frameLabel: `${frames.t0Label} / ${frames.actualLabel} / ${frames.t2Label}`,
  actualMiddleUsed: true,
  syntheticAuthority: SYNTHETIC_AUTHORITY,
  frames,
  candidates: [...reportCandidates, ...extraCandidates],
};
writeHtml(outPath, payload);
writeFileSync(outPath.replace(/\.html$/i, '.json'), `${JSON.stringify({
  ...payload,
  output: outPath,
}, null, 2)}\n`);
console.log(JSON.stringify({ schema: SCHEMA, output: outPath, candidates: payload.candidates.map(candidate => candidate.id) }, null, 2));
