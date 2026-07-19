import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { deflateSync, inflateSync } from 'node:zlib';

import {
  REFERENCE_FIT_CAMERAS,
  REFERENCE_FIT_PARAMETER_SPECS,
  REFERENCE_FIT_ROUTE,
  runReferenceFittedArmatureAssay,
} from './lirm-reference-fitted-armature-core.mjs';

export const CRAWLER_BASIN_MANIFEST_SCHEMA = 'kaminos.lirm-crawler-basin-robustness-manifest.v0';
export const CRAWLER_BASIN_MATRIX_SCHEMA = 'kaminos.lirm-crawler-basin-robustness-matrix.v0';
export const UPRIGHT_MACROCEPHALIC_BASIN_MANIFEST_SCHEMA = 'kaminos.lirm-upright-macrocephalic-basin-robustness-manifest.v0';
export const UPRIGHT_MACROCEPHALIC_BASIN_MATRIX_SCHEMA = 'kaminos.lirm-upright-macrocephalic-basin-robustness-matrix.v0';
export const CRAWLER_BASIN_PARAMETER_VOCABULARY = 'kaminos.reference-fitted-armature.13-semantic-parameters.v0';

const matrixSchemaByManifestSchema = new Map([
  [CRAWLER_BASIN_MANIFEST_SCHEMA, CRAWLER_BASIN_MATRIX_SCHEMA],
  [UPRIGHT_MACROCEPHALIC_BASIN_MANIFEST_SCHEMA, UPRIGHT_MACROCEPHALIC_BASIN_MATRIX_SCHEMA],
]);

const exactArray = (actual, expected) => (
  Array.isArray(actual)
  && actual.length === expected.length
  && actual.every((item, index) => item === expected[index])
);

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

function assertRepoLocalPath(path, repoRoot, label) {
  const absolute = resolve(repoRoot, path);
  const route = relative(repoRoot, absolute);
  if (route === '..' || route.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`${label} escapes repo root: ${path}`);
  }
  return absolute;
}

function verifyFileIdentity({ absolutePath, bytes, sha256: expectedSha }, label) {
  if (!existsSync(absolutePath)) throw new Error(`missing ${label}: ${absolutePath}`);
  const actualBytes = statSync(absolutePath).size;
  if (actualBytes !== bytes) throw new Error(`${label} byte count mismatch: expected ${bytes}, got ${actualBytes}`);
  const actualSha = sha256(readFileSync(absolutePath));
  if (actualSha !== expectedSha) throw new Error(`${label} hash mismatch: expected ${expectedSha}, got ${actualSha}`);
}

function matrixSchemaForManifest(manifest) {
  const matrixSchema = matrixSchemaByManifestSchema.get(manifest?.schema);
  if (!matrixSchema) throw new Error(`unexpected manifest schema: ${manifest?.schema}`);
  if (manifest.schema === UPRIGHT_MACROCEPHALIC_BASIN_MANIFEST_SCHEMA
      && manifest.familyId !== 'upright-macrocephalic-low-multicontact-v0') {
    throw new Error(`unexpected upright basin family: ${manifest.familyId}`);
  }
  return matrixSchema;
}

function sourceWitnessesForManifest(manifest) {
  if (manifest.sourceWitness && manifest.sourceWitnesses) {
    throw new Error('manifest cannot mix sourceWitness and sourceWitnesses');
  }
  if (Array.isArray(manifest.sourceWitnesses) && manifest.sourceWitnesses.length > 0) {
    return manifest.sourceWitnesses;
  }
  if (manifest.sourceWitness) return [manifest.sourceWitness];
  throw new Error('manifest requires source selection witness evidence');
}

function stripRuntimeWitnessPaths(witness) {
  const { absolutePath, mapping, ...sourceWitness } = witness;
  void absolutePath;
  if (!mapping) return sourceWitness;
  const { absolutePath: mappingAbsolutePath, ...sourceMapping } = mapping;
  void mappingAbsolutePath;
  return { ...sourceWitness, mapping: sourceMapping };
}

function admitSourceWitnesses(manifest, repoRoot, { requireFiles, embedded }) {
  const witnesses = sourceWitnessesForManifest(manifest);
  const paths = new Set();
  const hashes = new Set();
  return witnesses.map((witness, index) => {
    const label = `${embedded ? 'embedded ' : ''}source witness${witnesses.length > 1 ? ` ${index + 1}` : ''}`;
    if (!witness.path || paths.has(witness.path)) throw new Error(`duplicate ${label} path: ${witness.path}`);
    if (!witness.sha256 || hashes.has(witness.sha256)) throw new Error(`duplicate ${label} hash: ${witness.sha256}`);
    paths.add(witness.path);
    hashes.add(witness.sha256);
    const absolutePath = assertRepoLocalPath(witness.path, repoRoot, label);
    if (embedded && witness.absolutePath !== absolutePath) throw new Error(`${label} absolute path mismatch`);
    if (requireFiles) verifyFileIdentity({ ...witness, absolutePath }, label);

    let mapping = witness.mapping;
    if (mapping) {
      const mappingLabel = `${label} mapping`;
      const mappingAbsolutePath = assertRepoLocalPath(mapping.path, repoRoot, mappingLabel);
      if (embedded && mapping.absolutePath !== mappingAbsolutePath) throw new Error(`${mappingLabel} absolute path mismatch`);
      if (requireFiles) verifyFileIdentity({ ...mapping, absolutePath: mappingAbsolutePath }, mappingLabel);
      mapping = { ...mapping, absolutePath: mappingAbsolutePath };
    }
    return { ...witness, absolutePath, ...(mapping ? { mapping } : {}) };
  });
}

function assertFixedRoute(manifest) {
  const cameraIds = REFERENCE_FIT_CAMERAS.map(camera => camera.id);
  if (manifest.requestedRoute !== REFERENCE_FIT_ROUTE) throw new Error('manifest requested route mismatch');
  if (manifest.fixedRoute?.parameterVocabulary !== CRAWLER_BASIN_PARAMETER_VOCABULARY) {
    throw new Error('manifest parameter vocabulary mismatch');
  }
  if (REFERENCE_FIT_PARAMETER_SPECS.length !== 13) throw new Error('reviewed crawler parameter vocabulary is no longer 13 parameters');
  if (!exactArray(manifest.fixedRoute?.cameraIds, cameraIds)) throw new Error('manifest camera coverage mismatch');
  if (!exactArray(manifest.fixedRoute?.fitViewIds, ['az000', 'az090', 'az180', 'az270'])) throw new Error('manifest fit camera mismatch');
  if (!exactArray(manifest.fixedRoute?.heldOutViewIds, ['az045', 'az135', 'az225', 'az315'])) {
    throw new Error('manifest held-out camera mismatch');
  }
  for (const key of ['width', 'height', 'passes']) {
    if (!Number.isInteger(manifest.fixedRoute?.[key]) || manifest.fixedRoute[key] <= 0) throw new Error(`invalid fixed route ${key}`);
  }
}

function frozenManifestSourceView(manifest) {
  const {
    absoluteManifestPath,
    manifestSha256,
    repoRoot,
    ...source
  } = manifest;
  const sourceWitness = source.sourceWitness ? stripRuntimeWitnessPaths(source.sourceWitness) : undefined;
  const sourceWitnesses = source.sourceWitnesses?.map(stripRuntimeWitnessPaths);
  return {
    ...source,
    ...(sourceWitness ? { sourceWitness } : {}),
    ...(sourceWitnesses ? { sourceWitnesses } : {}),
    donors: (source.donors ?? []).map(donor => {
      const { absolutePath, ...frozenDonor } = donor;
      void absolutePath;
      return frozenDonor;
    }),
  };
}

function validateEmbeddedFrozenManifest(manifest, { requireFiles }) {
  matrixSchemaForManifest(manifest);
  if (manifest.fitOutcomesObserved !== false) {
    throw new Error('matrix lost frozen manifest identity');
  }
  if (manifest.acceptance?.basin?.donorCount !== 4 || manifest.donors?.length !== 4) {
    throw new Error('embedded manifest requires exactly 4 donors');
  }
  if (manifest.acceptance.basin.minimumRecoveredDonors !== 3) throw new Error('embedded manifest requires a 3-of-4 basin predicate');
  if (manifest.acceptance.basin.allowDonorReplacement !== false) throw new Error('embedded manifest must forbid donor replacement');
  assertFixedRoute(manifest);

  const repoRoot = resolve(manifest.repoRoot ?? '');
  if (!manifest.repoRoot || manifest.repoRoot !== repoRoot) throw new Error('embedded manifest repo root mismatch');
  const ids = new Set();
  const paths = new Set();
  const hashes = new Set();
  for (const donor of manifest.donors) {
    if (!donor.id || ids.has(donor.id)) throw new Error(`duplicate embedded donor id: ${donor.id}`);
    if (!donor.path || paths.has(donor.path)) throw new Error(`duplicate embedded donor path: ${donor.path}`);
    if (!donor.sha256 || hashes.has(donor.sha256)) throw new Error(`duplicate embedded donor hash: ${donor.sha256}`);
    ids.add(donor.id); paths.add(donor.path); hashes.add(donor.sha256);
    const absolutePath = assertRepoLocalPath(donor.path, repoRoot, `embedded donor ${donor.id}`);
    if (donor.absolutePath !== absolutePath) throw new Error(`embedded donor absolute path mismatch for ${donor.id}`);
    if (requireFiles) verifyFileIdentity({ ...donor, absolutePath }, `embedded donor ${donor.id}`);
  }
  admitSourceWitnesses(manifest, repoRoot, { requireFiles, embedded: true });

  if (requireFiles) {
    const absoluteManifestPath = assertRepoLocalPath(manifest.absoluteManifestPath, repoRoot, 'embedded manifest');
    const manifestBytes = readFileSync(absoluteManifestPath);
    if (sha256(manifestBytes) !== manifest.manifestSha256) throw new Error('embedded manifest file hash mismatch');
    const sourceManifest = JSON.parse(manifestBytes);
    if (!isDeepStrictEqual(frozenManifestSourceView(manifest), sourceManifest)) {
      throw new Error('embedded manifest identity mismatch');
    }
  }
}

export async function loadFrozenCrawlerBasinManifest({ manifestPath, repoRoot }) {
  const absoluteManifestPath = resolve(manifestPath);
  const absoluteRepoRoot = resolve(repoRoot);
  const manifestBytes = await readFile(absoluteManifestPath);
  const manifest = JSON.parse(manifestBytes);
  matrixSchemaForManifest(manifest);
  if (manifest.fitOutcomesObserved !== false) throw new Error('manifest must state that fit outcomes were not observed at donor selection');
  if (manifest.acceptance?.basin?.donorCount !== 4 || manifest.donors?.length !== 4) throw new Error('manifest requires exactly 4 donors');
  if (manifest.acceptance.basin.minimumRecoveredDonors !== 3) throw new Error('manifest requires a 3-of-4 basin predicate');
  if (manifest.acceptance.basin.allowDonorReplacement !== false) throw new Error('manifest must forbid donor replacement');
  assertFixedRoute(manifest);

  const ids = new Set();
  const paths = new Set();
  const hashes = new Set();
  const donors = manifest.donors.map(donor => {
    if (!donor.id || ids.has(donor.id)) throw new Error(`duplicate donor id: ${donor.id}`);
    if (!donor.path || paths.has(donor.path)) throw new Error(`duplicate donor path: ${donor.path}`);
    if (!donor.sha256 || hashes.has(donor.sha256)) throw new Error(`duplicate donor hash: ${donor.sha256}`);
    if (!donor.visualSelectionRationale?.trim()) throw new Error(`missing pre-fit visual rationale for ${donor.id}`);
    ids.add(donor.id); paths.add(donor.path); hashes.add(donor.sha256);
    const absolutePath = assertRepoLocalPath(donor.path, absoluteRepoRoot, `donor ${donor.id}`);
    verifyFileIdentity({ ...donor, absolutePath }, `donor ${donor.id}`);
    return { ...donor, absolutePath };
  });

  const sourceWitnesses = admitSourceWitnesses(manifest, absoluteRepoRoot, { requireFiles: true, embedded: false });
  return {
    ...manifest,
    absoluteManifestPath,
    manifestSha256: sha256(manifestBytes),
    repoRoot: absoluteRepoRoot,
    donors,
    ...(manifest.sourceWitness ? { sourceWitness: sourceWitnesses[0] } : { sourceWitnesses }),
  };
}

function donorRecovered(report, manifest) {
  return report.acceptance?.heldOutSilhouetteImprovementCount
      >= manifest.acceptance.donorRecovery.minimumHeldOutSilhouetteImprovements
    && (!manifest.acceptance.donorRecovery.requireMeanHeldOutDepthMaeImprovement
      || report.acceptance?.heldOutDepthImproved === true);
}

export function validateCrawlerBasinSubreport(report, { manifest, donor, requireFiles = true }) {
  if (report?.schema !== 'kaminos.lirm-reference-fitted-armature-assay.v0') throw new Error('unexpected donor subreport schema');
  if (report.requestedRoute !== manifest.requestedRoute) throw new Error('requested route mismatch');
  if (report.effectiveRoute !== manifest.requestedRoute) throw new Error('effective route mismatch');
  if (!exactArray(report.requestedCameraIds, manifest.fixedRoute.cameraIds)) throw new Error('requested camera mismatch');
  if (!exactArray(report.effectiveCameraIds, manifest.fixedRoute.cameraIds)) throw new Error('effective camera mismatch');
  if (!exactArray(report.fitViewIds, manifest.fixedRoute.fitViewIds)) throw new Error('fit camera mismatch');
  if (!exactArray(report.heldOutViewIds, manifest.fixedRoute.heldOutViewIds)) throw new Error('held-out camera mismatch');
  if (resolve(report.donor?.path ?? '') !== donor.absolutePath) throw new Error(`donor path substitution for ${donor.id}`);
  if (report.donor?.sha256 !== donor.sha256) throw new Error(`donor hash substitution for ${donor.id}`);
  if (report.donor?.bytes !== donor.bytes) throw new Error(`donor byte count substitution for ${donor.id}`);
  if (!report.metrics?.initial?.heldOut || !report.metrics?.fitted?.heldOut) throw new Error(`missing held-out metrics for ${donor.id}`);
  if (!Number.isFinite(report.metrics.initial.heldOut.meanDepthMae)
      || !Number.isFinite(report.metrics.fitted.heldOut.meanDepthMae)) throw new Error(`invalid depth metrics for ${donor.id}`);
  const evidenceIds = report.outputInventory?.donorEvidence?.map(item => item.cameraId);
  if (!exactArray(evidenceIds, manifest.fixedRoute.cameraIds)) throw new Error(`donor evidence camera mismatch for ${donor.id}`);
  for (const item of report.outputInventory.donorEvidence) {
    if (item.width !== manifest.fixedRoute.width || item.height !== manifest.fixedRoute.height) {
      throw new Error(`donor evidence dimensions mismatch for ${donor.id}`);
    }
  }
  if (requireFiles) for (const key of ['primaryWitness', 'depthWitness']) {
    const artifact = report.outputInventory?.[key];
    if (!artifact?.path || !existsSync(artifact.path)) throw new Error(`missing ${key} for ${donor.id}`);
    if (statSync(artifact.path).size !== artifact.bytes) throw new Error(`${key} byte count mismatch for ${donor.id}`);
  }
  return report;
}

export function evaluateCrawlerBasinRows(rows, basinAcceptance) {
  const recoveredDonorCount = rows.filter(row => row.outcome === 'recovered').length;
  const missedDonorCount = rows.filter(row => row.outcome === 'missed').length;
  const failedDonorCount = rows.filter(row => row.outcome === 'failed').length;
  return {
    donorCount: rows.length,
    recoveredDonorCount,
    missedDonorCount,
    failedDonorCount,
    passed: rows.length === basinAcceptance.donorCount
      && recoveredDonorCount >= basinAcceptance.minimumRecoveredDonors,
  };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const kind = Buffer.from(type);
  const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([kind, data])));
  return Buffer.concat([header, kind, data, checksum]);
}

function encodeRgbPng(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1); raw[row] = 0;
    pixels.copy(raw, row + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([
    Buffer.from('\x89PNG\r\n\x1a\n', 'binary'),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function decodeRgbPng(bytes) {
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('comparison input is not PNG');
  let offset = 8; let width; let height; const chunks = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset); const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length); offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 2 || data[12] !== 0) throw new Error('comparison input must be non-interlaced 8-bit RGB PNG');
    } else if (type === 'IDAT') chunks.push(data);
    else if (type === 'IEND') break;
  }
  if (!width || !height || chunks.length === 0) throw new Error('comparison input PNG is partial');
  const inflated = inflateSync(Buffer.concat(chunks));
  const stride = width * 3; const pixels = Buffer.alloc(stride * height); let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[source++];
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[source++];
      const left = x >= 3 ? pixels[y * stride + x - 3] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= 3 ? pixels[(y - 1) * stride + x - 3] : 0;
      const value = filter === 0 ? raw
        : filter === 1 ? raw + left
          : filter === 2 ? raw + up
            : filter === 3 ? raw + Math.floor((left + up) / 2)
              : filter === 4 ? raw + paeth(left, up, upperLeft)
                : NaN;
      if (!Number.isFinite(value)) throw new Error(`unsupported PNG filter ${filter}`);
      pixels[y * stride + x] = value & 0xff;
    }
  }
  return { width, height, pixels };
}

async function composeComparisonWitness({ rows, path, sourceKey, mappingName }) {
  const images = rows.map(row => row.outcome === 'failed'
    ? null
    : decodeRgbPng(readFileSync(row.subreport.outputInventory[sourceKey].path)));
  const exemplar = images.find(Boolean);
  if (!exemplar) throw new Error('comparison witness has no successful donor residual source');
  if (images.some(image => image && (image.width !== exemplar.width || image.height !== exemplar.height))) {
    throw new Error('comparison witness source dimensions diverged');
  }
  const gap = 8; const band = 12; const columns = 2; const rowsCount = 2;
  const width = exemplar.width * columns + gap * (columns + 1);
  const height = (exemplar.height + band) * rowsCount + gap * (rowsCount + 1);
  const pixels = Buffer.alloc(width * height * 3, 16);
  const colors = [[194, 140, 61], [74, 148, 126], [112, 104, 174], [183, 81, 92]];
  const cells = [];
  for (let index = 0; index < rows.length; index += 1) {
    const column = index % columns; const rowIndex = Math.floor(index / columns);
    const x0 = gap + column * (exemplar.width + gap);
    const y0 = gap + rowIndex * (exemplar.height + band + gap);
    const color = rows[index].outcome === 'failed' ? [120, 32, 38] : colors[index];
    for (let y = 0; y < band; y += 1) for (let x = 0; x < exemplar.width; x += 1) {
      const target = ((y0 + y) * width + x0 + x) * 3;
      pixels[target] = color[0]; pixels[target + 1] = color[1]; pixels[target + 2] = color[2];
    }
    const image = images[index];
    if (image) for (let y = 0; y < image.height; y += 1) {
      const source = y * image.width * 3;
      const target = ((y0 + band + y) * width + x0) * 3;
      image.pixels.copy(pixels, target, source, source + image.width * 3);
    }
    cells.push({ donorId: rows[index].donorId, outcome: rows[index].outcome, column, row: rowIndex, bandColor: color });
  }
  const bytes = encodeRgbPng(width, height, pixels);
  await writeFile(path, bytes);
  const mappingPath = resolve(dirname(path), mappingName);
  await writeJsonAtomic(mappingPath, {
    schema: 'kaminos.lirm-crawler-basin-comparison-witness-inputs.v0',
    sourceKey,
    width,
    height,
    cells,
  });
  return { path, bytes: bytes.length, sha256: sha256(bytes), width, height, mappingPath };
}

async function buildDefaultComparisonWitness({ rows, path, depthPath }) {
  return {
    comparisonWitness: await composeComparisonWitness({
      rows,
      path,
      sourceKey: 'primaryWitness',
      mappingName: 'comparison-witness-inputs.json',
    }),
    depthComparisonWitness: await composeComparisonWitness({
      rows,
      path: depthPath,
      sourceKey: 'depthWitness',
      mappingName: 'depth-comparison-witness-inputs.json',
    }),
  };
}

function validateComparisonWitness(artifact, requireFiles) {
  if (!artifact?.path || !artifact?.bytes || !artifact?.sha256) throw new Error('missing comparison witness identity');
  if (requireFiles) verifyFileIdentity({ absolutePath: artifact.path, bytes: artifact.bytes, sha256: artifact.sha256 }, 'comparison witness');
}

function validateInspectionWitnessIdentity(receipt, artifact, label) {
  if (receipt?.path !== artifact.path
      || receipt?.bytes !== artifact.bytes
      || receipt?.sha256 !== artifact.sha256) {
    throw new Error(`visual inspection ${label} witness identity mismatch`);
  }
}

export function validateCrawlerBasinMatrixReport(report, { requireFiles = true } = {}) {
  const manifest = report.manifest;
  if (report?.schema !== matrixSchemaForManifest(manifest)) throw new Error('unexpected morphology basin matrix schema');
  validateEmbeddedFrozenManifest(manifest, { requireFiles });
  if (report.requestedRoute !== manifest.requestedRoute) throw new Error('matrix requested route mismatch');
  if (report.effectiveRoute !== manifest.requestedRoute) throw new Error('matrix effective route mismatch');
  if (report.rows?.length !== 4) throw new Error('matrix requires exactly 4 matrix rows');
  if (!exactArray(report.rows.map(row => row.donorId), manifest.donors.map(donor => donor.id))) throw new Error('matrix donor order or identity mismatch');
  for (const row of report.rows) {
    const donor = manifest.donors.find(item => item.id === row.donorId);
    if (row.donorPath !== donor.absolutePath || row.donorSha256 !== donor.sha256) throw new Error(`matrix donor substitution for ${row.donorId}`);
    if (row.outcome === 'recovered' || row.outcome === 'missed') {
      validateCrawlerBasinSubreport(row.subreport, { manifest, donor, requireFiles });
      if ((row.outcome === 'recovered') !== donorRecovered(row.subreport, manifest)) throw new Error(`matrix outcome mismatch for ${row.donorId}`);
    } else if (row.outcome === 'failed') {
      if (!row.error || !row.failurePhase || !row.subreport) throw new Error(`failed row lacks durable failure report for ${row.donorId}`);
    } else throw new Error(`unknown matrix outcome for ${row.donorId}: ${row.outcome}`);
  }
  const evaluated = evaluateCrawlerBasinRows(report.rows, manifest.acceptance.basin);
  if (JSON.stringify(evaluated) !== JSON.stringify(report.acceptance)) throw new Error('matrix acceptance summary mismatch');
  validateComparisonWitness(report.outputInventory?.comparisonWitness, requireFiles);
  validateComparisonWitness(report.outputInventory?.depthComparisonWitness, requireFiles);
  let expectedStatus;
  if (report.visualInspection === 'pending') {
    expectedStatus = report.acceptance.passed ? 'basin-passed-uninspected' : 'basin-missed-threshold-uninspected';
  } else if (report.visualInspection && typeof report.visualInspection === 'object') {
    if (!['accepted', 'rejected'].includes(report.visualInspection.disposition)) throw new Error('invalid matrix visual inspection disposition');
    if (!report.visualInspection.visibleDelta?.trim()) throw new Error('matrix visual inspection lacks visible delta');
    validateInspectionWitnessIdentity(
      report.visualInspection.comparisonWitness,
      report.outputInventory.comparisonWitness,
      'silhouette',
    );
    validateInspectionWitnessIdentity(
      report.visualInspection.depthComparisonWitness,
      report.outputInventory.depthComparisonWitness,
      'depth',
    );
    expectedStatus = report.visualInspection.disposition === 'accepted'
      ? (report.acceptance.passed ? 'basin-passed-inspected' : 'basin-missed-threshold-inspected')
      : 'basin-visual-rejected';
  } else throw new Error('matrix status/inspection mismatch');
  if (report.status !== expectedStatus) throw new Error(`matrix status/inspection mismatch: expected ${expectedStatus}, got ${report.status}`);
  return report;
}

export async function runCrawlerBasinMatrix({
  manifestPath,
  repoRoot,
  outDir,
  runAssay = runReferenceFittedArmatureAssay,
  buildComparisonWitness = buildDefaultComparisonWitness,
} = {}) {
  const outputRoot = resolve(outDir);
  await mkdir(outputRoot, { recursive: true });
  const reportPath = resolve(outputRoot, 'report.json');
  const manifest = await loadFrozenCrawlerBasinManifest({ manifestPath, repoRoot });
  const startedAtMs = Date.now();
  const report = {
    schema: matrixSchemaForManifest(manifest),
    status: 'running',
    failurePhase: null,
    requestedRoute: manifest.requestedRoute,
    effectiveRoute: null,
    manifest,
    rows: [],
    acceptance: null,
    outputInventory: { comparisonWitness: null },
    timing: { startedAt: new Date(startedAtMs).toISOString(), finishedAt: null, durationSeconds: null },
    lastTrustworthyEvidence: 'frozen manifest admitted; no donor fit attempted',
  };
  await writeJsonAtomic(reportPath, report);
  let activePhase = 'donor-matrix';
  try {
    for (const donor of manifest.donors) {
      const donorOut = resolve(outputRoot, 'donors', donor.id);
      let donorPhase = 'assay-execution';
      try {
        const subreport = await runAssay({
          donorPath: donor.absolutePath,
          outDir: donorOut,
          fitViewIds: manifest.fixedRoute.fitViewIds,
          heldOutViewIds: manifest.fixedRoute.heldOutViewIds,
          width: manifest.fixedRoute.width,
          height: manifest.fixedRoute.height,
          passes: manifest.fixedRoute.passes,
        });
        donorPhase = 'subreport-validation';
        validateCrawlerBasinSubreport(subreport, { manifest, donor });
        report.rows.push({
          donorId: donor.id,
          donorPath: donor.absolutePath,
          donorSha256: donor.sha256,
          outcome: donorRecovered(subreport, manifest) ? 'recovered' : 'missed',
          reportPath: resolve(donorOut, 'report.json'),
          subreport,
        });
      } catch (error) {
        const donorReportPath = resolve(donorOut, 'report.json');
        let subreport = { status: 'failed', failurePhase: donorPhase, lastTrustworthyEvidence: 'no donor report could be read' };
        if (existsSync(donorReportPath)) {
          try { subreport = JSON.parse(await readFile(donorReportPath, 'utf8')); } catch {}
        }
        report.rows.push({
          donorId: donor.id,
          donorPath: donor.absolutePath,
          donorSha256: donor.sha256,
          outcome: 'failed',
          failurePhase: donorPhase,
          reportPath: donorReportPath,
          error: String(error?.stack ?? error),
          subreport,
        });
      }
      report.lastTrustworthyEvidence = `${report.rows.length} of 4 precommitted donors accounted for`;
      await writeJsonAtomic(reportPath, report);
    }
    report.acceptance = evaluateCrawlerBasinRows(report.rows, manifest.acceptance.basin);
    activePhase = 'comparison-witness';
    const comparisonPath = resolve(outputRoot, 'comparison-witness.png');
    const depthComparisonPath = resolve(outputRoot, 'depth-comparison-witness.png');
    const comparisonArtifacts = await buildComparisonWitness({
      rows: report.rows,
      path: comparisonPath,
      depthPath: depthComparisonPath,
      outDir: outputRoot,
    });
    report.outputInventory.comparisonWitness = comparisonArtifacts.comparisonWitness;
    report.outputInventory.depthComparisonWitness = comparisonArtifacts.depthComparisonWitness;
    validateComparisonWitness(report.outputInventory.comparisonWitness, true);
    validateComparisonWitness(report.outputInventory.depthComparisonWitness, true);
    report.status = report.acceptance.passed ? 'basin-passed-uninspected' : 'basin-missed-threshold-uninspected';
    report.effectiveRoute = manifest.requestedRoute;
    report.visualInspection = 'pending';
    report.lastTrustworthyEvidence = 'all four precommitted donors accounted for; comparison witness written but not inspected';
    const finishedAtMs = Date.now();
    report.timing.finishedAt = new Date(finishedAtMs).toISOString();
    report.timing.durationSeconds = (finishedAtMs - startedAtMs) / 1000;
    activePhase = 'matrix-validation';
    validateCrawlerBasinMatrixReport(report);
    await writeJsonAtomic(reportPath, report);
    return report;
  } catch (error) {
    report.status = 'failed';
    report.failurePhase = activePhase;
    report.error = String(error?.stack ?? error);
    const finishedAtMs = Date.now();
    report.timing.finishedAt = new Date(finishedAtMs).toISOString();
    report.timing.durationSeconds = (finishedAtMs - startedAtMs) / 1000;
    await writeJsonAtomic(reportPath, report);
    throw error;
  }
}

export async function recordCrawlerBasinVisualInspection({ reportPath, disposition, visibleDelta, missClassifications = {} }) {
  if (!['accepted', 'rejected'].includes(disposition)) throw new Error(`invalid inspection disposition: ${disposition}`);
  if (!visibleDelta?.trim()) throw new Error('visual inspection requires visible delta');
  const report = JSON.parse(await readFile(resolve(reportPath), 'utf8'));
  validateCrawlerBasinMatrixReport(report);
  for (const row of report.rows.filter(item => item.outcome !== 'recovered')) {
    if (!report.manifest.missClassifications.includes(missClassifications[row.donorId])) {
      throw new Error(`missing valid visual classification for ${row.donorId}`);
    }
  }
  const artifact = report.outputInventory.comparisonWitness;
  const depthArtifact = report.outputInventory.depthComparisonWitness;
  verifyFileIdentity({ absolutePath: artifact.path, bytes: artifact.bytes, sha256: artifact.sha256 }, 'comparison witness');
  verifyFileIdentity({ absolutePath: depthArtifact.path, bytes: depthArtifact.bytes, sha256: depthArtifact.sha256 }, 'depth comparison witness');
  report.visualInspection = {
    disposition,
    visibleDelta: visibleDelta.trim(),
    missClassifications: { ...missClassifications },
    comparisonWitness: { path: artifact.path, bytes: artifact.bytes, sha256: artifact.sha256 },
    depthComparisonWitness: { path: depthArtifact.path, bytes: depthArtifact.bytes, sha256: depthArtifact.sha256 },
  };
  report.status = disposition === 'accepted'
    ? (report.acceptance.passed ? 'basin-passed-inspected' : 'basin-missed-threshold-inspected')
    : 'basin-visual-rejected';
  report.lastTrustworthyEvidence = disposition === 'accepted'
    ? 'all four precommitted donors and aggregate residual witness visually inspected'
    : 'aggregate residual witness visually inspected and rejected';
  validateCrawlerBasinMatrixReport(report);
  await writeJsonAtomic(resolve(reportPath), report);
  return report;
}
