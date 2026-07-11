import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.doesNotMatch(
  html,
  /#crucible-viewport-workspace\s*\{[^}]*pointer-events:\s*none/s,
  'The Crucible workroom must accept pointer input instead of behaving like an untouchable overlay',
);

const requiredControls = [
  ['crucible-viewport-source-select', 'The source plate must expose a direct image chooser'],
  ['crucible-viewport-route-select', 'The firing mouth must expose the intended output route'],
  ['crucible-viewport-profile-select', 'The firing mouth must expose the available firing behavior'],
  ['crucible-viewport-fire-button', 'The firing mouth must expose one obvious primary command'],
  ['crucible-viewport-cast-button', 'The cast tray must expose the finished cast action'],
];

for (const [id, message] of requiredControls) {
  assert.match(html, new RegExp(`id=["']${id}["']`), message);
}

assert.match(
  html,
  /function renderCrucibleViewportSourceOptions\(/,
  'The plate chooser must render from the real indexed image assets',
);
assert.match(
  html,
  /pipelineDockState\.browserAssetsByKind\?\.image/,
  'The plate chooser must consume the shared image index rather than a private fixture list',
);
assert.match(
  html,
  /function selectCrucibleViewportSource\(assetId\)[\s\S]*pipelineDockState\.browserSelectedAssetIds\.image\s*=\s*assetId/,
  'Choosing a plate image must update the existing shared source selection',
);

assert.match(
  html,
  /function runCrucibleViewportFiring\([\s\S]*runKilnRouteBenchRoute\(route\.id,\s*profileId\)/,
  'The central fire command must invoke the existing route runner with the effective route and profile',
);
assert.match(
  html,
  /fireButton\.disabled\s*=\s*running\s*\|\|\s*!currentSource\?\.source/,
  'The central fire command must fail visibly disabled without a source or while another firing runs',
);
assert.match(
  html,
  /workspace\.dataset\.crucibleRouteStatus\s*=\s*kilnRouteBenchState\.status/,
  'The workroom must expose the real route status used by its controls',
);

assert.match(
  html,
  /castButton\.disabled\s*=\s*!lastCast\?\.assetId\s*\|\|\s*!castRecord/,
  'The cast action must stay disabled until its recorded scene object still exists',
);
assert.match(
  html,
  /function openCrucibleViewportCast\([\s\S]*window\.selectSceneObject\(lastCast\.assetId\)[\s\S]*setActiveTab\('assets'\)/,
  'Opening a cast must select the recorded scene object and move to the actual asset surface',
);
assert.match(
  html,
  /window\.kaminosCrucibleViewportDebugState\s*=\s*crucibleViewportDebugState/,
  'Browser witnesses must be able to read effective source, route, profile, running, and cast-target state',
);

console.log('Crucible viewport interaction contracts passed.');
