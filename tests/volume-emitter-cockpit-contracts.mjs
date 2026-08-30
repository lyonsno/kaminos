import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cockpit = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(
  cockpit,
  /import \{ applyVolumeEmitterFamilyRuntime, VOLUME_RUNTIME_EMITTER_FAMILIES \} from '\.\/volume-emitter-runtime\.mjs'/,
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
  /VOLUME_RUNTIME_EMITTER_FAMILIES\.includes\(requestedEmitterFamily\)/,
  'explicit route families are validated against the runtime contract',
);
assert.match(
  cockpit,
  /throw new Error\(`unsupported volume_emitter_family route:/,
  'unknown explicit emitter routes fail loud rather than falling back to cluster',
);
assert.match(
  cockpit,
  /function applyVolumeEmitterFamilyRuntimeToCockpit\(/,
  'cockpit has one named runtime composition boundary for controls and external carrier state',
);
assert.match(
  cockpit,
  /window\.__kaminosVolumeEmitterReceipt = receipt/,
  'cockpit publishes the complete requested/effective emitter receipt',
);
assert.match(cockpit, /id="volume-emitter-requested"/, 'requested family is human-visible');
assert.match(cockpit, /id="volume-emitter-effective"/, 'effective family is human-visible');
assert.match(cockpit, /id="volume-emitter-carrier"/, 'effective carrier mode/count are human-visible');
assert.match(cockpit, /id="volume-emitter-fallback"/, 'fallback status is human-visible');
assert.match(
  cockpit,
  /document\.getElementById\('volume-emitter-fallback'\)\.textContent = receipt\.fallbackUsed \? 'yes' : 'no'/,
  'visible fallback status derives from the durable runtime receipt',
);
assert.match(
  cockpit,
  /'emitter-assay-family'/,
  'emitter selection participates in the normal cockpit input/change sync path',
);
assert.match(
  cockpit,
  /applyVolumeEmitterFamilyRuntimeToCockpit\(readVolumeControls\(\)\)/,
  'initialization and interactive controls can share the same composition boundary',
);
const syntheticRefresh = cockpit.match(/const refreshSyntheticExternalEmitters = \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
assert.match(syntheticRefresh, /applyVolumeEmitterFamilyRuntimeToCockpit/, 'synthetic trails refresh through the canonical emitter source arbiter');
assert.doesNotMatch(syntheticRefresh, /setExternalEmitters/, 'synthetic trails have no competing direct carrier writer');

console.log('volume emitter cockpit contracts passed');
