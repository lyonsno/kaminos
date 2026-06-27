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

const delayMs = Number(process.env.KAMINOS_MOCK_SHARP_DELAY_MS || 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise(resolve => setTimeout(resolve, delayMs));
}

const inputBytes = readFileSync(input);
const inputSha256 = createHash('sha256').update(inputBytes).digest('hex');
const points = [];
for (let y = 0; y < 27; y += 1) {
  for (let x = 0; x < 27; x += 1) {
    const nx = (x - 13) / 13;
    const ny = (y - 13) / 13;
    const radius = Math.hypot(nx, ny);
    const z = Math.cos(radius * Math.PI) * 0.18;
    const red = Math.round(80 + 175 * Math.max(0, 1 - radius * 0.55));
    const green = Math.round(80 + 140 * Math.max(0, 1 - Math.abs(nx)));
    const blue = Math.round(120 + 100 * Math.max(0, 1 - Math.abs(ny)));
    points.push(`${nx.toFixed(4)} ${ny.toFixed(4)} ${z.toFixed(4)} ${red} ${green} ${blue}`);
  }
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, [
  'ply',
  'format ascii 1.0',
  'comment mock live SHARP output',
  `comment source_sha256 ${inputSha256}`,
  `element vertex ${points.length}`,
  'property float x',
  'property float y',
  'property float z',
  'property uchar red',
  'property uchar green',
  'property uchar blue',
  'end_header',
  ...points,
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
