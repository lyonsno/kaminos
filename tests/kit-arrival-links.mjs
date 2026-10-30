// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.env.KAMINOS_ROOT ?? path.resolve(import.meta.dirname, '..');

test('Kit README model-application links resolve to current headings', () => {
  const readme = fs.readFileSync(path.join(root, 'webgpu-inference-kit/README.md'), 'utf8');
  const guide = fs.readFileSync(path.join(root, 'webgpu-inference-kit/docs/model-applications.md'), 'utf8');
  const headings = new Set([...guide.matchAll(/^#{1,6} (.+)$/gm)].map(([, text]) =>
    text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s/g, '-')));
  const links = [...readme.matchAll(/\]\(\.\/docs\/model-applications\.md#([^)]+)\)/g)];
  assert.ok(links.length, 'the application guide must remain reachable');
  for (const [, anchor] of links) assert.ok(headings.has(anchor), `missing application-guide anchor: #${anchor}`);
});
