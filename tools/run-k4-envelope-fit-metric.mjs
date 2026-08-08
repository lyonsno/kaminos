#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  K4_ENVELOPE_FIT_METRIC_SCHEMA,
  computeK4EnvelopeFitMetric,
  parseGlbTriangleSoup,
} from '../k4-envelope-fit-core.mjs';

const RESULT_SCHEMA = 'kaminos.k4-envelope-fit-metric-result.v0';
const REPORT_SCHEMA = 'kaminos.k4-envelope-fit-metric-run-report.v0';
const CUSTODY_MARKER = '.kaminos-k4-envelope-fit-metric-output';
const CUSTODY_SCHEMA = 'kaminos.k4-envelope-fit-metric-output-custody.v0';
const CUSTODY_BYTES = Buffer.from(`${CUSTODY_SCHEMA}\n`);
const OVERLAY_DIRECTORY = 'overlays';
const OWNED_PATHS = Object.freeze(['envelope-fit-metric.json', OVERLAY_DIRECTORY]);
const CONSTRUCTION_COLORS = Object.freeze({
  'muscle-34': '#f2545b',
  'muscle-13': '#e8c547',
  'muscle-12': '#3ddad7',
  'muscle-45': '#9b8cf2',
});

function parseArguments(argv) {
  const parsed = { carriers: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    if (argument === '--frame-receipt') parsed.frameReceipt = value;
    else if (argument === '--envelope') parsed.envelope = value;
    else if (argument === '--carrier') {
      const separator = value.indexOf('=');
      if (separator <= 0) throw new Error('--carrier requires id=path');
      parsed.carriers.push({
        id: value.slice(0, separator),
        requestedPath: value.slice(separator + 1),
      });
    } else if (argument === '--output') parsed.output = value;
    else throw new Error(`unsupported argument ${argument}`);
    index += 1;
  }
  for (const key of ['frameReceipt', 'envelope', 'output']) {
    if (!parsed[key]) throw new Error(`--${key} is required`);
  }
  if (parsed.carriers.length === 0) throw new Error('--carrier is required');
  const seen = new Set();
  for (const row of parsed.carriers) {
    if (seen.has(row.id)) throw new Error(`duplicate carrier id ${row.id}`);
    seen.add(row.id);
  }
  parsed.output = path.resolve(parsed.output);
  return parsed;
}

function preScanOutputDirectory(argv) {
  const index = argv.indexOf('--output');
  const value = index >= 0 ? argv[index + 1] : null;
  return value && !value.startsWith('--') ? path.resolve(value) : null;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function writeAtomic(target, bytes) {
  const temporary = `${target}.tmp-${process.pid}`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(temporary, bytes);
  await rename(temporary, target);
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function hasOutputCustody(outputDirectory) {
  try {
    return (await readFile(path.join(outputDirectory, CUSTODY_MARKER)))
      .equals(CUSTODY_BYTES);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function clearOwnedOutput(outputDirectory) {
  await Promise.all(OWNED_PATHS.map(relative =>
    rm(path.join(outputDirectory, relative), { recursive: true, force: true })));
}

async function claimOutputCustody(outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  if (await hasOutputCustody(outputDirectory)) return;
  const occupied = [];
  for (const relative of [...OWNED_PATHS, 'run-report.json']) {
    if (await exists(path.join(outputDirectory, relative))) occupied.push(relative);
  }
  if (occupied.length > 0) {
    throw new Error(`refusing to claim unowned output containing ${occupied.join(', ')}`);
  }
  await writeAtomic(path.join(outputDirectory, CUSTODY_MARKER), CUSTODY_BYTES);
}

function receiptPath(target) {
  const relative = path.relative(process.cwd(), target);
  if (!path.isAbsolute(relative) && relative !== '..' &&
      !relative.startsWith(`..${path.sep}`)) {
    return `repo://${relative.split(path.sep).join('/')}`;
  }
  return target;
}

function sliceEnvelope(mesh, axis, level) {
  const segments = [];
  for (const [ia, ib, ic] of mesh.triangles) {
    const triangle = [mesh.vertices[ia], mesh.vertices[ib], mesh.vertices[ic]];
    const crossings = [];
    for (let edge = 0; edge < 3; edge += 1) {
      const from = triangle[edge];
      const to = triangle[(edge + 1) % 3];
      const fromDelta = from[axis] - level;
      const toDelta = to[axis] - level;
      if ((fromDelta <= 0 && toDelta > 0) || (fromDelta > 0 && toDelta <= 0)) {
        const t = fromDelta / (fromDelta - toDelta);
        crossings.push(from.map((value, index) => value + (to[index] - value) * t));
      }
    }
    if (crossings.length === 2) segments.push(crossings);
  }
  return segments;
}

function overlaySvg({ axis, level, segments, sampleRows, planeAxes, title }) {
  const [u, v] = planeAxes;
  const points = [
    ...segments.flat(),
    ...sampleRows.flatMap(row => row.samples.map(sample => sample.envelopePosition)),
  ];
  const uValues = points.map(point => point[u]);
  const vValues = points.map(point => point[v]);
  const uMin = Math.min(...uValues);
  const uMax = Math.max(...uValues);
  const vMin = Math.min(...vValues);
  const vMax = Math.max(...vValues);
  const size = 900;
  const pad = 50;
  const span = Math.max(uMax - uMin, vMax - vMin) || 1;
  const scale = (size - 2 * pad) / span;
  const mapU = value => pad + (value - uMin) * scale;
  const mapV = value => size - pad - (value - vMin) * scale;
  const lines = segments.map(([from, to]) =>
    `<line x1="${mapU(from[u]).toFixed(1)}" y1="${mapV(from[v]).toFixed(1)}" ` +
    `x2="${mapU(to[u]).toFixed(1)}" y2="${mapV(to[v]).toFixed(1)}" ` +
    `stroke="#8fa3b8" stroke-width="1.4"/>`).join('\n');
  const dots = sampleRows.map(row => row.samples.map(sample => {
    const fill = CONSTRUCTION_COLORS[sample.constructionId] || '#ffffff';
    const stroke = sample.signedDistance > 0 ? '#ff2d2d' : 'none';
    return `<circle cx="${mapU(sample.envelopePosition[u]).toFixed(1)}" ` +
      `cy="${mapV(sample.envelopePosition[v]).toFixed(1)}" r="3.2" ` +
      `fill="${fill}" fill-opacity="0.85"` +
      `${stroke === 'none' ? '' : ` stroke="${stroke}" stroke-width="2"`}/>`;
  }).join('\n')).join('\n');
  const axisNames = ['x', 'y', 'z'];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<rect width="${size}" height="${size}" fill="#0a0e14"/>
<text x="${pad}" y="30" fill="#f4eee3" font-family="monospace" font-size="16">${title}</text>
<text x="${pad}" y="${size - 14}" fill="#8fa3b8" font-family="monospace" font-size="11">section ${axisNames[axis]}=${level.toFixed(3)} · plane ${axisNames[u]}/${axisNames[v]} · grey = envelope section · dots = K4 boundary samples within slab · red ring = outside envelope</text>
${lines}
${dots}
</svg>
`;
}

const rawArguments = process.argv.slice(2);
const preScannedOutputDirectory = preScanOutputDirectory(rawArguments);
let args = null;
let phase = 'parse-arguments';
let inputReceipts = null;
let reportPath = preScannedOutputDirectory
  ? path.join(preScannedOutputDirectory, 'run-report.json')
  : null;

try {
  args = parseArguments(rawArguments);
  reportPath = path.join(args.output, 'run-report.json');
  phase = 'claim-output-custody';
  await claimOutputCustody(args.output);
  phase = 'clear-stale-evidence';
  await clearOwnedOutput(args.output);
  phase = 'read-inputs';
  const frameReceiptPath = await realpath(path.resolve(args.frameReceipt));
  const envelopePath = await realpath(path.resolve(args.envelope));
  const [frameReceiptBytes, envelopeBytes] = await Promise.all([
    readFile(frameReceiptPath),
    readFile(envelopePath),
  ]);
  const carrierInputs = [];
  for (const row of args.carriers) {
    const effectivePath = await realpath(path.resolve(row.requestedPath));
    const bytes = await readFile(effectivePath);
    carrierInputs.push({ ...row, effectivePath, bytes });
  }
  inputReceipts = {
    frameReceipt: {
      requestedPath: receiptPath(path.resolve(args.frameReceipt)),
      effectivePath: receiptPath(frameReceiptPath),
      sha256: sha256(frameReceiptBytes),
    },
    envelope: {
      requestedPath: receiptPath(path.resolve(args.envelope)),
      effectivePath: receiptPath(envelopePath),
      sha256: sha256(envelopeBytes),
    },
    carriers: carrierInputs.map(row => ({
      id: row.id,
      requestedPath: receiptPath(path.resolve(row.requestedPath)),
      effectivePath: receiptPath(row.effectivePath),
      sha256: sha256(row.bytes),
    })),
  };
  const frameReceipt = JSON.parse(frameReceiptBytes);
  phase = 'verify-frame-receipt-inputs';
  if (frameReceipt?.inputs?.envelopeFileSha256 !== inputReceipts.envelope.sha256) {
    throw new Error(
      'envelope fit envelope file does not match the frame receipt envelope identity',
    );
  }
  phase = 'parse-envelope';
  const envelopeMesh = parseGlbTriangleSoup(envelopeBytes);
  phase = 'compute-metric';
  const rows = [];
  for (const row of carrierInputs) {
    const solverCarrier = JSON.parse(row.bytes);
    const metric = computeK4EnvelopeFitMetric({
      frameReceipt,
      envelopeMesh,
      solverCarrier,
    });
    rows.push({ id: row.id, metric });
  }
  phase = 'render-overlays';
  const allSamples = rows.flatMap(row => row.metric.constructions.flatMap(
    construction => construction.samples.map(sample => ({
      ...sample,
      constructionId: construction.constructionId,
      rowId: row.id,
    }))));
  const centroid = [0, 1, 2].map(axis =>
    allSamples.reduce((sum, sample) => sum + sample.envelopePosition[axis], 0) /
    allSamples.length);
  const sectionOverlays = [];
  for (const axis of [0, 1, 2]) {
    const planeAxes = [0, 1, 2].filter(item => item !== axis);
    const level = centroid[axis];
    const segments = sliceEnvelope(envelopeMesh, axis, level);
    const slab = 0.35;
    for (const row of rows) {
      const samples = allSamples.filter(sample =>
        sample.rowId === row.id &&
        Math.abs(sample.envelopePosition[axis] - level) <= slab);
      const svg = overlaySvg({
        axis,
        level,
        segments,
        sampleRows: [{ samples }],
        planeAxes,
        title: `K4 envelope fit · ${row.id} · fit-derived provisional frame`,
      });
      const relative = `${OVERLAY_DIRECTORY}/section-${'xyz'[axis]}-${row.id}.svg`;
      const bytes = Buffer.from(svg);
      await writeAtomic(path.join(args.output, relative), bytes);
      sectionOverlays.push({
        path: relative,
        sha256: sha256(bytes),
        axis: 'xyz'[axis],
        level,
        rowId: row.id,
        sampleCount: samples.length,
        slab,
      });
    }
  }
  phase = 'write-metric';
  const compactRows = rows.map(row => ({
    id: row.id,
    metric: {
      ...row.metric,
      constructions: row.metric.constructions.map(construction => {
        const { samples: _samples, ...summary } = construction;
        return summary;
      }),
    },
  }));
  const result = {
    schema: RESULT_SCHEMA,
    status: 'completed-provisional',
    claimCeiling: rows[0].metric.claimCeiling,
    frameAuthority: rows[0].metric.frameAuthority,
    heldClaims: rows[0].metric.heldClaims,
    inputs: inputReceipts,
    rows: compactRows,
    sectionOverlays,
    boundarySampleBasis: rows[0].metric.boundarySampleBasis,
  };
  const resultBytes = jsonBytes(result);
  await writeAtomic(path.join(args.output, 'envelope-fit-metric.json'), resultBytes);
  const outputs = {
    envelopeFitMetric: {
      path: 'envelope-fit-metric.json',
      sha256: sha256(resultBytes),
    },
  };
  const report = {
    schema: REPORT_SCHEMA,
    status: 'completed',
    failurePhase: null,
    claimCeiling: result.claimCeiling,
    frameAuthority: result.frameAuthority,
    inputs: inputReceipts,
    outputs,
    lastTrustworthyEvidence: {
      phase: 'envelope-fit-metric-written',
      envelopeFitMetricSha256: outputs.envelopeFitMetric.sha256,
      rowIds: rows.map(row => row.id),
    },
  };
  phase = 'write-report';
  await writeAtomic(reportPath, jsonBytes(report));
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    reportPath,
    rows: compactRows.map(row => ({
      id: row.id,
      constructions: row.metric.constructions.map(construction => ({
        constructionId: construction.constructionId,
        insideFraction: construction.insideFraction,
        meanSignedDistance: construction.meanSignedDistance,
        maximumOutsideExcursion: construction.maximumOutsideExcursion,
      })),
    })),
  })}\n`);
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const outputDirectory = args?.output || preScannedOutputDirectory;
  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive: true });
    reportPath ||= path.join(outputDirectory, 'run-report.json');
    const outputCustodyVerified = await hasOutputCustody(outputDirectory);
    if (outputCustodyVerified) await clearOwnedOutput(outputDirectory);
    await writeAtomic(reportPath, jsonBytes({
      schema: REPORT_SCHEMA,
      status: 'failed',
      failurePhase: phase,
      error: message,
      rawArguments,
      inputs: inputReceipts,
      outputCustodyVerified,
      staleEvidenceCleared: outputCustodyVerified,
      outputs: null,
      lastTrustworthyEvidence: {
        phase: inputReceipts ? 'inputs-read-and-hashed' : 'raw-arguments-captured',
        inputs: inputReceipts,
      },
    }));
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
