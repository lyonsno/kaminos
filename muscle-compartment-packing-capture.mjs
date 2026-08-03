import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { captureIndependentBrowserScreenshot } from './lib/receipt-bearing-browser-capture.mjs';

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) throw new Error(`unexpected positional argument: ${argument}`);
    const name = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${name}`);
    values.set(name, value);
    index += 1;
  }
  return values;
}

export async function captureMuscleCompartmentPackingState({
  baseUrl = 'http://127.0.0.1:8765/artifacts/muscle-compartment-packing-v0/',
  state = 'packed',
  outputPath = `artifacts/muscle-compartment-packing-v0/capture-${state}.png`,
  reportPath = `artifacts/muscle-compartment-packing-v0/capture-${state}-report.json`,
  browserExecutable = process.env.KAMINOS_HEADLESS_BROWSER || null,
  viewport = { width: 1400, height: 900 },
  captureTimeoutMs = 15_000,
  cleanupGraceMs = 1_000,
  receiptRoot = process.cwd(),
} = {}) {
  if (!['before', 'packed'].includes(state)) {
    throw new Error(`state must be before or packed, got ${state}`);
  }
  const url = new URL(baseUrl);
  url.searchParams.set('state', state);
  return captureIndependentBrowserScreenshot({
    cliExecutable: browserExecutable,
    url: url.href,
    outputPath,
    reportPath,
    viewport,
    captureTimeoutMs,
    cleanupGraceMs,
    receiptRoot,
  });
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const state = args.get('state') || 'packed';
  const outputPath = args.get('out') || `artifacts/muscle-compartment-packing-v0/capture-${state}.png`;
  const reportPath = args.get('report') || `artifacts/muscle-compartment-packing-v0/capture-${state}-report.json`;
  const result = await captureMuscleCompartmentPackingState({
    baseUrl: args.get('url') || undefined,
    state,
    outputPath,
    reportPath,
    browserExecutable: args.get('browser') || process.env.KAMINOS_HEADLESS_BROWSER || null,
    viewport: {
      width: Number(args.get('width') || 1400),
      height: Number(args.get('height') || 900),
    },
    captureTimeoutMs: Number(args.get('timeout-ms') || 15_000),
    cleanupGraceMs: Number(args.get('cleanup-grace-ms') || 1_000),
  });
  process.stdout.write(`${JSON.stringify({
    status: result.report.status,
    route: result.report.route,
    browser: result.report.browser,
    process: result.report.process,
    primaryOutput: result.report.primaryOutput,
    reportPath: path.resolve(reportPath),
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode ||= 1;
  });
}
