import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { captureIndependentBrowserScreenshot } from './lib/receipt-bearing-browser-capture.mjs';

const STATES = Object.freeze([
  'known-feasible',
  'crowded',
  'sequential-counterfeit',
  'sparse-global-candidate',
  'joint-reference',
]);
const MODES = Object.freeze(['volume', 'slice']);
const EXPLICIT_WITNESS_STATES = new Set(['sparse-global-candidate', 'joint-reference']);
export const NBODY_PACKING_ASSAY_CAPTURE_VIEWPORT = Object.freeze({
  width:1400,
  height:900,
});

function requireEvidenceViewport(viewport) {
  if (
    !Number.isInteger(viewport?.width) ||
    !Number.isInteger(viewport?.height) ||
    viewport.width !== NBODY_PACKING_ASSAY_CAPTURE_VIEWPORT.width ||
    viewport.height !== NBODY_PACKING_ASSAY_CAPTURE_VIEWPORT.height
  ) {
    throw new Error(
      `N-body evidence viewport must be exactly ` +
      `${NBODY_PACKING_ASSAY_CAPTURE_VIEWPORT.width}x` +
      `${NBODY_PACKING_ASSAY_CAPTURE_VIEWPORT.height}`,
    );
  }
}

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
  baseUrl = null,
  state = 'crowded',
  mode = 'volume',
  outputPath = null,
  reportPath = null,
  browserExecutable = process.env.KAMINOS_HEADLESS_BROWSER || null,
  viewport = NBODY_PACKING_ASSAY_CAPTURE_VIEWPORT,
  captureTimeoutMs = 20_000,
  cleanupGraceMs = 1_000,
  receiptRoot = process.cwd(),
} = {}) {
  if (!STATES.includes(state)) {
    throw new Error(
      `state must be known-feasible, crowded, sequential-counterfeit, sparse-global-candidate, or joint-reference, got ${state}`,
    );
  }
  if (!MODES.includes(mode)) {
    throw new Error(`mode must be volume or slice, got ${mode}`);
  }
  requireEvidenceViewport(viewport);
  if (EXPLICIT_WITNESS_STATES.has(state) && (!baseUrl || !outputPath || !reportPath)) {
    throw new Error(
      `${state} capture requires an explicit baseUrl, outputPath, and reportPath`,
    );
  }
  const effectiveBaseUrl = baseUrl ||
    'http://127.0.0.1:8765/artifacts/nbody-packing-rosette-assay-v0/';
  const effectiveOutputPath = outputPath ||
    `artifacts/nbody-packing-rosette-assay-v0/${state}-${mode}.png`;
  const effectiveReportPath = reportPath ||
    `artifacts/nbody-packing-rosette-assay-v0/${state}-${mode}-capture-report.json`;
  const url = new URL(effectiveBaseUrl);
  url.searchParams.set('state', state);
  url.searchParams.set('mode', mode);
  return captureIndependentBrowserScreenshot({
    cliExecutable:browserExecutable,
    url:url.href,
    outputPath:effectiveOutputPath,
    reportPath:effectiveReportPath,
    viewport,
    captureTimeoutMs,
    cleanupGraceMs,
    receiptRoot,
    domDatasetKeys:['witnessLoaded', 'witnessState', 'witnessMode', 'witnessRoute'],
  });
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const state = args.get('state') || 'crowded';
  const mode = args.get('mode') || 'volume';
  const outputPath = args.get('out') || (EXPLICIT_WITNESS_STATES.has(state)
    ? null
    : `artifacts/nbody-packing-rosette-assay-v0/${state}-${mode}.png`);
  const reportPath = args.get('report') || (EXPLICIT_WITNESS_STATES.has(state)
    ? null
    : `artifacts/nbody-packing-rosette-assay-v0/${state}-${mode}-capture-report.json`);
  const captured = await captureNBodyPackingAssayState({
    baseUrl:args.get('url') || undefined,
    state,
    mode,
    outputPath,
    reportPath,
    browserExecutable:args.get('browser') || process.env.KAMINOS_HEADLESS_BROWSER || null,
    viewport: {
      width:Number(args.get('width') || NBODY_PACKING_ASSAY_CAPTURE_VIEWPORT.width),
      height:Number(args.get('height') || NBODY_PACKING_ASSAY_CAPTURE_VIEWPORT.height),
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
