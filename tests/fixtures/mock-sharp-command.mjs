#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);

const input = args.get('--input');
const output = args.get('--output');
const report = args.get('--report');
if (!input || !output || !report) {
  throw new Error('mock SHARP expected --input, --output, and --report');
}

const inputBytes = readFileSync(input);
const inputSha256 = createHash('sha256').update(inputBytes).digest('hex');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, [
  'ply',
  'format ascii 1.0',
  'comment mock live SHARP output',
  `comment source_sha256 ${inputSha256}`,
  'element vertex 3',
  'property float x',
  'property float y',
  'property float z',
  'property float f_dc_0',
  'property float opacity',
  'end_header',
  '0 0 0 1 1',
  '0.1 0 0 1 1',
  '0 0.1 0 1 1',
  '',
].join('\n'));

const outputStat = statSync(output);
mkdirSync(dirname(report), { recursive: true });
writeFileSync(report, `${JSON.stringify({
  schema: 'kaminos.mock-sharp-adapter-report.v0',
  ok: true,
  input,
  output,
  inputSha256,
  outputBytes: outputStat.size,
}, null, 2)}\n`);
