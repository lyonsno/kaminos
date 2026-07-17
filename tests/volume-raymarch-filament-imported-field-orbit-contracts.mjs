import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../volume-raymarch-filament-orbit-witness.mjs', import.meta.url), 'utf8');
const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');

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

console.log('volume raymarch filament imported-field orbit contracts passed');
