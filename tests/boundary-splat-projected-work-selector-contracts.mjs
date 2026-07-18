import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const witness = await readFile(new URL('../volume-layer-coefficient-live-union-witness.mjs', import.meta.url), 'utf8');
const overlay = await readFile(new URL('../volume-layer-coefficient-live-union-overlay.mjs', import.meta.url), 'utf8');

assert.match(
  core,
  /BOUNDARY_SPLAT_PROJECTED_WORK_SELECTOR_IDENTITY\s*=\s*'boundary-splat-live-union-projected-footprint-hash-thinning-v0'/,
  'full-support projected-work selector identity must be durable and route-visible',
);
assert.match(
  core,
  /BOUNDARY_SPLAT_SOURCE_PRESERVING_SELECTOR_IDENTITY\s*=\s*'boundary-splat-live-union-source-preserving-v0'/,
  'uncapped source-preserving selector identity must remain explicit',
);
assert.match(
  core,
  /function normalizeBoundarySplatProjectedWorkTargetPixels/,
  'runtime must normalize the requested projected-work target instead of accepting stale/default values',
);
assert.match(
  core,
  /projectedWorkRejectedCount:\s*atomic<u32>/,
  'draw-state telemetry must count candidates rejected by projected-work selection',
);
assert.match(
  core,
  /selectorPolicyCode:\s*u32/,
  'draw-state telemetry must preserve the effective selector policy code',
);
assert.match(
  core,
  /requestedProjectedWorkTargetPixels:\s*u32/,
  'draw-state telemetry must preserve the requested projected-work target',
);
assert.match(
  core,
  /fn boundarySplatProjectedFootprintPixels\(/,
  'WGSL must estimate candidate-local projected footprint before admission',
);
assert.match(
  core,
  /fn boundarySplatProjectedWorkSurvivalProbability\(/,
  'WGSL must convert projected footprint into deterministic survival probability',
);
assert.match(
  core,
  /fn boundarySplatProjectedWorkSelectorKeeps\(/,
  'WGSL must own deterministic hash admission for projected-work thinning',
);
assert.match(
  core,
  /let projectedFootprintPixels = boundarySplatProjectedFootprintPixels[\s\S]*if \(!boundarySplatProjectedWorkSelectorKeeps[\s\S]*atomicAdd\(&boundarySplatDraw\.projectedWorkRejectedCount/,
  'compaction must reject after source-union counting but before candidate append',
);
assert.match(
  core,
  /let candidateIndex = atomicAdd\(&boundarySplatDraw\.candidateCount/,
  'selected candidate append must remain GPU-owned after projected-work admission',
);
assert.match(
  core,
  /boundarySplatDraw\.selectorPolicyCode = select\([\s\S]*BOUNDARY_SPLAT_SOURCE_PRESERVING_SELECTOR_CODE[\s\S]*BOUNDARY_SPLAT_PROJECTED_WORK_SELECTOR_CODE[\s\S]*requestedTarget > 0u/,
  'finalize pass must publish projected-work selector policy when the target is active',
);
assert.match(
  core,
  /state\.boundarySplatProjectedWorkRejectedCount = drawState\[13\]/,
  'async telemetry must preserve projected-work rejection count',
);
assert.match(
  core,
  /projectedWorkRejectedCount: drawState\[13\]/,
  'synchronous draw-state witness must preserve projected-work rejection count',
);
assert.match(
  core,
  /boundarySplatSelectorPolicyIdentity/,
  'debug state must expose effective selector identity',
);
assert.match(
  core,
  /boundarySplatRequestedProjectedWorkTargetPixels/,
  'debug state must expose requested projected-work target',
);
assert.match(
  core,
  /boundarySplatEffectiveProjectedWorkTargetPixels/,
  'debug state must expose effective projected-work target',
);
assert.match(
  witness,
  /boundarySplatProjectedWorkRejectedCount/,
  'Greenroom witness must preserve projected-work rejection telemetry',
);
assert.match(
  witness,
  /boundarySplatSelectorPolicyIdentity/,
  'Greenroom witness must preserve effective selector identity',
);
assert.match(
  witness,
  /--projected-work-target-pixels/,
  'Greenroom witness must expose an explicit projected-work selector target',
);
assert.match(
  witness,
  /boundarySplatProjectedWorkTargetPixels:\s*projectedWorkTargetPixels/,
  'Greenroom witness must route the requested selector target into runtime controls',
);
assert.match(
  witness,
  /unionReceipt[\s\S]*selectorActive[\s\S]*stableNativeCellIdSha256/,
  'Greenroom witness must stop comparing selected native ids to the full-source hash when selector reduction is active',
);
assert.match(
  witness,
  /receiptFullUnionCount[\s\S]*auditFullUnionCount/,
  'Greenroom witness must compare selector full-union counts through route-visible audit fields, not source-preserving-only initial draw fields',
);
assert.match(
  overlay,
  /PROJECTED_WORK_SELECTOR_IDENTITY\s*=\s*'boundary-splat-live-union-projected-footprint-hash-thinning-v0'/,
  'coefficient overlay population audit must preserve the exact projected-work selector identity',
);
assert.match(
  overlay,
  /selectorSubsetCoveredByFullOverlay[\s\S]*lookupMissCount === 0[\s\S]*lookupExtraCount > 0/,
  'coefficient overlay population audit must accept a selector-thinned subset only when the full overlay covers every selected candidate and selector identity is explicit',
);

console.log('boundary splat projected-work selector contracts passed');
