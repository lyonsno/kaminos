#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { parseGlbGeometry } from '../cast-registration-core.mjs';
import {
  buildCastCleanupSpec,
  validateCastCleanupReport,
} from '../cast-cleanup-core.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function geometryFacts(geometry) {
  const vertexCount = geometry.positions.length / 3;
  const triangleCount = geometry.triangles.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < geometry.positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], geometry.positions[index + axis]);
      max[axis] = Math.max(max[axis], geometry.positions[index + axis]);
    }
  }

  const parent = Int32Array.from({ length: vertexCount }, (_, index) => index);
  function find(index) {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  }
  function union(left, right) {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  }
  for (let index = 0; index < geometry.triangles.length; index += 3) {
    union(geometry.triangles[index], geometry.triangles[index + 1]);
    union(geometry.triangles[index], geometry.triangles[index + 2]);
  }
  const componentRoots = new Set();
  for (let index = 0; index < vertexCount; index += 1) componentRoots.add(find(index));

  return {
    vertexCount,
    triangleCount,
    connectedComponentCount: componentRoots.size,
    bounds: {
      min,
      max,
      extent: max.map((value, axis) => value - min[axis]),
    },
  };
}

async function prepare() {
  const sourceArgument = option('--source');
  const outputArgument = option('--output-dir');
  if (!sourceArgument || !outputArgument) {
    throw new Error('usage: prepare-cast-cleanup-assay.mjs --source <source.glb> --output-dir <directory>');
  }
  const sourcePath = await realpath(resolve(sourceArgument));
  const outputDirectory = resolve(outputArgument);
  const blenderScriptPath = await realpath(new URL('./blender-cast-cleanup.py', import.meta.url));
  await mkdir(outputDirectory, { recursive: true });

  const [sourceBytes, workerBytes, sourceStat] = await Promise.all([
    readFile(sourcePath),
    readFile(blenderScriptPath),
    stat(sourcePath),
  ]);
  const sourceGeometry = geometryFacts(parseGlbGeometry(sourceBytes));
  const spec = buildCastCleanupSpec({
    sourcePath,
    sourceSha256: sha256(sourceBytes),
    sourceByteLength: sourceStat.size,
    sourceGeometry,
    blenderScriptPath,
    blenderScriptSha256: sha256(workerBytes),
    outputDirectory,
  });
  const specPath = resolve(outputDirectory, 'cleanup-spec.json');
  await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);
  return {
    status: 'prepared',
    specPath,
    specSha256: spec.specSha256,
    source: spec.source,
    worker: spec.worker,
    profiles: spec.profiles,
  };
}

async function validate() {
  const specPath = resolve(option('--spec') ?? '');
  const reportPath = resolve(option('--report') ?? '');
  if (!option('--spec') || !option('--report')) {
    throw new Error('usage: prepare-cast-cleanup-assay.mjs --validate --spec <spec.json> --report <report.json>');
  }
  const [spec, report] = await Promise.all([
    readFile(specPath, 'utf8').then(JSON.parse),
    readFile(reportPath, 'utf8').then(JSON.parse),
  ]);
  return validateCastCleanupReport(report, spec);
}

const validationMode = process.argv.includes('--validate');
const failureOutput = option('--output-dir');
try {
  console.log(JSON.stringify(await (validationMode ? validate() : prepare()), null, 2));
} catch (error) {
  if (failureOutput) {
    const failurePath = resolve(failureOutput, 'cleanup-preparation-failure.json');
    await mkdir(dirname(failurePath), { recursive: true });
    await writeFile(failurePath, `${JSON.stringify({
      status: 'failed',
      failurePhase: validationMode ? 'validation' : 'preparation',
      error: error instanceof Error ? error.message : String(error),
      lastTrustworthyEvidence: 'Caller arguments were parsed; no cleanup output was admitted',
    }, null, 2)}\n`);
  }
  throw error;
}
