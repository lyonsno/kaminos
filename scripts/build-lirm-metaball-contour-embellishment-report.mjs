#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = join(repoRoot, 'artifacts/lirm-metaball-contour-embellishment-v0');
const manifest = JSON.parse(readFileSync(join(artifactRoot, 'manifest.json'), 'utf8'));
const jobsPath = join(artifactRoot, 'greenroom-jobs.json');
const jobs = existsSync(jobsPath) ? JSON.parse(readFileSync(jobsPath, 'utf8')) : { jobs: [] };
const jobsByCell = new Map(jobs.jobs.map(job => [job.cellId, job]));
const escapeHtml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');
const reportPath = path => relative(artifactRoot, resolve(repoRoot, path));
const hash = path => `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;

function referenceTiles(references) {
  return references.map((reference, index) => `<figure class="tile source"><figcaption>ref ${index + 1} · depth · ${escapeHtml(reference.viewId)}</figcaption><img src="${escapeHtml(reportPath(reference.path))}" alt="${escapeHtml(`${reference.viewId} depth reference`)}"></figure>`).join('');
}

function outputTile(path, label, jobId) {
  const absolute = resolve(repoRoot, path);
  return existsSync(absolute)
    ? `<figure class="tile output"><figcaption>${escapeHtml(label)} · ${escapeHtml(hash(absolute).slice(7, 19))} · ${escapeHtml(jobId)}</figcaption><img src="${escapeHtml(reportPath(path))}" alt="${escapeHtml(label)}"></figure>`
    : `<figure class="tile pending"><figcaption>${escapeHtml(label)}</figcaption><div>pending</div></figure>`;
}

function routeDetails(receiptPath) {
  const absolute = resolve(repoRoot, receiptPath);
  if (!existsSync(absolute)) return '<p class="route-missing">effective route pending</p>';
  const receipt = JSON.parse(readFileSync(absolute, 'utf8'));
  return `<details><summary>effective route · ${escapeHtml(receipt.status)} · exit ${escapeHtml(receipt.exit_code)} · ${escapeHtml(receipt.job_type)}</summary><code>${escapeHtml(receipt.effective_route)}</code></details>`;
}

const baseline = `<section class="baseline"><header><h2>Observed all-depth baseline</h2><p>seed ${manifest.baseline.seed} · prior matched route</p></header><p class="row-prompt"><strong>exact prompt</strong> ${escapeHtml(manifest.baseline.prompt)}</p>${routeDetails(manifest.baseline.receiptPath)}<div class="tiles">${referenceTiles(manifest.baseline.references)}${outputTile(manifest.baseline.outputPath, 'furred organismal baseline', manifest.baseline.reuseJobId)}</div></section>`;

const rows = manifest.conditions.flatMap(condition => manifest.fixedGenerator.seeds.map(seed => {
  const cellId = `${condition.id}-seed-${seed}`;
  const job = jobsByCell.get(cellId);
  const outputPath = `artifacts/lirm-metaball-contour-embellishment-v0/generated/${condition.id}/seed-${seed}/output.png`;
  const receiptPath = `artifacts/lirm-metaball-contour-embellishment-v0/receipts/${cellId}.json`;
  return `<section><header><h2>${escapeHtml(condition.id)}</h2><p>seed ${seed} · depth/depth/depth · ${escapeHtml(condition.requestedRoute)}</p></header><p class="row-prompt"><strong>exact prompt</strong> ${escapeHtml(condition.prompt)}</p>${routeDetails(receiptPath)}<div class="tiles">${referenceTiles(condition.references)}${outputTile(outputPath, 'generated output', job?.jobId ?? 'unsubmitted')}</div></section>`;
})).join('');

const completed = manifest.conditions.reduce((count, condition) => count + manifest.fixedGenerator.seeds.filter(seed => existsSync(join(artifactRoot, 'generated', condition.id, `seed-${seed}`, 'output.png'))).length, 0);
const settings = manifest.fixedGenerator;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bowplan contour-bound embellishment</title><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:#101412;color:#edf1eb}.mast{position:sticky;top:0;z-index:2;padding:16px 24px;background:#151a17f2;border-bottom:1px solid #4c5b51}h1{margin:0 0 8px;font-size:20px;letter-spacing:0}.config,.question,.claim{margin:4px 0;color:#bac5bc;font-size:13px;line-height:1.45}.config strong{color:#f1c965}.question strong,.row-prompt strong{color:#69d2b4}.claim strong{color:#dc8a78}main{padding:0 24px 32px}section{padding:18px 0 22px;border-bottom:1px solid #344039}.baseline{background:#172019;margin:0 -24px;padding-left:24px;padding-right:24px}section header{display:flex;align-items:baseline;gap:12px;margin-bottom:6px}h2{margin:0;font-size:16px;letter-spacing:0}section header p{margin:0;color:#95a59a;font-size:12px}.row-prompt{margin:0 0 8px;color:#bac5bc;font-size:12px;line-height:1.4}details{margin:0 0 10px;color:#94a49a;font-size:11px}details code{display:block;margin-top:6px;padding:8px;background:#090c0a;color:#bac5bc;white-space:pre-wrap;overflow-wrap:anywhere}.route-missing{color:#dc8a78;font-size:11px}.tiles{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:8px}.tile{min-width:0;margin:0;overflow:hidden;border:1px solid #3a463f;border-radius:4px;background:#0a0d0b;aspect-ratio:1/1.1}figcaption{height:28px;padding:6px 8px;background:#202722;color:#d8ded9;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tile img{display:block;width:100%;height:calc(100% - 28px);object-fit:contain}.source{border-color:#287969}.output{border-color:#b98d34}.pending{display:grid;grid-template-rows:28px 1fr;color:#7e8a82}.pending div{display:grid;place-items:center;font-size:12px}@media(max-width:1000px){.tiles{grid-template-columns:repeat(2,minmax(150px,1fr))}}
</style></head><body><header class="mast"><h1>Bowplan contour-bound embellishment · ${completed}/9 new outputs present</h1><p class="config"><strong>fixed generator</strong> ${escapeHtml(settings.model)} · q${settings.quantize} · ${settings.width}×${settings.height} · ${settings.steps} steps · guidance ${settings.guidance.toFixed(1)} · seeds ${settings.seeds.join(', ')}</p><p class="question"><strong>controlled question</strong> How much organismal elaboration can prompt language induce before the fixed all-depth Bowplan carrier loses its low-frequency organization?</p><p class="claim"><strong>claim ceiling</strong> ${escapeHtml(manifest.claimCeiling)}</p></header><main>${baseline}${rows}</main></body></html>`;

writeFileSync(join(artifactRoot, 'report.html'), html);
process.stdout.write(`${join(artifactRoot, 'report.html')}\n`);
