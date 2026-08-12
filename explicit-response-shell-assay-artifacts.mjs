import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  EXPLICIT_RESPONSE_SHELL_ASSAY_CARD_ID,
  EXPLICIT_RESPONSE_SHELL_COMPILER_ID,
  buildExplicitResponseShellAssay,
} from './explicit-response-shell-assay-core.mjs';

export const EXPLICIT_RESPONSE_SHELL_ARTIFACT_ROUTE =
  'bounded-hindquarter-explicit-response-shell-v0';

function safeId(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]+/g, '_');
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function meshToObj(mesh, objectId) {
  if (!mesh?.vertices?.length || !mesh?.faces?.length) {
    throw new Error('nonblank explicit response-shell mesh is required');
  }
  const lines = [`o ${safeId(objectId)}`];
  for (const vertex of mesh.vertices) lines.push(`v ${vertex.join(' ')}`);
  for (const face of mesh.faces) lines.push(`f ${face.map((index) => index + 1).join(' ')}`);
  return `${lines.join('\n')}\n`;
}

function projectedMeshSvg(mesh, comparisonMesh, panel, className, radialSegments = 48) {
  const projectRaw = ([right, dorsal, anterior]) => [
    anterior * 0.82 + right * 0.68,
    -dorsal + anterior * 0.18 - right * 0.18,
  ];
  const points = mesh.vertices.map(projectRaw);
  const comparisonPoints = comparisonMesh.vertices.map(projectRaw);
  const combined = [...points, ...comparisonPoints];
  const lowX = Math.min(...combined.map(([x]) => x));
  const highX = Math.max(...combined.map(([x]) => x));
  const lowY = Math.min(...combined.map(([, y]) => y));
  const highY = Math.max(...combined.map(([, y]) => y));
  const project = (index) => {
    const [x, y] = points[index];
    return [
      panel.x + 7 + (x - lowX) / Math.max(highX - lowX, 1e-9) * (panel.width - 14),
      panel.y + 7 + (y - lowY) / Math.max(highY - lowY, 1e-9) * (panel.height - 14),
    ];
  };
  const path = (indices, closed = false) => `${indices.map((index, pointIndex) => (
    `${pointIndex === 0 ? 'M' : 'L'}${project(index).map((value) => value.toFixed(2)).join(',')}`
  )).join(' ')}${closed ? ' Z' : ''}`;
  const ringCount = Math.floor((mesh.vertices.length - 2) / radialSegments);
  const rings = Array.from({ length: ringCount }, (_, ringId) => (
    `<path class="${className}" d="${path(Array.from(
      { length: radialSegments },
      (__, segment) => ringId * radialSegments + segment,
    ), true)}"/>`
  )).join('');
  const longitudinals = Array.from({ length: radialSegments / 4 }, (_, index) => {
    const segment = index * 4;
    return `<path class="${className} longitudinal" d="${path(Array.from(
      { length: ringCount },
      (__, ringId) => ringId * radialSegments + segment,
    ))}"/>`;
  }).join('');
  return `${rings}${longitudinals}`;
}

function meshSectionsSvg(candidate, reference, panel, radialSegments = 48) {
  const ringCount = Math.floor((candidate.vertices.length - 2) / radialSegments);
  const ringIds = [2, Math.floor(ringCount / 2), ringCount - 3];
  const gap = 8;
  const width = (panel.width - gap * 2) / 3;
  const all = [...candidate.vertices, ...reference.vertices];
  const lowX = Math.min(...all.map((vertex) => vertex[0]));
  const highX = Math.max(...all.map((vertex) => vertex[0]));
  const lowY = Math.min(...all.map((vertex) => vertex[1]));
  const highY = Math.max(...all.map((vertex) => vertex[1]));
  const path = (mesh, ringId, x) => {
    const vertices = mesh.vertices.slice(
      ringId * radialSegments,
      (ringId + 1) * radialSegments,
    );
    return `${vertices.map((vertex, index) => {
      const px = x + (vertex[0] - lowX) / Math.max(highX - lowX, 1e-9) * width;
      const py = panel.y + panel.height
        - (vertex[1] - lowY) / Math.max(highY - lowY, 1e-9) * panel.height;
      return `${index === 0 ? 'M' : 'L'}${px.toFixed(2)},${py.toFixed(2)}`;
    }).join(' ')} Z`;
  };
  return ringIds.map((ringId, index) => {
    const x = panel.x + index * (width + gap);
    return `<rect class="section-panel" x="${x}" y="${panel.y}" width="${width}" height="${panel.height}"/><path class="section-reference" d="${path(reference, ringId, x)}"/><path class="section-candidate" d="${path(candidate, ringId, x)}"/>`;
  }).join('');
}

export function renderExplicitResponseShellSvg(assay, generationId) {
  if (assay?.status !== 'completed' || assay?.verdict?.passed !== true) {
    throw new Error('completed admitted explicit response-shell assay is required');
  }
  const width = 1450;
  const height = 1450;
  const left = 45;
  const top = 145;
  const columnWidth = 435;
  const columnGap = 27;
  const rowHeight = 340;
  const controls = [
    ['muscle-tension', 'muscle response'],
    ['fat-distribution', 'fat response'],
    ['combined', 'held-out combined response'],
  ];
  const panels = assay.verdict.combined.amplitudes.map((entry, rowIndex) => (
    controls.map(([controlId, title], columnIndex) => {
      const stateId = `${controlId}:${entry.amplitude}`;
      const candidate = assay.candidate.compiledStates[stateId];
      const reference = assay.evaluation.referenceStates[stateId];
      const metric = controlId === 'combined'
        ? entry
        : assay.verdict.independent[controlId].amplitudes[rowIndex];
      const x = left + columnIndex * (columnWidth + columnGap);
      const y = top + rowIndex * rowHeight;
      const meshPanel = { x, y: y + 44, width: columnWidth, height: 205 };
      const sectionPanel = { x, y: y + 267, width: columnWidth, height: 58 };
      return `<g id="${safeId(stateId)}">
        <text class="panel-title" x="${x}" y="${y + 17}">${escapeXml(title)}</text>
        <text class="metric" x="${x}" y="${y + 36}">amplitude ${entry.amplitude} · 3D RMSE ${metric.fullSurfaceNormalizedRmse.toFixed(6)} · closed ${candidate.topology.closed ? 'yes' : 'NO'} · vertices ${candidate.topology.vertexCount}</text>
        <rect class="mesh-panel" x="${meshPanel.x}" y="${meshPanel.y}" width="${meshPanel.width}" height="${meshPanel.height}" rx="10"/>
        ${projectedMeshSvg(reference.mesh, candidate.mesh, meshPanel, 'mesh-reference')}
        ${projectedMeshSvg(candidate.mesh, reference.mesh, meshPanel, 'mesh-candidate')}
        ${meshSectionsSvg(candidate.mesh, reference.mesh, sectionPanel)}
      </g>`;
    }).join('')
  )).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#071018"/>
  <style>
    text { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; fill: #deedf2; }
    .heading { font-size: 25px; font-weight: 700; }
    .sub { font-size: 12px; fill: #9fb4be; }
    .panel-title { font-size: 15px; font-weight: 700; }
    .metric { font-size: 9.5px; fill: #bfd1d8; }
    .mesh-panel, .section-panel { fill: #101b25; stroke: #314957; }
    .mesh-reference { fill: none; stroke: #ff68ce; stroke-opacity: .78; stroke-width: 1.45; stroke-dasharray: 4 3; }
    .mesh-candidate { fill: none; stroke: #65f6e5; stroke-opacity: .9; stroke-width: .72; }
    .longitudinal { stroke-opacity: .34; }
    .section-reference { fill: none; stroke: #ff68ce; stroke-width: 1.8; stroke-dasharray: 4 3; opacity: .82; }
    .section-candidate { fill: none; stroke: #6af2e3; stroke-width: .9; opacity: .9; }
  </style>
  <text class="heading" x="45" y="37">Fixed-topology explicit response shell</text>
  <text class="sub" x="45" y="64">full-surface 3D primary plus mesh-derived sections · magenta reference · cyan response shell</text>
  <text class="sub" x="45" y="87">combined held out from construction · construction sources baseline + independent muscle + independent fat only</text>
  <text class="sub" x="45" y="110">surface-only causal null: independent response missing · this is an additive interface result, not anatomy or nonlinear skin mechanics</text>
  ${panels}
  <text class="sub" x="45" y="1181">generation ${escapeXml(generationId)} · assay ${escapeXml(assay.assayHash)}</text>
  <text class="sub" x="45" y="1204">compiler ${escapeXml(assay.construction.effectiveCompilerId)} · promotion none · bounded synthetic fixture only</text>
</svg>
`;
}

function renderFailureSvg(generationId, failurePhase, error) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="360" viewBox="0 0 1000 360">
  <rect width="100%" height="100%" fill="#190b10"/>
  <text x="42" y="70" font-family="ui-monospace, monospace" font-size="28" font-weight="700" fill="#ff809d">EXPLICIT SHELL ASSAY FAILED</text>
  <text x="42" y="116" font-family="ui-monospace, monospace" font-size="15" fill="#f6ced7">phase ${escapeXml(failurePhase)}</text>
  <text x="42" y="151" font-family="ui-monospace, monospace" font-size="13" fill="#f6ced7">generation ${escapeXml(generationId)}</text>
  <text x="42" y="196" font-family="ui-monospace, monospace" font-size="13" fill="#ffb4c4">${escapeXml(error)}</text>
  <text x="42" y="246" font-family="ui-monospace, monospace" font-size="12" fill="#c794a0">Prior OBJ files, if present, are noncurrent; report outputs is empty.</text>
</svg>
`;
}

export async function writeExplicitResponseShellFailureTombstones({
  outDir,
  generationId,
  failurePhase,
  error,
  requestedRouteId = null,
  requestedAssayCardPath = null,
  requestedTargetPath = null,
}) {
  const message = error instanceof Error ? error.message : String(error);
  await mkdir(outDir, { recursive: true });
  const failedAssay = {
    schema: 'kaminos.explicit-response-shell-result.v0',
    status: 'failed',
    generationId,
    failurePhase,
    error: message,
  };
  const failedReport = {
    schema: 'kaminos.explicit-response-shell-artifact-report.v0',
    status: 'failed',
    generationId,
    requestedRouteId,
    effectiveRouteId: null,
    requestedAssayCardPath,
    requestedTargetPath,
    failurePhase,
    error: message,
    lastTrustworthyEvidence: 'output directory and current failure tombstones only; no primary artifact accepted',
    outputs: [],
  };
  await writeJson(join(outDir, 'assay.json'), failedAssay);
  await writeFile(
    join(outDir, 'contact-sheet.svg'),
    renderFailureSvg(generationId, failurePhase, message),
    'utf8',
  );
  await writeJson(join(outDir, 'report.json'), failedReport);
  return failedReport;
}

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeMeshProduct(outDir, relativePath, mesh, objectId) {
  await writeFile(join(outDir, relativePath), meshToObj(mesh, objectId), 'utf8');
  return relativePath;
}

function meshReference(relativePath) {
  return { encoding: 'wavefront-obj', outputRef: relativePath };
}

export async function writeExplicitResponseShellArtifacts({
  outDir,
  assayCard,
  target,
  requestedAssayCardPath,
  requestedTargetPath,
} = {}) {
  const generationId = randomUUID();
  await mkdir(outDir, { recursive: true });
  let failurePhase = 'input-validation';
  try {
    if (assayCard?.id !== EXPLICIT_RESPONSE_SHELL_ASSAY_CARD_ID
      || assayCard.id !== EXPLICIT_RESPONSE_SHELL_ARTIFACT_ROUTE) {
      throw new Error('explicit response-shell assay card identity is not authoritative');
    }
    const assay = buildExplicitResponseShellAssay({ assayCard, target });
    failurePhase = 'artifact-publication';
    const serialized = structuredClone(assay);
    serialized.generationId = generationId;
    const productPaths = [];
    for (const [stateId, state] of Object.entries(assay.candidate.compiledStates)) {
      const relativePath = `candidate-${safeId(stateId)}.obj`;
      productPaths.push(await writeMeshProduct(outDir, relativePath, state.mesh, stateId));
      serialized.candidate.compiledStates[stateId].mesh = meshReference(relativePath);
    }
    for (const [stateId, state] of Object.entries(assay.evaluation.referenceStates)) {
      const relativePath = `reference-${safeId(stateId)}.obj`;
      productPaths.push(await writeMeshProduct(outDir, relativePath, state.mesh, `reference-${stateId}`));
      serialized.evaluation.referenceStates[stateId].mesh = meshReference(relativePath);
    }
    const nullPath = 'causal-null.obj';
    productPaths.push(await writeMeshProduct(
      outDir,
      nullPath,
      assay.causalNull.mesh,
      assay.causalNull.id,
    ));
    serialized.causalNull.mesh = meshReference(nullPath);
    await writeJson(join(outDir, 'assay.json'), serialized);
    await writeFile(
      join(outDir, 'contact-sheet.svg'),
      renderExplicitResponseShellSvg(assay, generationId),
      'utf8',
    );
    productPaths.push('assay.json', 'contact-sheet.svg');
    const outputs = [];
    for (const relativePath of productPaths) {
      outputs.push({
        relativePath,
        sha256: await sha256File(join(outDir, relativePath)),
      });
    }
    const report = {
      schema: 'kaminos.explicit-response-shell-artifact-report.v0',
      status: 'completed',
      generationId,
      requestedRouteId: assayCard.id,
      effectiveRouteId: EXPLICIT_RESPONSE_SHELL_ARTIFACT_ROUTE,
      requestedAssayCardPath,
      requestedTargetPath,
      effectiveAssayCardId: assay.assayCardId,
      effectiveAssayCardHash: assay.assayCardHash,
      effectiveTargetId: target.id,
      effectiveTargetHash: assay.evaluation.targetHash,
      effectiveCompilerId: assay.construction.effectiveCompilerId,
      constructionProjectionHash: assay.construction.projectionHash,
      assayHash: assay.assayHash,
      evidencePassed: assay.verdict.passed,
      hypothesisPassed: assay.verdict.passed && assay.causalNull.verdict.passed === false,
      outputs,
    };
    await writeJson(join(outDir, 'report.json'), report);
    return { assay: serialized, report, reportPath: join(outDir, 'report.json') };
  } catch (error) {
    await writeExplicitResponseShellFailureTombstones({
      outDir,
      generationId,
      failurePhase,
      error,
      requestedRouteId: assayCard?.id ?? null,
      requestedAssayCardPath: requestedAssayCardPath ?? null,
      requestedTargetPath: requestedTargetPath ?? null,
    });
    throw error;
  }
}
