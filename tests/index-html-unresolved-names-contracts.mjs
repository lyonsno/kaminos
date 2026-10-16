// kaminos-test: node
// Names that the authoring page's inline scripts and handler attributes use
// without declaring them anywhere the browser would find them. A deleted
// function whose call stays behind throws a ReferenceError only when that code
// runs; tools/index-html-unresolved-names.mjs finds it from the source.
//
// This is a warning flow: each finding in index.html prints one line,
//   kaminos-test-warning: index.html unresolved name <name> at <line>:<col>; <remedy>
// and the test passes. A checker that cannot run (Node's bundled parser is
// unavailable) prints a warning naming why and passes. KAMINOS_STRICT_UNRESOLVED=1
// turns findings, and a checker that cannot run, into failures.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tool = path.join(root, 'tools', 'index-html-unresolved-names.mjs');
const WARNING = 'kaminos-test-warning: ';
const EXIT_PARSER_UNAVAILABLE = 3;

// Runs the checker over one file. Returns { report } when it ran, or
// { unavailable } with the reason when it could not.
function check(file, env = process.env) {
  const res = spawnSync(process.execPath, ['--expose-internals', tool, '--json', file], { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  if (res.status === EXIT_PARSER_UNAVAILABLE) return { unavailable: (res.stderr || '').trim() || 'parser unavailable' };
  try { return { report: JSON.parse(res.stdout), status: res.status }; }
  catch { return { unavailable: `the checker exited ${res.status} without a report: ${(res.stderr || '').trim().split('\n')[0]}` }; }
}

// The index.html scan as warnings, or as failures under strict mode.
function scan(file, { label = 'index.html', strict = false, env = process.env } = {}) {
  const result = check(file, env);
  const warnings = [];
  if (result.unavailable) {
    warnings.push(`${WARNING}${label} unresolved-name check did not run: ${result.unavailable}; use a Node release that bundles acorn, or set KAMINOS_UNRESOLVED_ACORN_MODULE to its module path`);
  } else {
    for (const e of result.report.parseErrors) warnings.push(`${WARNING}${label} parse error in ${e.context} at ${e.line}:${e.column}: ${e.message}; fix the script so it parses`);
    for (const u of result.report.unresolved) warnings.push(`${WARNING}${label} unresolved name ${u.name} at ${u.line}:${u.column}; check the name is defined in ${label} or in a script it loads`);
  }
  return { warnings, failed: strict && warnings.length > 0, result };
}

function scratch(t, name, html) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaminos-unresolved-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, name);
  fs.writeFileSync(file, html);
  return file;
}

const strict = process.env.KAMINOS_STRICT_UNRESOLVED === '1';

test(`index.html: unresolved names are ${strict ? 'failures (KAMINOS_STRICT_UNRESOLVED=1)' : 'reported as warnings'}`, () => {
  const { warnings, failed } = scan(path.join(root, 'index.html'), { strict });
  for (const line of warnings) console.log(line);
  assert.equal(failed, false, `KAMINOS_STRICT_UNRESOLVED=1 and the check reported:\n${warnings.join('\n')}`);
});

// The checker's own behavior, on fixtures; independent of index.html's
// current contents, so a lane's edit to the page cannot fail it. A checker
// that cannot run skips these with a warning unless strict.
let parserProbe = null;
function requireParser(t) {
  if (!parserProbe) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaminos-unresolved-probe-'));
    fs.writeFileSync(path.join(dir, 'probe.html'), '<script>let a = 1;</script>');
    parserProbe = check(path.join(dir, 'probe.html'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const probe = parserProbe;
  if (!probe.unavailable) return true;
  if (strict) assert.fail(`the checker cannot run: ${probe.unavailable}`);
  t.skip(`the checker cannot run: ${probe.unavailable}`);
  return false;
}

const PLANTED = `<!doctype html><html><body>
<div id="scene-object-list"></div>
<script type="module">
function pruneSceneGroups() {}
function renderSceneObjectList() {
  const list = document.getElementById('scene-object-list');
  if (!list) return;
  renderSceneImportStatus();
  pruneSceneGroups();
}
window.kaminosSceneAuthoring = { addMesh: () => renderSceneObjectList() };
</script>
</body></html>`;

test('a call to a deleted function is a finding with its line and column; strict mode fails on it', t => {
  if (!requireParser(t)) return;
  const file = scratch(t, 'planted.html', PLANTED);
  const planted = scan(file, { label: 'planted.html', strict: true });
  assert.deepEqual(planted.warnings, [`${WARNING}planted.html unresolved name renderSceneImportStatus at 8:3; check the name is defined in planted.html or in a script it loads`]);
  assert.equal(planted.failed, true, 'strict mode fails on the finding');
  assert.equal(scan(file, { label: 'planted.html' }).failed, false, 'the default mode only warns');
  const fixed = scan(scratch(t, 'fixed.html', PLANTED.replace('  renderSceneImportStatus();\n', '')), { label: 'fixed.html', strict: true });
  assert.deepEqual(fixed.warnings, []);
  assert.equal(fixed.failed, false);
});

test('scoping: module names are invisible to handlers and classic scripts; declared, imported and window-assigned names resolve', t => {
  if (!requireParser(t)) return;
  const html = `<!doctype html><html><body>
<button onclick="moduleOnly()">a</button>
<button onclick="exposed(); classicFn(event)">b</button>
<script type="module">
import { thing } from './x.js';
function moduleOnly() {}
window.exposed = () => thing;
const { a, b: [c = a] } = {};
try { c(); } catch (err) { console.log(err, arguments_like); }
class K { static #p = 1; m(x, ...rest) { return [x, rest, this, K, typeof neverDeclared]; } }
for (const [k, v] of Object.entries({})) label: { if (k) break label; v(); }
</script>
<script>
function classicFn(e) { var local = e; return local && moduleOnly; }
</script>
</body></html>`;
  const { result } = scan(scratch(t, 'scoping.html', html));
  assert.deepEqual(result.report.unresolved.map(u => [u.name, u.line]),
    [['moduleOnly', 2], ['arguments_like', 9], ['moduleOnly', 14]]);
});

test('a parser that cannot be loaded is a warning naming why, and a failure only in strict mode', t => {
  const env = { ...process.env, KAMINOS_UNRESOLVED_ACORN_MODULE: 'internal/deps/kaminos-no-such-parser' };
  const file = scratch(t, 'any.html', '<script>let a = 1;</script>');
  const relaxed = scan(file, { label: 'any.html', env });
  assert.equal(relaxed.warnings.length, 1);
  assert.match(relaxed.warnings[0], /^kaminos-test-warning: any\.html unresolved-name check did not run: parser unavailable: .*kaminos-no-such-parser.*; use a Node release that bundles acorn, or set KAMINOS_UNRESOLVED_ACORN_MODULE to its module path$/);
  assert.equal(relaxed.failed, false);
  assert.equal(scan(file, { label: 'any.html', env, strict: true }).failed, true);
});
