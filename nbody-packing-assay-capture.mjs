import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { captureIndependentBrowserScreenshot } from './lib/receipt-bearing-browser-capture.mjs';

const STATES = Object.freeze(['known-feasible', 'crowded', 'sequential-counterfeit']);
const MODES = Object.freeze(['volume', 'slice']);

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

export async function captureNBodyPackingAssayState({
  baseUrl = 'http://127.0.0.1:8765/artifacts/nbody-packing-rosette-assay-v0/',
  state = 'crowded',
  mode = 'volume',
  outputPath = `artifacts/nbody-packing-rosette-assay-v0/${state}-${mode}.png`,
  reportPath = `artifacts/nbody-packing-rosette-assay-v0/${state}-${mode}-capture-report.json`,
  browserExecutable = process.env.KAMINOS_HEADLESS_BROWSER || null,
  viewport = { width:1400, height:900 },
  captureTimeoutMs = 20_000,
  cleanupGraceMs = 1_000,
  receiptRoot = process.cwd(),
} = {}) {
  if (!STATES.includes(state)) {
    throw new Error(`state must be known-feasible, crowded, or sequential-counterfeit, got ${state}`);
  }
  if (!MODES.includes(mode)) {
    throw new Error(`mode must be volume or slice, got ${mode}`);
  }
  const url = new URL(baseUrl);
  url.searchParams.set('state', state);
  url.searchParams.set('mode', mode);
  return captureIndependentBrowserScreenshot({
    cliExecutable:browserExecutable,
    url:url.href,
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
  const state = args.get('state') || 'crowded';
  const mode = args.get('mode') || 'volume';
  const outputPath = args.get('out') ||
    `artifacts/nbody-packing-rosette-assay-v0/${state}-${mode}.png`;
  const reportPath = args.get('report') ||
    `artifacts/nbody-packing-rosette-assay-v0/${state}-${mode}-capture-report.json`;
  const captured = await captureNBodyPackingAssayState({
    baseUrl:args.get('url') || undefined,
    state,
    mode,
    outputPath,
    reportPath,
    browserExecutable:args.get('browser') || process.env.KAMINOS_HEADLESS_BROWSER || null,
    viewport: {
      width:Number(args.get('width') || 1400),
      height:Number(args.get('height') || 900),
    },
    captureTimeoutMs:Number(args.get('timeout-ms') || 20_000),
    cleanupGraceMs:Number(args.get('cleanup-grace-ms') || 1_000),
  });
  process.stdout.write(`${JSON.stringify({
    status:captured.report.status,
    route:captured.report.route,
    browser:captured.report.browser,
    process:captured.report.process,
    primaryOutput:captured.report.primaryOutput,
    reportPath:path.resolve(reportPath),
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
