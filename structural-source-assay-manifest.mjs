#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { buildStructuralSourceGenerationManifest } from './structural-source-assay-core.mjs';

const REPORT_SCHEMA = 'kaminos.structural-source-manifest-report.v0';

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || value === undefined) {
      throw new Error(`Expected --name value arguments; received ${name ?? '<end>'}`);
    }
    values[name.slice(2)] = value;
  }
  if (!values.input || !values.output) {
    throw new Error('Both --input and --output are required');
  }
  return values;
}

function optionValue(argv, name) {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : null;
  return value && !value.startsWith('--') ? value : null;
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function failureReport({
  requestedInputPath,
  requestedOutputPath,
  effectiveInputPath,
  effectiveOutputPath,
  failurePhase,
  inputHash,
  validation = null,
  message,
}) {
  return {
    schema: REPORT_SCHEMA,
    status: 'failed',
    failurePhase,
    requestedInputPath,
    effectiveInputPath,
    requestedOutputPath,
    effectiveOutputPath,
    lastTrustworthyEvidence: { inputHash },
    validation,
    manifest: null,
    error: message,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    const requestedInputPath = optionValue(argv, '--input');
    const requestedOutputPath = optionValue(argv, '--output');
    if (requestedOutputPath) {
      const effectiveOutputPath = resolve(requestedOutputPath);
      await writeJson(effectiveOutputPath, failureReport({
        requestedInputPath,
        requestedOutputPath,
        effectiveInputPath: requestedInputPath ? resolve(requestedInputPath) : null,
        effectiveOutputPath,
        failurePhase: 'argument-parse',
        inputHash: null,
        message: error.message,
      }));
    }
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  const requestedInputPath = args.input;
  const requestedOutputPath = args.output;
  const effectiveInputPath = resolve(requestedInputPath);
  const effectiveOutputPath = resolve(requestedOutputPath);
  let inputBytes;
  let inputHash = null;

  try {
    inputBytes = await readFile(effectiveInputPath);
    inputHash = sha256(inputBytes);
  } catch (error) {
    await writeJson(effectiveOutputPath, failureReport({
      requestedInputPath,
      requestedOutputPath,
      effectiveInputPath,
      effectiveOutputPath,
      failurePhase: 'input-read',
      inputHash,
      message: error.message,
    }));
    process.stderr.write(`Gate-0 manifest failed during input-read: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  let assay;
  try {
    assay = JSON.parse(inputBytes.toString('utf8'));
  } catch (error) {
    await writeJson(effectiveOutputPath, failureReport({
      requestedInputPath,
      requestedOutputPath,
      effectiveInputPath,
      effectiveOutputPath,
      failurePhase: 'input-parse',
      inputHash,
      message: error.message,
    }));
    process.stderr.write(`Gate-0 manifest failed during input-parse: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const manifest = buildStructuralSourceGenerationManifest(assay);
    manifest.execution = {
      requestedInputPath,
      effectiveInputPath,
      requestedOutputPath,
      effectiveOutputPath,
      inputHash,
    };
    await writeJson(effectiveOutputPath, manifest);
  } catch (error) {
    const failurePhase = error.failurePhase ?? 'manifest-build';
    await writeJson(effectiveOutputPath, failureReport({
      requestedInputPath,
      requestedOutputPath,
      effectiveInputPath,
      effectiveOutputPath,
      failurePhase,
      inputHash,
      validation: error.validation ?? null,
      message: error.message,
    }));
    process.stderr.write(`Gate-0 manifest failed during ${failurePhase}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

await main();
