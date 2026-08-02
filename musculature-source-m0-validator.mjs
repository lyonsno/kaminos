#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  FAIL_MUSCULATURE_SOURCE,
  validateMusculatureSourceM0,
} from './musculature-source-m0-core.mjs';

export const MUSCULATURE_SOURCE_M0_REPORT_SCHEMA = 'kaminos.musculature-source-m0-report.v0';

function optionValue(argv, name) {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : null;
  return value && !value.startsWith('--') ? value : null;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`Expected --name value arguments; received ${name ?? '<end>'}`);
    }
    values[name.slice(2)] = value;
  }
  if (!values.input || !values.output) throw new Error('Both --input and --output are required');
  return values;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function failedReport({
  requestedInputPath,
  effectiveInputPath,
  requestedOutputPath,
  effectiveOutputPath,
  failurePhase,
  inputSha256,
  message,
}) {
  return {
    schema: MUSCULATURE_SOURCE_M0_REPORT_SCHEMA,
    status: 'failed-to-validate',
    disposition: null,
    failurePhase,
    requestedInputPath,
    effectiveInputPath,
    requestedOutputPath,
    effectiveOutputPath,
    lastTrustworthyEvidence: { inputSha256 },
    validation: null,
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
      await writeJson(effectiveOutputPath, failedReport({
        requestedInputPath,
        effectiveInputPath: requestedInputPath ? resolve(requestedInputPath) : null,
        requestedOutputPath,
        effectiveOutputPath,
        failurePhase: 'argument-parse',
        inputSha256: null,
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
  let inputSha256 = null;

  try {
    inputBytes = await readFile(effectiveInputPath);
    inputSha256 = sha256(inputBytes);
  } catch (error) {
    await writeJson(effectiveOutputPath, failedReport({
      requestedInputPath,
      effectiveInputPath,
      requestedOutputPath,
      effectiveOutputPath,
      failurePhase: 'input-read',
      inputSha256,
      message: error.message,
    }));
    process.stderr.write(`Track M M0 failed during input-read: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  let receipt;
  try {
    receipt = JSON.parse(inputBytes.toString('utf8'));
  } catch (error) {
    await writeJson(effectiveOutputPath, failedReport({
      requestedInputPath,
      effectiveInputPath,
      requestedOutputPath,
      effectiveOutputPath,
      failurePhase: 'input-parse',
      inputSha256,
      message: error.message,
    }));
    process.stderr.write(`Track M M0 failed during input-parse: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  const validation = validateMusculatureSourceM0(receipt);
  const report = {
    schema: MUSCULATURE_SOURCE_M0_REPORT_SCHEMA,
    status: 'validated',
    disposition: validation.disposition,
    failurePhase: null,
    requestedInputPath,
    effectiveInputPath,
    requestedOutputPath,
    effectiveOutputPath,
    lastTrustworthyEvidence: {
      inputSha256,
      receiptSha256: validation.receiptSha256,
      sourceId: validation.sourceId,
      sourceSha256: validation.sourceSha256,
      controlId: validation.controlId,
      controlSha256: validation.controlSha256,
    },
    validation,
    error: null,
  };
  await writeJson(effectiveOutputPath, report);
  if (validation.disposition === FAIL_MUSCULATURE_SOURCE) process.exitCode = 1;
}

await main();
