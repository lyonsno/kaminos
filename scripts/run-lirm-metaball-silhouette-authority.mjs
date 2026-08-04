#!/usr/bin/env node

import { writeMetaballSilhouetteAuthoritySources } from '../lirm-metaball-silhouette-authority-core.mjs';

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const result = await writeMetaballSilhouetteAuthoritySources({
  outDir: readOption(
    '--out-dir',
    'artifacts/lirm-metaball-silhouette-authority-v0',
  ),
  pixelWidth: Number(readOption('--pixel-width', '256')),
  pixelHeight: Number(readOption('--pixel-height', '192')),
});

process.stdout.write(`${JSON.stringify({
  status: result.manifest.status,
  manifestPath: result.manifestPath,
  rowCount: result.manifest.rows.length,
}, null, 2)}\n`);
