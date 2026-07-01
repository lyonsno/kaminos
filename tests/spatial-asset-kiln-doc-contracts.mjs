import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

const readme = read('README.md');
const kilnDocUrl = new URL('docs/spatial-asset-kiln.md', root);

assert.ok(existsSync(kilnDocUrl), 'Kaminos docs include a Spatial Asset Kiln architecture page');
assert.match(readme, /docs\/spatial-asset-kiln\.md/, 'README links to the Spatial Asset Kiln architecture doc');
assert.match(readme, /World Chambers/i, 'README names World Chambers as part of the public architecture');
assert.match(readme, /Preview Benches/i, 'README names Preview Benches as part of the public architecture');
assert.match(readme, /Smoke Offers/i, 'README names Smoke Offers as part of the public architecture');

const docs = read('docs/spatial-asset-kiln.md');

assert.match(docs, /^# Spatial Asset Kiln/m, 'architecture doc has the expected title');
assert.match(docs, /generated assets as specimens/i, 'architecture doc frames generated assets as specimens');
assert.match(docs, /preheat/i, 'architecture doc preserves the preheat kiln phase');
assert.match(docs, /burn/i, 'architecture doc preserves the burn kiln phase');
assert.match(docs, /bank/i, 'architecture doc preserves the bank kiln phase');
assert.match(docs, /cool/i, 'architecture doc preserves the cool kiln phase');
assert.match(docs, /glow/i, 'architecture doc preserves the glow kiln phase');
assert.match(docs, /snuff/i, 'architecture doc preserves the snuff kiln phase');
assert.match(docs, /World Chamber/i, 'architecture doc defines World Chambers');
assert.match(docs, /Workbench\/Kiln/i, 'architecture doc defines Workbench/Kiln posture');
assert.match(docs, /Preview Bench/i, 'architecture doc defines Preview Benches');
assert.match(docs, /Smoke Offer/i, 'architecture doc defines Smoke Offers');
assert.match(docs, /operator smoke capture/i, 'architecture doc names operator smoke capture as the return evidence layer');
assert.match(docs, /Motion And Body Custody/i, 'architecture doc names the motion/body custody boundary');
assert.match(docs, /body semantics,\s+embodied motion\s+grammar, physics, or behavior truth/i, 'architecture doc says host presence does not transfer motion/body custody');
assert.match(docs, /Promotion Membrane/i, 'architecture doc defines the promotion membrane');
assert.match(docs, /scratch output[\s\S]*witnessed[\s\S]*promoted[\s\S]*chamber/i, 'architecture doc states the promotion ladder from scratch output to chamber placement');
assert.match(docs, /motion take[\s\S]*filmstrip[\s\S]*source frame range/i, 'architecture doc gives a concrete operator smoke capture example');
assert.match(docs, /source authority/i, 'architecture doc requires source authority to stay visible');
assert.match(docs, /freshness/i, 'architecture doc requires freshness to stay visible');
assert.match(docs, /downgrade/i, 'architecture doc requires downgrades to stay visible');
assert.match(docs, /does not certify domain truth/i, 'architecture doc keeps Kaminos from impersonating source truth');
assert.match(docs, /Human-Primary Interface Text/i, 'architecture doc defines the human-primary interface text rule');
assert.match(docs, /primary text[\s\S]*make\s+sense to someone who is not the operator and not an agent/i, 'architecture doc requires primary text to be human-legible');
assert.match(docs, /receipts[\s\S]*schemas[\s\S]*warnings[\s\S]*evidence drawer/i, 'architecture doc keeps evidence machinery in subordinate detail surfaces');
assert.match(docs, /Inhabited Agent Forge/i, 'architecture doc states the internal/future agent-forge relationship');
assert.match(docs, /not the public headline/i, 'architecture doc keeps the internal agent-forge layer out of the public headline');
assert.match(docs, /docs\/splat-assets\.md/, 'architecture doc links the splat asset correction doc');

assert.doesNotMatch(readme, /source truth|source-honest|evidence|specimen|specimens|domain truth|certify|provenance/i, 'README keeps the public posture confident and non-clinical');
