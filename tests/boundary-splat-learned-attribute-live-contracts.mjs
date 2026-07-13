import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const witness = await readFile(new URL('../volume-witness.mjs', import.meta.url), 'utf8');
const liveModel = await readFile(new URL('../models/boundary-splat-attribute/live-support-h64-v0/boundary-splat-attribute-model.generated.js', import.meta.url), 'utf8').catch(() => '');

assert.match(core, /import\s*\{[\s\S]*BOUNDARY_SPLAT_ATTRIBUTE_MODEL_IDENTITY[\s\S]*BOUNDARY_SPLAT_ATTRIBUTE_MODEL_WGSL[\s\S]*\}\s*from\s*['"]\.\/models\/boundary-splat-attribute\/live-support-h64-v0\/boundary-splat-attribute-model\.generated\.js['"]/, 'live renderer imports the real-support compiler-generated model module');
assert.match(liveModel, /sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472/, 'live route contract pins the corrected radius-multiplier model identity');
assert.match(core, /BOUNDARY_SPLAT_LEARNED_RENDERER_IDENTITY\s*=\s*'live-boundary-sidecar-learned-attribute-splats-v0'/, 'learned route has a distinct effective renderer identity');
assert.match(core, /\$\{BOUNDARY_SPLAT_ATTRIBUTE_MODEL_WGSL\}/, 'generated inference WGSL is compiled into the live splat shader');
assert.match(core, /applyBoundarySplatAttributeHook[\s\S]*boundarySplatCamera\.controls\.y[\s\S]*inferBoundarySplatAttributes\(features\)/, 'hook selects generated inference only when learned mode is effective');
assert.match(core, /splatCamera\.set\(\[normalizeBoundarySplatRadius\([^)]*\),\s*boundarySplatLearnedAttributesRequested\(\)\s*\?\s*1\s*:\s*0/, 'live control uniform carries learned mode into compaction alongside the raster radius');
assert.match(core, /boundarySplatComputeBindGroupLayout\s*=\s*device\.createBindGroupLayout[\s\S]*binding:\s*4,\s*visibility:\s*GPUShaderStage\.COMPUTE/, 'compute layout exposes the learned-mode camera controls');
assert.match(core, /boundarySplatComputeBindGroups\s*=\s*fluidBuffers\.map[\s\S]*binding:\s*4,\s*resource:\s*\{\s*buffer:\s*boundarySplatCameraBuffer/, 'compute bind groups attach the existing camera uniform without restoring the candidate copy');
assert.match(core, /normalizeBoundarySplatMode[\s\S]*'learned'/, 'renderer accepts learned mode without collapsing to off');
assert.match(page, /<option value="learned">learned attributes<\/option>/, 'primary interface exposes learned attribute mode');
assert.match(page, /BOUNDARY_SPLAT_MODE_VALUES\s*=\s*new Set\(\['off',\s*'analytic',\s*'learned'\]\)/, 'browser route preserves learned mode');
assert.match(core, /boundarySplatAttributeModelIdentity:\s*boundarySplatEffectiveAttributeModelIdentity\(controlsSnapshot\.boundarySplatMode\)/, 'runtime evidence reports only the applied model identity');
assert.match(core, /boundarySplatEffectiveAttributeModelIdentity[\s\S]*normalizeBoundarySplatMode\(mode\)\s*===\s*'learned'[\s\S]*BOUNDARY_SPLAT_ATTRIBUTE_MODEL_IDENTITY[\s\S]*null/, 'applied model identity is null outside learned mode');
assert.match(core, /state\.boundarySplatAttributeModelIdentity\s*=\s*boundarySplatEffectiveAttributeModelIdentity\(state\.boundarySplatMode\)/, 'runtime applied-model identity follows effective mode');
assert.match(core, /boundarySplatRendererIdentity:\s*boundarySplatEffectiveRendererIdentity\(/, 'runtime evidence distinguishes analytic and learned renderers');
assert.match(core, /state\.volumeReconstructionStyle\s*=\s*state\.boundarySplatRendererIdentity/, 'rendered frame reconstruction style follows effective learned identity');
assert.match(core, /makeBoundarySplatCopyDisposition\(state\.boundarySplatCopyBytesThisFrame,\s*state\.boundarySplatRendererIdentity\)/, 'copy-removal evidence follows the effective learned renderer identity');
assert.match(core, /makeBoundarySplatGpuProfile\(\{[\s\S]*rendererIdentity:\s*state\.boundarySplatRendererIdentity/, 'GPU profile evidence follows the effective learned renderer identity');
assert.match(core, /boundarySplatCopyDisposition:\s*makeBoundarySplatCopyDisposition\(0,\s*boundarySplatEffectiveRendererIdentity\(controlsSnapshot\.boundarySplatMode\)\)/, 'initial evidence identity does not dereference runtime state during construction');
assert.match(witness, /boundarySplatAttributeModelIdentity:\s*sample\.boundarySplatAttributeModelIdentity\s*\?\?\s*state\.boundarySplatAttributeModelIdentity/, 'witness preserves the exact learned model identity');
assert.match(core, /boundarySplatLearnedAttributesRequested[\s\S]*normalizeBoundarySplatMode\(controlsSnapshot\.boundarySplatMode\)\s*===\s*'learned'/, 'learned activation follows the effective routed mode');

console.log('boundary splat learned attribute live contracts passed');
