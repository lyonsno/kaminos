import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(
  index,
  /function kilnRouteBenchHeartbeatSummary\(/,
  'Generate route completion must translate heartbeat evidence into operator-readable copy',
);
assert.match(
  index,
  /The longest pause while the model was working was/,
  'Heartbeat copy must explain the observed pause instead of exposing only telemetry nouns',
);
assert.match(
  index,
  /backgroundHeartbeat/,
  'Generate route completion must consume the validated heartbeat projected by the adapter report',
);

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
  /id="sharp-breathing-room-comparison-button"/,
  'Generate panel must expose a one-action SHARP comparison smoke button',
);
assert.match(
  index,
  />Run comparison</,
  'Comparison button must use operator-facing copy instead of internal route profile ids',
);
assert.match(
  index,
  /async function runSharpBreathingRoomComparison\(/,
  'Generate panel must implement one operator action that runs default then friendly for comparison',
);
assert.match(
  index,
  /\{\s*profileId:\s*'baseline-default',\s*label:\s*'Default'\s*\}/,
  'Comparison action must include the default SHARP route in the ordered comparison steps',
);
assert.match(
  index,
  /\{\s*profileId:\s*'cooperative-spn-gaussian',\s*label:\s*'Friendly'\s*\}/,
  'Comparison action must include the friendly SHARP route in the ordered comparison steps',
);
assert.match(
  index,
  /runKilnRouteBenchRoute\('sharp-image-to-splat-live-v0',\s*step\.profileId\)/,
  'Comparison action must run each comparison step through the generic bench runner',
);
assert.match(
  index,
  /comparisonRuns:\s*\[\]/,
  'Route bench state must preserve a comparison run list so default/friendly results do not collapse into one status',
);
assert.match(
  index,
  /window\.__kaminosSharpBreathingRoomComparisonState/,
  'Comparison smoke must expose debug state for operator and witness inspection',
);
assert.match(
  index,
  /const SHARP_SPN_LOWRES_BLOCK_LABELS\s*=\s*\[/,
  'Comparison smoke must name the SPN lowres block labels Cranial asked Wake to verify',
);
for (const label of [
  'upsample-lowres',
  'readback-x2-upsampled',
  'readback-lowres',
  'cpu-concat-lowres',
  'concat-upload',
  'fuse-lowres',
]) {
  assert.match(
    index,
    new RegExp(label),
    `Comparison smoke must preserve the ${label} scheduler block label in live evidence`,
  );
}
assert.match(
  index,
  /const SHARP_MONODEPTH_PHASE_LABELS\s*=\s*\[/,
  'Comparison smoke must name the monodepth phase labels Cranial asked Wake to verify',
);
for (const label of [
  'project-feature',
  'fusion-resnet1',
  'fusion-skip-add',
  'fusion-resnet2',
  'fusion-out-conv',
  'head-conv0',
  'head-final',
]) {
  assert.match(
    index,
    new RegExp(label),
    `Comparison smoke must preserve the ${label} monodepth scheduler label in live evidence`,
  );
}
assert.match(
  index,
  /function sharpBreathingRoomComparisonRunEvidence\(/,
  'Comparison smoke must summarize each live run through a dedicated evidence object',
);
assert.match(
  index,
  /durationMs/,
  'Comparison smoke must preserve per-run duration evidence for Cranial route comparison',
);
assert.match(
  index,
  /effectiveScheduler/,
  'Comparison smoke must preserve the effective scheduler config for each run',
);
assert.match(
  index,
  /artifactSha256/,
  'Comparison smoke must preserve output hashes so default/friendly artifact equivalence is visible',
);
assert.match(
  index,
  /missingSpnFusionBlocks/,
  'Comparison smoke must fail loud when friendly telemetry does not include the expected SPN lowres labels',
);
assert.match(
  index,
  /lowresFusionCoverage/,
  'Comparison smoke must expose SPN lowres coverage on the comparison state instead of hiding it in raw reports',
);
assert.match(
  index,
  /monodepthPhaseCoverage/,
  'Comparison smoke must expose monodepth phase coverage on the comparison state instead of hiding it in raw reports',
);
assert.match(
  index,
  /outputEquivalence/,
  'Comparison smoke must compare default/friendly output hashes instead of implying success from completion alone',
);
assert.match(
  index,
  /Default then friendly/,
  'Comparison status must explain that the two runs are sequential, not simultaneous SHARP contention',
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
assert.match(
  index,
  /window\.kaminosSharpBreathingRoomKilnFireDebug/,
  'Kiln-fire activation must expose a narrow debug handle so witnesses can prove release without running SHARP inference',
);
assert.match(
  index,
  /async function endSharpBreathingRoomKilnFire\(/,
  'Kiln-fire release must be async so route completion waits for the volume renderer to actually stop',
);
assert.match(
  index,
  /await volumePrototype\.setActive\(false\)/,
  'Kiln-fire release must await the renderer deactivate path instead of firing and immediately showing the splat behind the flame',
);
assert.match(
  index,
  /volumeBridge\?\.forceHidden\?\.\('sharp-breathing-room-release'\)/,
  'Kiln-fire release must force-hide the main-renderer bridge so a stale flame frame cannot remain over the loaded splat',
);
assert.match(
  index,
  /async function confirmSharpBreathingRoomKilnFireReleased\(/,
  'Kiln-fire release must confirm the visible volume canvas has actually left its active state before the smoke reports completion',
);
assert.match(
  index,
  /canvasElement\(\)\?\.classList\?\.contains\('active'\)/,
  'Release confirmation must inspect the DOM canvas active class, not only the volume debug object',
);
assert.match(
  index,
  /await confirmSharpBreathingRoomKilnFireReleased\('sharp-breathing-room-release'\)/,
  'Completed SHARP routes must wait for confirmed visible furnace release before returning control to the operator',
);
assert.match(
  index,
  /composition:\s*'dom-webgpu-canvas-no-copy'/,
  'The volume bridge must name the no-copy DOM overlay path so fire visibility does not depend on a WebGPU canvas texture upload',
);
assert.doesNotMatch(
  index,
  /sourceTexture\.needsUpdate\s*=\s*true/,
  'The volume bridge must not upload the WebGPU volume canvas through a Three CanvasTexture during live inference',
);
assert.match(
  index,
  /window\._kaminosDirty\?\.\(\)/,
  'Kiln-fire release must dirty the main renderer after hiding the bridge so the cleared scene is painted',
);
assert.match(
  index,
  /await endSharpBreathingRoomKilnFire\('complete',\s*\{\s*forceInactive:\s*true\s*\}\)/,
  'A finished SHARP smoke must release the furnace even when the volume renderer was already active before the run',
);
