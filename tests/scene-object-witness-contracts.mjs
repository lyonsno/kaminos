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
assert.match(witness, /mkdirSync\(dirname\(reportPath\)/, 'witness creates report parent directories before writing');
assert.match(witness, /mkdirSync\(dirname\(out\)/, 'witness creates screenshot parent directories before writing');
assert.match(witness, /checking-debug-port/, 'witness checks for stale CDP endpoints before launch');
assert.match(witness, /CDP debug port already in use before launch/, 'witness fails instead of attaching to stale CDP endpoints');
assert.match(witness, /chromeProcess\.once\('error'/, 'witness converts Chrome launch errors into caught failures');
assert.match(witness, /Chrome launch failed/, 'witness names Chrome launch failures in reports');
assert.match(witness, /effective URL mismatch/, 'witness fails when the loaded route differs from the requested route');
assert.match(witness, /CDP request timed out/, 'witness times out nonresponsive CDP requests');
assert.match(witness, /Page\.captureScreenshot/, 'witness captures a screenshot artifact');
assert.match(witness, /assertPngScreenshot\(/, 'witness validates screenshot output before claiming visual evidence');
assert.match(witness, /default replace did not keep one row/, 'witness proves unchecked imports replace rather than append');
assert.match(witness, /default replace did not start from exactly one row/, 'witness requires a pre-existing row before proving replace behavior');
assert.match(witness, /default replace did not complete with a new row/, 'witness waits for unchecked replace to complete instead of accepting a stale single row');
assert.match(witness, /append import did not produce two unique rows/, 'witness proves checked Append creates two unique object rows');
assert.match(witness, /selection not exclusive/, 'witness proves row selection is exclusive');
assert.match(witness, /selection did not activate the clicked row/, 'witness proves the clicked row becomes active');
assert.match(witness, /selection did not deactivate other rows/, 'witness proves non-clicked rows become inactive');
assert.match(witness, /assertClickedSelection\([\s\S]*'first'/, 'witness checks the first clicked row');
assert.match(witness, /assertClickedSelection\([\s\S]*'second'/, 'witness checks the second clicked row');
assert.match(witness, /mouse remove did not leave one active row/, 'witness proves mouse removal fallback');
assert.match(witness, /mouse remove did not report removal/, 'witness proves mouse removal status evidence');
assert.match(witness, /mouse remove did not preserve transform toolbar/, 'witness proves mouse removal keeps transform controls on fallback object');
assert.match(witness, /keyboard remove did not remove focused row/, 'witness proves focused keyboard removal');
assert.match(witness, /keyboard remove did not preserve transform toolbar/, 'witness proves keyboard removal keeps transform controls on fallback object');
assert.match(witness, /append selection did not preserve transform toolbar/, 'witness proves transform controls after append selection');
assert.match(witness, /stderrTail/, 'witness report preserves browser stderr tail for debugging');
