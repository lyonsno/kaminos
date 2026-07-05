import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(
  index,
  /id="kiln-route-bench-panel"/,
  'Generate panel must expose a route-generic kiln bench, not only a SHARP-specific smoke card',
);
assert.match(
  index,
  /data-kiln-route-bench="generate"/,
  'Generate route bench must carry a stable smoke selector for browser witnesses',
);
assert.match(
  index,
  /const KILN_ROUTE_BENCH_ROUTES\s*=/,
  'Generate route bench must define routes as data so SHARP is the first route, not the whole UI contract',
);
assert.match(
  index,
  /pipelineId:\s*'sharp-image-to-splat-live-v0'/,
  'Kiln route bench must keep SHARP as a route definition with explicit pipeline identity',
);
assert.match(
  index,
  /sourceKind:\s*'image'/,
  'Kiln route bench route definitions must declare their source kind for MoGE/Lotus/CHORD composition',
);
assert.match(
  index,
  /function renderKilnRouteBench\(/,
  'Generate surface must render through a generic kiln route bench helper',
);
assert.match(
  index,
  /function kilnRouteBenchSelectedSource\(/,
  'Generate route bench must resolve the selected image through a shared source helper',
);
assert.match(
  index,
  /function runKilnRouteBenchRoute\(/,
  'Generate route bench buttons must actuate routes through a generic runner before calling SHARP-specific compatibility wrappers',
);
assert.match(
  index,
  /window\.__kaminosKilnRouteBenchState/,
  'Route bench must expose debug state so smokes can prove source, route, status, and result truth',
);
assert.match(
  index,
  /Choose an image, pick a route, and cook it into an asset/,
  'Route bench primary copy must explain the operator flow in ordinary language',
);
assert.doesNotMatch(
  index,
  /Root Request|root request|Evidence Bundle|evidence bundle/,
  'Generate route bench must not expose internal ontology as operator-facing primary copy',
);

assert.match(
  index,
  /id="sharp-breathing-room-default-button"/,
  'Generate panel must expose a dedicated default SHARP route button',
);
assert.match(
  index,
  /id="sharp-breathing-room-friendly-button"/,
  'Generate panel must expose a dedicated friendly SHARP route button',
);
assert.match(
  index,
  />Run default</,
  'Default route button must use operator-facing copy instead of an internal profile id',
);
assert.match(
  index,
  />Run friendly</,
  'Friendly route button must use operator-facing copy instead of an internal profile id',
);
assert.doesNotMatch(
  index,
  /<button[^>]*>(?:(?!<\/button>).)*cooperative-spn-gaussian(?:(?!<\/button>).)*<\/button>/s,
  'Internal cooperative profile id must not be visible as button copy',
);
assert.match(
  index,
  /function runSharpBreathingRoomProfile\(/,
  'Generate panel buttons must call a live profile runner rather than acting as static diagnostics',
);
assert.match(
  index,
  /schedulerProfileId:\s*profileId/,
  'Live profile runner must send the selected scheduler profile id to the server',
);
assert.match(
  index,
  /runSharpBreathingRoomProfile\('baseline-default'\)/,
  'Default button must actuate the baseline-default profile',
);
assert.match(
  index,
  /runSharpBreathingRoomProfile\('cooperative-spn-gaussian'\)/,
  'Friendly button must actuate the cooperative profile',
);
assert.match(
  index,
  /sharp-breathing-room-status/,
  'Generate panel must show the route status beside the two buttons',
);
assert.match(
  index,
  /function pipelineRunFailureSummary\(/,
  'Generate panel failures must extract backend report details instead of showing only generic failure copy',
);
assert.match(
  index,
  /stderrTail/,
  'Failure summary must inspect adapter stderr when the run fails before output',
);
assert.match(
  index,
  /adapterReport\?\.phase/,
  'Failure summary must expose adapter report phase when available',
);
assert.match(
  index,
  /adapterReport\?\.failure\?\.operatorMessage/,
  'Failure summary must prefer operator-facing adapter failure copy when the live route records one',
);
assert.match(
  index,
  /lastTrustworthyEvidence\?\.browserLastMilestone/,
  'Failure summary must expose the last trustworthy SHARP browser milestone when a run fails before PLY output',
);
assert.match(
  index,
  /Friendly gives SHARP more room/,
  'Generate panel must steer live smoke toward the cooperative route while preserving default as a comparison path',
);
assert.match(
  index,
  /function ensureSharpBreathingRoomImageAssets\(/,
  'Generate panel must load indexed Kaminos image assets instead of depending on a pasted smoke URL',
);
assert.match(
  index,
  /loadPipelineAssetKind\('image'\)/,
  'Generate panel must source its default SHARP input from the real image asset index',
);
assert.match(
  index,
  /function pipelineBestSharpSourceImage\(/,
  'Generate panel must choose a real image asset and reject tiny proxy fixtures as default smoke inputs',
);
assert.match(
  index,
  /pipeline-test-image/,
  'Default SHARP image selection must explicitly avoid the 1x1 pipeline test fixtures',
);
assert.match(
  index,
  /id="sharp-breathing-room-source-preview"/,
  'Generate panel must preview the exact image source before SHARP runs',
);
assert.match(
  index,
  /pipelineLoadRunSplatArtifact\(run,\s*artifact\)/,
  'A successful Generate-panel SHARP run must load its produced splat from the run-local result instead of sending the operator to hunt in Greenroom',
);
assert.match(
  index,
  /async function beginSharpBreathingRoomKilnFire\(/,
  'Generate panel must have an explicit kiln-fire activation helper for live SHARP runs',
);
assert.match(
  index,
  /beginSharpBreathingRoomKilnFire\(\{\s*profileId,\s*source,\s*pipelineId/s,
  'Run default/friendly must ignite the live kiln before starting SHARP inference',
);
assert.match(
  index,
  /volumePrototype\.setActive\(true\)/,
  'Kiln-fire activation must turn on the existing volume renderer instead of only changing status text',
);
assert.match(
  index,
  /window\.__kaminosSharpBreathingRoomKilnFireState/,
  'Kiln-fire activation must expose debug state so smokes can prove the run button actually ignited the furnace',
);
