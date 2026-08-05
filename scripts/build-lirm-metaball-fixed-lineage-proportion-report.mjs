#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = join(repoRoot, 'artifacts/lirm-metaball-fixed-lineage-proportion-v0');
const manifest = JSON.parse(readFileSync(join(artifactRoot, 'manifest.json'), 'utf8'));
const jobsPath = join(artifactRoot, 'greenroom-jobs.json');
const jobs = existsSync(jobsPath) ? JSON.parse(readFileSync(jobsPath, 'utf8')) : { jobs: [] };
const jobsByCell = new Map(jobs.jobs.map(job => [job.cellId, job]));
const inspectionPath = join(artifactRoot, 'inspection.json');
const inspection = existsSync(inspectionPath)
  ? JSON.parse(readFileSync(inspectionPath, 'utf8'))
  : { cells: [] };
const inspectionByCell = new Map(inspection.cells.map(cell => [cell.id, cell]));
const escapeHtml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');
const reportPath = path => relative(artifactRoot, resolve(repoRoot, path));
const hash = path => `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;

function referenceTiles(references) {
  return references.map(reference => `<figure class="tile source"><figcaption>ref ${reference.slot} · ${escapeHtml(reference.kind)} · ${escapeHtml(reference.viewId)}</figcaption><img src="${escapeHtml(reportPath(reference.path))}" alt="${escapeHtml(`${reference.viewId} ${reference.kind} reference`)}"></figure>`).join('');
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

function inspectionDetails(cellId) {
  const cell = inspectionByCell.get(cellId);
  if (!cell) return '<p class="inspection pending-inspection">visual inspection pending</p>';
  const lineageClass = cell.lineage === 'preserved' ? 'preserved' : 'crossed';
  return `<p class="inspection ${lineageClass}"><strong>${escapeHtml(cell.disposition)}</strong> · lineage ${escapeHtml(cell.lineage)} · directional inheritance ${escapeHtml(cell.directionalInheritance)} · target view ${escapeHtml(cell.targetView)} · happy ${escapeHtml(cell.happy ? 'yes' : 'no')}</p><p class="observation">${escapeHtml(cell.observation)}</p>`;
}

const baselineRow = manifest.rows.find(row => row.id === 'baseline');
if (!baselineRow) throw new Error('missing baseline row');
const anchor = manifest.lineageAnchor;
const anchorSection = `<section class="anchor"><header><h2>Exact lineage anchor</h2><p>maximum contour-bound invention · seed ${anchor.seed}</p></header><p class="parameters"><strong>source parameters</strong> ${escapeHtml(JSON.stringify(baselineRow.parameters))}</p><p class="row-prompt"><strong>exact prompt</strong> ${escapeHtml(manifest.fixedGenerator.prompt)}</p>${routeDetails(anchor.receiptPath)}<div class="tiles">${referenceTiles(baselineRow.references)}${outputTile(anchor.outputPath, 'observed lineage anchor', 'prior exact cell')}</div></section>`;

const rows = manifest.rows.map(row => {
  const seed = manifest.fixedGenerator.seeds[0];
  const cellId = `${row.id}-seed-${seed}`;
  const job = jobsByCell.get(cellId);
  const outputPath = `artifacts/lirm-metaball-fixed-lineage-proportion-v0/generated/${row.id}/seed-${seed}/output.png`;
  const receiptPath = `artifacts/lirm-metaball-fixed-lineage-proportion-v0/receipts/${cellId}.json`;
  const axis = row.axis.parameterId
    ? `${row.axis.parameterId}: ${row.axis.from} → ${row.axis.to}`
    : 'shared baseline';
  return `<section><header><h2>${escapeHtml(row.id)}</h2><p>${escapeHtml(axis)} · seed ${seed}</p></header><p class="parameters"><strong>bauplan parameters</strong> ${escapeHtml(JSON.stringify(row.parameters))}</p><p class="row-prompt"><strong>exact prompt</strong> ${escapeHtml(manifest.fixedGenerator.prompt)}</p>${inspectionDetails(row.id)}${routeDetails(receiptPath)}<div class="tiles">${referenceTiles(row.references)}${outputTile(outputPath, 'generated lineage member', job?.jobId ?? 'unsubmitted')}</div></section>`;
}).join('');

const completed = manifest.rows.filter(row => existsSync(join(artifactRoot, 'generated', row.id, `seed-${manifest.fixedGenerator.seeds[0]}`, 'output.png'))).length;
const settings = manifest.fixedGenerator;
const envelope = manifest.effectiveConfig.fixedProjectionEnvelope;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fixed-lineage bauplan proportions</title><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:#101412;color:#edf1eb}.mast{position:sticky;top:0;z-index:2;padding:16px 24px;background:#151a17f2;border-bottom:1px solid #4c5b51}h1{margin:0 0 8px;font-size:20px;letter-spacing:0}.config,.question,.claim{margin:4px 0;color:#bac5bc;font-size:13px;line-height:1.45}.config strong{color:#f1c965}.question strong,.row-prompt strong,.parameters strong{color:#69d2b4}.claim strong{color:#dc8a78}main{padding:0 24px 32px}section{padding:18px 0 22px;border-bottom:1px solid #344039}.anchor{background:#172019;margin:0 -24px;padding-left:24px;padding-right:24px}section header{display:flex;align-items:baseline;gap:12px;margin-bottom:6px}h2{margin:0;font-size:16px;letter-spacing:0}section header p{margin:0;color:#95a59a;font-size:12px}.row-prompt,.parameters,.observation{margin:0 0 8px;color:#bac5bc;font-size:12px;line-height:1.4}.inspection{display:inline-block;margin:0 0 6px;padding:4px 7px;border:1px solid #496255;border-radius:3px;background:#19241d;color:#cfe5d6;font-size:11px}.inspection.crossed{border-color:#a46e55;background:#2b1d18;color:#f0c4af}.pending-inspection{border-color:#6f6752;background:#262318;color:#d8cdab}.observation{color:#d8ded9}details{margin:0 0 10px;color:#94a49a;font-size:11px}details code{display:block;margin-top:6px;padding:8px;background:#090c0a;color:#bac5bc;white-space:pre-wrap;overflow-wrap:anywhere}.route-missing{color:#dc8a78;font-size:11px}.tiles{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:8px}.tile{min-width:0;margin:0;overflow:hidden;border:1px solid #3a463f;border-radius:4px;background:#0a0d0b;aspect-ratio:1/1.1}figcaption{height:28px;padding:6px 8px;background:#202722;color:#d8ded9;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tile img{display:block;width:100%;height:calc(100% - 28px);object-fit:contain}.source{border-color:#287969}.output{border-color:#b98d34}.pending{display:grid;grid-template-rows:28px 1fr;color:#7e8a82}.pending div{display:grid;place-items:center;font-size:12px}@media(max-width:1000px){.tiles{grid-template-columns:repeat(2,minmax(150px,1fr))}}
</style></head><body><header class="mast"><h1>Fixed-lineage bauplan proportion assay · ${completed}/7 outputs present</h1><p class="config"><strong>fixed generator</strong> ${escapeHtml(settings.model)} · q${settings.quantize} · ${settings.width}×${settings.height} · ${settings.steps} steps · guidance ${settings.guidance.toFixed(1)} · seed ${settings.seeds[0]}</p><p class="config"><strong>fixed projection</strong> ${envelope.screenWidthWorld}×${envelope.screenHeightWorld} world units · ${escapeHtml(envelope.framingPolicy)}</p><p class="question"><strong>controlled question</strong> Does the exact successful animal basin persist while axial length, body depth, and support length move substantially in both directions?</p><p class="claim"><strong>claim ceiling</strong> ${escapeHtml(manifest.claimCeiling)}</p></header><main>${anchorSection}${rows}</main></body></html>`;

writeFileSync(join(artifactRoot, 'report.html'), html);
process.stdout.write(`${join(artifactRoot, 'report.html')}\n`);
