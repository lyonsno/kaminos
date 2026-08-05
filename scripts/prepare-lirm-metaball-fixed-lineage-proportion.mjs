#!/usr/bin/env node

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeMetaballFixedLineageProportionSources } from '../lirm-metaball-silhouette-authority-core.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'artifacts/lirm-metaball-fixed-lineage-proportion-v0');
const result = await writeMetaballFixedLineageProportionSources({
  outDir,
  pixelWidth: 256,
  pixelHeight: 256,
});

process.stdout.write(`${result.manifestPath}\n`);
