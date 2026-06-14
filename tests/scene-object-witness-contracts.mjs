import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const witnessPath = join(root, 'scene-object-witness.mjs');

assert.ok(existsSync(witnessPath), 'scene-object-witness.mjs must provide a reusable browser witness for scene object UI');

const witness = readFileSync(witnessPath, 'utf8');

assert.match(witness, /const scenario\s*=\s*args\.get\('--scenario'\) \|\| 'append-select-remove-keyboard'/, 'witness records an explicit default scenario');
assert.match(witness, /requestedUrl:\s*url/, 'witness report records requested URL');
assert.match(witness, /effectiveUrl:/, 'witness report records effective browser URL');
assert.match(witness, /debugPort:\s*port/, 'witness report records effective debug port');
assert.match(witness, /phase\s*=/, 'witness tracks failure phase for report-on-failure');
assert.match(witness, /writeReport\(/, 'witness writes a durable JSON report');
assert.match(witness, /catch \(error\)[\s\S]*writeReport\([\s\S]*ok:\s*false/, 'witness writes report even when the primary flow fails');
assert.match(witness, /Page\.captureScreenshot/, 'witness captures a screenshot artifact');
assert.match(witness, /assertPngScreenshot\(/, 'witness validates screenshot output before claiming visual evidence');
assert.match(witness, /default replace did not keep one row/, 'witness proves unchecked imports replace rather than append');
assert.match(witness, /default replace did not complete with a new row/, 'witness waits for unchecked replace to complete instead of accepting a stale single row');
assert.match(witness, /append import did not produce two unique rows/, 'witness proves checked Append creates two unique object rows');
assert.match(witness, /first selection not exclusive/, 'witness proves row selection is exclusive');
assert.match(witness, /mouse remove did not leave one active row/, 'witness proves mouse removal fallback');
assert.match(witness, /keyboard remove did not remove focused row/, 'witness proves focused keyboard removal');
assert.match(witness, /stderrTail/, 'witness report preserves browser stderr tail for debugging');
