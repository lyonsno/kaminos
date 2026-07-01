import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const serve = readFileSync(new URL('../serve.py', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../motion-panel-live-witness.mjs', import.meta.url), 'utf8');

assert.match(serve, /def runtime_identity\(\):/, 'dev server exposes reusable runtime identity evidence');
assert.match(serve, /"schema": "kaminos\.runtime-identity\.v0"/, 'runtime identity has a stable schema');
assert.match(serve, /"root": str\(ROOT\)/, 'runtime identity reports the effective server root');
assert.match(serve, /"gitBranch"/, 'runtime identity reports git branch when available');
assert.match(serve, /"gitCommit"/, 'runtime identity reports git commit when available');
assert.match(serve, /parsed\.path == "\/api\/runtime-identity"/, 'dev server routes the runtime identity endpoint');
assert.match(serve, /handle_runtime_identity/, 'dev server has a handler for runtime identity');

assert.match(witness, /runtimeIdentity/, 'live witness includes runtime identity in reports');
assert.match(witness, /\/api\/runtime-identity/, 'live witness fetches runtime identity from the smoke page origin');
assert.match(witness, /runtime identity missing effective root/, 'live witness fails loud when runtime identity lacks a root');
