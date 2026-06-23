import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const indexPath = join(root, 'index.html');
const witnessPath = join(root, 'motion-witness.mjs');

assert.ok(existsSync(witnessPath), 'motion-witness.mjs must provide a reusable motion-agency witness');

const witness = readFileSync(witnessPath, 'utf8');
assert.match(witness, /kaminos_motion_agency=1/, 'motion witness defaults to the Kaminos motion-agency route');
assert.match(witness, /window\.kaminosMotionAgencyDebugState/, 'motion witness reads explicit browser route state');
assert.match(witness, /requestedClipIds/, 'motion witness report records requested clip ids');
assert.match(witness, /effectiveClipIds/, 'motion witness report records effective clip ids');
assert.match(witness, /fallbackCount/, 'motion witness report records fallback count');
assert.match(witness, /writeRgbaPng/, 'motion witness can write deterministic filmstrip PNG evidence');
assert.match(witness, /Page\.captureScreenshot/, 'motion witness captures a browser screenshot');
assert.match(witness, /catch \(error\)[\s\S]*writeReport\([\s\S]*ok:\s*false/, 'motion witness writes a report on failure');

const index = readFileSync(indexPath, 'utf8');
assert.match(index, /motion-core\.js/, 'Kaminos imports the shared motion core');
assert.match(index, /data-tab="motion"/, 'sidebar exposes a Motion tab');
assert.match(index, /id="tab-motion"/, 'Motion tab content is present');
assert.match(index, /kaminos_motion_agency/, 'URL route can enable the motion-agency scene');
assert.match(index, /procedural-orb-motion-grammar-v0/, 'browser route preserves motion route identity');
assert.match(index, /createMotionAgencyFixtureScene/, 'browser route creates a procedural orb fixture scene');
assert.match(index, /updateMotionAgencyFrame/, 'render loop advances motion actors');
assert.match(index, /window\.kaminosMotionAgencyDebugState/, 'browser witnesses can inspect motion-agency state');
assert.match(index, /motionAgencyActive/, 'render loop keeps rendering while the motion-agency route is active');
