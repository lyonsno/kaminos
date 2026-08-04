#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const artifactRoot = 'artifacts/lirm-metaball-target-first-multiview-v0';
const manifest = JSON.parse(readFileSync(join(artifactRoot, 'manifest.json'), 'utf8'));
const jobsPath = join(artifactRoot, 'greenroom-jobs.json');
const jobs = existsSync(jobsPath)
  ? JSON.parse(readFileSync(jobsPath, 'utf8'))
  : { carrierKind: manifest.fixedGenerator.provisionalCarrierKind, jobs: [] };
const jobsByCell = new Map(jobs.jobs.map(job => [job.cellId, job]));
const viewsById = new Map(manifest.views.map(view => [view.id, view]));
const carrierKind = jobs.carrierKind;

const escapeHtml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const conditions = manifest.conditions.map(condition => {
  const references = condition.referenceViewIds.map((viewId, index) => {
    const view = viewsById.get(viewId);
    const authority = condition.authoritativeReferenceIndices.includes(index + 1)
      ? ' · target authority'
      : ' · supplemental';
    return `<figure class="tile source">
      <figcaption>ref ${index + 1} · ${escapeHtml(viewId)}${authority} · yaw ${view.cameraYawRadians}</figcaption>
      <img src="${escapeHtml(view.sourceImages[carrierKind].relativePath)}" alt="${escapeHtml(`${viewId} ${carrierKind}`)}">
    </figure>`;
  }).join('');
  const seed = manifest.fixedGenerator.seeds[0];
  const cellId = `${condition.id}-seed-${seed}`;
  const outputPath = `generated/${condition.id}/seed-${seed}/output.png`;
  const job = jobsByCell.get(cellId);
  const output = job && existsSync(join(artifactRoot, outputPath))
    ? `<figure class="tile output"><figcaption>output · seed ${seed} · ${escapeHtml(job.jobId)}</figcaption><img src="${escapeHtml(outputPath)}" alt="${escapeHtml(`${condition.id} output`)}"></figure>`
    : `<figure class="tile pending"><figcaption>output · seed ${seed}</figcaption><div>pending</div></figure>`;
  return `<section><header><h2>${escapeHtml(condition.id)}</h2><p>${condition.distinctViewCount} distinct view${condition.distinctViewCount === 1 ? '' : 's'} · ${escapeHtml(condition.probeAxis)} · target ref ${condition.authoritativeReferenceIndices.join(', ')}</p></header><p class="row-prompt"><strong>exact prompt</strong> ${escapeHtml(condition.prompt)}</p><div class="tiles">${references}${output}</div></section>`;
}).join('');

const completed = manifest.conditions.filter(condition => existsSync(join(
  artifactRoot,
  'generated',
  condition.id,
  `seed-${manifest.fixedGenerator.seeds[0]}`,
  'output.png',
))).length;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Target-first multiview assay</title><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:#101412;color:#edf1eb}.mast{position:sticky;top:0;z-index:2;padding:16px 24px;background:#151a17f2;border-bottom:1px solid #4c5b51}h1{margin:0 0 8px;font-size:20px;letter-spacing:0}.config,.prompt,.claim{margin:4px 0;color:#bac5bc;font-size:13px;line-height:1.45}.config strong{color:#f1c965}.prompt strong,.row-prompt strong{color:#69d2b4}.claim strong{color:#dc8a78}main{padding:0 24px 32px}section{padding:18px 0 22px;border-bottom:1px solid #344039}section header{display:flex;align-items:baseline;gap:12px;margin-bottom:6px}h2{margin:0;font-size:16px;letter-spacing:0}section header p{margin:0;color:#95a59a;font-size:12px}.row-prompt{margin:0 0 10px;color:#bac5bc;font-size:12px;line-height:1.4}.tiles{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:8px}.tile{min-width:0;margin:0;overflow:hidden;border:1px solid #3a463f;border-radius:4px;background:#0a0d0b;aspect-ratio:1/1.1}figcaption{height:28px;padding:6px 8px;background:#202722;color:#d8ded9;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tile img{display:block;width:100%;height:calc(100% - 28px);object-fit:contain}.source{border-color:#287969}.output{border-color:#906b25}.pending{display:grid;grid-template-rows:28px 1fr;color:#7e8a82}.pending div{display:grid;place-items:center;font-size:12px}@media(max-width:1000px){.tiles{grid-template-columns:repeat(2,minmax(150px,1fr))}}
</style></head><body><header class="mast"><h1>Reference-position multiview · ${completed}/${manifest.conditions.length} outputs present</h1><p class="config"><strong>fixed generator</strong> ${escapeHtml(manifest.fixedGenerator.model)} · q${manifest.fixedGenerator.quantize} · ${manifest.fixedGenerator.width}×${manifest.fixedGenerator.height} · ${manifest.fixedGenerator.steps} steps · guidance ${manifest.fixedGenerator.guidance.toFixed(1)} · carrier ${escapeHtml(carrierKind)} · seed ${manifest.fixedGenerator.seeds.join(', ')}</p><p class="prompt"><strong>controlled question</strong> Can prompt-declared target authority survive first/middle/last reference placement before genuine three-view completion is interpreted?</p><p class="claim"><strong>claim ceiling</strong> ${escapeHtml(manifest.claimCeiling)}</p></header><main>${conditions}</main></body></html>`;

const reportPath = join(artifactRoot, 'report.html');
writeFileSync(reportPath, html);
process.stdout.write(`${reportPath}\n`);
