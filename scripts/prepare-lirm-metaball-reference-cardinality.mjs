#!/usr/bin/env node

import { writeMetaballReferenceCardinalitySources } from '../lirm-metaball-silhouette-authority-core.mjs';

const result = await writeMetaballReferenceCardinalitySources();
process.stdout.write(`${JSON.stringify({
  status: result.manifest.status,
  manifestPath: result.manifestPath,
  conditionCount: result.manifest.conditions.length,
}, null, 2)}\n`);
