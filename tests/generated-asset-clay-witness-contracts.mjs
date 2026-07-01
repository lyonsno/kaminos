import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const witnessPath = join(root, 'generated-asset-clay-witness.mjs');

assert.ok(existsSync(witnessPath), 'generated-asset-clay-witness.mjs provides reusable clay geometry contact-sheet smoke');

const witness = readFileSync(witnessPath, 'utf8');

assert.match(witness, /--manifest/, 'clay witness accepts an explicit asset manifest path');
assert.match(witness, /--out-dir/, 'clay witness accepts an explicit output directory');
assert.match(witness, /--base-url/, 'clay witness records the Kaminos base URL used for deep links');
assert.match(witness, /glb_material=clay/, 'clay witness loads each GLB through the clay material override route');
assert.match(witness, /scene-object-witness\.mjs/, 'clay witness reuses the browser scene witness instead of inventing a detached renderer');
assert.match(witness, /direct-glb-clay-load/, 'clay witness asks the browser witness to verify clay override state');
assert.match(witness, /createContactSheet/, 'clay witness emits a visual contact sheet from inspected frames');
assert.match(witness, /renderContactSheetHtml/, 'clay witness renders its contact sheet through the existing browser/CDP substrate');
assert.match(witness, /generated-asset-clay-witness-report\.json/, 'clay witness writes a durable JSON report');
assert.match(witness, /routeIdentity/, 'clay witness report preserves requested route identity');
assert.match(witness, /kaminosUrl/, 'clay witness report preserves operator-clickable Kaminos URLs');
assert.match(witness, /contactSheet/, 'clay witness report records the contact sheet path');
assert.match(witness, /status:\s*'failed'/, 'clay witness writes failed status instead of silently losing partial evidence');
