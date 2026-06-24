#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { runOrbInnerEngineImageRoute } from './orb-inner-engine-concept-loop.mjs';

export const ORB_INNER_ENGINE_PROVIDER_ADAPTERS_IDENTITY = 'orb-inner-engine-provider-adapters-v0';

const MODULE_PATH = fileURLToPath(import.meta.url);
const DEFAULT_IDEOGRAM_ROOT = '/Users/noahlyons/dev/mlx-ideogram4';
const DEFAULT_COSMOS_ROOT = '/Users/noahlyons/dev/cosmos3-mlx';
const DEFAULT_DIFFUSION_ROOTS = [
  '/Users/noahlyons/dev/llama.cpp/examples/diffusion',
  '/Users/noahlyons/dev/mflux',
];

function pathExists(path) {
  return typeof path === 'string' && path.length > 0 && existsSync(path);
}

function executablePython(root, fallback = 'python') {
  const venvPython = join(root, '.venv', 'bin', 'python');
  return existsSync(venvPython) ? venvPython : fallback;
}

function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

function numericSeed(seed) {
  return String(hashString(String(seed)) % 2147483647);
}

function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function parseArgs(argv) {
  const values = new Map();
  const dashedValueKeys = new Set(['--adapter-arg']);
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const hasValue = argv[i + 1] !== undefined && (dashedValueKeys.has(key) || !argv[i + 1].startsWith('--'));
    const value = hasValue ? argv[++i] : 'true';
    const existing = values.get(key) || [];
    existing.push(value);
    values.set(key, existing);
  }
  return {
    get(key) {
      const found = values.get(key);
      return found ? found[found.length - 1] : undefined;
    },
  };
}

function providerRecord({
  id,
  label,
  kind,
  mediaKind,
  outputExtension,
  root,
  entrypoint,
  adapter,
  pythonCommand,
  status,
  capability,
  notes,
  defaultArgs = {},
}) {
  const nativeEntrypoint = root && entrypoint ? join(root, entrypoint) : null;
  const configured = status || (nativeEntrypoint && existsSync(nativeEntrypoint) ? 'configured' : 'unconfigured');
  return {
    id,
    label,
    kind,
    mediaKind,
    outputExtension,
    root,
    nativeEntrypoint,
    adapter,
    status: configured,
    capability,
    defaultArgs,
    pythonCommand: root ? executablePython(root, pythonCommand) : pythonCommand,
    shell: false,
    notes,
  };
}

export function createOrbInnerEngineProviderRegistry({
  ideogramRoot = process.env.KAMINOS_IDEOGRAM4_ROOT || DEFAULT_IDEOGRAM_ROOT,
  cosmosRoot = process.env.KAMINOS_COSMOS3_MLX_ROOT || DEFAULT_COSMOS_ROOT,
  pythonCommand = 'python',
  diffusionRoots = DEFAULT_DIFFUSION_ROOTS,
} = {}) {
  const resolvedIdeogramRoot = ideogramRoot ? resolve(ideogramRoot) : null;
  const resolvedCosmosRoot = cosmosRoot ? resolve(cosmosRoot) : null;
  const diffusionRoot = diffusionRoots.map(path => resolve(path)).find(pathExists) || null;
  return {
    identity: ORB_INNER_ENGINE_PROVIDER_ADAPTERS_IDENTITY,
    providers: [
      providerRecord({
        id: 'local-image.ideogram4',
        label: 'Ideogram4 NF4 MLX',
        kind: 'text-to-image',
        mediaKind: 'image',
        outputExtension: 'png',
        root: resolvedIdeogramRoot,
        entrypoint: 'generate.py',
        adapter: 'ideogram4',
        pythonCommand,
        capability: ['text-to-image', 'square-core-concept-source'],
        defaultArgs: {
          timeoutMs: 900000,
        },
        notes: 'Uses local mlx-ideogram4 generate.py through the stable Kaminos adapter contract.',
      }),
      providerRecord({
        id: 'local-video.cosmos3-mlx.t2v',
        label: 'Cosmos3 MLX Text-to-Video',
        kind: 'text-to-video',
        mediaKind: 'video',
        outputExtension: 'mp4',
        root: resolvedCosmosRoot,
        entrypoint: 'txt2video.py',
        adapter: 'cosmos3-txt2video',
        pythonCommand,
        capability: ['text-to-video', 'multi-view-sequence-candidate'],
        defaultArgs: {
          frames: 8,
          steps: 4,
          size: '256x256',
          quantize: 8,
          timeoutMs: 900000,
        },
        notes: 'Cosmos3 is on-distribution for physical/world video; arbitrary creative quality remains unproven until visual smoke.',
      }),
      providerRecord({
        id: 'local-video.cosmos3-mlx.i2v',
        label: 'Cosmos3 MLX Image-to-Video',
        kind: 'image-to-video',
        mediaKind: 'video',
        outputExtension: 'mp4',
        root: resolvedCosmosRoot,
        entrypoint: 'img2video.py',
        adapter: 'cosmos3-img2video',
        pythonCommand,
        capability: ['image-to-video', 'source-view-motion-candidate', 'multi-view-conditioning-candidate'],
        defaultArgs: {
          frames: 8,
          steps: 4,
          size: '256x256',
          quantize: 8,
          timeoutMs: 900000,
        },
        notes: 'Can later turn a generated core source image into a short view/motion sequence if quality is coherent.',
      }),
      {
        id: 'local-image.diffusion-fallback',
        label: 'Local Diffusion Fallback',
        kind: 'text-to-image',
        mediaKind: 'image',
        outputExtension: 'png',
        root: diffusionRoot,
        nativeEntrypoint: null,
        adapter: 'diffusion-fallback',
        status: diffusionRoot ? 'discovered-unconfigured' : 'unconfigured',
        capability: ['text-to-image-fallback'],
        defaultArgs: {},
        pythonCommand,
        shell: false,
        notes: diffusionRoot
          ? 'A diffusion surface exists locally, but no stable Kaminos adapter contract is bound yet.'
          : 'No clean local diffusion fallback CLI was discovered.',
      },
    ],
  };
}

function providerById(registry, providerId) {
  return registry.providers.find(provider => provider.id === providerId) || null;
}

export function resolveOrbInnerEngineProviderCommand({
  registry = createOrbInnerEngineProviderRegistry(),
  providerId,
} = {}) {
  const provider = providerById(registry, providerId);
  if (!provider) {
    return {
      ok: false,
      status: 'unconfigured',
      providerId,
      failurePhase: 'provider-lookup',
      failureReason: `Unknown provider ${providerId}`,
    };
  }
  if (provider.status !== 'configured' || !provider.nativeEntrypoint || !existsSync(provider.nativeEntrypoint)) {
    return {
      ok: false,
      status: 'unconfigured',
      providerId,
      provider,
      failurePhase: 'configuration',
      failureReason: `Provider ${providerId} is not configured.`,
    };
  }
  const args = [
    MODULE_PATH,
    '--adapter', provider.adapter,
    '--provider-root', provider.root,
    '--provider-python', provider.pythonCommand || 'python',
    '--prompt', '{prompt}',
    '--negative', '{negative}',
    '--seed', '{seed}',
    '--out', '{output}',
  ];
  if (provider.defaultArgs?.frames) args.push('--frames', String(provider.defaultArgs.frames));
  if (provider.defaultArgs?.steps) args.push('--steps', String(provider.defaultArgs.steps));
  if (provider.defaultArgs?.size) args.push('--size', provider.defaultArgs.size);
  if (provider.defaultArgs?.quantize) args.push('--quantize', String(provider.defaultArgs.quantize));

  return {
    ok: true,
    status: 'configured',
    providerId,
    provider,
    mediaKind: provider.mediaKind,
    outputExtension: provider.outputExtension,
    command: process.execPath,
    args,
    cwd: provider.root,
    timeoutMs: provider.defaultArgs?.timeoutMs || 120000,
    shell: false,
  };
}

function providerRecordsFile(providerId) {
  return `provider-route-${providerId.replaceAll('.', '-')}.json`;
}

export function runOrbInnerEngineProviderRoute({
  bundleRoot,
  registry = createOrbInnerEngineProviderRegistry(),
  providerId = 'local-image.ideogram4',
  timeoutMs = null,
} = {}) {
  const resolved = resolveOrbInnerEngineProviderCommand({ registry, providerId });
  const provider = resolved.provider || providerById(registry, providerId) || {
    id: providerId,
    mediaKind: 'image',
    outputExtension: 'png',
  };
  const recordsFileName = providerRecordsFile(providerId);
  if (!resolved.ok) {
    const run = runOrbInnerEngineImageRoute({
      bundleRoot,
      route: providerId,
      recordsFileName,
      recordIdentity: 'orb-inner-engine-provider-route-records-v0',
      mediaKind: provider.mediaKind || 'image',
      outputExtension: provider.outputExtension || 'png',
    });
    const rewritten = rewriteProviderRecordEnvelope(run.imageRouteRecordsPath, {
      providerId,
      provider,
      mediaKind: provider.mediaKind || 'image',
      outputExtension: provider.outputExtension || 'png',
    });
    return {
      ok: false,
      status: rewritten.status,
      providerId,
      recordsPath: run.imageRouteRecordsPath,
      failurePhase: resolved.failurePhase,
      failureReason: resolved.failureReason,
    };
  }
  const run = runOrbInnerEngineImageRoute({
    bundleRoot,
    route: providerId,
    command: resolved.command,
    args: resolved.args,
    cwd: resolved.cwd,
    timeoutMs: timeoutMs || resolved.timeoutMs || 120000,
    recordsFileName,
    recordIdentity: 'orb-inner-engine-provider-route-records-v0',
    mediaKind: resolved.mediaKind,
    outputExtension: resolved.outputExtension,
  });
  const rewritten = rewriteProviderRecordEnvelope(run.imageRouteRecordsPath, {
    providerId,
    provider,
    mediaKind: resolved.mediaKind,
    outputExtension: resolved.outputExtension,
  });
  return {
    ok: rewritten.ok,
    status: rewritten.status,
    providerId,
    recordsPath: run.imageRouteRecordsPath,
  };
}

function rewriteProviderRecordEnvelope(recordsPath, { providerId, provider, mediaKind, outputExtension }) {
  const data = JSON.parse(readFileSync(recordsPath, 'utf8'));
  data.providerId = providerId;
  data.provider = provider;
  data.mediaKind = mediaKind;
  data.outputExtension = outputExtension;
  data.identity = 'orb-inner-engine-provider-route-records-v0';
  data.records = data.records.map(record => {
    const providerReceiptPath = record.outputImagePath
      ? `${record.outputImagePath}.provider-receipt.json`
      : null;
    const blocked = mediaKind === 'image' && record.status === 'complete'
      ? detectProviderBlockedImage(record.outputImagePath)
      : { blocked: false };
    const failedRecord = blocked.blocked
      ? {
          status: 'failed',
          failurePhase: 'provider-blocked-output',
          failureReason: blocked.reason,
          providerBlockDetection: blocked,
        }
      : {};
    return {
      ...record,
      ...failedRecord,
      providerId,
      mediaKind,
      outputExtension,
      providerReceiptPath: providerReceiptPath && existsSync(providerReceiptPath) ? providerReceiptPath : providerReceiptPath,
    };
  });
  const complete = data.records.every(record => record.status === 'complete');
  const unconfigured = data.records.every(record => record.status === 'unconfigured');
  data.ok = complete;
  data.status = complete ? 'complete' : (unconfigured ? 'unconfigured' : 'failed');
  writeFileSync(recordsPath, `${JSON.stringify(data, null, 2)}\n`);
  return data;
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePngRgba(path) {
  const png = readFileSync(path);
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('not a PNG');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
        throw new Error(`unsupported PNG format bitDepth=${bitDepth} colorType=${colorType}`);
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8ClampedArray(width * height * 4);
  const prev = Buffer.alloc(stride);
  const row = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const sourceStart = y * (stride + 1);
    const filter = raw[sourceStart];
    raw.copy(row, 0, sourceStart + 1, sourceStart + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev[x] || 0;
      const upLeft = x >= channels ? prev[x - channels] : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) row[x] = (row[x] + paethPredictor(left, up, upLeft)) & 255;
      else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
    }
    for (let x = 0; x < width; x++) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      out[dst] = row[src];
      out[dst + 1] = row[src + 1];
      out[dst + 2] = row[src + 2];
      out[dst + 3] = channels === 4 ? row[src + 3] : 255;
    }
    row.copy(prev);
  }
  return { width, height, rgba: out };
}

export function detectProviderBlockedImage(path) {
  try {
    const image = decodePngRgba(path);
    let black = 0;
    let white = 0;
    let centerWhite = 0;
    let saturatedNonWhiteColor = 0;
    const total = image.width * image.height;
    const y0 = image.height * 0.32;
    const y1 = image.height * 0.68;
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const i = (y * image.width + x) * 4;
        const r = image.rgba[i];
        const g = image.rgba[i + 1];
        const b = image.rgba[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max < 18) black++;
        if (min > 215) {
          white++;
          if (y >= y0 && y <= y1) centerWhite++;
        } else if (max > 80 && max - min > 35) {
          saturatedNonWhiteColor++;
        }
      }
    }
    const blackRatio = black / total;
    const whiteRatio = white / total;
    const centerWhiteRatio = centerWhite / Math.max(1, white);
    const colorRatio = saturatedNonWhiteColor / total;
    const blocked = blackRatio > 0.82
      && whiteRatio > 0.002
      && whiteRatio < 0.16
      && centerWhiteRatio > 0.68
      && colorRatio < 0.08;
    return {
      blocked,
      reason: blocked ? 'provider output resembles a black safety-filter/block card, not usable generated art' : null,
      metrics: {
        width: image.width,
        height: image.height,
        blackRatio,
        whiteRatio,
        centerWhiteRatio,
        colorRatio,
      },
    };
  } catch (error) {
    return {
      blocked: false,
      reason: null,
      metrics: null,
      probeError: error.message,
    };
  }
}

function combinedPrompt(prompt, negative) {
  const cleanPrompt = String(prompt || '').trim();
  const cleanNegative = String(negative || '').trim();
  return cleanNegative ? `${cleanPrompt}\nAvoid: ${cleanNegative}` : cleanPrompt;
}

function runNative(command, argv, cwd) {
  return spawnSync(command, argv, {
    cwd,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 1024 * 1024 * 8,
  });
}

function ensureOutput(path) {
  if (!existsSync(path) || statSync(path).size <= 0) {
    throw new Error(`provider adapter did not create output: ${path}`);
  }
}

function writeAdapterReceipt(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function runIdeogramAdapter(args) {
  const providerRoot = resolve(args.get('--provider-root'));
  const out = resolve(args.get('--out'));
  const receipt = `${out}.provider-receipt.json`;
  const seed = numericSeed(args.get('--seed') || '0');
  const prompt = combinedPrompt(args.get('--prompt'), args.get('--negative'));
  const nativeArgv = [
    join(providerRoot, 'generate.py'),
    '--prompt', prompt,
    '--output', out,
    '--seed', seed,
    '--receipt', receipt,
    '--preset', args.get('--preset') || 'V4_TURBO_12',
  ];
  const providerPython = args.get('--provider-python') || executablePython(providerRoot);
  const spawned = runNative(providerPython, nativeArgv, providerRoot);
  if (spawned.status !== 0 || spawned.error) {
    writeAdapterReceipt(receipt, {
      ok: false,
      adapter: 'ideogram4',
      providerRoot,
      nativeEntrypoint: nativeArgv[0],
      seed,
      promptSha256: sha256Text(prompt),
      output: out,
      stdout: spawned.stdout || '',
      stderr: spawned.stderr || '',
      exitCode: spawned.status ?? null,
      error: spawned.error?.message || null,
    });
    process.stderr.write(spawned.stderr || spawned.error?.message || 'ideogram adapter failed');
    process.exit(spawned.status || 1);
  }
  ensureOutput(out);
  if (!existsSync(receipt)) {
    writeAdapterReceipt(receipt, {
      ok: true,
      adapter: 'ideogram4',
      providerRoot,
      nativeEntrypoint: nativeArgv[0],
      seed,
      promptSha256: sha256Text(prompt),
      output: out,
      stdout: spawned.stdout || '',
      stderr: spawned.stderr || '',
      exitCode: spawned.status ?? null,
    });
  }
  process.stdout.write(JSON.stringify({ ok: true, adapter: 'ideogram4', output: out, receipt }) + '\n');
}

function runCosmosAdapter(args, mode) {
  const providerRoot = resolve(args.get('--provider-root'));
  const out = resolve(args.get('--out'));
  const receipt = `${out}.provider-receipt.json`;
  const seed = numericSeed(args.get('--seed') || '0');
  const prompt = String(args.get('--prompt') || '').trim();
  const negative = String(args.get('--negative') || '').trim();
  const entrypoint = mode === 'i2v' ? 'img2video.py' : 'txt2video.py';
  const nativeArgv = [
    join(providerRoot, entrypoint),
    '--output', out,
    '--seed', seed,
    '--frames', args.get('--frames') || '8',
    '--steps', args.get('--steps') || '4',
    '--size', args.get('--size') || '256x256',
    '--quantize', args.get('--quantize') || '8',
  ];
  if (negative) nativeArgv.push('--n-prompt', negative);
  nativeArgv.push(prompt);
  if (mode === 'i2v') {
    const image = args.get('--image');
    if (!image) {
      writeAdapterReceipt(receipt, {
        ok: false,
        adapter: 'cosmos3-img2video',
        failurePhase: 'configuration',
        failureReason: 'Cosmos image-to-video adapter requires --image.',
        output: out,
      });
      process.stderr.write('Cosmos image-to-video adapter requires --image\n');
      process.exit(2);
    }
    nativeArgv.splice(2, 0, '--image', image);
  }
  const providerPython = args.get('--provider-python') || executablePython(providerRoot);
  const spawned = runNative(providerPython, nativeArgv, providerRoot);
  if (spawned.status !== 0 || spawned.error) {
    writeAdapterReceipt(receipt, {
      ok: false,
      adapter: mode === 'i2v' ? 'cosmos3-img2video' : 'cosmos3-txt2video',
      providerRoot,
      nativeEntrypoint: nativeArgv[0],
      seed,
      promptSha256: sha256Text(prompt),
      output: out,
      stdout: spawned.stdout || '',
      stderr: spawned.stderr || '',
      exitCode: spawned.status ?? null,
      error: spawned.error?.message || null,
    });
    process.stderr.write(spawned.stderr || spawned.error?.message || 'cosmos adapter failed');
    process.exit(spawned.status || 1);
  }
  ensureOutput(out);
  if (!existsSync(receipt)) {
    writeAdapterReceipt(receipt, {
      ok: true,
      adapter: mode === 'i2v' ? 'cosmos3-img2video' : 'cosmos3-txt2video',
      providerRoot,
      nativeEntrypoint: nativeArgv[0],
      seed,
      promptSha256: sha256Text(prompt),
      output: out,
      stdout: spawned.stdout || '',
      stderr: spawned.stderr || '',
      exitCode: spawned.status ?? null,
    });
  }
  process.stdout.write(JSON.stringify({ ok: true, adapter: mode === 'i2v' ? 'cosmos3-img2video' : 'cosmos3-txt2video', output: out, receipt }) + '\n');
}

const invokedAsScript = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href;
if (invokedAsScript) {
  const args = parseArgs(process.argv);
  const adapter = args.get('--adapter');
  if (adapter === 'ideogram4') {
    runIdeogramAdapter(args);
  } else if (adapter === 'cosmos3-txt2video') {
    runCosmosAdapter(args, 't2v');
  } else if (adapter === 'cosmos3-img2video') {
    runCosmosAdapter(args, 'i2v');
  } else {
    process.stderr.write(`Unknown provider adapter: ${adapter}\n`);
    process.exit(2);
  }
}
