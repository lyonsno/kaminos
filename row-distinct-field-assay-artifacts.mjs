import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ROW_DISTINCT_FIELD_ASSAY_SCHEMA,
  buildRowDistinctScalarAnisotropicAssay,
} from './row-distinct-field-assay-core.mjs';

export const ROW_DISTINCT_ARTIFACT_ROUTE = 'bounded-hindquarter-row-distinct-field-mesh-v0';

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function safeId(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]+/g, '_');
}

function meshToObj(mesh, objectId) {
  if (!mesh?.vertices?.length || !mesh?.faces?.length) {
    throw new Error('nonblank row-distinct mesh is required');
  }
  const lines = [`o ${safeId(objectId)}`];
  for (const vertex of mesh.vertices) lines.push(`v ${vertex.join(' ')}`);
  for (const face of mesh.faces) lines.push(`f ${face.map((index) => index + 1).join(' ')}`);
  return `${lines.join('\n')}\n`;
}

function profilePath(stations, panel, camera) {
  const [zLow, zHigh] = camera.bounds.anterior;
  const [yLow, yHigh] = camera.bounds.dorsal;
  const point = (anterior, dorsal) => [
    panel.x + (anterior - zLow) / (zHigh - zLow) * panel.width,
    panel.y + panel.height - (dorsal - yLow) / (yHigh - yLow) * panel.height,
  ];
  const upper = stations.map((station) => point(station.anterior, station.top));
  const lower = [...stations].reverse().map((station) => point(station.anterior, station.bottom));
  return [...upper, ...lower].map(
    ([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`,
  ).join(' ') + ' Z';
}

function targetProfile(target, stateId) {
  return target.stations.map((station) => ({ anterior: station.anterior, ...station[stateId] }));
}

export function renderRowDistinctAssaySvg(assay, target) {
  if (assay?.schema !== ROW_DISTINCT_FIELD_ASSAY_SCHEMA
    || assay.status !== 'completed'
    || assay.rows?.length !== 2) {
    throw new Error('completed row-distinct assay is required');
  }
  if (!target?.stations?.length) throw new Error('row-distinct target is required');
  const width = 900;
  const height = 1160;
  const panels = assay.rows.map((_, index) => ({
    x: 55,
    y: 155 + index * 430,
    width: 790,
    height: 330,
  }));
  const panelsSvg = assay.rows.map((row, index) => {
    const panel = panels[index];
    const targetPerturbed = profilePath(targetProfile(target, 'perturbed'), panel, assay.camera);
    const baseline = profilePath(row.baseline.observations, panel, assay.camera);
    const perturbed = profilePath(row.perturbed.observations, panel, assay.camera);
    const rowAdmitted = row.evidenceDisposition === 'candidate-evidence'
      && row.verdict.passed
      && assay.verdict.passed;
    const verdict = row.evidenceDisposition === 'control-observation'
      ? 'control / not admitted'
      : rowAdmitted ? 'candidate admitted' : 'candidate not admitted';
    const admissionFailures = row.evidenceDisposition === 'candidate-evidence'
      ? assay.verdict.failures
      : [];
    const failures = [...row.verdict.failures, ...admissionFailures]
      .map((failure) => failure.code)
      .join(', ');
    return `<g id="${escapeXml(row.id)}">
      <text x="${panel.x}" y="${panel.y - 47}" class="title">${escapeXml(row.id)}</text>
      <text x="${panel.x}" y="${panel.y - 24}" class="meta">${escapeXml(row.effectiveCompilerId)} · ${escapeXml(verdict)}</text>
      <rect x="${panel.x}" y="${panel.y}" width="${panel.width}" height="${panel.height}" rx="14" class="panel"/>
      <path d="${baseline}" class="baseline"/>
      <path d="${perturbed}" class="perturbed"/>
      <path d="${targetPerturbed}" class="target"/>
      <text x="${panel.x + 14}" y="${panel.y + panel.height - 48}" class="metric">baseline RMSE ${row.baselineFit.normalizedRmse.toFixed(4)} · response RMSE ${row.response.normalizedRmse.toFixed(4)}</text>
      <text x="${panel.x + 14}" y="${panel.y + panel.height - 28}" class="metric">locality ${row.response.localityRatio.toExponential(2)} · direction ${row.response.directionAgreement.toFixed(3)} · smooth Δ² ${row.response.maxSecondDifference.toFixed(4)}</text>
      <text x="${panel.x + 14}" y="${panel.y + panel.height - 8}" class="failure">${escapeXml(failures || 'no admission failures')}</text>
    </g>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#081018"/>
  <style>
    text { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; fill: #d9e8ee; }
    .heading { font-size: 25px; font-weight: 700; }
    .sub { font-size: 13px; fill: #94aab4; }
    .title { font-size: 17px; font-weight: 700; }
    .meta, .metric { font-size: 11px; fill: #b9cbd2; }
    .failure { font-size: 10px; fill: #f2b477; }
    .panel { fill: #111923; stroke: #304455; }
    .baseline { fill: #7f8b95; fill-opacity: .35; stroke: #aab4bc; stroke-width: 2; }
    .perturbed { fill: #20d8c4; fill-opacity: .26; stroke: #5ff3e5; stroke-width: 2.5; }
    .target { fill: none; stroke: #f18bd1; stroke-width: 2; stroke-dasharray: 8 6; }
  </style>
  <text x="55" y="42" class="heading">Row-distinct interior-carrier assay</text>
  <text x="55" y="68" class="sub">grey = compiled baseline · cyan = compiled muscle-tension perturbation · magenta dash = independent perturbed target</text>
  <text x="55" y="91" class="sub">same grid, boundary target, control, camera, extractor family, and gates; distinct effective field compilers</text>
  ${panelsSvg}
  <text x="55" y="1020" class="sub">camera ${escapeXml(assay.camera.id)} · target ${escapeXml(assay.targetId)}</text>
  <text x="55" y="1044" class="sub">target hash ${escapeXml(assay.targetHash)}</text>
  <text x="55" y="1068" class="sub">card hash ${escapeXml(assay.assayCardHash)}</text>
  <text x="55" y="1092" class="sub">assay ${escapeXml(assay.assayHash)}</text>
  <text x="55" y="1128" class="sub">bounded synthetic fixture only; no anatomical, feline, authored-envelope, generator, reconstruction, registration, motion, or production claim</text>
</svg>
`;
}

export async function writeRowDistinctAssayArtifacts({
  outDir,
  assayCard,
  target,
  requestedRouteId = ROW_DISTINCT_ARTIFACT_ROUTE,
} = {}) {
  if (typeof outDir !== 'string' || outDir.length === 0) throw new Error('outDir is required');
  await mkdir(outDir, { recursive: true });
  const reportPath = join(outDir, 'report.json');
  const report = {
    schema: 'kaminos.row-distinct-field-assay-run-report.v0',
    status: 'running',
    requestedRouteId,
    effectiveRouteId: null,
    cameraId: assayCard?.camera?.id ?? null,
    outputs: [],
  };
  let phase = 'input-validation';
  try {
    if (requestedRouteId !== ROW_DISTINCT_ARTIFACT_ROUTE) {
      throw new Error(
        `requested route ${requestedRouteId} is unavailable; effective route would be ${ROW_DISTINCT_ARTIFACT_ROUTE}`,
      );
    }
    report.effectiveRouteId = ROW_DISTINCT_ARTIFACT_ROUTE;
    phase = 'assay-build';
    const assay = buildRowDistinctScalarAnisotropicAssay({ assayCard, target });
    report.assayHash = assay.assayHash;
    report.admissionPassed = assay.verdict.passed;
    report.targetHash = assay.targetHash;
    report.assayCardHash = assay.assayCardHash;

    phase = 'artifact-write';
    const products = [
      ['assay.json', `${JSON.stringify(assay, null, 2)}\n`],
      ['contact-sheet.svg', renderRowDistinctAssaySvg(assay, target)],
    ];
    for (const [rowIndex, row] of assay.rows.entries()) {
      for (const stateId of ['baseline', 'perturbed']) {
        products.push([
          `${rowIndex + 1}-${safeId(row.id)}-${stateId}.obj`,
          meshToObj(row[stateId].mesh, `${row.id}-${stateId}`),
        ]);
      }
    }
    for (const [relativePath, contents] of products) {
      const path = join(outDir, relativePath);
      await writeFile(path, contents, 'utf8');
      const bytes = await readFile(path);
      report.outputs.push({
        relativePath,
        byteLength: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    report.status = 'completed';
    report.failurePhase = null;
    report.lastTrustworthyEvidence = 'all primary artifacts reread and hashed from disk';
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return { assay, report, reportPath };
  } catch (error) {
    report.status = 'failed';
    report.failurePhase = phase;
    report.error = error instanceof Error ? error.message : String(error);
    report.lastTrustworthyEvidence = report.outputs.length === 0
      ? 'output directory and failure report only; no primary artifact accepted'
      : `${report.outputs.length} primary artifact(s) reread and hashed from disk`;
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    throw error;
  }
}
