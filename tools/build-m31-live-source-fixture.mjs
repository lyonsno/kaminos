#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compactM31HistoricalSource,
  M31_HISTORICAL_SOURCE_REF,
} from '../m31-live-source-fixture-core.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const historicalRef = M31_HISTORICAL_SOURCE_REF;
const outputOption = process.argv.indexOf('--output');
const outputPath = resolve(
  repoRoot,
  (outputOption >= 0 ? process.argv[outputOption + 1] : null)
    || 'artifacts/cast-correspondence-v0/frozen/m31-authenticated-source.compact.json',
);

const sourceBytes = execFileSync('git', ['show', historicalRef], { cwd: repoRoot });
const fixture = compactM31HistoricalSource(sourceBytes, { historicalRef });
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(fixture)}\n`);
process.stdout.write(`${JSON.stringify({
  status: 'written',
  outputPath,
  fixtureId: fixture.fixtureId,
  historicalRef,
  sourceArtifactSha256: fixture.sourceArtifactSha256,
  vertices: fixture.positions.length / 3,
  triangles: fixture.triangles.length / 3,
})}\n`);
