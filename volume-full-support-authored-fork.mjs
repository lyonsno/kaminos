#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildFullSupportAuthoredFork } from './volume-full-support-cockpit.mjs';

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`invalid argument: ${key || '<missing>'}`);
    values.set(key, value);
  }
  return values;
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} read failed: ${error.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const key of ['--name', '--output', '--source-receipt', '--controls']) {
    if (!args.get(key)) throw new Error(`${key} is required`);
  }
  const outputPath = resolve(args.get('--output'));
  const [sourceReceipt, controls] = await Promise.all([
    readJson(resolve(args.get('--source-receipt')), 'source receipt'),
    readJson(resolve(args.get('--controls')), 'controls'),
  ]);
  const artifact = buildFullSupportAuthoredFork({
    name: args.get('--name'),
    outputPath,
    sourceReceipt,
    controls,
  });
  const encoded = `${JSON.stringify(artifact, null, 2)}\n`;
  const temporaryPath = `${outputPath}.partial-${process.pid}`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(temporaryPath, encoded, { encoding: 'utf8', flag: 'wx' });
  await rename(temporaryPath, outputPath);
  process.stdout.write(`${JSON.stringify({
    schema: 'kaminos.pyro.full-support-authored-fork-write-receipt.v0',
    status: 'written',
    outputPath,
    bytes: Buffer.byteLength(encoded),
    sha256: createHash('sha256').update(encoded).digest('hex'),
    sourceStatus: sourceReceipt.status,
  })}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
