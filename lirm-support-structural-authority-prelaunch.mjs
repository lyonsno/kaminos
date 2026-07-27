import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CARRIER_FAMILIES,
  STANCE_PROGRAMS,
  createCellArmatureProgram,
} from './lirm-support-control-carrier-atlas.mjs';
import {
  createLirmArmatureProgramImplicitBodyBundle,
} from './lirm-speciation-armature-core.js';
import {
  GESTALT_IMAGEGEN_JOB_TYPE_4REF,
  GESTALT_IMAGEGEN_RUNNER,
} from './lirm-speciation-gestalt-imagegen-core.mjs';

export const STRUCTURAL_AUTHORITY_PRELAUNCH_SCHEMA =
  'kaminos.lirm-support-structural-authority-prelaunch.v0';
export const STRUCTURAL_AUTHORITY_EXECUTION_MANIFEST_SCHEMA =
  'kaminos.lirm-support-structural-authority-execution-manifest.v0';
export const STRUCTURAL_AUTHORITY_EXPOSURE_LEDGER_SCHEMA =
  'kaminos.lirm-structural-authority-exposure-ledger.v0';
export const STRUCTURAL_AUTHORITY_CELL_IDS = Object.freeze(['cell-a', 'cell-b', 'cell-c']);

const moduleDir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = join(moduleDir, 'artifacts/lirm-support-structural-authority-tranche-01');
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const GRID = Object.freeze({ width: 192, height: 144, channels: 3 });
const REFERENCE_ORDER = Object.freeze(['clay', 'depth', 'normal', 'support_control']);
const PROMPT = 'Create one eyeless, nose-led Lerm with a compact squash body, soft elastic anatomy, tactile toy-like materials, clean red species color with warm cream accents, and a readable horde-scale silhouette. Keep the supplied front-three-quarter camera, connected volume, head-tail polarity, and low-frequency proportions. Images one through three are matched clay, depth, and normal views of the same body. Image four carries body-relative support guidance. Resolve that guidance into a pleasant, playful, mildly strange character whose lower body can locomote, compress, steal, and carry. Render the finished character alone on a plain studio background; support-control graphic marks remain absent from the character image.';

const CELL_SPECS = Object.freeze([
  Object.freeze({
    cellId: 'cell-a',
    atlasCellId: 'body-only--wide',
    familyId: 'body-only',
    carrierMode: 'zero_support',
  }),
  Object.freeze({
    cellId: 'cell-b',
    atlasCellId: 'attachment-fields--wide',
    familyId: 'attachment-fields',
    carrierMode: 'latent_continuous_underside',
  }),
  Object.freeze({
    cellId: 'cell-c',
    atlasCellId: 'external-rig--wide',
    familyId: 'external-rig',
    carrierMode: 'consumed_explicit_role_plane',
  }),
]);

const ROLE_IDS = Object.freeze(['front-left', 'front-right', 'rear-left', 'rear-right']);
const ROLE_COLORS = Object.freeze([
  [255, 72, 54],
  [64, 224, 126],
  [72, 132, 255],
  [244, 210, 64],
]);

const hashBytes = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

async function evidence(path, root) {
  const bytes = await readFile(path);
  return {
    path: relative(root, path),
    byteSize: bytes.length,
    sha256: hashBytes(bytes),
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
    throw new Error(`structural authority rasterization failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
}

function familyById(id) {
  const family = CARRIER_FAMILIES.find(item => item.id === id);
  if (!family) throw new Error(`unknown carrier family: ${id}`);
  return family;
}

function wideStance() {
  const program = STANCE_PROGRAMS.find(item => item.id === 'wide');
  if (!program) throw new Error('wide stance is missing');
  return program;
}

export function buildStructuralAuthorityTranchePlan({
  sourceRoot = DEFAULT_OUT_DIR,
  outputRoot = join(sourceRoot, 'outputs'),
  seed = 727001,
} = {}) {
  if (!Number.isInteger(seed)) throw new TypeError('structural authority seed must be an integer');
  const cells = CELL_SPECS.map(spec => {
    const cellRoot = join(sourceRoot, 'cells', spec.cellId);
    return {
      ...spec,
      seed,
      jobType: GESTALT_IMAGEGEN_JOB_TYPE_4REF,
      requestedRoute: `gpu-greenroom/${GESTALT_IMAGEGEN_JOB_TYPE_4REF}`,
      expectedRunner: GESTALT_IMAGEGEN_RUNNER,
      input: { role: 'clay', path: join(cellRoot, 'clay.png') },
      referenceSlots: REFERENCE_ORDER.map(role => ({
        role,
        path: join(cellRoot, `${role.replace('_', '-')}.png`),
      })),
      prompt: { path: join(sourceRoot, 'prompt.txt') },
      outputDir: join(outputRoot, spec.cellId),
      outputPath: join(outputRoot, spec.cellId, 'output.png'),
      settings: {
        model: 'flux2-klein-9b',
        quantize: 4,
        width: 512,
        height: 512,
        steps: 8,
        guidance: 1,
        mlxCacheLimitGb: 48,
      },
    };
  });
  return {
    schema: STRUCTURAL_AUTHORITY_PRELAUNCH_SCHEMA,
    seed,
    requestedRoute: `gpu-greenroom/${GESTALT_IMAGEGEN_JOB_TYPE_4REF}`,
    referenceOrder: [...REFERENCE_ORDER],
    prompt: PROMPT,
    cells,
  };
}

function validateSignalInput({ width, height, channels, data, bodyMask }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || !Number.isInteger(channels)) {
    throw new TypeError('carrier signal dimensions must be integers');
  }
  if (!(data instanceof Uint8Array) || data.length !== width * height * channels) {
    throw new Error('carrier signal byte dimensions do not match');
  }
  if (!(bodyMask instanceof Uint8Array) || bodyMask.length !== width * height) {
    throw new Error('carrier body mask dimensions do not match');
  }
}

export function measureCarrierSignalBudget({
  width,
  height,
  channels,
  data,
  bodyMask,
  rolePeaks,
  disposition,
}) {
  validateSignalInput({ width, height, channels, data, bodyMask });
  const channelMetrics = [];
  for (let channel = 0; channel < channels; channel += 1) {
    let nonBackgroundPixelCount = 0;
    let l1Energy = 0;
    let squaredEnergy = 0;
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const value = data[pixel * channels + channel];
      if (value > 0) nonBackgroundPixelCount += 1;
      l1Energy += value;
      squaredEnergy += value * value;
    }
    channelMetrics.push({
      channel,
      nonBackgroundPixelCount,
      areaFraction: nonBackgroundPixelCount / (width * height),
      l1Energy,
      l2Energy: Math.sqrt(squaredEnergy),
    });
  }
  let nonBackgroundPixelCount = 0;
  let l1Energy = 0;
  let squaredEnergy = 0;
  let weightedX = 0;
  let weightedY = 0;
  let totalWeight = 0;
  let bodyOverlap = 0;
  let undersideBoundaryContact = 0;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    let pixelEnergy = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const value = data[pixel * channels + channel];
      pixelEnergy += value;
      l1Energy += value;
      squaredEnergy += value * value;
    }
    if (pixelEnergy === 0) continue;
    nonBackgroundPixelCount += 1;
    totalWeight += pixelEnergy;
    weightedX += x * pixelEnergy;
    weightedY += y * pixelEnergy;
    if (bodyMask[pixel]) {
      bodyOverlap += 1;
      const below = y + 1 >= height ? 0 : bodyMask[(y + 1) * width + x];
      if (!below) undersideBoundaryContact += 1;
    }
  }
  const centroid = totalWeight > 0
    ? { x: weightedX / totalWeight, y: weightedY / totalWeight }
    : null;
  let secondMoment = 0;
  if (centroid) {
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      let pixelEnergy = 0;
      for (let channel = 0; channel < channels; channel += 1) {
        pixelEnergy += data[pixel * channels + channel];
      }
      secondMoment += pixelEnergy * ((x - centroid.x) ** 2 + (y - centroid.y) ** 2);
    }
    secondMoment /= totalWeight;
  }
  return {
    schema: 'kaminos.lirm-carrier-signal-budget.v0',
    disposition,
    dimensions: { width, height, channels },
    dtype: 'uint8',
    valueRange: [0, 255],
    backgroundValue: 0,
    channels: channelMetrics,
    aggregate: {
      nonBackgroundPixelCount,
      areaFraction: nonBackgroundPixelCount / (width * height),
      l1Energy,
      l2Energy: Math.sqrt(squaredEnergy),
      centroid,
      secondMoment,
      spatialBandwidth: centroid ? Math.sqrt(secondMoment) : 0,
      spatialBandwidthMeasure: 'energy-weighted-rms-radius-pixels',
    },
    roles: (rolePeaks ?? []).map(item => ({
      role: item.role,
      peak: { x: item.x, y: item.y, value: item.value },
    })),
    bodyMaskOverlap: {
      pixelCount: bodyOverlap,
      signalFraction: nonBackgroundPixelCount > 0 ? bodyOverlap / nonBackgroundPixelCount : 0,
    },
    undersideBoundaryContact: { pixelCount: undersideBoundaryContact },
  };
}

function maskFromSvg(svg, width, height) {
  const mask = new Uint8Array(width * height);
  const pattern = /<rect x="(\d+)" y="(\d+)" width="1" height="1" fill="rgb\(255,255,255\)"\/>/g;
  for (const match of svg.matchAll(pattern)) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    if (x < width && y < height) mask[y * width + x] = 1;
  }
  if (!mask.some(Boolean)) throw new Error('implicit body mask yielded no organismal pixels');
  return mask;
}

function projectedRolePoints(bundle) {
  const fields = bundle.projectionEvidence.primitiveVisibility
    .filter(item => item.role === 'attachmentField' && item.projectedCentroid);
  if (fields.length !== ROLE_IDS.length) {
    throw new Error(`expected four projected attachment fields, got ${fields.length}`);
  }
  return fields.map((field, index) => ({
    role: ROLE_IDS[index],
    x: field.projectedCentroid.x,
    y: field.projectedCentroid.y,
  }));
}

function carrierField({ mode, rolePoints, width, height }) {
  const data = new Uint8Array(width * height * 3);
  if (mode === 'zero_support') return { data, rolePeaks: [] };
  const sigmaX = mode === 'latent_continuous_underside' ? 17 : 4.5;
  const sigmaY = mode === 'latent_continuous_underside' ? 10 : 4.5;
  const strength = mode === 'latent_continuous_underside' ? 116 : 255;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      for (const [roleIndex, point] of rolePoints.entries()) {
        const dx = (x - point.x) / sigmaX;
        const dy = (y - point.y) / sigmaY;
        const value = Math.round(strength * Math.exp(-0.5 * (dx * dx + dy * dy)));
        for (let channel = 0; channel < 3; channel += 1) {
          data[offset + channel] = Math.min(
            255,
            data[offset + channel] + Math.round(value * ROLE_COLORS[roleIndex][channel] / 255),
          );
        }
      }
    }
  }
  return {
    data,
    rolePeaks: rolePoints.map(point => ({
      role: point.role,
      x: Math.round(point.x),
      y: Math.round(point.y),
      value: strength,
    })),
  };
}

function carrierSvg({ data, width, height, title }) {
  const rects = [];
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 3;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    if (red === 0 && green === 0 && blue === 0) continue;
    rects.push(`<rect x="${pixel % width}" y="${Math.floor(pixel / width)}" width="1" height="1" fill="rgb(${red},${green},${blue})"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="rgb(0,0,0)"/>
  <g style="shape-rendering:crispEdges">${rects.join('')}</g>
</svg>`;
}

function requireDecomposedBoolean(value, field) {
  if (typeof value !== 'boolean') throw new Error(`exposure ledger requires decomposed classification fields; missing ${field}`);
}

export function validateExposureLedger(ledger) {
  if (ledger?.schema !== STRUCTURAL_AUTHORITY_EXPOSURE_LEDGER_SCHEMA) {
    throw new Error(`unexpected exposure ledger schema: ${ledger?.schema}`);
  }
  for (const field of [
    'safe',
    'happy',
    'lerm_identity',
    'nintendo_region_coherence',
    'connected_body',
    'head_tail_polarity',
    'literal_carrier_mark_leakage',
  ]) {
    requireDecomposedBoolean(ledger[field], field);
  }
  if (!ledger.classifier?.id || !ledger.classifier?.model || !ledger.classifier?.context) {
    throw new Error('exposure ledger requires classifier identity and inspection context');
  }
  if (ledger.literal_carrier_mark_leakage && ledger.operatorExposure === 'eligible') {
    throw new Error('carrier mark leakage prohibits operator exposure');
  }
  if ((!ledger.safe || !ledger.happy) && ledger.operatorExposure === 'eligible') {
    throw new Error('operator exposure requires positive safe and happy classifications');
  }
  if (!['eligible', 'prohibited'].includes(ledger.operatorExposure)) {
    throw new Error(`unsupported operator exposure disposition: ${ledger.operatorExposure}`);
  }
  return structuredClone(ledger);
}

export function buildExposureFilteredComparisonManifest({ plan, ledgers }) {
  const byCell = new Map((ledgers ?? []).map(ledger => [ledger.cellId, validateExposureLedger(ledger)]));
  const cells = plan.cells.map(cell => {
    const ledger = byCell.get(cell.cellId);
    if (!ledger) throw new Error(`missing exposure ledger for ${cell.cellId}`);
    return { cellId: cell.cellId, outputPath: cell.outputPath, ledger };
  }).filter(cell => cell.ledger.operatorExposure === 'eligible');
  return {
    schema: 'kaminos.lirm-structural-authority-exposure-filtered-comparison.v0',
    operatorExposure: cells.length > 0 ? 'eligible' : 'prohibited',
    cells,
    sourceSelection: 'exact-plan-cell-output-paths-only',
  };
}

export function validateStructuralAuthorityExecutionManifest(manifest) {
  if (manifest?.schema !== STRUCTURAL_AUTHORITY_EXECUTION_MANIFEST_SCHEMA) {
    throw new Error(`unexpected structural authority execution manifest schema: ${manifest?.schema}`);
  }
  if (manifest.seed !== 727001) throw new Error(`frozen opening seed mismatch: ${manifest.seed}`);
  if (manifest.requestedRoute !== `gpu-greenroom/${GESTALT_IMAGEGEN_JOB_TYPE_4REF}`) {
    throw new Error(`four-reference route mismatch: ${manifest.requestedRoute}`);
  }
  if (JSON.stringify(manifest.referenceOrder) !== JSON.stringify(REFERENCE_ORDER)) {
    throw new Error('reference order must be clay, depth, normal, support_control');
  }
  if (
    !Array.isArray(manifest.cells)
    || JSON.stringify(manifest.cells.map(cell => cell.cellId)) !== JSON.stringify(STRUCTURAL_AUTHORITY_CELL_IDS)
  ) {
    throw new Error('execution manifest requires exactly cell-a, cell-b, cell-c');
  }
  for (const receipt of [
    'carrierSignalBudget',
    'fluxRouteContract',
    'exposureFilterContract',
    'sealedSourceMapping',
  ]) {
    if (!manifest.receipts?.[receipt]) throw new Error(`execution manifest missing receipt: ${receipt}`);
  }
  for (const cell of manifest.cells) {
    if (cell.seed !== 727001 || cell.jobType !== GESTALT_IMAGEGEN_JOB_TYPE_4REF) {
      throw new Error(`${cell.cellId} lost frozen seed or four-reference job type`);
    }
    if (
      !Array.isArray(cell.sourceImages)
      || cell.sourceImages.length !== 4
      || JSON.stringify(cell.sourceImages.map(image => image.role)) !== JSON.stringify(REFERENCE_ORDER)
    ) {
      throw new Error(`${cell.cellId} requires exactly four ordered source images`);
    }
    for (const image of cell.sourceImages) {
      if (!image.path || !HASH_PATTERN.test(image.sha256 ?? '')) {
        throw new Error(`${cell.cellId} source image lacks path/hash evidence: ${image.role}`);
      }
    }
  }
  return structuredClone(manifest);
}

export async function writeStructuralAuthorityPrelaunch({
  outDir = DEFAULT_OUT_DIR,
} = {}) {
  const root = resolve(outDir);
  await mkdir(join(root, 'receipts'), { recursive: true });
  const plan = buildStructuralAuthorityTranchePlan({ sourceRoot: root });
  const promptPath = join(root, 'prompt.txt');
  await writeFile(promptPath, `${PROMPT}\n`);
  const wide = wideStance();
  const sourceMapping = {
    schema: 'kaminos.lirm-support-structural-authority-sealed-source-mapping.v0',
    sealedFromClassifier: true,
    cells: CELL_SPECS,
  };
  await atomicWriteJson(join(root, 'source-mapping.json'), sourceMapping);

  const latentProgram = createCellArmatureProgram(familyById('attachment-fields'), wide);
  const latentBundle = createLirmArmatureProgramImplicitBodyBundle({
    armatureProgram: latentProgram,
    parameters: { carrierGain: 1 },
    candidateId: 'carrier-coordinate-source',
    pixelWidth: GRID.width,
    pixelHeight: GRID.height,
  });
  const rolePoints = projectedRolePoints(latentBundle);
  const budgets = [];
  const executionCells = [];
  for (const cell of plan.cells) {
    const family = familyById(cell.familyId);
    const program = createCellArmatureProgram(family, wide);
    const bundle = createLirmArmatureProgramImplicitBodyBundle({
      armatureProgram: program,
      parameters: { carrierGain: 1 },
      candidateId: cell.cellId,
      pixelWidth: GRID.width,
      pixelHeight: GRID.height,
    });
    const cellDir = join(root, 'cells', cell.cellId);
    await mkdir(cellDir, { recursive: true });
    const sourceImages = [];
    for (const role of ['clay', 'depth', 'normal']) {
      const map = bundle.renderMaps.find(item => item.kind === role);
      if (!map) throw new Error(`${cell.cellId} lacks ${role} map`);
      const svgPath = join(cellDir, `${role}.svg`);
      const pngPath = join(cellDir, `${role}.png`);
      await writeFile(svgPath, map.svg);
      rasterizeSvg(svgPath, pngPath);
      sourceImages.push({ role, ...(await evidence(pngPath, root)) });
    }
    const maskMap = bundle.renderMaps.find(item => item.kind === 'mask');
    if (!maskMap) throw new Error(`${cell.cellId} lacks mask map`);
    const bodyMask = maskFromSvg(maskMap.svg, GRID.width, GRID.height);
    const field = carrierField({
      mode: cell.carrierMode,
      rolePoints,
      width: GRID.width,
      height: GRID.height,
    });
    const carrierSvgPath = join(cellDir, 'support-control.svg');
    const carrierPngPath = join(cellDir, 'support-control.png');
    await writeFile(carrierSvgPath, carrierSvg({
      data: field.data,
      width: GRID.width,
      height: GRID.height,
      title: `${cell.cellId} ${cell.carrierMode}`,
    }));
    rasterizeSvg(carrierSvgPath, carrierPngPath);
    const carrierEvidence = await evidence(carrierPngPath, root);
    sourceImages.push({ role: 'support_control', ...carrierEvidence });
    budgets.push({
      cellId: cell.cellId,
      atlasCellId: cell.atlasCellId,
      carrierMode: cell.carrierMode,
      nativeBudget: measureCarrierSignalBudget({
        ...GRID,
        data: field.data,
        bodyMask,
        rolePeaks: field.rolePeaks,
        disposition: cell.carrierMode,
      }),
      carrierImage: carrierEvidence,
      producer: {
        module: 'lirm-support-structural-authority-prelaunch.mjs',
        grid: GRID,
        roleCoordinateSource: 'attachment-fields--wide measured projection centroids',
      },
    });
    executionCells.push({
      cellId: cell.cellId,
      atlasCellId: cell.atlasCellId,
      carrierMode: cell.carrierMode,
      seed: cell.seed,
      jobType: cell.jobType,
      sourceImages,
    });
  }

  const carrierBudgetPath = join(root, 'receipts/carrier-signal-budget.json');
  await atomicWriteJson(carrierBudgetPath, {
    schema: 'kaminos.lirm-carrier-signal-budget-collection.v0',
    calibration: 'native-budget-with-sensitivity',
    nativeScale: 1,
    sensitivityCompanion: {
      status: 'planned_after_opening-trio',
      scales: [0.5, 2],
      invariant: 'same source geometry, prompt, seed, route, and role coordinates',
    },
    cells: budgets,
  });
  await atomicWriteJson(join(root, 'receipts/flux-4ref-route-contract.json'), {
    schema: 'kaminos.lirm-flux-four-reference-route-contract.v0',
    requestedRoute: plan.requestedRoute,
    jobType: GESTALT_IMAGEGEN_JOB_TYPE_4REF,
    referenceOrder: REFERENCE_ORDER,
    expectedRunner: GESTALT_IMAGEGEN_RUNNER,
    effectiveRouteAdmission: 'exact --image-paths sequence required after completion',
    status: 'contract_written_not_exercised',
  });
  await atomicWriteJson(join(root, 'receipts/exposure-filter-contract.json'), {
    schema: 'kaminos.lirm-structural-authority-exposure-filter-contract.v0',
    requiredFields: [
      'safe',
      'happy',
      'lerm_identity',
      'nintendo_region_coherence',
      'connected_body',
      'head_tail_polarity',
      'literal_carrier_mark_leakage',
      'operatorExposure',
      'classifier',
    ],
    operatorEligibility: 'safe=true; happy=true; literal_carrier_mark_leakage=false',
    sourceSelection: 'exact-plan-cell-output-paths-only',
    status: 'contract_written_no_outputs_classified',
  });
  const executionManifest = validateStructuralAuthorityExecutionManifest({
    schema: STRUCTURAL_AUTHORITY_EXECUTION_MANIFEST_SCHEMA,
    seed: plan.seed,
    requestedRoute: plan.requestedRoute,
    referenceOrder: plan.referenceOrder,
    prompt: await evidence(promptPath, root),
    settings: plan.cells[0].settings,
    receipts: {
      carrierSignalBudget: relative(root, carrierBudgetPath),
      fluxRouteContract: 'receipts/flux-4ref-route-contract.json',
      exposureFilterContract: 'receipts/exposure-filter-contract.json',
      sealedSourceMapping: 'source-mapping.json',
    },
    cells: executionCells,
    generatorFiring: 'not_started',
    operatorExposure: 'prohibited_pending_decomposed_agent_classification',
  });
  await atomicWriteJson(join(root, 'execution-manifest.json'), executionManifest);
  return executionManifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outFlag = process.argv.indexOf('--out');
  const outDir = outFlag >= 0 ? process.argv[outFlag + 1] : DEFAULT_OUT_DIR;
  writeStructuralAuthorityPrelaunch({ outDir })
    .then(manifest => {
      process.stdout.write(`${JSON.stringify({
        status: 'prelaunch_written',
        outDir: resolve(outDir),
        cells: manifest.cells.map(cell => cell.cellId),
        generatorFiring: manifest.generatorFiring,
      }, null, 2)}\n`);
    })
    .catch(error => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}
