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
assert.match(readme, /World Cartridges/i, 'README names World Cartridges as part of the public architecture');
assert.match(readme, /LERMS terrarium/i, 'README names the first worked cartridge direction');

const docs = read('docs/spatial-asset-kiln.md');

assert.match(docs, /^# Spatial Asset Kiln/m, 'architecture doc has the expected title');
assert.match(docs, /generated work gains a body in a spatial forge/i, 'architecture doc gives the public positive frame');
assert.match(docs, /preheat/i, 'architecture doc preserves the preheat kiln phase');
assert.match(docs, /burn/i, 'architecture doc preserves the burn kiln phase');
assert.match(docs, /bank/i, 'architecture doc preserves the bank kiln phase');
assert.match(docs, /cool/i, 'architecture doc preserves the cool kiln phase');
assert.match(docs, /glow/i, 'architecture doc preserves the glow kiln phase');
assert.match(docs, /snuff/i, 'architecture doc preserves the snuff kiln phase');
assert.match(docs, /Spatial Pre-Production Forge/i, 'architecture doc defines the spatial pre-production forge');
assert.match(docs, /open a Kaminos worktree/i, 'architecture doc describes agent composition in Kaminos worktrees');
assert.match(docs, /Start from a world chamber, workbench, asset route, or world cartridge/i, 'architecture doc gives a concrete workbench starting point');
assert.match(docs, /Run the same route the operator will smoke/i, 'architecture doc keeps operator route exercise central');
assert.match(docs, /Record graduation accounting/i, 'architecture doc makes graduation accounting part of the workflow');
assert.match(docs, /World Cartridge/i, 'architecture doc defines World Cartridges');
assert.match(docs, /portable world seed/i, 'architecture doc defines cartridges positively');
assert.match(docs, /bounded world surface/i, 'architecture doc defines the terrarium surface');
assert.match(docs, /LERMS terrarium cartridge/i, 'architecture doc names the worked lerms cartridge direction');
assert.match(docs, /World Chamber/i, 'architecture doc defines World Chambers');
assert.match(docs, /Workbench\/Kiln/i, 'architecture doc defines Workbench/Kiln posture');
assert.match(docs, /generated pieces and world fragments become\s+inspectable/i, 'architecture doc frames workbench material in less clinical language');
assert.match(docs, /Preview Bench/i, 'architecture doc defines Preview Benches');
assert.match(docs, /Smoke Offer/i, 'architecture doc defines Smoke Offers');
assert.match(docs, /operator smoke capture/i, 'architecture doc names operator smoke capture as the return evidence layer');
assert.match(docs, /Motion And Body Custody/i, 'architecture doc names the motion/body custody boundary');
assert.match(docs, /host custody: spatial placement, badges, capture, camera,\s+and witness shape/i, 'architecture doc names Kaminos motion/body host custody positively');
assert.match(docs, /Promotion And Graduation/i, 'architecture doc defines promotion and graduation');
assert.match(docs, /scratch output -> witnessed payload -> promoted take\/asset\/sidecar -> chamber,\s+cartridge, or scene placement/i, 'architecture doc states the promotion ladder from scratch output to chamber placement');
assert.match(docs, /Remain in Kaminos terrarium/i, 'architecture doc names the remain-in-cartridge graduation mode');
assert.match(docs, /Port domain-native/i, 'architecture doc names the domain-native graduation mode');
assert.match(docs, /Extract shared runtime/i, 'architecture doc names the shared-runtime graduation mode');
assert.match(docs, /Ship Kaminos-backed shell/i, 'architecture doc names the Kaminos-backed shell graduation mode');
assert.match(docs, /Archive prototype/i, 'architecture doc names the archive graduation mode');
assert.match(docs, /motion take[\s\S]*filmstrip[\s\S]*source frame range/i, 'architecture doc gives a concrete operator smoke capture example');
assert.match(docs, /source authority/i, 'architecture doc requires source authority to stay visible');
assert.match(docs, /freshness/i, 'architecture doc requires freshness to stay visible');
assert.match(docs, /downgrade/i, 'architecture doc requires downgrades to stay visible');
assert.match(docs, /Inhabited Agent Forge/i, 'architecture doc states the internal/future agent-forge relationship');
assert.match(docs, /source lanes and diauloi can become embodied\s+stations in Kaminos/i, 'architecture doc links the cartridge/kiln layer to embodied stations');
assert.match(docs, /splat-assets\.md/, 'architecture doc links the splat asset correction doc');

assert.doesNotMatch(readme, /source truth|source-honest|evidence|specimen|specimens|domain truth|certify|provenance/i, 'README keeps the public posture confident and non-clinical');
