import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const pagePath = join(root, 'site', 'index.html');
const stylesPath = join(root, 'site', 'styles.css');
const scriptPath = join(root, 'site', 'landing.js');

assert.ok(existsSync(pagePath), 'standalone Kaminos landing surface exists');
assert.ok(existsSync(stylesPath), 'landing surface has a dedicated responsive stylesheet');
assert.ok(existsSync(scriptPath), 'landing surface has a dedicated interaction module');

const page = readFileSync(pagePath, 'utf8');
const styles = readFileSync(stylesPath, 'utf8');
const script = readFileSync(scriptPath, 'utf8');

assert.match(page, /<h1[^>]*>\s*Kaminos\s*<\/h1>/i, 'Kaminos is the literal page headline');
assert.match(page, /Independent technical invention studio/i, 'page identifies the studio directly');
assert.match(page, /difficult product bets visible, steerable, and easier to own/i, 'hero explains the value without an unearned customer claim');
assert.match(page, /Current material study/i, 'hero identifies the fire imagery as a current material study');
assert.match(page, /data-evidence-authority="operator-capture"/i, 'fire imagery records its evidence authority');
assert.match(page, /href="\.\.\/index\.html"/i, 'landing surface preserves a direct route to the live workbench');
assert.match(page, /href="https:\/\/github\.com\/lyonsno"/i, 'landing surface associates the work with Noah Lyons');

assert.match(page, /Where does it stop\?/i, 'Basin Maintenance invitation leads with a warm question');
assert.match(page, /difficult ML, graphics, and spatial-computing problems that do not yet have a practical route/i, 'pre-precedent invitation uses the approved claim boundary');
assert.match(page, /tell us what you have tried and where it stops/i, 'invitation asks for concrete problem history');
assert.doesNotMatch(page, /Bring us the problem your current stack has taught you not to attempt/i, 'future-earned invitation remains gated');

assert.match(page, /Neural fire/i, 'current work names neural fire');
assert.match(page, /World kiln/i, 'current work names the larger Kaminos system');
assert.match(page, /One expensive uncertainty/i, 'method begins from a bounded decision object');
assert.match(page, /Live artifact/i, 'method names the visible working proof');
assert.match(page, /Receipts and handoff/i, 'method preserves transfer evidence');

assert.doesNotMatch(page, /<video\b[^>]*\bloop\b/i, 'identity treatment is not a looping flaming-logo video');
assert.match(styles, /@media\s*\(max-width:\s*760px\)/i, 'landing surface defines a mobile layout boundary');
assert.match(styles, /min-height:\s*100svh/i, 'hero uses a stable viewport-height contract');
assert.match(script, /IntersectionObserver/, 'section state follows viewport progression');
assert.match(script, /prefers-reduced-motion/, 'interaction respects reduced-motion preference');
