#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const SCHEMA_IDENTITY = 'kaminos.volume.source-scale-blobbiness-probe.v0';

function parseArgs(argv) {
  const parsed = new Map();
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument ${key}`);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) parsed.set(key, true);
    else {
      parsed.set(key, next);
      i++;
    }
  }
  return parsed;
}

const args = parseArgs(process.argv);
const baseUrl = String(args.get('--base-url') || 'http://127.0.0.1:8095/?kaminos_volume_smoke=1');
const outDir = resolve(String(args.get('--out-dir') || `artifacts/source-scale-probe-${new Date().toISOString().slice(0, 10)}`));
const settleMs = Number(args.get('--settle-ms') || 6500);
const windowSize = String(args.get('--window-size') || '1280,960');
const evidenceMode = String(args.get('--evidence-mode') || 'pyro-material');
const dryRun = args.has('--dry-run');
const witnessPath = resolve(String(args.get('--witness') || 'volume-witness.mjs'));
const caseFilter = String(args.get('--cases') || '').split(',').map((s) => s.trim()).filter(Boolean);

const DEFAULT_CASES = [
  {
    id: 'compact-source',
    label: 'Compact source',
    sourceRadius: 0.08,
    fireScale: 0.65,
    flowRate: 0.30,
    note: 'Small mouth; should keep a ragged flame edge without needing heroic source detail.',
  },
  {
    id: 'operator-source',
    label: 'Operator source',
    sourceRadius: 0.13,
    fireScale: 0.65,
    flowRate: 0.30,
    note: 'Current tuned basin neighborhood.',
  },
  {
    id: 'wide-source',
    label: 'Wide source',
    sourceRadius: 0.22,
    fireScale: 0.65,
    flowRate: 0.30,
    note: 'Wide mouth; catches whether the same detail packets smear into one blob.',
  },
  {
    id: 'wide-source-low-flow',
    label: 'Wide source, low flow',
    sourceRadius: 0.22,
    fireScale: 0.65,
    flowRate: 0.16,
    note: 'Separates source-radius blobbiness from pure vertical fuel-column overload.',
  },
  {
    id: 'fire-scale-wide',
    label: 'Fire scale wide',
    sourceRadius: 0.13,
    fireScale: 1.05,
    flowRate: 0.30,
    note: 'Moves scale through fireScale instead of input radius; should not reintroduce stripe-frequency artifacts.',
  },
];

function selectedCases() {
  if (!caseFilter.length) return DEFAULT_CASES;
  const wanted = new Set(caseFilter);
  return DEFAULT_CASES.filter((entry) => wanted.has(entry.id));
}

function withRouteParams(inputUrl, params) {
  const url = new URL(inputUrl);
  url.searchParams.set('kaminos_volume_smoke', '1');
  url.searchParams.set('volume_input_radius', String(params.sourceRadius));
  url.searchParams.set('volume_fire_scale', String(params.fireScale));
  url.searchParams.set('volume_flow_rate', String(params.flowRate));
  url.searchParams.set('volume_quality_reason', 'source-scale-blobbiness-probe-0705');
  return url.toString();
}

function assertPngSignature(buffer) {
  const signature = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') !== signature) {
    throw new Error('not a PNG file');
  }
}

function parsePngRgba(buffer) {
  assertPngSignature(buffer);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error(`unsupported PNG format bitDepth=${bitDepth} colorType=${colorType}`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(idat));
  const rows = [];
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = inflated[rowStart];
    const row = Buffer.from(inflated.subarray(rowStart + 1, rowStart + 1 + stride));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(up - upLeft);
        const pb = Math.abs(left - upLeft);
        const pc = Math.abs(left + up - 2 * upLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        row[x] = (row[x] + predictor) & 255;
      } else if (filter !== 0) {
        throw new Error(`unsupported PNG filter ${filter}`);
      }
    }
    rows.push(row);
    previous = row;
  }
  return { width, height, channels, rows };
}

function pixelAt(png, x, y) {
  const row = png.rows[y];
  const i = x * png.channels;
  return [row[i], row[i + 1], row[i + 2], png.channels === 4 ? row[i + 3] : 255];
}

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function warmIntensity(r, g, b) {
  return Math.max(0, r - b) * 0.65 + Math.max(0, g - b * 0.72) * 0.35 + Math.max(0, luma(r, g, b) - 155) * 0.28;
}

function classifyFire(r, g, b) {
  const lum = luma(r, g, b);
  const warm = warmIntensity(r, g, b);
  const orange = r > 120 && g > 62 && warm > 44 && r > b * 1.18 && g > b * 0.82;
  const yellowWhite = lum > 205 && r > 180 && g > 150 && b < 220 && r >= g * 0.86;
  return orange || yellowWhite;
}

function analyzeFireShape(png) {
  const x0 = Math.floor(png.width * 0.04);
  const x1 = Math.ceil(png.width * 0.96);
  const y0 = Math.floor(png.height * 0.04);
  const y1 = Math.ceil(png.height * 0.96);
  const maskWidth = x1 - x0;
  const maskHeight = y1 - y0;
  const mask = new Uint8Array(maskWidth * maskHeight);
  const intensity = new Float32Array(maskWidth * maskHeight);
  let area = 0;
  let saturated = 0;
  let minX = maskWidth;
  let minY = maskHeight;
  let maxX = -1;
  let maxY = -1;
  let totalIntensity = 0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const [r, g, b] = pixelAt(png, x, y);
      const localIndex = (y - y0) * maskWidth + (x - x0);
      const warm = warmIntensity(r, g, b);
      intensity[localIndex] = warm;
      if (!classifyFire(r, g, b)) continue;
      mask[localIndex] = 1;
      area++;
      totalIntensity += warm;
      if (r > 242 && g > 218 && b > 165) saturated++;
      minX = Math.min(minX, x - x0);
      minY = Math.min(minY, y - y0);
      maxX = Math.max(maxX, x - x0);
      maxY = Math.max(maxY, y - y0);
    }
  }

  let perimeter = 0;
  let boundaryGradientTotal = 0;
  let boundaryGradientSamples = 0;
  const neighborOffsets = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let y = 1; y < maskHeight - 1; y++) {
    for (let x = 1; x < maskWidth - 1; x++) {
      const index = y * maskWidth + x;
      if (!mask[index]) continue;
      let boundary = false;
      for (const [dx, dy] of neighborOffsets) {
        const neighborIndex = (y + dy) * maskWidth + (x + dx);
        if (!mask[neighborIndex]) {
          boundary = true;
          boundaryGradientTotal += Math.abs(intensity[index] - intensity[neighborIndex]);
          boundaryGradientSamples++;
        }
      }
      if (boundary) perimeter++;
    }
  }

  const localMaxThreshold = area ? Math.max(28, totalIntensity / area * 0.92) : 9999;
  let localMaxCount = 0;
  for (let y = 2; y < maskHeight - 2; y++) {
    for (let x = 2; x < maskWidth - 2; x++) {
      const index = y * maskWidth + x;
      if (!mask[index] || intensity[index] < localMaxThreshold) continue;
      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (intensity[(y + dy) * maskWidth + (x + dx)] > intensity[index] + 1.5) {
            isMax = false;
            break;
          }
        }
      }
      if (isMax) localMaxCount++;
    }
  }

  const bboxWidth = Math.max(0, maxX - minX + 1);
  const bboxHeight = Math.max(0, maxY - minY + 1);
  const bboxArea = bboxWidth * bboxHeight;
  const perimeterAreaRatio = perimeter / Math.sqrt(Math.max(1, area));
  const localMaxDensity = localMaxCount / Math.max(1, area / 10000);
  return {
    width: png.width,
    height: png.height,
    fireArea: area,
    fireBbox: area ? { x: minX + x0, y: minY + y0, width: bboxWidth, height: bboxHeight } : null,
    fireFillFraction: area / Math.max(1, bboxArea),
    perimeterPixels: perimeter,
    perimeterAreaRatio,
    boundaryGradientEnergy: boundaryGradientTotal / Math.max(1, boundaryGradientSamples),
    localMaxCount,
    localMaxDensity,
    saturationFraction: saturated / Math.max(1, area),
    meanWarmIntensity: totalIntensity / Math.max(1, area),
  };
}

function summarizeWitness(report) {
  return {
    requestedRoute: report.requestedRoute,
    effectiveRoute: report.effectiveRoute,
    prototypeIdentity: report.prototypeIdentity,
    backend: report.backend,
    volumeScene: report.volumeScene,
    simGrid: report.simGrid,
    simGridLabel: report.simGridLabel,
    raySteps: report.raySteps,
    renderScale: report.renderScale,
    renderPixelRatio: report.renderPixelRatio,
    fireScale: report.fireScale,
    detailScale: report.detailScale,
    detailScaleArtifactQuarantine: report.detailScaleArtifactQuarantine,
    pressureMode: report.pressureMode,
    frameCount: report.frameCount,
    simStepCount: report.simStepCount,
    runtimeQualityEffective: report.runtimeQualityEffective,
    mainRendererMetrics: report.mainRendererMetrics,
  };
}

function runWitness(testCase, url, outPng, reportPath) {
  const result = spawnSync(process.execPath, [
    witnessPath,
    '--url', url,
    '--out', outPng,
    '--report', reportPath,
    '--settle-ms', String(settleMs),
    '--window-size', windowSize,
    '--evidence-mode', evidenceMode,
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });
  writeFileSync(reportPath.replace(/\.json$/i, '.witness.stdout.txt'), result.stdout || '');
  writeFileSync(reportPath.replace(/\.json$/i, '.witness.stderr.txt'), result.stderr || '');
  return {
    ok: result.status === 0,
    status: result.status,
    failurePhase: result.status === 0 ? null : `witness:${testCase.id}`,
    stdoutPath: reportPath.replace(/\.json$/i, '.witness.stdout.txt'),
    stderrPath: reportPath.replace(/\.json$/i, '.witness.stderr.txt'),
  };
}

function buildComparisons(caseResults) {
  const byId = new Map(caseResults.map((entry) => [entry.id, entry]));
  const baseline = byId.get('compact-source') || caseResults[0];
  return caseResults
    .filter((entry) => entry !== baseline)
    .map((entry) => ({
      baseline: baseline.id,
      candidate: entry.id,
      sourceRadiusRatio: entry.sourceRadius / Math.max(0.0001, baseline.sourceRadius),
      fireAreaRatio: entry.shape.fireArea / Math.max(1, baseline.shape.fireArea),
      complexityCollapseRatio: entry.shape.perimeterAreaRatio / Math.max(0.0001, baseline.shape.perimeterAreaRatio),
      boundaryGradientRatio: entry.shape.boundaryGradientEnergy / Math.max(0.0001, baseline.shape.boundaryGradientEnergy),
      localMaxDensityRatio: entry.shape.localMaxDensity / Math.max(0.0001, baseline.shape.localMaxDensity),
      saturationRatio: entry.shape.saturationFraction / Math.max(0.0001, baseline.shape.saturationFraction),
    }));
}

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

function writeHtmlContactSheet(path, manifest) {
  const rows = manifest.cases.map((entry) => {
    const imagePath = entry.shape ? relative(dirname(path), entry.mainRendererPng) : '';
    const metrics = entry.shape ? {
      sourceRadius: entry.sourceRadius,
      fireScale: entry.fireScale,
      flowRate: entry.flowRate,
      fireArea: entry.shape.fireArea,
      perimeterAreaRatio: Number(entry.shape.perimeterAreaRatio.toFixed(4)),
      boundaryGradientEnergy: Number(entry.shape.boundaryGradientEnergy.toFixed(4)),
      localMaxCount: entry.shape.localMaxCount,
      saturationFraction: Number(entry.shape.saturationFraction.toFixed(4)),
      failurePhase: entry.failurePhase,
    } : {
      sourceRadius: entry.sourceRadius,
      fireScale: entry.fireScale,
      flowRate: entry.flowRate,
      failurePhase: entry.failurePhase,
      error: entry.error?.message || 'no analyzable screenshot',
    };
    return `<section>
      <h2>${htmlEscape(entry.label)}</h2>
      ${entry.shape ? `<img src="${htmlEscape(imagePath)}" alt="${htmlEscape(entry.id)}">` : '<p>No analyzable screenshot.</p>'}
      <pre>${htmlEscape(JSON.stringify(metrics, null, 2))}</pre>
    </section>`;
  }).join('\n');
  const html = `<!doctype html>
<meta charset="utf-8">
<title>Kaminos Source-Scale Probe</title>
<style>
body { margin: 0; background: #101315; color: #d8e1e4; font: 14px/1.4 system-ui, sans-serif; }
main { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; padding: 16px; }
section { border: 1px solid #2a3336; background: #171c1f; padding: 12px; }
h1 { margin: 16px 16px 0; font-size: 18px; }
h2 { margin: 0 0 8px; font-size: 15px; }
img { display: block; width: 100%; height: auto; background: #000; }
pre { white-space: pre-wrap; color: #9eb4bd; }
</style>
<h1>${htmlEscape(manifest.identity)}</h1>
<main>
${rows}
</main>
`;
  writeFileSync(path, html);
}

function writeFailureReport(path, failurePhase, error, partial) {
  writeFileSync(path, JSON.stringify({
    identity: SCHEMA_IDENTITY,
    capturedAt: new Date().toISOString(),
    failurePhase,
    error: {
      message: error?.message || String(error),
      stack: error?.stack || '',
    },
    partial,
  }, null, 2));
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const aggregatePath = resolve(outDir, 'source-scale-probe.json');
  const htmlPath = resolve(outDir, 'source-scale-probe.html');
  const cases = selectedCases();
  if (!cases.length) throw new Error(`No source-scale cases selected from ${caseFilter.join(', ')}`);
  const manifest = {
    identity: SCHEMA_IDENTITY,
    capturedAt: new Date().toISOString(),
    baseUrl,
    witnessPath,
    settleMs,
    windowSize,
    evidenceMode,
    dryRun,
    cases: [],
    comparisons: [],
    failurePhase: null,
  };

  if (dryRun) {
    manifest.cases = cases.map((entry) => ({
      ...entry,
      url: withRouteParams(baseUrl, entry),
      effectiveRouteIdentity: null,
    }));
    manifest.comparisons = [];
    writeFileSync(aggregatePath, JSON.stringify(manifest, null, 2));
    writeHtmlContactSheet(htmlPath, { ...manifest, cases: [] });
    console.log(JSON.stringify({ aggregatePath, htmlPath, dryRun: true }, null, 2));
    return;
  }

  for (const testCase of cases) {
    const url = withRouteParams(baseUrl, testCase);
    const outPng = resolve(outDir, `${testCase.id}.png`);
    const reportPath = resolve(outDir, `${testCase.id}.json`);
    const mainRendererPng = outPng.replace(/\.png$/i, '.main-renderer.png');
    const result = {
      ...testCase,
      url,
      outPng,
      mainRendererPng,
      reportPath,
      witness: null,
      effectiveRouteIdentity: null,
      shape: null,
      failurePhase: null,
    };
    try {
      result.witness = runWitness(testCase, url, outPng, reportPath);
      const witnessReport = JSON.parse(readFileSync(reportPath, 'utf8'));
      const imageForMetrics = existsSync(mainRendererPng) ? mainRendererPng : outPng;
      const png = parsePngRgba(readFileSync(imageForMetrics));
      result.mainRendererPng = imageForMetrics;
      result.effectiveRouteIdentity = summarizeWitness(witnessReport);
      result.shape = analyzeFireShape(png);
      result.failurePhase = result.witness.ok ? null : result.witness.failurePhase;
      manifest.cases.push(result);
      writeFileSync(aggregatePath, JSON.stringify(manifest, null, 2));
    } catch (error) {
      result.failurePhase = `case:${testCase.id}`;
      result.error = {
        message: error?.message || String(error),
        stack: error?.stack || '',
      };
      manifest.cases.push(result);
      manifest.failurePhase = result.failurePhase;
      writeFileSync(aggregatePath, JSON.stringify(manifest, null, 2));
    }
  }

  const shapedCases = manifest.cases.filter((entry) => entry.shape);
  if (!shapedCases.length) {
    const error = new Error('source-scale probe produced no analyzable screenshots');
    writeFailureReport(aggregatePath, 'no-analyzable-screenshots', error, manifest);
    throw error;
  }
  manifest.comparisons = buildComparisons(shapedCases);
  writeFileSync(aggregatePath, JSON.stringify(manifest, null, 2));
  writeHtmlContactSheet(htmlPath, manifest);
  console.log(JSON.stringify({ aggregatePath, htmlPath, cases: manifest.cases.length }, null, 2));
}

main().catch((error) => {
  const aggregatePath = resolve(outDir, 'source-scale-probe.json');
  mkdirSync(outDir, { recursive: true });
  if (!existsSync(aggregatePath)) {
    writeFailureReport(aggregatePath, 'startup', error, null);
  }
  console.error(error?.stack || error);
  process.exit(1);
});
