import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const scriptPath = join(root, 'volume-resolution-gap-ladder.py');
assert.ok(existsSync(scriptPath), 'phase-aligned resolution-gap ladder harness exists');

const script = readFileSync(scriptPath, 'utf8');
assert.match(script, /kaminos\.volume\.resolution-gap-ladder\.v0/, 'ladder harness writes a stable report schema');
assert.match(script, /phase-aligned-resolution-gap-ladder-v0/, 'ladder harness names a stable identity');
assert.match(script, /--target-grid-list/, 'ladder harness accepts an explicit target grid ladder');
assert.match(script, /sourceHighHistoryManifest/, 'ladder report records the source high-history manifest');
assert.match(script, /ladderLegs/, 'ladder report records every attempted ladder leg');
assert.match(script, /corpusManifest/, 'ladder leg records the phase-aligned corpus manifest');
assert.match(script, /probeManifest/, 'ladder leg records the sidecar/meta probe manifest');
assert.match(script, /denseCuePackManifest/, 'ladder leg records the dense cue pack manifest when exported');
assert.match(script, /selectedCandidateRecommendations/, 'ladder report recommends a compact candidate subset for receiver playback');
assert.match(script, /storageDiscipline/, 'ladder report records storage-discipline policy');
assert.match(script, /regenerable-intermediates-not-retained-by-default/, 'ladder harness explicitly avoids retaining gratuitous regenerable intermediates');
assert.match(script, /failurePhase/, 'ladder harness writes failure-phase reports when a leg fails');
assert.match(script, /continue-on-leg-failure/, 'ladder harness can preserve partial ladder evidence instead of failing the whole discriminator');
assert.match(script, /volume-phase-aligned-corpus-contract\.py/, 'ladder harness delegates corpus construction to the existing phase-aligned corpus contract');
assert.match(script, /volume-sidecar-meta-probe\.py/, 'ladder harness delegates training/probing to the existing sidecar/meta probe');

console.log('volume resolution-gap ladder contract passed');
