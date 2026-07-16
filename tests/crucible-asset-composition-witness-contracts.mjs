import assert from 'node:assert/strict';
import fs from 'node:fs';

const witness = fs.readFileSync(new URL('../crucible-asset-composition-witness.mjs', import.meta.url), 'utf8');

assert.match(witness, /requestedCompositionId/);
assert.match(witness, /effectiveCompositionId/);
assert.match(witness, /registeredObjectIds/);
assert.match(witness, /aoEnabled/);
assert.match(witness, /canvasPixelEvidence/);
assert.match(witness, /sidebarPixelEvidence/);
assert.match(witness, /maxDarkFraction/);
assert.match(witness, /quantizedColorCount/);
assert.match(witness, /lastTrustworthyEvidence/);
assert.match(witness, /phase/);
assert.match(witness, /primaryOutputWritten/);
assert.match(witness, /writeReport\(/);
assert.match(witness, /catch \(error\)/);
assert.match(witness, /browser-exit/);
assert.match(witness, /cleanup-failed/);
assert.match(witness, /let cleanupEvidence\s*=\s*null/);
assert.match(witness, /cleanupEvidence\s*=\s*\{\s*userDataDir/);
assert.match(witness, /cleanup:\s*cleanupEvidence/);
assert.doesNotMatch(witness, /catch \(cleanupError\) \{[\s\S]*?writeReport\('failed'/);

console.log('crucible asset composition witness contracts passed');
