// kaminos-test: node
// Every identifier the authoring page's inline scripts and handler attributes
// use must be declared somewhere the browser would find it. A deleted function
// whose call stays behind throws a ReferenceError only when that code runs;
// tools/index-html-unresolved-names.mjs finds it from the source.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tool = path.join(root, 'tools', 'index-html-unresolved-names.mjs');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function check(file) {
  const res = spawnSync(process.execPath, ['--expose-internals', tool, '--json', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let report = null;
  try { report = JSON.parse(res.stdout); } catch { report = null; }
  assert.ok(report, `the checker printed no report (exit ${res.status}): ${res.stderr}`);
  return { status: res.status, report };
}

function scratch(t, name, html) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaminos-unresolved-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, name);
  fs.writeFileSync(file, html);
  return file;
}

const lineOf = (text, needle) => text.slice(0, text.indexOf(needle)).split('\n').length;

test('index.html uses no undeclared names', () => {
  const { status, report } = check(path.join(root, 'index.html'));
  const listing = report.unresolved.map(u => `${u.name} at index.html:${u.line}:${u.column} (${u.context})`).join('\n');
  assert.deepEqual(report.parseErrors, [], 'every inline script and handler parses');
  assert.equal(report.unresolved.length, 0, `unresolved names:\n${listing}`);
  assert.equal(status, 0);
  assert.ok(report.scripts.some(s => s.kind === 'module'), 'the module script was read');
  assert.ok(report.handlers.count > 0, 'handler attributes were read');
});

test('a call to a deleted function planted in the page is reported with its position', t => {
  const anchor = 'function renderSceneObjectList() {';
  assert.ok(indexHtml.includes(anchor), 'the planting anchor still exists in index.html');
  const planted = indexHtml.replace(anchor, `${anchor}\n  renderDeletedStatusPanel();`);
  const { status, report } = check(scratch(t, 'index.html', planted));
  assert.equal(status, 1);
  assert.deepEqual(report.unresolved.map(u => [u.name, u.line, u.column]),
    [['renderDeletedStatusPanel', lineOf(planted, 'renderDeletedStatusPanel'), 3]]);
});

test('scoping: module names are invisible to handlers and classic scripts; declared, imported and window-assigned names resolve', t => {
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
  const { status, report } = check(scratch(t, 'scoping.html', html));
  assert.equal(status, 1);
  assert.deepEqual(report.unresolved.map(u => [u.name, u.line]).sort(),
    [['arguments_like', 9], ['moduleOnly', 14], ['moduleOnly', 2]]);
});
