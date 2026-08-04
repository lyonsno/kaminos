#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = join(repoRoot, 'artifacts/lirm-metaball-silhouette-authority-v0');
const manifest = JSON.parse(readFileSync(join(artifactRoot, 'manifest.json'), 'utf8'));
const jobs = JSON.parse(readFileSync(join(artifactRoot, 'greenroom-jobs.json'), 'utf8'));
const jobsByCell = new Map(jobs.jobs.map((job) => [job.cellId, job]));

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');
const imagePath = (absolutePath) => relative(artifactRoot, absolutePath).split('\\').join('/');

const sourceTile = (row, kind) => `
  <figure class="tile source">
    <figcaption>${kind}</figcaption>
    <img src="${escapeHtml(row.sourceImages[kind].relativePath)}" alt="${escapeHtml(`${row.id} ${kind} conditioning`)}">
  </figure>`;

const outputTile = (row, seed) => {
  const cellId = `${row.id}-seed-${seed}`;
  const job = jobsByCell.get(cellId);
  const absoluteOutput = join(artifactRoot, 'generated', row.id, `seed-${seed}`, 'output.png');
  if (!job || !existsSync(absoluteOutput)) {
    return `<figure class="tile pending"><figcaption>seed ${seed}</figcaption><div>pending</div></figure>`;
  }
  const metadataPath = join(dirname(absoluteOutput), 'metadata.json');
  const metadata = existsSync(metadataPath) ? JSON.parse(readFileSync(metadataPath, 'utf8')) : null;
  const duration = metadata?.duration_s ? `${metadata.duration_s.toFixed(1)}s` : 'duration unavailable';
  return `
  <figure class="tile output">
    <figcaption>seed ${seed} <span>${escapeHtml(job.jobId)} · ${duration}</span></figcaption>
    <img src="${escapeHtml(imagePath(absoluteOutput))}" alt="${escapeHtml(`${row.id} generated seed ${seed}`)}">
  </figure>`;
};

const rows = manifest.rows.map((row) => {
  const axis = row.axis.parameterId
    ? `${row.axis.parameterId}: ${row.axis.from} → ${row.axis.to}`
    : 'baseline';
  return `
<section class="assay-row">
  <header><h2>${escapeHtml(row.id)}</h2><p>${escapeHtml(axis)}</p></header>
  <div class="tiles">
    ${sourceTile(row, 'clay')}
    ${sourceTile(row, 'depth')}
    ${sourceTile(row, 'normal')}
    ${manifest.fixedGenerator.seeds.map((seed) => outputTile(row, seed)).join('')}
  </div>
</section>`;
}).join('');

const completed = manifest.rows.reduce((count, row) => count
  + manifest.fixedGenerator.seeds.filter((seed) => existsSync(
    join(artifactRoot, 'generated', row.id, `seed-${seed}`, 'output.png'),
  )).length, 0);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Metaball silhouette authority · tranche 01</title>
<style>
  :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #101412; color: #edf1eb; }
  .mast { position: sticky; top: 0; z-index: 2; padding: 16px 24px; background: #151a17f2; border-bottom: 1px solid #4c5b51; }
  h1 { margin: 0 0 8px; font-size: 20px; letter-spacing: 0; }
  .config, .prompt { margin: 4px 0; color: #bac5bc; font-size: 13px; line-height: 1.45; }
  .config strong { color: #f1c965; }
  .prompt strong { color: #69d2b4; }
  main { padding: 0 24px 32px; }
  .assay-row { padding: 18px 0 22px; border-bottom: 1px solid #344039; }
  .assay-row header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 10px; }
  h2 { margin: 0; font-size: 16px; letter-spacing: 0; }
  .assay-row header p { margin: 0; color: #95a59a; font-size: 12px; }
  .tiles { display: grid; grid-template-columns: repeat(6, minmax(150px, 1fr)); gap: 8px; }
  .tile { min-width: 0; margin: 0; overflow: hidden; border: 1px solid #3a463f; border-radius: 4px; background: #0a0d0b; aspect-ratio: 1 / 1.1; }
  figcaption { height: 28px; padding: 6px 8px; background: #202722; color: #d8ded9; font-size: 11px; }
  figcaption span { float: right; color: #849288; }
  .tile img { display: block; width: 100%; height: calc(100% - 28px); object-fit: contain; }
  .source { border-color: #287969; }
  .output { border-color: #906b25; }
  .pending { display: grid; grid-template-rows: 28px 1fr; color: #7e8a82; }
  .pending div { display: grid; place-items: center; font-size: 12px; }
  @media (max-width: 1100px) { .tiles { grid-template-columns: repeat(3, minmax(150px, 1fr)); } }
</style>
</head>
<body>
<header class="mast">
  <h1>Metaball silhouette authority · tranche 01 · ${completed}/21 outputs present</h1>
  <p class="config"><strong>fixed generator</strong> ${escapeHtml(manifest.fixedGenerator.model)} · q${manifest.fixedGenerator.quantize} · ${manifest.fixedGenerator.width}×${manifest.fixedGenerator.height} · ${manifest.fixedGenerator.steps} steps · guidance ${manifest.fixedGenerator.guidance.toFixed(1)} · clay/depth/normal · matched seeds ${manifest.fixedGenerator.seeds.join(', ')}</p>
  <p class="prompt"><strong>prompt</strong> ${escapeHtml(manifest.fixedGenerator.prompt)}</p>
</header>
<main>${rows}</main>
</body>
</html>`;

const reportPath = join(artifactRoot, 'report.html');
writeFileSync(reportPath, html);
process.stdout.write(`${reportPath}\n`);
