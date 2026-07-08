import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(
  indexHtml,
  /const KILN_ROUTE_BENCH_ROUTES\s*=\s*\[/,
  'Generate must expose the shared kiln route bench route registry'
);

assert.match(
  indexHtml,
  /KILN_ROUTE_BENCH_ROUTES[\s\S]*moge\.depth-normal\.webgpu-local\.v0/,
  'MoGE must be registered as a route in the shared Generate kiln bench instead of living only in Greenroom'
);

assert.match(
  indexHtml,
  /moge\.depth-normal\.webgpu-local\.v0[\s\S]*sourceKind:\s*'image'/,
  'MoGE kiln bench route must declare image source semantics'
);

assert.match(
  indexHtml,
  /moge\.depth-normal\.webgpu-local\.v0[\s\S]*runMogeGreenroomKilnRouteBenchRoute/,
  'MoGE kiln bench route must dispatch through the Greenroom browser runner path'
);

assert.match(
  indexHtml,
  /runMogeGreenroomKilnRouteBenchRoute[\s\S]*queueBrowserWebGpuPreviewRoute/,
  'MoGE Generate bench runs must keep the queued Greenroom browser runner as the default execution path'
);

assert.match(
  indexHtml,
  /window\.__kaminosKilnRouteBenchState[\s\S]*moge/,
  'Kiln bench debug state must expose MoGE route state for smoke evidence'
);

assert.match(
  indexHtml,
  /data-kiln-route-bench-route-id="moge\.depth-normal\.webgpu-local\.v0"/,
  'Generate bench must expose a stable MoGE route DOM hook'
);
