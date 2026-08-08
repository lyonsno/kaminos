import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const temp = mkdtempSync(join(tmpdir(), 'kaminos-assay-sheet-'));
const promptPath = join(temp, 'prompt.txt');
const outputPath = join(temp, 'output.png');
const specPath = join(temp, 'spec.json');
const sheetPath = join(temp, 'sheet.html');

writeFileSync(promptPath, 'A friendly three-legged creature.\n');
writeFileSync(
  outputPath,
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
);
writeFileSync(specPath, JSON.stringify({
  title: 'Text-only assay',
  subtitle: 'No conditioning plate exists for text-to-image generation.',
  route: 'mflux_flux2_t2i',
  settings: {
    model: 'flux2-klein-9b',
    steps: 4,
    guidance: 1.0,
  },
  cells: [{
    id: 'cell-1',
    jobId: 'abc123def456',
    seed: 80301,
    promptPath,
    outputPath,
    verdict: 'rejected',
  }],
}, null, 2));

const result = spawnSync(process.execPath, [join(root, 'tools/build-assay-sheet.mjs'), specPath, sheetPath], {
  encoding: 'utf8',
});

assert.equal(result.status, 0, result.stderr || result.stdout);
const html = readFileSync(sheetPath, 'utf8');
assert.match(html, /No conditioning image/, 'text-to-image cells state that no conditioning image exists');
assert.match(html, /flux2-klein-9b/, 'sheet exposes effective model settings beside the output');
assert.match(html, /guidance[^<]*1/, 'sheet exposes guidance beside the output');
assert.match(html, /A friendly three-legged creature\./, 'sheet exposes the exact prompt beside the output');
assert.match(html, /seed 80301/, 'sheet exposes the seed beside the output');
assert.match(html, /job abc123def456/, 'sheet exposes the execution receipt identity beside the output');
assert.match(html, /class="verdict rejected">REJECTED/, 'sheet distinguishes a rejected cell from an admitted result');
