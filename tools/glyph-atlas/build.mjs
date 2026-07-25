#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';

import {
  BUILD_REPORT_SCHEMA,
  FONTCONFIG_FORMAT,
  REQUIRED_TEXT,
  SOURCE_SCHEMA,
  buildAtlasModel,
  parseFontconfigRows,
  renderAtlasHtml,
  sha256,
} from './core.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith('--')) throw new Error(`unexpected positional argument: ${key}`);
  args.set(key, process.argv[++index]);
}

const configPath = resolve(args.get('--config') || new URL('./sources.json', import.meta.url).pathname);
const outputRoot = resolve(args.get('--out') || 'scratch/glyph-atlas');
const reportPath = resolve(args.get('--report') || join(outputRoot, 'build-report.json'));
const markerPath = join(outputRoot, '.kaminos-glyph-atlas-output');
let phase = 'argument-validation';
let primaryOutputWritten = false;
let requestedSources = [];
let effectiveSources = [];
let configIdentity = null;

function command(binary, commandArgs) {
  const result = spawnSync(binary, commandArgs, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw new Error(`${binary} launch failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${binary} failed (${result.status}): ${result.stderr.trim() || result.stdout.trim()}`);
  return result.stdout;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function prepareOutput() {
  if (await exists(outputRoot)) {
    if (!(await exists(markerPath))) {
      const entries = await readdir(outputRoot);
      if (entries.length) throw new Error(`refusing to replace unmarked output directory: ${outputRoot}`);
    } else {
      await rm(outputRoot, { recursive: true, force: true });
    }
  }
  await mkdir(join(outputRoot, 'fonts'), { recursive: true });
  await writeFile(markerPath, 'kaminos.glyph-atlas.output.v0\n');
}

function resolveSource(source, base) {
  return {
    ...source,
    root: source.root ? resolve(base, source.root.replace(/^~(?=\/)/, process.env.HOME || '~')) : null,
  };
}

function inspectSource(source) {
  const pattern = source.pattern || `:charset=${[...new Set([...REQUIRED_TEXT])].map(character => character.codePointAt(0).toString(16).padStart(4, '0')).join(' ')}`;
  if (source.kind === 'fontconfig') {
    return parseFontconfigRows(command('fc-list', [pattern, '--format', FONTCONFIG_FORMAT]), source);
  }
  if (source.kind === 'directory') {
    const rows = parseFontconfigRows(command('fc-scan', ['--format', FONTCONFIG_FORMAT, source.root]), source);
    return rows.filter(face => face.requiredTextCoverage !== false);
  }
  throw new Error(`unsupported source kind ${source.kind} for ${source.id}`);
}

async function linkFontAssets(faces) {
  const assets = new Map();
  for (const face of faces) {
    if (!assets.has(face.file)) {
      const extension = basename(face.file).includes('.') ? `.${basename(face.file).split('.').pop()}` : '';
      const assetName = `${sha256(face.file).slice(0, 16)}${extension.toLowerCase()}`;
      const assetPath = join(outputRoot, 'fonts', assetName);
      try {
        const current = await readlink(assetPath);
        if (current !== face.file) await rm(assetPath);
      } catch {
        await symlink(face.file, assetPath);
      }
      assets.set(face.file, `fonts/${assetName}`);
    }
    face.assetHref = assets.get(face.file);
  }
}

async function writeReport(body) {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({
    schema: BUILD_REPORT_SCHEMA,
    ...body,
  }, null, 2)}\n`);
}

try {
  phase = 'config-load';
  const configBytes = await readFile(configPath);
  configIdentity = sha256(configBytes);
  const config = JSON.parse(configBytes);
  if (config.schema !== SOURCE_SCHEMA) throw new Error(`unsupported source schema: ${config.schema}`);
  if (!Array.isArray(config.sources) || !config.sources.length) throw new Error('source config must name at least one source');
  const configBase = dirname(configPath);
  const sources = config.sources.map(source => resolveSource(source, configBase));
  requestedSources = sources.map(source => source.id);

  phase = 'source-discovery';
  const faces = [];
  const warnings = [];
  for (const source of sources) {
    if (!source.id) throw new Error('source without id');
    if (source.kind === 'directory' && !(await exists(source.root))) {
      effectiveSources.push({ id: source.id, kind: source.kind, root: source.root, status: 'missing', faceCount: 0 });
      if (source.required) throw new Error(`required source ${source.id} is missing: ${source.root}`);
      warnings.push(`optional source ${source.id} is missing: ${source.root}`);
      continue;
    }
    const sourceFaces = inspectSource(source);
    if (source.required && !sourceFaces.length) throw new Error(`required source ${source.id} produced no ${REQUIRED_TEXT}-capable faces`);
    faces.push(...sourceFaces);
    effectiveSources.push({
      id: source.id,
      kind: source.kind,
      root: source.root,
      url: source.url || null,
      ref: source.ref || null,
      status: 'loaded',
      faceCount: sourceFaces.length,
    });
  }
  if (!faces.length) throw new Error('all effective sources produced zero usable faces');

  phase = 'output-preparation';
  await prepareOutput();
  phase = 'asset-link';
  await linkFontAssets(faces);
  const model = buildAtlasModel({
    configIdentity,
    requestedSources,
    effectiveSources,
    faces,
    warnings,
    diagnosticThreshold: config.mohelIndicatorThreshold || 1000,
  });

  phase = 'artifact-write';
  const manifestPath = join(outputRoot, 'manifest.json');
  const indexPath = join(outputRoot, 'index.html');
  await writeFile(manifestPath, `${JSON.stringify(model, null, 2)}\n`);
  await writeFile(indexPath, renderAtlasHtml(model));
  primaryOutputWritten = true;
  const manifestSha256 = sha256(await readFile(manifestPath));
  const indexSha256 = sha256(await readFile(indexPath));
  await writeReport({
    status: 'completed',
    failurePhase: null,
    primaryOutputWritten,
    route: {
      requestedConfig: configPath,
      effectiveConfig: configPath,
      configIdentity,
      requestedSources,
      effectiveSources,
    },
    accounting: model.accounting,
    mohelIndicators: model.mohelIndicators,
    artifacts: {
      outputRoot,
      manifest: { path: manifestPath, sha256: manifestSha256 },
      index: { path: indexPath, sha256: indexSha256 },
    },
  });
  console.log(JSON.stringify({
    ok: true,
    outputRoot,
    report: reportPath,
    faces: model.accounting.emittedFaces,
    sources: effectiveSources,
  }, null, 2));
} catch (error) {
  await writeReport({
    status: 'failed',
    failurePhase: phase,
    primaryOutputWritten,
    error: error instanceof Error ? error.message : String(error),
    route: {
      requestedConfig: configPath,
      effectiveConfig: configPath,
      configIdentity,
      requestedSources,
      effectiveSources,
    },
    lastTrustworthyEvidence: {
      requestedSources,
      effectiveSources,
      outputRoot,
    },
  });
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 2;
}
