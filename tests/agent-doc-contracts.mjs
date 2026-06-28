import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const agents = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');
const claude = readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8');

assert.match(agents, /`cliplet sheet`/, 'AGENTS.md preserves the spoken cliplet-sheet handle');
assert.match(agents, /Cliplet Sheet/, 'AGENTS.md names the human-facing Motion panel button');
assert.match(agents, /exportMotionPanelSelectedClipletFilmstrip/, 'AGENTS.md names the selected-cliplet export API');
assert.match(agents, /--export-selected-cliplet/, 'AGENTS.md names the live witness flag');
assert.match(agents, /Do not ask the operator for a path/, 'AGENTS.md preserves the no-ugly-path operator contract');
assert.match(claude, /Read `AGENTS\.md` first/, 'CLAUDE.md delegates to the shared repo-local agent contract');
