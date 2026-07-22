import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../motion-ready-719024-stencil.html', import.meta.url), 'utf8');

assert.match(page, /motion-ready-719024-stencil\.js/, 'workbench consumes the semantic stencil module');
assert.match(page, /creature\.glb/, 'workbench loads the exact cast rather than a proxy');
assert.match(page, /registration\.json/, 'workbench binds authoring to the exact registration identity');
assert.match(page, /crypto\.subtle\.digest/, 'workbench verifies effective asset bytes rather than trusting requested URLs');
assert.match(page, /stencil_url/, 'workbench accepts an explicit persisted stencil source');
assert.match(page, /operator_session/, 'workbench records the authoring session rather than inventing anonymous authority');
assert.match(page, /localStorage/, 'workbench can save and reload the current semantic draft');
assert.match(page, /application\/json/, 'workbench can export the authored semantic document');
assert.match(page, /id="stencil-import"/, 'workbench can import and revalidate a semantic document');
assert.match(page, /Body axis/, 'workbench exposes body-axis authoring directly');
assert.match(page, /Appendage/, 'workbench exposes appendage-chain authoring directly');
assert.match(page, /Contact/, 'workbench exposes contact-patch authoring directly');
assert.match(page, /Preserve/, 'workbench exposes preservation-region authoring directly');
assert.match(page, /acceptButton\.disabled/, 'workbench makes incomplete acceptance visibly unavailable');
assert.match(page, /required.*body-axis.*appendage-chain.*contact-patch.*preservation-region/is, 'workbench names the complete primitive acceptance gate');
assert.match(page, /kaminosOracleStencilDebugState/, 'workbench exposes machine-readable live state');
assert.match(page, /requestedStencilSource/, 'debug state distinguishes requested stencil input');
assert.match(page, /effectiveStencilSource/, 'debug state records the effective stencil source');
assert.match(page, /derivedBinding/, 'debug state reports derived binding separately from semantic authority');
assert.match(page, /stencilHash/, 'debug state reports semantic stencil identity');
assert.match(page, /castHash/, 'debug state reports effective cast identity');
assert.match(page, /registrationHash/, 'debug state reports effective registration identity');
assert.doesNotMatch(page, /contact-atlas\.json/, 'authoring workbench must not silently substitute the old contact atlas');
assert.doesNotMatch(page, /contact-carriers\.json/, 'authoring workbench must not load the rejected carrier assay');
assert.doesNotMatch(page, /motion-ready-719024-hill/, 'rest-space authoring must not depend on Hill motion state');

console.log('motion-ready-719024 oracle stencil workbench contracts passed');
