#!/usr/bin/env node

import { writeMetaballMultiviewTopologySources } from '../lirm-metaball-silhouette-authority-core.mjs';

const result = await writeMetaballMultiviewTopologySources();
process.stdout.write(`${JSON.stringify({
  status: result.manifest.status,
  manifestPath: result.manifestPath,
  conditionCount: result.manifest.conditions.length,
}, null, 2)}\n`);
