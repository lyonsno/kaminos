import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../volume-raymarch-filament-orbit-witness.mjs', import.meta.url), 'utf8');
const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const holdout = await import('../boundary-splat-camera-holdout-oracle.mjs');

assert.match(source, /--initial-field-manifest/, 'orbit witness accepts a checksum-addressed imported field');
assert.match(source, /beginDebugFullFieldImport/, 'orbit witness begins explicit imported-field custody');
assert.match(source, /finishDebugFullFieldImport/, 'orbit witness admits only a complete imported field');
assert.match(source, /fullFieldImportSessionId/, 'every frozen render remains bound to the import session');
assert.match(source, /imported-field-checksum-anchor-v0/, 'report names the alternate replay authority');
assert.match(source, /fluidSha256.*expectedAnchorFluidSha256/s, 'imported fluid is checked against the requested anchor');
assert.match(source, /frontSha256.*expectedAnchorFrontSha256/s, 'imported front is checked against the requested anchor');
assert.match(source, /independentlyRenderedToneMappedImageAdditivity/, 'orbit report preserves the no-image-addition transport contract');
assert.match(
  core,
  /async function sampleFrame[\s\S]*fullFieldImportSessionId[\s\S]*importedFieldCustody/,
  'readback capture remains lawful while an exact imported field owns the paused renderer',
);

const importedSource = {
  sourceSettingsPreset: { presetId: null, authority: null },
  sourceRouteAuthority: 'checksum-addressed-full-field-import-explicit-controls-hash-v0',
  replayAuthority: {
    warmupAuthority: 'imported-field-checksum-anchor-v0',
    warmupTarget: 96,
    warmupComplete: true,
    warmupReceipt: {
      ok: true,
      authority: 'imported-field-checksum-anchor-v0',
      completedSteps: 96,
      grid: 160,
      fluidSha256: 'fecde19cccf7859e592a7ef546c46b7c222ef01ade4c5ec1ab4fb8682bf8fa2f',
      frontSha256: 'fb299905a89392bf46f15d6b30f22873dd0e695daac78d9804ce5013a081be40',
    },
    freezeAfterWarmupRequested: true,
    postWarmupFreezeReceipt: {
      paused: true,
      frameCount: 96,
      simStepCount: 96,
      authority: 'checksum-addressed-full-field-import-pause-v0',
    },
  },
  frozenState: {
    frameCount: 96,
    simStepCount: 96,
    controlsHash: 'ba122038332747804203b4d03c6a5e9bf7b1e5969ec5d1f5ef995d3b5adff5b9',
  },
  importedFieldReceipt: {
    identity: 'checksum-addressed-full-field-import-receipt-v0',
    effective: {
      status: 'applied',
      initializationAuthority: 'checksum-addressed-live-replay-resume-v0',
      filterIdentity: 'exact-field-live-replay-application-v0',
      layoutIdentity: 'x-fastest-zyx-c-interleaved-v0',
      receiverInitialSimStepCount: 96,
      fluidSha256: 'fecde19cccf7859e592a7ef546c46b7c222ef01ade4c5ec1ab4fb8682bf8fa2f',
      frontSha256: 'fb299905a89392bf46f15d6b30f22873dd0e695daac78d9804ce5013a081be40',
      renderLoopPaused: true,
      effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
      backend: 'WebGPU:apple',
    },
  },
};
assert.equal(holdout.hasExactImportedFieldSourceIdentity(importedSource), true, 'exact imported field is an admitted source identity');
assert.equal(holdout.hasExactImportedFieldSourceIdentity({
  ...importedSource,
  importedFieldReceipt: {
    ...importedSource.importedFieldReceipt,
    effective: { ...importedSource.importedFieldReceipt.effective, frontSha256: '0'.repeat(64) },
  },
}), false, 'an imported field receipt with a mismatched effective hash is rejected');

console.log('volume raymarch filament imported-field orbit contracts passed');
