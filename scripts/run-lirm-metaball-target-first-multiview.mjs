#!/usr/bin/env node

import { writeMetaballTargetFirstMultiviewSources } from '../lirm-metaball-silhouette-authority-core.mjs';

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const result = await writeMetaballTargetFirstMultiviewSources({
  outDir: readOption(
    '--out-dir',
    'artifacts/lirm-metaball-target-first-multiview-v0',
  ),
  pixelWidth: Number(readOption('--pixel-width', '256')),
  pixelHeight: Number(readOption('--pixel-height', '192')),
});

process.stdout.write(`${JSON.stringify({
  status: result.manifest.status,
  manifestPath: result.manifestPath,
  viewCount: result.manifest.views.length,
  conditionCount: result.manifest.conditions.length,
}, null, 2)}\n`);
