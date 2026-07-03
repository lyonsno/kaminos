import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const docs = readFileSync(new URL('../docs/generated-motion-agency.md', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

assert.match(docs, /Generated Motion Agency/i, 'motion agency docs name the vision surface');
assert.match(docs, /behavioral motion composition/i, 'docs frame the work beyond animation playback');
assert.match(docs, /Motion Source/i, 'docs define the Motion Source layer');
assert.match(docs, /Motion Features/i, 'docs define the Motion Features layer');
assert.match(docs, /Cliplet/i, 'docs define cliplets as source-backed fragments');
assert.match(docs, /Phrase/i, 'docs define phrases above cliplets');
assert.match(docs, /Actor Body Adapter/i, 'docs define target-body adaptation');
assert.match(docs, /Steering Intent/i, 'docs define pre-contact steering intent');
assert.match(docs, /Encounter Semantics/i, 'docs define object/event encounter appraisal');
assert.match(docs, /World Constraint/i, 'docs define world constraints separately from intent');
assert.match(docs, /Witness/i, 'docs preserve witness artifacts as part of the system');
assert.match(docs, /Reynolds/i, 'docs name classic steering shoulders');
assert.match(docs, /motion graph/i, 'docs name motion-graph shoulders');
assert.match(docs, /motion matching/i, 'docs name motion-matching shoulders');
assert.match(docs, /generated motion/i, 'docs explain generated motion as behavioral material');
assert.match(docs, /Path World Steering Intent V0/i, 'docs name the next implementation target');
assert.match(docs, /not final creature intelligence/i, 'docs preserve the honesty boundary');

assert.match(readme, /Generated Motion Agency/i, 'README teases generated motion agency publicly');
assert.match(readme, /docs\/generated-motion-agency\.md/, 'README links to the deep motion agency doc');
assert.doesNotMatch(readme, /Behavior Tree|GOAP|ORCA|RVO/, 'README teaser must not become an internal crowd-AI taxonomy dump');
