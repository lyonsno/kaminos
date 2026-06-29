import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const witnessPath = join(root, 'hand-surface-compositor-browser-witness.mjs');
const witness = readFileSync(witnessPath, 'utf8');

assert.ok(existsSync(witnessPath), 'browser witness must exist as a reusable route proof');
assert.match(witness, /kaminos\.tracked-hand-surface-browser-witness-report\.v0/, 'browser witness records report schema identity');
assert.match(witness, /requestedUrl:\s*url/, 'browser witness records requested URL');
assert.match(witness, /effectiveUrl/, 'browser witness records effective URL');
assert.match(witness, /phase\s*=/, 'browser witness records failure phase');
assert.match(witness, /writeReport\(/, 'browser witness writes a durable report');
assert.match(witness, /catch \(error\)[\s\S]*writeReport\([\s\S]*ok:\s*false/, 'browser witness writes a report on failure');
assert.match(witness, /CDP debug port already in use before launch/, 'browser witness refuses stale debug ports');
assert.match(witness, /screenshot is too small to be credible visual evidence/, 'browser witness rejects tiny screenshots');
assert.match(witness, /screenshot is not a PNG/, 'browser witness validates PNG identity');
assert.match(witness, /missing kaminosTrackedHandSurfaceDebugState/, 'browser witness requires the route debug state');
assert.match(witness, /sourceTruthOwner !== 'kaminos'/, 'browser witness checks Kaminos source-truth ownership');
assert.match(witness, /fixture route claimed live hand-surface authority/, 'browser witness fails if fixture authority pretends to be live');

console.log('ok - hand-surface compositor browser witness contracts');
