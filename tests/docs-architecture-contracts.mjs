import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const rootReadme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const architecture = readFileSync(new URL('../docs/architecture.md', import.meta.url), 'utf8');
const combined = `${rootReadme}\n\n${architecture}`;

assert.match(rootReadme, /spatial asset forge/i, 'README names Kaminos as a spatial asset forge');
assert.match(rootReadme, /inhabited operational workbench/i, 'README names the inhabited operational workbench');
assert.match(rootReadme, /source-honest/i, 'README keeps source honesty in the public pitch');
assert.match(rootReadme, /docs\/architecture\.md/, 'README points readers to the architecture doc');

assert.match(architecture, /World Chambers/, 'Architecture docs define World Chambers');
assert.match(architecture, /Specimen Bench/, 'Architecture docs define the Specimen Bench');
assert.match(architecture, /spatial\s+asset\s+kiln/i, 'Architecture docs name the spatial asset kiln');
assert.match(architecture, /fast truth/i, 'Architecture docs explain fast truth');
assert.match(architecture, /slow beauty/i, 'Architecture docs explain slow beauty');
assert.match(architecture, /source-honest receipts/i, 'Architecture docs require source-honest receipts');
assert.match(architecture, /fixture\/live authority/i, 'Architecture docs preserve fixture/live authority boundaries');
assert.match(architecture, /failure cartography/i, 'Architecture docs include failure cartography');
assert.match(architecture, /preview ladder/i, 'Architecture docs include the preview ladder');
assert.match(architecture, /generated assets become inspectable candidates/i, 'Architecture docs reject silent promotion of generated output');

assert.doesNotMatch(combined, /Spawnfucker|Clayfucker|Gutfucker|Edgefucker|Pit Boss|Palm Daddy|Gutterglass Pornographers/, 'Public docs do not publish private lane names');
assert.doesNotMatch(combined, /terminal extinction/i, 'Public docs do not lead with operator-internal terminal-extinction language');
