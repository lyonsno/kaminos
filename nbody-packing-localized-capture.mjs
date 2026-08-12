#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { captureIndependentBrowserScreenshot } from './lib/receipt-bearing-browser-capture.mjs';

const STATES = Object.freeze([
  'pass-crowded', 'last-pass', 'fail-crowded', 'first-fail',
  'same-basis-feasible', 'all-neighbor-restoration', 'reference',
]);
export const NBODY_PACKING_LOCALIZED_CAPTURE_VIEWPORT = Object.freeze({
  width:1400,
  height:900,
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeJsonAtomically(targetPath, value) {
  await mkdir(path.dirname(path.resolve(targetPath)), { recursive:true });
  const temporaryPath = `${path.resolve(targetPath)}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, path.resolve(targetPath));
}

export async function captureNBodyPackingLocalizedState({
  baseUrl = null,
  state = 'fail-crowded',
  mode = 'volume',
  outputPath = null,
  reportPath = null,
  browserExecutable = process.env.KAMINOS_HEADLESS_BROWSER || null,
  viewport = NBODY_PACKING_LOCALIZED_CAPTURE_VIEWPORT,
  captureTimeoutMs = 20_000,
  cleanupGraceMs = 1_000,
  receiptRoot = process.cwd(),
} = {}) {
  if (!STATES.includes(state)) throw new Error('localized capture state is unsupported');
  if (!['volume', 'slice'].includes(mode)) throw new Error('localized capture mode is unsupported');
  if (
    viewport?.width !== NBODY_PACKING_LOCALIZED_CAPTURE_VIEWPORT.width ||
    viewport?.height !== NBODY_PACKING_LOCALIZED_CAPTURE_VIEWPORT.height
  ) throw new Error('localized evidence viewport must be exactly 1400x900');
  if (!baseUrl || !outputPath || !reportPath) {
    throw new Error('localized capture requires explicit baseUrl, outputPath, and reportPath');
  }
  const url = new URL(baseUrl);
  url.searchParams.set('state', state);
  url.searchParams.set('mode', mode);
  let sourceDocument;
  try {
    const response = await fetch(url.href, { cache:'no-store' });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok || bytes.length === 0) {
      throw new Error(`served localized witness returned HTTP ${response.status} with ${bytes.length} bytes`);
    }
    sourceDocument = {
      status:'complete',
      url:url.href,
      httpStatus:response.status,
      sizeBytes:bytes.length,
      sha256:sha256(bytes),
    };
  } catch (error) {
    await writeJsonAtomically(reportPath, {
      schema:'kaminos.nbody-packing-localized-capture-wrapper.v0',
      status:'failed',
      route:{ requested:'independent-headless-screenshot-v0', effective:null, fallbackUsed:false },
      failurePhase:'fetch-source-document',
      lastTrustworthyEvidence:{ phase:'validated-invocation', url:url.href, state, mode },
      error:{ name:error.name, message:error.message },
    });
    throw error;
  }
  const captured = await captureIndependentBrowserScreenshot({
    cliExecutable:browserExecutable,
    url:url.href,
    outputPath,
    reportPath,
    viewport,
    captureTimeoutMs,
    cleanupGraceMs,
    receiptRoot,
    domDatasetKeys:[
      'witnessLoaded', 'witnessState', 'witnessMode', 'witnessRoute',
      'fixturesSha256', 'resultsSha256',
    ],
  });
  const amendedReport = { ...captured.report, sourceDocument };
  await writeJsonAtomically(reportPath, amendedReport);
  return { ...captured, report:amendedReport };
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) throw new Error(`unexpected positional argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${argument}`);
    values.set(argument.slice(2), value);
    index += 1;
  }
  return values;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const captured = await captureNBodyPackingLocalizedState({
    baseUrl:args.get('url'), state:args.get('state') || 'fail-crowded',
    mode:args.get('mode') || 'volume', outputPath:args.get('out'),
    reportPath:args.get('report'), browserExecutable:args.get('browser') || null,
  });
  process.stdout.write(`${JSON.stringify({ status:captured.report.status, route:captured.report.route, browser:captured.report.browser, process:captured.report.process, domDataset:captured.report.domReceipt?.dataset, primaryOutput:captured.report.primaryOutput, reportPath:path.resolve(args.get('report')) }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
}
