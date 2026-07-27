import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createLirmArmatureProgramImplicitBodyBundle,
} from './lirm-speciation-armature-core.js';

export const LIRM_SUPPORT_CONTROL_CARRIER_ATLAS_SCHEMA =
  'kaminos.lirm-support-control-carrier-atlas.v0';
export const LIRM_SUPPORT_CONTROL_CARRIER_VISUAL_ADMISSION_SCHEMA =
  'kaminos.lirm-support-control-carrier-visual-admission.v0';
export const LIRM_SUPPORT_CONTROL_CARRIER_ATLAS_ROUTE =
  'kaminos/lirm-support-control-carrier-atlas/pre-flux-v0';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = join(
  moduleDir,
  'artifacts/lirm-support-control-carrier-atlas-v0',
);
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const BAUPLAN_ID = 'friendly-continuous-bauplan-v0';
const CAMERA_ID = 'fixed-front-three-quarter-yaw-0.42';

const support = (id, x, z, gain = 1) => Object.freeze({ id, x, z, gain });
const stance = (id, label, supports) => Object.freeze({
  id,
  label,
  supports: Object.freeze(supports),
});

export const STANCE_PROGRAMS = Object.freeze([
  stance('neutral', 'balanced', [
    support('front-left', -0.42, -0.42),
    support('front-right', -0.42, 0.42),
    support('rear-left', 0.42, -0.42),
    support('rear-right', 0.42, 0.42),
  ]),
  stance('wide', 'wide set', [
    support('front-left', -0.42, -0.66),
    support('front-right', -0.42, 0.66),
    support('rear-left', 0.42, -0.66),
    support('rear-right', 0.42, 0.66),
  ]),
  stance('tucked', 'tucked', [
    support('front-left', -0.42, -0.25),
    support('front-right', -0.42, 0.25),
    support('rear-left', 0.42, -0.25),
    support('rear-right', 0.42, 0.25),
  ]),
  stance('fore-loaded', 'fore loaded', [
    support('front-left', -0.62, -0.5, 1.18),
    support('front-right', -0.62, 0.5, 1.18),
    support('rear-left', 0.28, -0.36, 0.84),
    support('rear-right', 0.28, 0.36, 0.84),
  ]),
  stance('rear-loaded', 'rear loaded', [
    support('front-left', -0.28, -0.36, 0.84),
    support('front-right', -0.28, 0.36, 0.84),
    support('rear-left', 0.62, -0.5, 1.18),
    support('rear-right', 0.62, 0.5, 1.18),
  ]),
  stance('diagonal', 'diagonal bias', [
    support('front-left', -0.58, -0.58, 1.18),
    support('front-right', -0.3, 0.28, 0.82),
    support('rear-left', 0.3, -0.28, 0.82),
    support('rear-right', 0.58, 0.58, 1.18),
  ]),
]);

export const CARRIER_FAMILIES = Object.freeze([
  Object.freeze({
    id: 'body-only',
    label: 'body only',
    generatorAuthority: 'sidecar_only',
    geometryRoles: Object.freeze([]),
    referenceMode: 'semantic-sidecar-only',
  }),
  Object.freeze({
    id: 'external-rig',
    label: 'external rig',
    generatorAuthority: 'separate_reference',
    geometryRoles: Object.freeze([]),
    referenceMode: 'body-plus-spatial-rig-reference',
  }),
  Object.freeze({
    id: 'attachment-fields',
    label: 'attachment fields',
    generatorAuthority: 'shape_pixels',
    geometryRoles: Object.freeze(['attachmentField']),
    referenceMode: 'single-shape-reference',
  }),
  Object.freeze({
    id: 'fused-carriers',
    label: 'fused carriers',
    generatorAuthority: 'shape_pixels',
    geometryRoles: Object.freeze(['fusedSupportCarrier']),
    referenceMode: 'single-shape-reference',
  }),
  Object.freeze({
    id: 'stance-envelope',
    label: 'stance envelope',
    generatorAuthority: 'separate_reference',
    geometryRoles: Object.freeze([]),
    referenceMode: 'body-plus-ground-envelope-reference',
  }),
  Object.freeze({
    id: 'hybrid',
    label: 'field + rig',
    generatorAuthority: 'shape_plus_reference',
    geometryRoles: Object.freeze(['attachmentField']),
    referenceMode: 'shape-reference-plus-spatial-rig-reference',
  }),
]);

const point = (x, y, z) => ({ x, y, z });
const ellipsoid = (role, center, radius) => ({ kind: 'ellipsoid', role, center, radius });
const capsule = (role, a, b, radius) => ({ kind: 'capsule', role, a, b, radius });
const xml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');
const hashBytes = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

async function evidence(path) {
  const bytes = await readFile(path);
  return {
    path,
    byteSize: bytes.length,
    sha256: hashBytes(bytes),
  };
}

async function relativeEvidence(path, outDir) {
  const result = await evidence(path);
  return {
    ...result,
    path: relative(outDir, path),
  };
}

async function atomicWriteJson(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

function rasterizeSvg(svgPath, pngPath) {
  const result = spawnSync('sips', ['-s', 'format', 'png', svgPath, '--out', pngPath], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `support carrier rasterization failed for ${svgPath}: ${
        (result.stderr || result.stdout || '').trim()
      }`,
    );
  }
}

function assembleSheet({ manifestPath, sheetPath }) {
  const assembler = join(
    moduleDir,
    'artifacts/lirm-rare-gestalt-pressure-ladder-v1/assemble-imagegen-contact-sheet.swift',
  );
  const result = spawnSync('swift', [assembler, manifestPath, sheetPath], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`support carrier sheet assembly failed: ${result.stderr || result.stdout}`);
  }
}

function familyById(id) {
  const family = CARRIER_FAMILIES.find(item => item.id === id);
  if (!family) throw new Error(`unknown carrier family: ${id}`);
  return family;
}

function stanceById(id) {
  const program = STANCE_PROGRAMS.find(item => item.id === id);
  if (!program) throw new Error(`unknown stance program: ${id}`);
  return program;
}

function baseBodyPrimitives() {
  return [
    capsule(
      'bodyBridge',
      point(-0.58, 0.03, 0),
      point(0.52, 0.03, 0),
      0.3,
    ),
    ellipsoid(
      'anteriorChestMass',
      point(-0.43, 0.06, 0),
      point(0.34, 0.31, 0.32),
    ),
    ellipsoid(
      'posteriorBulbousMass',
      point(0.5, 0.05, -0.015),
      point(0.34, 0.31, 0.33),
    ),
    ellipsoid(
      'anteriorHead',
      point(-0.72, 0.17, 0.035),
      point(0.26, 0.23, 0.25),
    ),
    capsule(
      'anteriorHead',
      point(-0.73, 0.17, 0.035),
      point(-0.9, 0.11, 0.035),
      0.13,
    ),
  ];
}

function attachmentFieldPrimitives(program) {
  return program.supports.map(item => ellipsoid(
    'attachmentField',
    point(
      item.x * 0.72,
      -0.14,
      item.z * 0.28,
    ),
    point(
      0.2 * item.gain,
      0.15 * item.gain,
      0.19 * item.gain,
    ),
  ));
}

function fusedCarrierPrimitives(program) {
  return program.supports.map(item => capsule(
    'fusedSupportCarrier',
    point(item.x * 0.68, -0.1, item.z * 0.22),
    point(item.x * 0.88, -0.35, item.z * 0.62),
    0.105 * item.gain,
  ));
}

export function createCellArmatureProgram(family, program) {
  return {
    id: `kaminos.lirm-support-control-carrier.${family.id}.${program.id}.v0`,
    parameterVocabulary: 'kaminos.lirm-support-control-carrier.fixed-friendly-bauplan.v0',
    parameterSpecs: [{
      id: 'carrierGain',
      semanticRole: 'carrierStrength',
      initial: 1,
      min: 1,
      max: 1,
      step: 1,
    }],
    createPrimitives() {
      const primitives = baseBodyPrimitives();
      if (family.id === 'attachment-fields' || family.id === 'hybrid') {
        primitives.push(...attachmentFieldPrimitives(program));
      } else if (family.id === 'fused-carriers') {
        primitives.push(...fusedCarrierPrimitives(program));
      }
      return primitives;
    },
  };
}

export function buildSupportControlCarrierCells() {
  const cells = [];
  for (const family of CARRIER_FAMILIES) {
    for (const program of STANCE_PROGRAMS) {
      cells.push({
        cellId: `${family.id}--${program.id}`,
        bauplanId: BAUPLAN_ID,
        cameraId: CAMERA_ID,
        familyId: family.id,
        familyLabel: family.label,
        stanceId: program.id,
        stanceLabel: program.label,
        supports: program.supports,
        geometryRoles: [...family.geometryRoles],
        contactMarkersEnterBodySdf: false,
        authority: {
          generatorAuthority: family.generatorAuthority,
          referenceMode: family.referenceMode,
          mechanicalPersistence: 'unassayed',
          globalRootCarriedCorrection: 'rejected_external_result',
        },
        generatorFiring: 'not_started',
      });
    }
  }
  return cells;
}

function drawBodyPlan() {
  return `
    <rect x="82" y="82" width="156" height="76" rx="38" fill="#90bd77" stroke="#dcebb5" stroke-width="3"/>
    <path d="M 94 111 Q 72 120 94 137" fill="none" stroke="#dcebb5" stroke-width="12" stroke-linecap="round"/>
  `;
}

function planPoint(item) {
  return {
    x: 160 + item.x * 120,
    y: 120 + item.z * 112,
  };
}

function attachmentPoint(item) {
  return {
    x: 160 + item.x * 82,
    y: 120 + item.z * 34,
  };
}

function supportBars(program, opacity = 1) {
  return program.supports.map(item => {
    const p = planPoint(item);
    const width = 31 * item.gain;
    return `<rect x="${p.x - width / 2}" y="${p.y - 5}" width="${width}" height="10" rx="3" fill="#f4c86a" opacity="${opacity}"/>`;
  }).join('\n');
}

function rigLines(program, opacity = 1) {
  return program.supports.map(item => {
    const a = attachmentPoint(item);
    const b = planPoint(item);
    return `<path d="M ${a.x} ${a.y} L ${b.x} ${b.y}" fill="none" stroke="#67d9cc" stroke-width="${5 * item.gain}" stroke-linecap="round" opacity="${opacity}"/>`;
  }).join('\n');
}

function attachmentBands(program, opacity = 1) {
  return program.supports.map(item => {
    const a = attachmentPoint(item);
    return `<rect x="${a.x - 18 * item.gain}" y="${a.y - 13 * item.gain}" width="${36 * item.gain}" height="${26 * item.gain}" rx="${12 * item.gain}" fill="#68cdb4" opacity="${opacity}"/>`;
  }).join('\n');
}

function stanceEnvelope(program) {
  const points = program.supports
    .map(item => planPoint(item))
    .sort((a, b) => Math.atan2(a.y - 120, a.x - 160) - Math.atan2(b.y - 120, b.x - 160))
    .map(pointValue => `${pointValue.x},${pointValue.y}`)
    .join(' ');
  return `<polygon points="${points}" fill="#6bb8d4" fill-opacity="0.2" stroke="#75d8df" stroke-width="5" stroke-linejoin="round"/>`;
}

function renderControlDiagramSvg(cell) {
  const family = familyById(cell.familyId);
  const program = stanceById(cell.stanceId);
  const layers = [];
  if (family.id === 'stance-envelope') layers.push(stanceEnvelope(program));
  layers.push(drawBodyPlan());
  if (family.id === 'attachment-fields' || family.id === 'hybrid') {
    layers.push(attachmentBands(program, 0.84));
  }
  if (family.id === 'external-rig' || family.id === 'hybrid') {
    layers.push(rigLines(program, 0.95));
  }
  if (family.id === 'fused-carriers') {
    layers.push(rigLines(program, 0.72));
  }
  layers.push(supportBars(program, family.id === 'body-only' ? 0.35 : 0.95));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240" role="img" aria-label="${xml(family.label)} ${xml(program.label)} control diagram" data-family="${xml(family.id)}" data-stance="${xml(program.id)}">
  <rect width="320" height="240" fill="#10201c"/>
  <path d="M 34 120 H 286" stroke="#334d43" stroke-width="2"/>
  <path d="M 160 28 V 212" stroke="#334d43" stroke-width="2"/>
  ${layers.join('\n  ')}
  <text x="14" y="24" fill="#eef5d4" font-family="Menlo, monospace" font-size="13">${xml(family.label)}</text>
  <text x="306" y="24" fill="#f4c86a" text-anchor="end" font-family="Menlo, monospace" font-size="13">${xml(program.label)}</text>
</svg>`;
}

function compositeSvg({ shapeBytes, diagramBytes, cell }) {
  const shapeUri = `data:image/png;base64,${shapeBytes.toString('base64')}`;
  const diagramUri = `data:image/png;base64,${diagramBytes.toString('base64')}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240" viewBox="0 0 640 240" role="img" aria-label="${xml(cell.familyLabel)} ${xml(cell.stanceLabel)} shape and control">
  <rect width="640" height="240" fill="#07130f"/>
  <image href="${shapeUri}" x="0" y="0" width="320" height="240"/>
  <image href="${diagramUri}" x="320" y="0" width="320" height="240"/>
  <path d="M 319 0 V 240" stroke="#a8b79b" stroke-opacity="0.35"/>
</svg>`;
}

function sheetManifest(cells, outDir, {
  schema,
  columns,
  rows,
  cellWidth,
  imageKind,
  compactLabels = false,
}) {
  return {
    schema,
    columns,
    rows,
    width: columns * cellWidth,
    cellWidth,
    cellHeight: 292,
    imageHeight: 240,
    imageOffsetY: 0,
    cells: cells.map(cell => ({
      sourcePath: join(outDir, cell[imageKind].path),
      title: cell.cellId,
      viewLabel: compactLabels
        ? `${cell.familyLabel} | ${cell.stanceLabel}`
        : `${cell.familyLabel} | ${cell.stanceLabel} | ${cell.authority.generatorAuthority}`,
    })),
  };
}

function requireEvidence(value, label) {
  if (!value || !Number.isInteger(value.byteSize) || value.byteSize <= 0) {
    throw new Error(`${label} lacks positive byte evidence`);
  }
  if (!HASH_PATTERN.test(value.sha256 || '')) {
    throw new Error(`${label} lacks SHA-256 evidence`);
  }
}

export function validateSupportControlCarrierManifest(manifest) {
  if (manifest?.schema !== LIRM_SUPPORT_CONTROL_CARRIER_ATLAS_SCHEMA) {
    throw new Error('support carrier atlas schema mismatch');
  }
  if (
    manifest.requestedRoute !== LIRM_SUPPORT_CONTROL_CARRIER_ATLAS_ROUTE
    || manifest.effectiveRoute !== manifest.requestedRoute
  ) {
    throw new Error('support carrier atlas lost requested and effective route identity');
  }
  if (manifest.generatorFiring !== 'not_started') {
    throw new Error('support carrier atlas must remain pre-FLUX');
  }
  if (!Array.isArray(manifest.cells) || manifest.cells.length !== 36) {
    throw new Error('support carrier atlas requires exactly 36 cells');
  }
  const expected = buildSupportControlCarrierCells();
  if (
    new Set(manifest.cells.map(cell => cell.cellId)).size !== 36
    || expected.some(cell => !manifest.cells.some(actual => actual.cellId === cell.cellId))
  ) {
    throw new Error('support carrier atlas cell identity is incomplete or duplicated');
  }
  for (const cell of manifest.cells) {
    if (
      cell.bauplanId !== BAUPLAN_ID
      || cell.cameraId !== CAMERA_ID
      || cell.generatorFiring !== 'not_started'
      || cell.contactMarkersEnterBodySdf !== false
    ) {
      throw new Error(`${cell.cellId} has source or route drift`);
    }
    requireEvidence(cell.shapeCarrier, `${cell.cellId} shape carrier`);
    requireEvidence(cell.controlDiagram, `${cell.cellId} control diagram`);
  }
  if (!Array.isArray(manifest.sheets) || manifest.sheets.length !== 6) {
    throw new Error('support carrier atlas requires one sheet per family');
  }
  for (const sheet of manifest.sheets) requireEvidence(sheet, `${sheet.familyId} family sheet`);
  requireEvidence(manifest.overview, 'support carrier atlas overview');
  return true;
}

export async function admitSupportControlCarrierAtlas({
  outDir = DEFAULT_OUT_DIR,
  familyClassifications,
} = {}) {
  const absoluteOutDir = resolve(outDir);
  const receiptPath = join(absoluteOutDir, 'receipt.json');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  validateSupportControlCarrierManifest(receipt);

  if (!Array.isArray(familyClassifications)) {
    throw new Error('support carrier admission requires family classifications');
  }
  const classificationsByFamily = new Map(
    familyClassifications.map(classification => [
      classification.familyId,
      classification,
    ]),
  );
  if (
    classificationsByFamily.size !== CARRIER_FAMILIES.length
    || CARRIER_FAMILIES.some(family => !classificationsByFamily.has(family.id))
  ) {
    throw new Error('support carrier admission requires exactly one classification per family');
  }

  const classifications = CARRIER_FAMILIES.map(family => {
    const classification = classificationsByFamily.get(family.id);
    if (
      classification.classification !== 'happy_safe'
      || classification.happy !== true
      || classification.safe !== true
      || typeof classification.notes !== 'string'
      || classification.notes.trim().length === 0
    ) {
      throw new Error(`${family.id} lacks explicit happy and safe visual admission`);
    }
    return {
      familyId: family.id,
      classification: classification.classification,
      happy: true,
      safe: true,
      notes: classification.notes.trim(),
    };
  });

  const admissionPath = join(absoluteOutDir, 'visual-admission.json');
  const admission = {
    schema: LIRM_SUPPORT_CONTROL_CARRIER_VISUAL_ADMISSION_SCHEMA,
    atlasSchema: receipt.schema,
    requestedRoute: receipt.requestedRoute,
    effectiveRoute: receipt.effectiveRoute,
    bauplanId: receipt.bauplanId,
    cameraId: receipt.cameraId,
    overallClassification: 'happy_safe',
    operatorExposure: 'admitted_happy_safe_static_only',
    familyClassifications: classifications,
    inspectedEvidence: {
      overview: receipt.overview,
      sheets: receipt.sheets,
    },
    unassayed: [
      'motion',
      'three-dimensional generator behavior',
      'downstream image-generator aesthetic behavior',
      'mechanical support persistence',
    ],
  };
  await atomicWriteJson(admissionPath, admission);

  const admitted = {
    ...receipt,
    status: 'admitted-pre-flux',
    phase: 'agent-visual-inspection-complete',
    operatorExposure: admission.operatorExposure,
    visualAdmission: await relativeEvidence(admissionPath, absoluteOutDir),
    lastTrustworthyEvidence:
      'all six static carrier-family sheets inspected and classified happy_safe; dynamic and generator behavior remain unassayed',
  };
  await atomicWriteJson(receiptPath, admitted);
  return admitted;
}

export async function writeSupportControlCarrierAtlas({
  outDir = DEFAULT_OUT_DIR,
} = {}) {
  const absoluteOutDir = resolve(outDir);
  const receiptPath = join(absoluteOutDir, 'receipt.json');
  await mkdir(absoluteOutDir, { recursive: true });
  const initialized = {
    schema: LIRM_SUPPORT_CONTROL_CARRIER_ATLAS_SCHEMA,
    status: 'running',
    phase: 'initialized',
    requestedRoute: LIRM_SUPPORT_CONTROL_CARRIER_ATLAS_ROUTE,
    effectiveRoute: null,
    generatorFiring: 'not_started',
    operatorExposure: 'prohibited_pending_agent_visual_inspection',
    bauplanId: BAUPLAN_ID,
    cameraId: CAMERA_ID,
    lastTrustworthyEvidence: 'route and fixed source identity recorded; no visual admitted',
  };
  await atomicWriteJson(receiptPath, initialized);

  try {
    const cells = [];
    for (const cell of buildSupportControlCarrierCells()) {
      const family = familyById(cell.familyId);
      const program = stanceById(cell.stanceId);
      const armatureProgram = createCellArmatureProgram(family, program);
      const bundle = createLirmArmatureProgramImplicitBodyBundle({
        armatureProgram,
        parameters: { carrierGain: 1 },
        candidateId: cell.cellId,
        pixelWidth: 192,
        pixelHeight: 144,
      });
      const cellDir = join(absoluteOutDir, 'cells', cell.cellId);
      await mkdir(cellDir, { recursive: true });

      const clay = bundle.renderMaps.find(map => map.kind === 'clay');
      if (!clay) throw new Error(`${cell.cellId} lacks clay render`);
      const shapeSvgPath = join(cellDir, 'shape-carrier.svg');
      const shapePngPath = join(cellDir, 'shape-carrier.png');
      await writeFile(shapeSvgPath, clay.svg);
      rasterizeSvg(shapeSvgPath, shapePngPath);

      const diagramSvgPath = join(cellDir, 'control-diagram.svg');
      const diagramPngPath = join(cellDir, 'control-diagram.png');
      await writeFile(diagramSvgPath, renderControlDiagramSvg(cell));
      rasterizeSvg(diagramSvgPath, diagramPngPath);

      const comparisonSvgPath = join(cellDir, 'shape-plus-control.svg');
      const comparisonPngPath = join(cellDir, 'shape-plus-control.png');
      await writeFile(comparisonSvgPath, compositeSvg({
        shapeBytes: await readFile(shapePngPath),
        diagramBytes: await readFile(diagramPngPath),
        cell,
      }));
      rasterizeSvg(comparisonSvgPath, comparisonPngPath);

      const effectiveRoles = [...new Set(
        bundle.semanticRoles.filter(role => cell.geometryRoles.includes(role)),
      )];
      if (JSON.stringify(effectiveRoles.sort()) !== JSON.stringify([...cell.geometryRoles].sort())) {
        throw new Error(`${cell.cellId} lost requested carrier geometry roles`);
      }
      cells.push({
        ...cell,
        effectiveGeometryRoles: effectiveRoles,
        requestedRoute: bundle.requestedRoute,
        effectiveRoute: bundle.effectiveRoute,
        renderMode: bundle.renderMode,
        fieldModel: bundle.fieldModel,
        projectionEvidence: bundle.projectionEvidence,
        shapeCarrier: await relativeEvidence(shapePngPath, absoluteOutDir),
        shapeCarrierSvg: await relativeEvidence(shapeSvgPath, absoluteOutDir),
        controlDiagram: await relativeEvidence(diagramPngPath, absoluteOutDir),
        controlDiagramSvg: await relativeEvidence(diagramSvgPath, absoluteOutDir),
        comparison: await relativeEvidence(comparisonPngPath, absoluteOutDir),
        comparisonSvg: await relativeEvidence(comparisonSvgPath, absoluteOutDir),
      });
    }

    const sheets = [];
    for (const family of CARRIER_FAMILIES) {
      const familyCells = cells.filter(cell => cell.familyId === family.id);
      const manifestPath = join(absoluteOutDir, `family-${family.id}-manifest.json`);
      const sheetPath = join(absoluteOutDir, `family-${family.id}.png`);
      await atomicWriteJson(manifestPath, sheetManifest(familyCells, absoluteOutDir, {
        schema: 'kaminos.lirm-support-control-carrier-family-sheet.v0',
        columns: 2,
        rows: 3,
        cellWidth: 640,
        imageKind: 'comparison',
      }));
      assembleSheet({ manifestPath, sheetPath });
      sheets.push({
        familyId: family.id,
        ...(await relativeEvidence(sheetPath, absoluteOutDir)),
      });
    }

    const overviewManifestPath = join(absoluteOutDir, 'overview-manifest.json');
    const overviewPath = join(absoluteOutDir, 'overview.png');
    await atomicWriteJson(overviewManifestPath, sheetManifest(cells, absoluteOutDir, {
      schema: 'kaminos.lirm-support-control-carrier-overview-sheet.v0',
      columns: 6,
      rows: 6,
      cellWidth: 320,
      imageKind: 'shapeCarrier',
      compactLabels: true,
    }));
    assembleSheet({ manifestPath: overviewManifestPath, sheetPath: overviewPath });

    const completed = {
      ...initialized,
      status: 'rendered-uninspected',
      phase: 'all-carrier-sheets-written',
      effectiveRoute: LIRM_SUPPORT_CONTROL_CARRIER_ATLAS_ROUTE,
      cells,
      sheets,
      overview: await relativeEvidence(overviewPath, absoluteOutDir),
      lastTrustworthyEvidence: '36 shape carriers and diagrams rendered; agent visual admission pending',
    };
    validateSupportControlCarrierManifest(completed);
    await atomicWriteJson(receiptPath, completed);
    return completed;
  } catch (error) {
    await atomicWriteJson(receiptPath, {
      ...initialized,
      status: 'failed',
      phase: 'carrier-atlas-generation',
      failure: {
        name: error?.name || 'Error',
        message: error?.message || String(error),
      },
      lastTrustworthyEvidence: 'route and fixed source identity recorded; generation failed before admission',
    });
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outDir = process.argv[2] || DEFAULT_OUT_DIR;
  const receipt = await writeSupportControlCarrierAtlas({ outDir });
  process.stdout.write(`${JSON.stringify({
    schema: receipt.schema,
    status: receipt.status,
    cells: receipt.cells.length,
    overview: receipt.overview.path,
    sheets: receipt.sheets.map(sheet => sheet.path),
  }, null, 2)}\n`);
}
