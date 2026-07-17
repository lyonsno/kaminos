import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const match = core.match(/const BOUNDARY_SPLAT_WGSL = `([\s\S]*?)`;\n/);

assert.ok(match, 'boundary splat WGSL template must remain discoverable');

let depth = 0;
let line = 1;
for (const character of match[1]) {
  if (character === '\n') line += 1;
  if (character === '{') depth += 1;
  if (character === '}') depth -= 1;
  assert.ok(depth >= 0, `boundary splat WGSL closes an unopened block at template line ${line}`);
}

assert.equal(depth, 0, `boundary splat WGSL has ${depth} unmatched opening block(s)`);
assert.match(
  core,
  /const computeHelpersStart = BOUNDARY_SPLAT_WGSL\.indexOf\('fn boundarySplatClampCell'\)/,
  'render module assembly must identify the compute-only reconstruction helper boundary',
);
assert.match(
  core,
  /const boundarySplatRenderWgsl[\s\S]*BOUNDARY_SPLAT_WGSL\.slice\(0, computeHelpersStart\)[\s\S]*BOUNDARY_SPLAT_WGSL\.slice\(archiveEnd\)/,
  'render module must exclude compute-only reconstruction helpers whose storage bindings are removed',
);

console.log('boundary splat WGSL structure contracts passed');
