import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cockpit = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(
  cockpit,
  /import \{ applyVolumeEmitterFamilyRuntime, resolveVolumeEmitterRoute \} from '\.\/volume-emitter-runtime\.mjs'/,
  'cockpit consumes the tested emitter runtime adapter instead of reconstructing morphology inline',
);
assert.match(
  cockpit,
  /id="emitter-assay-family"[^>]+data-volume-assay-control="emitter-family"/,
  'cockpit exposes emitter family selection as an invocation-scoped assay control',
);
assert.doesNotMatch(
  cockpit,
  /id="volume-emitter-family"/,
  'the assay selector stays outside Handy-owned volume-* settings inventory until consumer composition',
);
for (const family of ['cluster', 'wick', 'nozzle', 'ribbon', 'ring']) {
  assert.match(cockpit, new RegExp(`<option value="${family}"`), `cockpit exposes the ${family} family`);
}
assert.match(cockpit, /params\.get\('volume_emitter_family'\)/, 'emitter family is reproducible by route');
assert.match(
  cockpit,
  /\['emitterFamily', 'volume_emitter_family'\]/,
  'copied and stored Basin identity includes the selected emitter family',
);
assert.match(
  cockpit,
  /buildVolumeBasinUrl as buildVolumeBasinRuntimeUrl[\s\S]*restoreVolumeBasinState[\s\S]*from '\.\/volume-basin-runtime\.mjs'/,
  'the cockpit consumes the executable production Basin boundary',
);
assert.match(
  cockpit,
  /return buildVolumeBasinRuntimeUrl\(\{[\s\S]*controls: controlsSnapshot,[\s\S]*routeFields: VOLUME_BASIN_ROUTE_FIELDS/,
  'copied Basin URLs run through the tested serializer with the production route field inventory',
);
assert.match(
  cockpit,
  /emitterFamily:\s*document\.getElementById\('emitter-assay-family'\)\.value/,
  'the production controls snapshot records emitter family identity',
);
assert.match(
  cockpit,
  /restoreVolumeBasinSnapshot\(applyVolumeEmitterFamilyRuntimeToCockpit\)/,
  'restoring the autosaved Basin passes through the emitter runtime composition boundary',
);
assert.match(
  cockpit,
  /restoreVolumeBasinSlot\(selectedVolumeBasinSlot\(\), applyVolumeEmitterFamilyRuntimeToCockpit\)/,
  'restoring a named Basin slot passes through the emitter runtime composition boundary',
);
for (const restoreName of ['restoreVolumeBasinSnapshot', 'restoreVolumeBasinSlot']) {
  const restoreBody = cockpit.match(new RegExp(`function ${restoreName}\\([\\s\\S]*?\\n}`))?.[0] || '';
  assert.match(restoreBody, /restoreVolumeBasinState\(\{/, `${restoreName} uses the executable restore orchestrator`);
  assert.match(restoreBody, /applyControls: applyVolumeControlsSnapshot/, `${restoreName} restores the DOM controls`);
  assert.match(restoreBody, /readControls: readVolumeControls/, `${restoreName} rereads the effective DOM state`);
  assert.match(restoreBody, /applyRuntime:/, `${restoreName} applies the restored runtime after the DOM state`);
}
assert.match(
  cockpit,
  /resolveVolumeEmitterRoute\(\{[\s\S]*requestedFamily:[\s\S]*requestedExternalMode:/,
  'family and external-source route identity share one executable admission contract',
);
assert.match(
  cockpit,
  /function applyVolumeEmitterFamilyRuntimeToCockpit\(/,
  'cockpit has one named runtime composition boundary for controls and emitter morphology',
);
assert.match(
  cockpit,
  /const activeRouteReceipt = resolveVolumeEmitterRoute\(\{[\s\S]*requestedFamily: controlsSnapshot\.emitterFamily[\s\S]*receipt\.routeReceipt = activeRouteReceipt/,
  'runtime receipts resolve authority from the restored controls instead of retaining initial-page route identity',
);
assert.match(
  cockpit,
  /window\.__kaminosVolumeEmitterReceipt = receipt/,
  'cockpit publishes the complete requested/effective emitter receipt',
);
assert.match(cockpit, /id="volume-emitter-requested"/, 'requested family is human-visible');
assert.match(cockpit, /id="volume-emitter-effective"/, 'effective family is human-visible');
assert.match(cockpit, /id="volume-emitter-carrier"/, 'effective carrier mode/count are human-visible');
assert.match(cockpit, /id="volume-emitter-owner"/, 'effective source owner has its own non-truncated visible field');
assert.match(cockpit, /id="volume-emitter-core-flow"/, 'effective core flow has its own visible field');
assert.match(cockpit, /id="volume-emitter-external-requested"/, 'requested external source identity has its own visible field');
assert.match(cockpit, /id="volume-emitter-external-effective"/, 'effective external source identity has its own visible field');
assert.match(cockpit, /receipt\.coreSourceReceipt\.effectiveOwner/, 'the human-visible source receipt names the authoritative effective owner');
assert.match(cockpit, /receipt\.coreSourceReceipt\.effectiveFlowRate/, 'the human-visible source receipt discloses effective core flow');
assert.match(cockpit, /receipt\.requested\.externalSourceMode/, 'the human-visible source receipt preserves requested external-source identity');
assert.match(cockpit, /id="volume-emitter-fallback"/, 'fallback status is human-visible');
assert.match(
  cockpit,
  /document\.getElementById\('volume-emitter-fallback'\)\.textContent = receipt\.fallbackUsed \? 'yes' : 'no'/,
  'visible fallback status derives from the durable runtime receipt',
);
assert.match(
  cockpit,
  /const emitterMorphologyControls = new Set\(\['emitter-assay-family', 'volume-input-radius', 'volume-flow-rate'\]\)/,
  'only morphology-bearing controls enter the analytic descriptor path',
);
assert.match(
  cockpit,
  /applyVolumeEmitterFamilyRuntimeToCockpit\(readVolumeControls\(\)\)/,
  'initialization and interactive controls can share the same composition boundary',
);
const syntheticRefresh = cockpit.match(/const refreshSyntheticExternalEmitters = \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
assert.doesNotMatch(syntheticRefresh, /applyVolumeEmitterFamilyRuntimeToCockpit/, 'dynamic trail refresh does not reapply controls or fixed morphology');
assert.match(syntheticRefresh, /setExternalEmitters/, 'the generic carrier remains the direct dynamic-trail transport');

console.log('volume emitter cockpit contracts passed');
