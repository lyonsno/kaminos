import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  OVERLAPPING_ANISOTROPIC_TISSUE_CONTROL_SCHEMA,
  ROW_DISTINCT_FIELD_ASSAY_SCHEMA,
  TARGET_SDF_FULL_SURFACE_SWEEP_SCHEMA,
  buildOverlappingAnisotropicTissueControlAssay,
  buildRowDistinctScalarAnisotropicAssay,
  buildTargetSdfFullSurfaceSweep,
  validateOverlappingAnisotropicTissueControlInputs,
} from './row-distinct-field-assay-core.mjs';

export const ROW_DISTINCT_ARTIFACT_ROUTE = 'bounded-hindquarter-row-distinct-field-mesh-v0';
export const TARGET_SDF_FULL_SURFACE_ARTIFACT_ROUTE =
  'bounded-hindquarter-target-sdf-full-surface-sweep-v0';
export const OVERLAPPING_TISSUE_ARTIFACT_ROUTE =
  'bounded-hindquarter-overlapping-anisotropic-tissue-control-v0';

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

function projectedMeshSvg(mesh, panel, bounds, className, maximumFaces = 2600) {
  const corners = [];
  for (const right of bounds.right) {
    for (const dorsal of bounds.dorsal) {
      for (const anterior of bounds.anterior) corners.push([right, dorsal, anterior]);
    }
  }
  const rawProject = ([right, dorsal, anterior]) => [
    anterior * 0.88 + right * 0.58,
    -dorsal + anterior * 0.22 - right * 0.16,
  ];
  const projectedCorners = corners.map(rawProject);
  const lowX = Math.min(...projectedCorners.map((point) => point[0]));
  const highX = Math.max(...projectedCorners.map((point) => point[0]));
  const lowY = Math.min(...projectedCorners.map((point) => point[1]));
  const highY = Math.max(...projectedCorners.map((point) => point[1]));
  const project = (vertex) => {
    const [x, y] = rawProject(vertex);
    return [
      panel.x + 10 + (x - lowX) / (highX - lowX) * (panel.width - 20),
      panel.y + 10 + (y - lowY) / (highY - lowY) * (panel.height - 20),
    ];
  };
  const stride = Math.max(1, Math.ceil(mesh.faces.length / maximumFaces));
  const faces = mesh.faces
    .filter((_, index) => index % stride === 0)
    .map((face) => ({
      points: face.map((index) => project(mesh.vertices[index])),
      depth: face.reduce((sum, index) => {
        const [right, dorsal, anterior] = mesh.vertices[index];
        return sum + right * 0.45 + dorsal * 0.12 + anterior * 0.2;
      }, 0) / face.length,
    }))
    .sort((left, right) => left.depth - right.depth);
  return faces.map(({ points }) => (
    `<polygon points="${points.map((point) => point.map((value) => value.toFixed(2)).join(',')).join(' ')}" class="${className}"/>`
  )).join('');
}

function meshSectionsSvg(candidateSections, referenceSections, panel, bounds) {
  const gap = 7;
  const sectionWidth = (panel.width - gap * 2) / 3;
  const sectionHeight = panel.height;
  const drawSegments = (section, index, className) => {
    const originX = panel.x + index * (sectionWidth + gap);
    return section.segments.map((segment) => {
      const points = segment.map(([right, dorsal]) => [
        originX + (right - bounds.right[0]) / (bounds.right[1] - bounds.right[0]) * sectionWidth,
        panel.y + sectionHeight
          - (dorsal - bounds.dorsal[0]) / (bounds.dorsal[1] - bounds.dorsal[0]) * sectionHeight,
      ]);
      return `<line x1="${points[0][0].toFixed(2)}" y1="${points[0][1].toFixed(2)}" x2="${points[1][0].toFixed(2)}" y2="${points[1][1].toFixed(2)}" class="${className}"/>`;
    }).join('');
  };
  return candidateSections.map((section, index) => (
    `<g><rect x="${panel.x + index * (sectionWidth + gap)}" y="${panel.y}" width="${sectionWidth}" height="${sectionHeight}" class="section-panel"/>${drawSegments(referenceSections[index], index, 'section-reference')}${drawSegments(section, index, 'section-candidate')}<text x="${panel.x + index * (sectionWidth + gap) + 5}" y="${panel.y + 13}" class="section-label">z ${section.anterior}</text></g>`
  )).join('');
}

export function renderTargetSdfFullSurfaceSvg(assay) {
  if (assay?.schema !== TARGET_SDF_FULL_SURFACE_SWEEP_SCHEMA
    || assay.status !== 'completed'
    || assay.verdict?.passed !== true
    || assay.amplitudes?.length < 3) {
    throw new Error('admitted target-SDF full-surface sweep is required');
  }
  const width = 1480;
  const height = 1590;
  const columnWidth = 440;
  const columnGap = 28;
  const left = 55;
  const rowTop = 145;
  const rowHeight = 450;
  const columns = [
    { id: 'target-reference', title: 'independent target field' },
    { id: 'scalar-metaball-control', title: 'dense scalar metaballs' },
    { id: 'anisotropic-identity-challenger', title: 'anisotropic identity fields' },
  ];
  const rowsSvg = assay.amplitudes.map((amplitudeEntry, rowIndex) => {
    const y = rowTop + rowIndex * rowHeight;
    return columns.map((column, columnIndex) => {
      const x = left + columnIndex * (columnWidth + columnGap);
      const candidate = columnIndex === 0
        ? amplitudeEntry.reference
        : amplitudeEntry.rows.find((row) => row.id === column.id);
      const meshPanel = { x, y: y + 42, width: columnWidth, height: 245 };
      const sectionPanel = { x, y: y + 309, width: columnWidth, height: 92 };
      const referenceMesh = amplitudeEntry.reference.mesh;
      const referenceSections = amplitudeEntry.reference.sections;
      const topology = candidate.topology;
      const metric = candidate.fullSurface;
      const primitiveText = candidate.controlComplexity
        ? ` · ${candidate.controlComplexity.primitiveCount} primitives`
        : '';
      return `<g id="amplitude-${escapeXml(amplitudeEntry.amplitude)}-${escapeXml(column.id)}">
        <text x="${x}" y="${y + 17}" class="panel-title">${escapeXml(column.title)}</text>
        <text x="${x}" y="${y + 36}" class="metric">RMSE ${metric.normalizedRmse.toFixed(4)} · max ${metric.maximumNormalizedError.toFixed(4)} · ${topology.closed ? 'closed' : 'OPEN'} · ${topology.componentCount} component(s)${primitiveText}</text>
        <rect x="${meshPanel.x}" y="${meshPanel.y}" width="${meshPanel.width}" height="${meshPanel.height}" rx="12" class="mesh-panel"/>
        ${columnIndex === 0 ? '' : projectedMeshSvg(referenceMesh, meshPanel, assay.grid.bounds, 'mesh-reference')}
        ${projectedMeshSvg(candidate.mesh, meshPanel, assay.grid.bounds, columnIndex === 0 ? 'mesh-target' : 'mesh-candidate')}
        ${meshSectionsSvg(candidate.sections, referenceSections, sectionPanel, assay.grid.bounds)}
        <text x="${x}" y="${y + 423}" class="metric">area ${metric.area.toFixed(3)} · volume ${metric.volume.toFixed(3)} · all ${metric.sampledTriangleCount} triangles measured</text>
      </g>`;
    }).join('');
  }).join('');
  const amplitudeLabels = assay.amplitudes.map((entry, index) => (
    `<text x="12" y="${rowTop + index * rowHeight + 18}" class="amplitude" transform="rotate(-90 12 ${rowTop + index * rowHeight + 18})">amplitude ${entry.amplitude}</text>`
  )).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#071018"/>
  <style>
    text { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; fill: #dceaf0; }
    .heading { font-size: 25px; font-weight: 700; }
    .sub { font-size: 13px; fill: #96acb6; }
    .panel-title { font-size: 16px; font-weight: 700; }
    .metric { font-size: 10px; fill: #bfd0d7; }
    .amplitude { font-size: 12px; font-weight: 700; fill: #f3c47a; }
    .mesh-panel, .section-panel { fill: #101a24; stroke: #304657; }
    .mesh-target { fill: #e8b45b; fill-opacity: .30; stroke: #ffd78e; stroke-opacity: .42; stroke-width: .45; }
    .mesh-reference { fill: #ed74cb; fill-opacity: .10; stroke: #ff9ee0; stroke-opacity: .30; stroke-width: .38; }
    .mesh-candidate { fill: #27d8c5; fill-opacity: .20; stroke: #67f3e4; stroke-opacity: .42; stroke-width: .42; }
    .section-reference { stroke: #f18bd1; stroke-width: 1.2; opacity: .62; }
    .section-candidate { stroke: #65efe2; stroke-width: .8; opacity: .78; }
    .section-label { font-size: 8px; fill: #d6e5eb; }
  </style>
  <text x="55" y="39" class="heading">Target-field extraction and amplitude sweep</text>
  <text x="55" y="66" class="sub">full-surface 3D primary: every extracted triangle contributes to error, area, volume, and topology evidence</text>
  <text x="55" y="89" class="sub">mesh-derived 2D sections: magenta = independent target · cyan = candidate · same grid, extractor family, and observation volume</text>
  <text x="55" y="112" class="sub">3D panels deterministically subsample triangles for legibility; OBJ products preserve every triangle</text>
  ${amplitudeLabels}
  ${rowsSvg}
  <text x="55" y="1515" class="sub">reference ${escapeXml(assay.reference.authority)} · extractor ${escapeXml(assay.reference.effectiveExtractorId)}</text>
  <text x="55" y="1538" class="sub">target ${escapeXml(assay.targetHash)} · card ${escapeXml(assay.sweepCardHash)}</text>
  <text x="55" y="1561" class="sub">assay ${escapeXml(assay.assayHash)} · bounded synthetic evidence only; promotion none</text>
</svg>
`;
}

export function renderOverlappingAnisotropicTissueControlSvg(assay) {
  if (assay?.schema !== OVERLAPPING_ANISOTROPIC_TISSUE_CONTROL_SCHEMA
    || assay.status !== 'completed'
    || assay.evidenceVerdict?.passed !== true
    || assay.amplitudes?.length < 3) {
    throw new Error('completed overlapping tissue evidence is required');
  }
  const width = 1480;
  const height = 1590;
  const columnWidth = 440;
  const columnGap = 28;
  const left = 55;
  const rowTop = 150;
  const rowHeight = 450;
  const columns = [
    { id: 'muscle-tension', title: 'muscle-tension' },
    { id: 'fat-distribution', title: 'fat-distribution' },
    { id: 'combined', title: 'combined' },
  ];
  const rowsSvg = assay.amplitudes.map((amplitude, rowIndex) => {
    const y = rowTop + rowIndex * rowHeight;
    return columns.map((column, columnIndex) => {
      const x = left + columnIndex * (columnWidth + columnGap);
      const candidate = column.id === 'combined'
        ? assay.combined[rowIndex]
        : assay.controls[column.id].amplitudes[rowIndex];
      const meshPanel = { x, y: y + 42, width: columnWidth, height: 245 };
      const sectionPanel = { x, y: y + 309, width: columnWidth, height: 92 };
      const identity = candidate.surfaceIdentity.componentFractions;
      const responseText = column.id === 'combined'
        ? `sum ${candidate.superposition.normalizedRmse.toFixed(4)}`
        : `resp ${candidate.response.normalizedRmse.toFixed(4)} · x-talk ${candidate.spatialCrosstalkRatio.toFixed(3)}`;
      return `<g id="overlap-${escapeXml(amplitude)}-${escapeXml(column.id)}">
        <text x="${x}" y="${y + 17}" class="panel-title">${escapeXml(column.title)}</text>
        <text x="${x}" y="${y + 36}" class="metric">surf ${candidate.fullSurface.normalizedRmse.toFixed(4)} · ${responseText} · ${candidate.topology.closed ? 'closed' : 'OPEN'} · ${candidate.topology.componentCount}c</text>
        <rect x="${meshPanel.x}" y="${meshPanel.y}" width="${meshPanel.width}" height="${meshPanel.height}" rx="12" class="mesh-panel"/>
        ${projectedMeshSvg(candidate.reference.mesh, meshPanel, assay.grid.bounds, 'mesh-reference', 1000)}
        ${projectedMeshSvg(candidate.mesh, meshPanel, assay.grid.bounds, 'mesh-candidate', 1000)}
        ${meshSectionsSvg(candidate.sections, candidate.referenceSections, sectionPanel, assay.grid.bounds)}
        <text x="${x}" y="${y + 423}" class="metric">volume ${candidate.fullSurface.volume.toFixed(3)} · surface mixture muscle ${(identity.muscle ?? 0).toFixed(3)} / fat ${(identity.fat ?? 0).toFixed(3)}</text>
      </g>`;
    }).join('');
  }).join('');
  const amplitudeLabels = assay.amplitudes.map((amplitude, index) => (
    `<text x="12" y="${rowTop + index * rowHeight + 18}" class="amplitude" transform="rotate(-90 12 ${rowTop + index * rowHeight + 18})">amplitude ${amplitude}</text>`
  )).join('');
  const hypothesis = assay.hypothesisVerdict.passed
    ? 'lead hypothesis passed all predeclared bounds'
    : `lead hypothesis missed ${assay.hypothesisVerdict.failures.length} predeclared bound(s)`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#071018"/>
  <style>
    text { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; fill: #dceaf0; }
    .heading { font-size: 25px; font-weight: 700; }
    .sub { font-size: 13px; fill: #96acb6; }
    .panel-title { font-size: 16px; font-weight: 700; }
    .metric { font-size: 10px; fill: #bfd0d7; }
    .amplitude { font-size: 12px; font-weight: 700; fill: #f3c47a; }
    .mesh-panel, .section-panel { fill: #101a24; stroke: #304657; }
    .mesh-reference { fill: #ed74cb; fill-opacity: .10; stroke: #ff9ee0; stroke-opacity: .32; stroke-width: .38; }
    .mesh-candidate { fill: #27d8c5; fill-opacity: .20; stroke: #67f3e4; stroke-opacity: .44; stroke-width: .42; }
    .section-reference { stroke: #f18bd1; stroke-width: 1.2; opacity: .62; }
    .section-candidate { stroke: #65efe2; stroke-width: .8; opacity: .78; }
    .section-label { font-size: 8px; fill: #d6e5eb; }
  </style>
  <text x="55" y="39" class="heading">Overlapping anisotropic tissue control</text>
  <text x="55" y="66" class="sub">full-surface 3D: magenta = independent authored response · cyan = fitted muscle/fat carrier · muscle and fat contributors overlap but retain identity</text>
  <text x="55" y="89" class="sub">mesh-derived sections: the same extracted meshes are cut at three anterior planes; no profile-only substitute</text>
  <text x="55" y="112" class="sub">${escapeXml(hypothesis)} · scalar metaballs remain frozen at ${escapeXml(assay.frozenScalarControl.sourceAssayHash.slice(0, 12))}; no rescue or refit</text>
  ${amplitudeLabels}
  ${rowsSvg}
  <text x="55" y="1515" class="sub">descriptor ${escapeXml(assay.descriptorHash)} · target ${escapeXml(assay.targetHash)}</text>
  <text x="55" y="1538" class="sub">card ${escapeXml(assay.overlapCardHash)} · extractor ${escapeXml(assay.extractorId)}</text>
  <text x="55" y="1561" class="sub">assay ${escapeXml(assay.assayHash)} · bounded synthetic evidence only; promotion none</text>
</svg>
`;
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

export async function writeTargetSdfFullSurfaceArtifacts({
  outDir,
  sweepCard,
  assayCard,
  target,
  requestedRouteId = TARGET_SDF_FULL_SURFACE_ARTIFACT_ROUTE,
} = {}) {
  if (typeof outDir !== 'string' || outDir.length === 0) throw new Error('outDir is required');
  await mkdir(outDir, { recursive: true });
  const reportPath = join(outDir, 'report.json');
  const report = {
    schema: 'kaminos.target-sdf-full-surface-run-report.v0',
    status: 'running',
    requestedRouteId,
    effectiveRouteId: null,
    requestedExtractorId: sweepCard?.extractorId ?? null,
    effectiveExtractorId: null,
    evidencePrimary: 'full-surface-3d',
    sectionSource: 'extracted-mesh-triangle-plane-intersections',
    outputs: [],
  };
  let phase = 'input-validation';
  try {
    if (requestedRouteId !== TARGET_SDF_FULL_SURFACE_ARTIFACT_ROUTE) {
      throw new Error(
        `requested route ${requestedRouteId} is unavailable; effective route would be ${TARGET_SDF_FULL_SURFACE_ARTIFACT_ROUTE}`,
      );
    }
    report.effectiveRouteId = TARGET_SDF_FULL_SURFACE_ARTIFACT_ROUTE;
    phase = 'assay-build';
    const assay = buildTargetSdfFullSurfaceSweep({ sweepCard, assayCard, target });
    report.assayHash = assay.assayHash;
    report.targetHash = assay.targetHash;
    report.sweepCardHash = assay.sweepCardHash;
    report.effectiveExtractorId = assay.reference.effectiveExtractorId;
    report.admissionPassed = assay.verdict.passed;
    if (!assay.verdict.passed) {
      throw new Error(`full-surface reference evidence failed: ${JSON.stringify(assay.verdict.failures)}`);
    }

    phase = 'artifact-write';
    const products = [
      ['assay.json', `${JSON.stringify(assay, null, 2)}\n`],
      ['contact-sheet.svg', renderTargetSdfFullSurfaceSvg(assay)],
      ['reference-baseline.obj', meshToObj(assay.reference.baseline.mesh, 'target-reference-baseline')],
    ];
    for (const amplitude of assay.amplitudes) {
      const amplitudeId = String(amplitude.amplitude).replace('.', 'p');
      products.push([
        `reference-amplitude-${amplitudeId}.obj`,
        meshToObj(amplitude.reference.mesh, `target-reference-amplitude-${amplitudeId}`),
      ]);
      for (const row of amplitude.rows) {
        products.push([
          `${safeId(row.id)}-amplitude-${amplitudeId}.obj`,
          meshToObj(row.mesh, `${row.id}-amplitude-${amplitudeId}`),
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
    report.lastTrustworthyEvidence = 'all 3D meshes and 2D diagnostics reread and hashed from disk';
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return { assay, report, reportPath };
  } catch (error) {
    report.status = 'failed';
    report.failurePhase = phase;
    report.error = error instanceof Error ? error.message : String(error);
    report.lastTrustworthyEvidence = report.outputs.length === 0
      ? 'output directory and failure report only; no primary artifact accepted'
      : `${report.outputs.length} artifact(s) reread and hashed before failure`;
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    throw error;
  }
}

export async function writeOverlappingAnisotropicTissueControlArtifacts({
  outDir,
  overlapCard,
  overlapTarget,
  descriptor,
  frozenSweepCard,
  frozenAssayCard,
  frozenTarget,
  requestedOverlapCardPath = null,
  requestedTargetPath = null,
  requestedDescriptorPath = null,
  requestedRouteId = OVERLAPPING_TISSUE_ARTIFACT_ROUTE,
} = {}) {
  if (typeof outDir !== 'string' || outDir.length === 0) throw new Error('outDir is required');
  await mkdir(outDir, { recursive: true });
  const reportPath = join(outDir, 'report.json');
  const report = {
    schema: 'kaminos.overlapping-anisotropic-tissue-control-run-report.v0',
    status: 'running',
    requestedRouteId,
    effectiveRouteId: null,
    requestedCompilerId: overlapCard?.compilerId ?? null,
    effectiveCompilerId: null,
    requestedExtractorId: overlapCard?.extractorId ?? null,
    effectiveExtractorId: null,
    requestedOverlapCardPath,
    requestedTargetPath,
    requestedDescriptorPath,
    evidencePrimary: 'full-surface-3d',
    sectionSource: 'extracted-mesh-triangle-plane-intersections',
    outputs: [],
  };
  let phase = 'input-validation';
  try {
    if (requestedRouteId !== OVERLAPPING_TISSUE_ARTIFACT_ROUTE) {
      throw new Error(
        `requested route ${requestedRouteId} is unavailable; effective route would be ${OVERLAPPING_TISSUE_ARTIFACT_ROUTE}`,
      );
    }
    report.effectiveRouteId = OVERLAPPING_TISSUE_ARTIFACT_ROUTE;
    validateOverlappingAnisotropicTissueControlInputs({
      overlapCard,
      overlapTarget,
      descriptor,
      frozenSweepCard,
      frozenAssayCard,
      frozenTarget,
    });
    phase = 'assay-build';
    const assay = buildOverlappingAnisotropicTissueControlAssay({
      overlapCard,
      overlapTarget,
      descriptor,
      frozenSweepCard,
      frozenAssayCard,
      frozenTarget,
    });
    report.assayHash = assay.assayHash;
    report.targetHash = assay.targetHash;
    report.descriptorHash = assay.descriptorHash;
    report.overlapCardHash = assay.overlapCardHash;
    report.effectiveOverlapCardId = assay.overlapCardId;
    report.requestedTargetRef = assay.requestedTargetRef;
    report.effectiveTargetId = assay.effectiveTargetId;
    report.effectiveTargetHash = assay.effectiveTargetHash;
    report.requestedDescriptorRef = assay.requestedDescriptorRef;
    report.effectiveDescriptorId = assay.effectiveDescriptorId;
    report.effectiveDescriptorHash = assay.effectiveDescriptorHash;
    report.effectiveCompilerId = assay.effectiveCompilerId;
    report.effectiveExtractorId = assay.extractorId;
    report.evidencePassed = assay.evidenceVerdict.passed;
    report.hypothesisPassed = assay.hypothesisVerdict.passed;
    if (!assay.evidenceVerdict.passed) {
      throw new Error(`overlapping tissue evidence failed: ${JSON.stringify(assay.evidenceVerdict.failures)}`);
    }

    phase = 'artifact-write';
    const serializedAssay = structuredClone(assay);
    serializedAssay.baseline.mesh = {
      encoding: 'obj',
      outputRef: 'baseline-overlapping-anisotropic.obj',
    };
    serializedAssay.baseline.reference.mesh = {
      encoding: 'obj',
      outputRef: 'baseline-reference.obj',
    };
    for (const [controlId, control] of Object.entries(serializedAssay.controls)) {
      for (const entry of control.amplitudes) {
        const amplitudeId = String(entry.amplitude).replace('.', 'p');
        entry.mesh = {
          encoding: 'obj',
          outputRef: `${safeId(controlId)}-amplitude-${amplitudeId}.obj`,
        };
        entry.reference.mesh = {
          encoding: 'obj',
          outputRef: `${safeId(controlId)}-reference-amplitude-${amplitudeId}.obj`,
        };
      }
    }
    for (const entry of serializedAssay.combined) {
      const amplitudeId = String(entry.amplitude).replace('.', 'p');
      entry.mesh = {
        encoding: 'obj',
        outputRef: `combined-amplitude-${amplitudeId}.obj`,
      };
      entry.reference.mesh = {
        encoding: 'obj',
        outputRef: `combined-reference-amplitude-${amplitudeId}.obj`,
      };
    }
    const products = [
      ['assay.json', `${JSON.stringify(serializedAssay, null, 2)}\n`],
      ['contact-sheet.svg', renderOverlappingAnisotropicTissueControlSvg(assay)],
      ['baseline-overlapping-anisotropic.obj', meshToObj(assay.baseline.mesh, 'overlapping-anisotropic-baseline')],
      ['baseline-reference.obj', meshToObj(assay.baseline.reference.mesh, 'overlapping-anisotropic-baseline-reference')],
    ];
    for (const [controlId, control] of Object.entries(assay.controls)) {
      for (const entry of control.amplitudes) {
        const amplitudeId = String(entry.amplitude).replace('.', 'p');
        products.push([
          `${safeId(controlId)}-amplitude-${amplitudeId}.obj`,
          meshToObj(entry.mesh, `${controlId}-amplitude-${amplitudeId}`),
        ]);
        products.push([
          `${safeId(controlId)}-reference-amplitude-${amplitudeId}.obj`,
          meshToObj(entry.reference.mesh, `${controlId}-reference-amplitude-${amplitudeId}`),
        ]);
      }
    }
    for (const entry of assay.combined) {
      const amplitudeId = String(entry.amplitude).replace('.', 'p');
      products.push([
        `combined-amplitude-${amplitudeId}.obj`,
        meshToObj(entry.mesh, `combined-amplitude-${amplitudeId}`),
      ]);
      products.push([
        `combined-reference-amplitude-${amplitudeId}.obj`,
        meshToObj(entry.reference.mesh, `combined-reference-amplitude-${amplitudeId}`),
      ]);
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
    report.lastTrustworthyEvidence = 'all 3D meshes and mesh-derived diagnostics reread and hashed from disk';
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return { assay, report, reportPath };
  } catch (error) {
    report.status = 'failed';
    report.failurePhase = phase;
    report.error = error instanceof Error ? error.message : String(error);
    report.lastTrustworthyEvidence = report.outputs.length === 0
      ? 'output directory and failure report only; no primary artifact accepted'
      : `${report.outputs.length} artifact(s) reread and hashed before failure`;
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    throw error;
  }
}
