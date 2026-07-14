import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

export const LIRM_SILHOUETTE_ARCHETYPE_CORPUS_SCHEMA = 'kaminos.lirm-silhouette-archetype-corpus.v0';
export const LIRM_SILHOUETTE_ARCHETYPE_RECORD_SCHEMA = 'kaminos.lirm-silhouette-archetype-record.v0';
export const LIRM_SILHOUETTE_TRAINABLE_SAMPLE_SCHEMA = 'kaminos.lirm-silhouette-trainable-sample.v0';
export const LIRM_SILHOUETTE_NOVELTY_ASSAY_SCHEMA = 'kaminos.lirm-silhouette-novelty-assay.v0';
export const LIRM_SILHOUETTE_ARCHETYPE_ROUTE = 'kaminos/lirm-speciation-armature/silhouette-archetype-corpus-v0';
export const LIRM_SILHOUETTE_SOURCE_MANIFEST_SCHEMA = 'kaminos.lirm-silhouette-source-manifest.v0';

function assertMask(mask) {
  if (!mask || !Number.isInteger(mask.width) || !Number.isInteger(mask.height) || mask.width <= 0 || mask.height <= 0) {
    throw new Error('mask width and height must be positive integers');
  }
  if (!mask.data || mask.data.length !== mask.width * mask.height) {
    throw new Error(`mask data length must equal width * height (${mask.width * mask.height})`);
  }
}

function validateManifest(manifest) {
  if (!manifest || manifest.schema !== LIRM_SILHOUETTE_SOURCE_MANIFEST_SCHEMA) {
    throw new Error(`manifest schema must be ${LIRM_SILHOUETTE_SOURCE_MANIFEST_SCHEMA}`);
  }
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) {
    throw new Error('manifest sources must be a non-empty array');
  }
}

function validateManifestSource(source) {
  for (const field of ['sourceId', 'provider', 'sourceUrl', 'sourcePageUrl', 'retrievedAt']) {
    if (!source || typeof source[field] !== 'string' || source[field].trim() === '') {
      throw new Error(`source.${field} is required`);
    }
  }
}

async function defaultFetchSource(source) {
  const response = await fetch(source.sourceUrl, {
    headers: { 'user-agent': 'Kaminos silhouette-archetype corpus witness/0' },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${source.sourceUrl}`);
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    effectiveUrl: response.url || source.sourceUrl,
    cacheStatus: 'network',
  };
}

export function extractBorderConnectedForegroundMask(image, options = {}) {
  const { width, height, data } = image || {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('RGB image width and height must be positive integers');
  }
  if (!data || data.length !== width * height * 3) throw new Error('RGB image data length must equal width * height * 3');
  const threshold = Math.max(0, Number(options.colorDistanceThreshold ?? 24));
  const borderColors = [];
  const addColor = (x, y) => {
    const index = (y * width + x) * 3;
    borderColors.push([data[index], data[index + 1], data[index + 2]]);
  };
  for (let x = 0; x < width; x += 1) {
    addColor(x, 0);
    if (height > 1) addColor(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    addColor(0, y);
    if (width > 1) addColor(width - 1, y);
  }
  const median = channel => {
    const values = borderColors.map(color => color[channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  const background = [median(0), median(1), median(2)];
  const backgroundCandidate = pixel => {
    const index = pixel * 3;
    const dr = data[index] - background[0];
    const dg = data[index + 1] - background[1];
    const db = data[index + 2] - background[2];
    return Math.sqrt(dr * dr + dg * dg + db * db) <= threshold;
  };
  const connected = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const enqueue = pixel => {
    if (connected[pixel] || !backgroundCandidate(pixel)) return;
    connected[pixel] = 1;
    queue[tail] = pixel;
    tail += 1;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  while (head < tail) {
    const pixel = queue[head];
    head += 1;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) enqueue(pixel - 1);
    if (x + 1 < width) enqueue(pixel + 1);
    if (y > 0) enqueue(pixel - width);
    if (y + 1 < height) enqueue(pixel + width);
  }
  return {
    width,
    height,
    data: Array.from(connected, value => value ? 0 : 1),
    extraction: {
      kind: 'border-connected-background-v0',
      colorDistanceThreshold: threshold,
      estimatedBackgroundRgb: background,
    },
  };
}

function imageExtension(contentType, sourceUrl) {
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('jpeg')) return '.jpg';
  const extension = extname(new URL(sourceUrl).pathname).toLowerCase();
  return ['.png', '.webp', '.jpg', '.jpeg'].includes(extension) ? extension : '.image';
}

async function decodeAlphaMaskWithFfmpeg(download, source) {
  const scratch = await mkdtemp(join(tmpdir(), 'kaminos-silhouette-alpha-'));
  const inputPath = join(scratch, `source${imageExtension(download.contentType || '', download.effectiveUrl || source.sourceUrl)}`);
  try {
    await writeFile(inputPath, download.bytes);
    const probe = spawnSync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,pix_fmt',
      '-of', 'json',
      inputPath,
    ], { encoding: 'utf8' });
    if (probe.status !== 0) throw new Error(`ffprobe failed: ${(probe.stderr || probe.stdout || '').trim()}`);
    const stream = JSON.parse(probe.stdout)?.streams?.[0];
    if (!stream?.width || !stream?.height) throw new Error('ffprobe did not report image dimensions');
    if (source.maskExtraction?.kind === 'border-connected-background-v0') {
      const rgb = spawnSync('ffmpeg', [
        '-v', 'error', '-i', inputPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
      ], {
        encoding: null,
        maxBuffer: Math.max(16 * 1024 * 1024, stream.width * stream.height * 4),
      });
      if (rgb.status !== 0) throw new Error(`RGB extraction failed for pix_fmt ${stream.pix_fmt}: ${Buffer.from(rgb.stderr || '').toString('utf8').trim()}`);
      const expectedBytes = stream.width * stream.height * 3;
      if (rgb.stdout.length < expectedBytes) throw new Error(`RGB extraction returned ${rgb.stdout.length} of ${expectedBytes} bytes`);
      return extractBorderConnectedForegroundMask({
        width: stream.width,
        height: stream.height,
        data: rgb.stdout.subarray(0, expectedBytes),
      }, source.maskExtraction);
    }
    const alpha = spawnSync('ffmpeg', [
      '-v', 'error', '-i', inputPath, '-vf', 'alphaextract', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1',
    ], {
      encoding: null,
      maxBuffer: Math.max(16 * 1024 * 1024, stream.width * stream.height * 2),
    });
    if (alpha.status !== 0) throw new Error(`alpha extraction failed for pix_fmt ${stream.pix_fmt}: ${Buffer.from(alpha.stderr || '').toString('utf8').trim()}`);
    const expectedBytes = stream.width * stream.height;
    if (alpha.stdout.length < expectedBytes) throw new Error(`alpha extraction returned ${alpha.stdout.length} of ${expectedBytes} bytes`);
    return { width: stream.width, height: stream.height, data: Array.from(alpha.stdout.subarray(0, expectedBytes), value => value >= 16 ? 1 : 0) };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export function assaySilhouetteFraming(mask, options = {}) {
  const data = binaryData(mask);
  const occupancy = data.reduce((sum, value) => sum + value, 0) / data.length;
  let borderForeground = 0;
  let borderPixels = 0;
  const count = (x, y) => {
    borderPixels += 1;
    borderForeground += data[y * mask.width + x];
  };
  for (let x = 0; x < mask.width; x += 1) {
    count(x, 0);
    if (mask.height > 1) count(x, mask.height - 1);
  }
  for (let y = 1; y < mask.height - 1; y += 1) {
    count(0, y);
    if (mask.width > 1) count(mask.width - 1, y);
  }
  const borderForegroundFraction = borderPixels ? borderForeground / borderPixels : 1;
  const minOccupancy = Number(options.minOccupancy ?? 0.001);
  const maxOccupancy = Number(options.maxOccupancy ?? 0.98);
  const maxBorderForegroundFraction = Number(options.maxBorderForegroundFraction ?? 0.05);
  const reasons = [];
  if (occupancy <= minOccupancy) reasons.push('blank_foreground');
  if (occupancy >= maxOccupancy) reasons.push('opaque_rectangle');
  if (borderForegroundFraction > maxBorderForegroundFraction) reasons.push('foreground_touches_border');
  return {
    accepted: reasons.length === 0,
    occupancy: Number(occupancy.toFixed(6)),
    borderForegroundFraction: Number(borderForegroundFraction.toFixed(6)),
    thresholds: { minOccupancy, maxOccupancy, maxBorderForegroundFraction },
    reasons,
  };
}

function assertUsefulOccupancy(mask) {
  const assay = assaySilhouetteFraming(mask);
  if (!assay.accepted) {
    throw new Error(`unusable silhouette framing (${assay.reasons.join(', ')}): occupancy ${assay.occupancy}, border ${assay.borderForegroundFraction}`);
  }
  return assay;
}

function pgmBuffer(mask) {
  const pixels = Buffer.from(binaryData(mask).map(value => value ? 255 : 0));
  return Buffer.concat([Buffer.from(`P5\n${mask.width} ${mask.height}\n255\n`, 'ascii'), pixels]);
}

function signedDistanceBuffer(mask) {
  const sdf = createSignedDistanceField(mask);
  const buffer = Buffer.allocUnsafe(sdf.data.length * 4);
  sdf.data.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function maskPath(mask) {
  const data = binaryData(mask);
  const commands = [];
  for (let y = 0; y < mask.height; y += 1) {
    let x = 0;
    while (x < mask.width) {
      while (x < mask.width && !data[y * mask.width + x]) x += 1;
      if (x >= mask.width) break;
      const start = x;
      while (x < mask.width && data[y * mask.width + x]) x += 1;
      commands.push(`M${start} ${y}h${x - start}v1h-${x - start}z`);
    }
  }
  return commands.join('');
}

function renderContactSheet(corpus, options = {}) {
  const columns = Math.max(1, Number(options.columns || 6));
  const cellWidth = 180;
  const cellHeight = 206;
  const rows = Math.ceil(corpus.accepted.length / columns);
  const width = columns * cellWidth;
  const height = Math.max(1, rows) * cellHeight;
  const cells = corpus.accepted.map((record, index) => {
    const x = (index % columns) * cellWidth;
    const y = Math.floor(index / columns) * cellHeight;
    const maskSize = record.mask.width;
    const scale = Math.min(150 / record.mask.width, 150 / record.mask.height);
    const label = record.sourceProvenance.characterName || record.sourceId;
    return `<g transform="translate(${x} ${y})" data-source-id="${xml(record.sourceId)}" data-shape-id="${xml(record.shapeId)}">
      <rect width="${cellWidth - 2}" height="${cellHeight - 2}" fill="#0b0d0c" stroke="#313833"/>
      <g transform="translate(15 14) scale(${scale})"><path d="${maskPath(record.mask)}" fill="#e9efde"/></g>
      <text x="10" y="176" fill="#f1d06a" font-family="Menlo, monospace" font-size="11">${xml(label)}</text>
      <text x="10" y="192" fill="#8f9b92" font-family="Menlo, monospace" font-size="9">${xml(record.sourceId)} · ${maskSize}px</text>
    </g>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-route="${LIRM_SILHOUETTE_ARCHETYPE_ROUTE}" data-evidence="derived-silhouette-contact-sheet">
  <rect width="100%" height="100%" fill="#050706"/>
  ${cells}
</svg>`;
}

function rasterizeSvg(svgPath, pngPath) {
  const result = spawnSync('sips', ['-s', 'format', 'png', svgPath, '--out', pngPath], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`sips failed: ${(result.stderr || result.stdout || '').trim()}`);
}

async function writeReceipt(outDir, receipt) {
  await writeFile(join(outDir, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
}

export async function writeSilhouetteArchetypeCorpusWitness(options = {}) {
  const outDir = options.outDir;
  if (!outDir) throw new Error('writeSilhouetteArchetypeCorpusWitness requires outDir');
  await mkdir(outDir, { recursive: true });
  const requestedRoute = LIRM_SILHOUETTE_ARCHETYPE_ROUTE;
  const manifestUsesDeclaredExtraction = options.manifest?.sources?.some(source => source.maskExtraction);
  const extractionRoute = options.extractionRoute || (options.decodeMask
    ? 'injected-contract-decoder'
    : manifestUsesDeclaredExtraction ? 'manifest-declared-raster-mask-ffmpeg-v0' : 'png-alpha-ffmpeg-v0');
  const initialized = {
    schema: LIRM_SILHOUETTE_ARCHETYPE_CORPUS_SCHEMA,
    route: requestedRoute,
    status: 'running',
    phase: 'writer_initialized',
    lastTrustworthyEvidence: 'writer_initialized',
    routeIdentity: { requestedRoute, effectiveRoute: requestedRoute, extractionRoute },
  };
  await writeReceipt(outDir, initialized);

  try {
    validateManifest(options.manifest);
  } catch (error) {
    const failed = {
      ...initialized,
      status: 'failed',
      failurePhase: 'validate_manifest',
      error: error.message,
    };
    await writeReceipt(outDir, failed);
    throw error;
  }

  const fetchSource = options.fetchSource || defaultFetchSource;
  const decodeMask = options.decodeMask || decodeAlphaMaskWithFfmpeg;
  const samples = [];
  const failures = [];
  const acquisition = [];
  for (const source of options.manifest.sources) {
    const sourceId = source?.sourceId || 'unknown-source';
    try {
      validateManifestSource(source);
    } catch (error) {
      failures.push({ sourceId, phase: 'validate_source', lastTrustworthyEvidence: 'manifest_validated', error: error.message });
      continue;
    }
    let download;
    try {
      download = await fetchSource(source);
      if (!download?.bytes?.length) throw new Error('source fetch returned no bytes');
    } catch (error) {
      failures.push({ sourceId, phase: 'fetch_source', lastTrustworthyEvidence: 'manifest_source_validated', error: error.message });
      continue;
    }
    const contentHash = `sha256:${createHash('sha256').update(download.bytes).digest('hex')}`;
    if (source.expectedContentHash && source.expectedContentHash !== contentHash) {
      failures.push({ sourceId, phase: 'verify_content_hash', lastTrustworthyEvidence: 'source_bytes_fetched', error: `expected ${source.expectedContentHash}, got ${contentHash}` });
      continue;
    }
    try {
      const mask = await decodeMask(download, source);
      const framingAssay = assertUsefulOccupancy(mask);
      // Canonicalize before retention so corpus memory scales with the requested
      // training resolution rather than the source artwork resolution.
      const retainedMask = canonicalizeSilhouetteMask(mask, {
        targetSize: Math.max(8, Number(options.targetSize || 128)),
        padding: Number(options.padding ?? 6),
      });
      samples.push({ source: { ...source, contentHash }, mask: retainedMask });
      acquisition.push({
        sourceId,
        contentHash,
        contentType: download.contentType || 'unknown',
        requestedUrl: source.sourceUrl,
        effectiveUrl: download.effectiveUrl || source.sourceUrl,
        cacheStatus: download.cacheStatus || 'unknown',
        extractionRoute,
        sourceWidth: mask.width,
        sourceHeight: mask.height,
        foregroundOccupancy: framingAssay.occupancy,
        borderForegroundFraction: framingAssay.borderForegroundFraction,
        maskExtraction: mask.extraction || { kind: 'alpha-threshold-v0', threshold: 16 },
      });
    } catch (error) {
      failures.push({ sourceId, phase: 'decode_mask', lastTrustworthyEvidence: 'source_bytes_verified', error: error.message });
    }
  }

  const corpus = samples.length > 0
    ? createSilhouetteArchetypeCorpus(samples, options)
    : {
        schema: LIRM_SILHOUETTE_ARCHETYPE_CORPUS_SCHEMA,
        route: requestedRoute,
        status: 'failed',
        requestedSourceCount: options.manifest.sources.length,
        acceptedSourceCount: 0,
        uniqueSourceContentCount: 0,
        uniqueDerivedShapeCount: 0,
        accepted: [],
        failures: [],
        shapeGroups: [],
      };
  failures.push(...corpus.failures);

  const maskDir = join(outDir, 'masks');
  const distanceDir = join(outDir, 'distance-fields');
  await mkdir(maskDir, { recursive: true });
  await mkdir(distanceDir, { recursive: true });
  const indexRows = [];
  for (const record of corpus.accepted) {
    const safeId = record.sourceId.replace(/[^a-zA-Z0-9._-]+/g, '-');
    const maskPathname = `masks/${safeId}.pgm`;
    const distancePathname = `distance-fields/${safeId}.f32`;
    await writeFile(join(outDir, maskPathname), pgmBuffer(record.mask));
    await writeFile(join(outDir, distancePathname), signedDistanceBuffer(record.mask));
    indexRows.push({
      schema: LIRM_SILHOUETTE_TRAINABLE_SAMPLE_SCHEMA,
      shapeId: record.shapeId,
      mask: { path: maskPathname, width: record.mask.width, height: record.mask.height, format: 'pgm-p5-u8' },
      signedDistance: { path: distancePathname, width: record.mask.width, height: record.mask.height, format: 'float32-le' },
      topology: record.topology,
    });
  }
  await writeFile(join(outDir, 'training-index.jsonl'), indexRows.map(row => JSON.stringify(row)).join('\n') + (indexRows.length ? '\n' : ''));
  const contactSheetSvg = renderContactSheet(corpus, options);
  await writeFile(join(outDir, 'contact-sheet.svg'), contactSheetSvg);
  let contactSheetRaster = null;
  try {
    rasterizeSvg(join(outDir, 'contact-sheet.svg'), join(outDir, 'contact-sheet.png'));
    contactSheetRaster = 'contact-sheet.png';
  } catch (error) {
    failures.push({ sourceId: null, phase: 'rasterize_contact_sheet', lastTrustworthyEvidence: 'contact_sheet_svg_written', error: error.message });
  }

  const status = corpus.accepted.length === 0 ? 'failed' : failures.length > 0 ? 'partial' : 'complete';
  const receipt = {
    schema: LIRM_SILHOUETTE_ARCHETYPE_CORPUS_SCHEMA,
    route: requestedRoute,
    status,
    phase: 'witness_written',
    requestedSourceCount: options.manifest.sources.length,
    acceptedSourceCount: corpus.accepted.length,
    failedSourceCount: failures.length,
    uniqueSourceContentCount: corpus.uniqueSourceContentCount,
    uniqueDerivedShapeCount: corpus.uniqueDerivedShapeCount,
    routeIdentity: { requestedRoute, effectiveRoute: requestedRoute, extractionRoute },
    acquisition,
    failures,
    shapeGroups: corpus.shapeGroups,
    provenance: corpus.accepted.map(record => ({
      sourceId: record.sourceId,
      shapeId: record.shapeId,
      sourceContentHash: record.sourceContentHash,
      source: record.sourceProvenance,
    })),
    falseClosureGuards: {
      blankOrOpaqueRectangle: 'rejected',
      sourceBytesCommitted: 'false',
      retainedMaskResolution: `${Math.max(8, Number(options.targetSize || 128))}x${Math.max(8, Number(options.targetSize || 128))}`,
      identityInTrainingInput: 'forbidden',
      noveltyClaim: 'requires_nearest_shape_assay',
      generatorTrainingClaim: 'not_yet_trained',
    },
    outputInventory: {
      receipt: 'receipt.json',
      trainingIndex: 'training-index.jsonl',
      masks: indexRows.map(row => row.mask.path),
      signedDistanceFields: indexRows.map(row => row.signedDistance.path),
      contactSheet: 'contact-sheet.svg',
      contactSheetRaster,
      sourceBytes: null,
    },
  };
  await writeReceipt(outDir, receipt);
  return receipt;
}
function binaryData(mask) {
  assertMask(mask);
  return Array.from(mask.data, value => Number(value) >= 0.5 ? 1 : 0);
}

function maskBounds(mask) {
  const data = binaryData(mask);
  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (!data[y * mask.width + x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new Error('mask contains no foreground pixels');
  return { data, minX, minY, maxX, maxY };
}

function hashMask(mask) {
  const hash = createHash('sha256');
  hash.update(`${mask.width}x${mask.height}:`);
  hash.update(Buffer.from(mask.data));
  return `sha256:${hash.digest('hex')}`;
}

export function canonicalizeSilhouetteMask(mask, options = {}) {
  const targetSize = Math.max(8, Number(options.targetSize || 128));
  const padding = Math.max(1, Math.min(Math.floor(targetSize / 4), Number(options.padding ?? 6)));
  const bounds = maskBounds(mask);
  const sourceWidth = bounds.maxX - bounds.minX + 1;
  const sourceHeight = bounds.maxY - bounds.minY + 1;
  const available = targetSize - padding * 2;
  const scale = Math.min(available / sourceWidth, available / sourceHeight);
  const renderedWidth = Math.max(1, Math.round(sourceWidth * scale));
  const renderedHeight = Math.max(1, Math.round(sourceHeight * scale));
  const offsetX = Math.floor((targetSize - renderedWidth) / 2);
  const offsetY = Math.floor((targetSize - renderedHeight) / 2);
  const data = Array(targetSize * targetSize).fill(0);

  for (let y = 0; y < renderedHeight; y += 1) {
    const sourceY = bounds.minY + Math.min(sourceHeight - 1, Math.floor(((y + 0.5) * sourceHeight) / renderedHeight));
    for (let x = 0; x < renderedWidth; x += 1) {
      const sourceX = bounds.minX + Math.min(sourceWidth - 1, Math.floor(((x + 0.5) * sourceWidth) / renderedWidth));
      data[(offsetY + y) * targetSize + offsetX + x] = bounds.data[sourceY * mask.width + sourceX];
    }
  }

  return {
    width: targetSize,
    height: targetSize,
    data,
    framing: {
      kind: 'tight-bounds-aspect-preserving-v0',
      padding,
      sourceBounds: { x: bounds.minX, y: bounds.minY, width: sourceWidth, height: sourceHeight },
      renderedBounds: { x: offsetX, y: offsetY, width: renderedWidth, height: renderedHeight },
    },
  };
}

function countComponents(mask, targetValue) {
  const data = binaryData(mask);
  const visited = new Uint8Array(data.length);
  let components = 0;
  let enclosed = 0;
  const queueX = new Int32Array(data.length);
  const queueY = new Int32Array(data.length);
  for (let y0 = 0; y0 < mask.height; y0 += 1) {
    for (let x0 = 0; x0 < mask.width; x0 += 1) {
      const start = y0 * mask.width + x0;
      if (visited[start] || data[start] !== targetValue) continue;
      components += 1;
      let head = 0;
      let tail = 0;
      let touchesBorder = false;
      queueX[tail] = x0;
      queueY[tail] = y0;
      tail += 1;
      visited[start] = 1;
      while (head < tail) {
        const x = queueX[head];
        const y = queueY[head];
        head += 1;
        if (x === 0 || y === 0 || x === mask.width - 1 || y === mask.height - 1) touchesBorder = true;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= mask.width || ny >= mask.height) continue;
          const next = ny * mask.width + nx;
          if (visited[next] || data[next] !== targetValue) continue;
          visited[next] = 1;
          queueX[tail] = nx;
          queueY[tail] = ny;
          tail += 1;
        }
      }
      if (!touchesBorder) enclosed += 1;
    }
  }
  return { components, enclosed };
}

export function measureSilhouetteTopology(mask) {
  return {
    foregroundComponents: countComponents(mask, 1).components,
    holes: countComponents(mask, 0).enclosed,
  };
}

function edt1d(values) {
  const n = values.length;
  const finiteIndexes = [];
  for (let i = 0; i < n; i += 1) if (Number.isFinite(values[i])) finiteIndexes.push(i);
  if (finiteIndexes.length === 0) return Array(n).fill(Infinity);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const distances = new Float64Array(n);
  let k = 0;
  v[0] = finiteIndexes[0];
  z[0] = -Infinity;
  z[1] = Infinity;
  for (const q of finiteIndexes.slice(1)) {
    let s = ((values[q] + q * q) - (values[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k] && k > 0) {
      k -= 1;
      s = ((values[q] + q * q) - (values[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) k += 1;
    const delta = q - v[k];
    distances[q] = delta * delta + values[v[k]];
  }
  return Array.from(distances);
}

function squaredDistanceToValue(mask, targetValue) {
  const data = binaryData(mask);
  const vertical = Array(mask.width * mask.height).fill(Infinity);
  for (let x = 0; x < mask.width; x += 1) {
    const column = Array(mask.height);
    for (let y = 0; y < mask.height; y += 1) column[y] = data[y * mask.width + x] === targetValue ? 0 : Infinity;
    const transformed = edt1d(column);
    for (let y = 0; y < mask.height; y += 1) vertical[y * mask.width + x] = transformed[y];
  }
  const output = Array(mask.width * mask.height).fill(Infinity);
  for (let y = 0; y < mask.height; y += 1) {
    const row = edt1d(vertical.slice(y * mask.width, (y + 1) * mask.width));
    for (let x = 0; x < mask.width; x += 1) output[y * mask.width + x] = row[x];
  }
  return output;
}

export function createSignedDistanceField(mask) {
  const data = binaryData(mask);
  const toForeground = squaredDistanceToValue(mask, 1);
  const toBackground = squaredDistanceToValue(mask, 0);
  return {
    width: mask.width,
    height: mask.height,
    data: data.map((inside, index) => inside ? Math.sqrt(toBackground[index]) : -Math.sqrt(toForeground[index])),
  };
}

function mirrorX(mask) {
  const data = binaryData(mask);
  const mirrored = Array(data.length).fill(0);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) mirrored[y * mask.width + (mask.width - 1 - x)] = data[y * mask.width + x];
  }
  return { width: mask.width, height: mask.height, data: mirrored };
}

function maskIou(a, b) {
  assertMask(a);
  assertMask(b);
  if (a.width !== b.width || a.height !== b.height) throw new Error('IoU masks must share dimensions');
  const ad = binaryData(a);
  const bd = binaryData(b);
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < ad.length; i += 1) {
    if (ad[i] || bd[i]) union += 1;
    if (ad[i] && bd[i]) intersection += 1;
  }
  return union === 0 ? 1 : intersection / union;
}

export function assaySilhouetteNovelty(candidate, trainingMasks, options = {}) {
  assertMask(candidate);
  const copyThreshold = Number(options.copyThreshold ?? 0.96);
  const includeMirror = options.includeMirror !== false;
  const canonicalCandidate = canonicalizeSilhouetteMask(candidate, { targetSize: candidate.width, padding: options.padding ?? 2 });
  let nearest = { index: -1, similarity: 0, transform: 'direct' };
  trainingMasks.forEach((trainingMask, index) => {
    const canonicalTraining = canonicalizeSilhouetteMask(trainingMask, { targetSize: candidate.width, padding: options.padding ?? 2 });
    const candidates = [{ transform: 'direct', mask: canonicalTraining }];
    if (includeMirror) candidates.push({ transform: 'mirror_x', mask: mirrorX(canonicalTraining) });
    for (const transformed of candidates) {
      const similarity = maskIou(canonicalCandidate, transformed.mask);
      if (similarity > nearest.similarity) nearest = { index, similarity, transform: transformed.transform };
    }
  });
  return {
    schema: LIRM_SILHOUETTE_NOVELTY_ASSAY_SCHEMA,
    metric: 'canonical-mask-iou',
    copyThreshold,
    includeMirror,
    copied: nearest.similarity >= copyThreshold,
    nearest: { ...nearest, similarity: Number(nearest.similarity.toFixed(6)) },
  };
}

export function interpolateSilhouetteMasks(a, b, amount = 0.5, options = {}) {
  const t = Math.max(0, Math.min(1, Number(amount)));
  const targetSize = Math.max(8, Number(options.targetSize || 128));
  const padding = Number(options.padding ?? 6);
  const ca = canonicalizeSilhouetteMask(a, { targetSize, padding });
  const cb = canonicalizeSilhouetteMask(b, { targetSize, padding });
  const sa = createSignedDistanceField(ca);
  const sb = createSignedDistanceField(cb);
  return {
    width: targetSize,
    height: targetSize,
    data: sa.data.map((value, index) => value * (1 - t) + sb.data[index] * t >= 0 ? 1 : 0),
    interpolation: { kind: 'signed-distance-linear-v0', amount: t },
  };
}

function validateSource(source) {
  const required = ['sourceId', 'provider', 'sourceUrl', 'sourcePageUrl', 'retrievedAt', 'contentHash'];
  for (const field of required) {
    if (!source || typeof source[field] !== 'string' || source[field].trim() === '') {
      throw new Error(`source.${field} is required`);
    }
  }
}

export function toTrainableSilhouetteSample(record) {
  if (!record || record.schema !== LIRM_SILHOUETTE_ARCHETYPE_RECORD_SCHEMA) {
    throw new Error('trainable conversion requires a validated silhouette archetype record');
  }
  return {
    schema: LIRM_SILHOUETTE_TRAINABLE_SAMPLE_SCHEMA,
    shapeId: record.shapeId,
    mask: { width: record.mask.width, height: record.mask.height, data: [...record.mask.data] },
    signedDistance: createSignedDistanceField(record.mask),
    topology: record.topology,
  };
}

export function createSilhouetteArchetypeCorpus(samples, options = {}) {
  const targetSize = Math.max(8, Number(options.targetSize || 128));
  const padding = Number(options.padding ?? 6);
  const accepted = [];
  const failures = [];
  for (const sample of samples) {
    const sourceId = sample?.source?.sourceId || 'unknown-source';
    try {
      validateSource(sample?.source);
    } catch (error) {
      failures.push({ sourceId, phase: 'validate_source', lastTrustworthyEvidence: 'none', error: error.message });
      continue;
    }
    try {
      const mask = canonicalizeSilhouetteMask(sample.mask, { targetSize, padding });
      const shapeId = hashMask(mask);
      accepted.push({
        schema: LIRM_SILHOUETTE_ARCHETYPE_RECORD_SCHEMA,
        route: LIRM_SILHOUETTE_ARCHETYPE_ROUTE,
        sourceId,
        sourceContentHash: sample.source.contentHash,
        shapeId,
        sourceProvenance: { ...sample.source },
        mask,
        topology: measureSilhouetteTopology(mask),
      });
    } catch (error) {
      failures.push({ sourceId, phase: 'canonicalize_mask', lastTrustworthyEvidence: 'source_validated', error: error.message });
    }
  }

  const groups = new Map();
  for (const record of accepted) {
    const group = groups.get(record.shapeId) || { shapeId: record.shapeId, sourceIds: [], sourceContentHashes: [] };
    group.sourceIds.push(record.sourceId);
    if (!group.sourceContentHashes.includes(record.sourceContentHash)) group.sourceContentHashes.push(record.sourceContentHash);
    groups.set(record.shapeId, group);
  }
  return {
    schema: LIRM_SILHOUETTE_ARCHETYPE_CORPUS_SCHEMA,
    route: LIRM_SILHOUETTE_ARCHETYPE_ROUTE,
    status: failures.length === 0 ? 'complete' : accepted.length === 0 ? 'failed' : 'partial',
    requestedSourceCount: samples.length,
    acceptedSourceCount: accepted.length,
    failedSourceCount: failures.length,
    uniqueSourceContentCount: new Set(accepted.map(record => record.sourceContentHash)).size,
    uniqueDerivedShapeCount: groups.size,
    canonicalization: { targetSize, padding, orientationNormalization: 'none' },
    accepted,
    failures,
    shapeGroups: [...groups.values()],
    falseClosureGuards: {
      sourceFailureClaim: failures.length === 0 ? 'none' : 'durably_recorded',
      identityInTrainingInput: 'forbidden',
      noveltyClaim: 'requires_nearest_shape_assay',
      generatorTrainingClaim: 'not_yet_trained',
    },
  };
}
