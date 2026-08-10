import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { captureIndependentBrowserScreenshot } from './lib/receipt-bearing-browser-capture.mjs';

export const NBODY_PACKING_GENERALIZATION_CAPTURE_VIEWPORT = Object.freeze({
  width:1400,
  height:900,
});

export async function captureNBodyPackingGeneralizationState({
  baseUrl = null,
  memberCount = null,
  state = 'crowded',
  mode = 'volume',
  outputPath = null,
  reportPath = null,
  browserExecutable = process.env.KAMINOS_HEADLESS_BROWSER || null,
  viewport = NBODY_PACKING_GENERALIZATION_CAPTURE_VIEWPORT,
  captureTimeoutMs = 20_000,
  cleanupGraceMs = 1_000,
  receiptRoot = process.cwd(),
} = {}) {
  if (![4, 6, 8].includes(memberCount)) {
    throw new Error('memberCount must be exactly 4, 6, or 8');
  }
  if (!['crowded', 'packed', 'reference'].includes(state)) {
    throw new Error('state must be crowded, packed, or reference');
  }
  if (!['volume', 'slice'].includes(mode)) {
    throw new Error('mode must be volume or slice');
  }
  if (
    viewport?.width !== NBODY_PACKING_GENERALIZATION_CAPTURE_VIEWPORT.width ||
    viewport?.height !== NBODY_PACKING_GENERALIZATION_CAPTURE_VIEWPORT.height
  ) {
    throw new Error('generalization evidence viewport must be exactly 1400x900');
  }
  if (!baseUrl || !outputPath || !reportPath) {
    throw new Error('generalization capture requires explicit baseUrl, outputPath, and reportPath');
  }
  const url = new URL(baseUrl);
  url.searchParams.set('count', String(memberCount));
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
    domDatasetKeys:['witnessLoaded', 'witnessState', 'witnessMode', 'witnessRoute', 'memberCount'],
  });
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
  const captured = await captureNBodyPackingGeneralizationState({
    baseUrl:args.get('url'),
    memberCount:Number(args.get('count')),
    state:args.get('state') || 'crowded',
    mode:args.get('mode') || 'volume',
    outputPath:args.get('out'),
    reportPath:args.get('report'),
    browserExecutable:args.get('browser') || process.env.KAMINOS_HEADLESS_BROWSER || null,
  });
  process.stdout.write(`${JSON.stringify({
    status:captured.report.status,
    route:captured.report.route,
    browser:captured.report.browser,
    process:captured.report.process,
    domDataset:captured.report.domDataset,
    primaryOutput:captured.report.primaryOutput,
    reportPath:path.resolve(args.get('report')),
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
