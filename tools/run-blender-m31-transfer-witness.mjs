#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [transferArgument, outputArgument] = process.argv.slice(2);
if (!transferArgument || !outputArgument) {
  console.error('expected transfer JSON and output directory');
  process.exit(2);
}

const transferPath = resolve(transferArgument);
const outputDir = resolve(outputArgument);
const blender = process.env.M31_WITNESS_BLENDER_BIN ??
  '/Applications/Blender.app/Contents/MacOS/Blender';
const script = new URL('./blender-m31-transfer-witness.py', import.meta.url).pathname;
const argv = [
  '--background',
  '--factory-startup',
  '--python',
  script,
  '--',
  transferPath,
  outputDir,
];
const child = spawnSync(blender, argv, { encoding: 'utf8' });
const witnessPath = join(outputDir, 'witness.json');
let witness = null;
let witnessError = null;
try {
  witness = JSON.parse(readFileSync(witnessPath, 'utf8'));
} catch (error) {
  witnessError = error.message;
}
const success = child.status === 0 && witness?.status === 'complete' &&
  Array.isArray(witness.outputs) && witness.outputs.length === 4;
const receipt = {
  schema: 'kaminos.m31-transfer-visual-witness-runner.v0',
  status: success ? 'complete' : 'failed',
  requestedRoute: 'exact-blender-binary-background-python',
  effectiveRoute: [blender, ...argv],
  fallbackUsed: false,
  childExitCode: child.status,
  childSignal: child.signal,
  witnessPath,
  witnessStatus: witness?.status ?? null,
  witnessOutputCount: witness?.outputs?.length ?? 0,
  failurePhase: success ? null : 'primary-output-validation',
  lastTrustworthyEvidence: success
    ? 'Blender exited zero and a complete four-frame witness manifest was parsed'
    : 'Blender process returned; completed witness manifest was not proved',
  witnessError,
  stdout: child.stdout,
  stderr: child.stderr,
  primaryOutput: success ? witnessPath : null,
};
const receiptPath = join(outputDir, 'runner-receipt.json');
const temporaryPath = `${receiptPath}.tmp`;
writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`);
renameSync(temporaryPath, receiptPath);
if (!success) {
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  process.exit(1);
}
console.log(JSON.stringify({ status: receipt.status, primaryOutput: receipt.primaryOutput }));
