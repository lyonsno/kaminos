import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../finger-fluid-webgpu-core.js', import.meta.url), 'utf8');
const start = source.indexOf('fn compact_interface_records(');
assert.notEqual(start, -1, 'the GPU interface-record compaction shader exists');
const end = source.indexOf('@compute', start + 1);
assert.notEqual(end, -1, 'the interface-record shader has a following entry point');
const shader = source.slice(start, end);
const rejectNonInterface = shader.indexOf('if (surfaceFactor < ${INTERFACE_THRESHOLD}) { return; }');
const firstNeighborWork = shader.indexOf('let baseCell = gridCoord(position)');
assert.ok(rejectNonInterface !== -1, 'interface compaction retains the established surface threshold');
assert.ok(firstNeighborWork !== -1, 'interface compaction performs linked-cell neighbor traversal');
assert.ok(
  rejectNonInterface < firstNeighborWork,
  'non-interface particles are rejected before the per-particle linked-cell traversal',
);
