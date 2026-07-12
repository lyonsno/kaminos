import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const witness = await readFile(new URL('../volume-witness.mjs', import.meta.url), 'utf8');

assert.match(core, /BOUNDARY_SPLAT_RENDERER_IDENTITY\s*=\s*'live-boundary-sidecar-analytic-splats-v0'/, 'splat renderer route identity is explicit');
assert.match(core, /BOUNDARY_SPLAT_SOURCE_AUTHORITY\s*=\s*'live-baked-sidecar-plus-fluid-material-v0'/, 'splat source authority names live sidecar and material fields');
assert.match(core, /BOUNDARY_SPLAT_ATTRIBUTE_HOOK_IDENTITY\s*=\s*'boundary-splat-learned-attribute-hook-v0'/, 'splat renderer exposes a stable learned-attribute hook identity');
assert.match(core, /BOUNDARY_SPLAT_ATTRIBUTE_FEATURE_ORDER[\s\S]*'sidecar\.support'[\s\S]*'sidecar\.coverage'[\s\S]*'sidecar\.ridge'[\s\S]*'sidecar\.footprint'[\s\S]*'material\.density'[\s\S]*'material\.heat'[\s\S]*'material\.fuel'[\s\S]*'material\.detail'[\s\S]*'fire\.energy'[\s\S]*'fire\.temperature'[\s\S]*'fire\.emission'[\s\S]*'fire\.detail'[\s\S]*'micro\.x'[\s\S]*'micro\.y'[\s\S]*'micro\.z'[\s\S]*'micro\.w'/, 'splat learned-attribute hook preserves the compiler feature order');
assert.match(core, /BOUNDARY_SPLAT_ATTRIBUTE_OUTPUT_ORDER[\s\S]*'color\.r'[\s\S]*'color\.g'[\s\S]*'color\.b'[\s\S]*'opacity'[\s\S]*'radius\.x'[\s\S]*'radius\.y'/, 'splat learned-attribute hook preserves the compiler output order');
assert.match(core, /function normalizeBoundarySplatMode/, 'splat mode normalization is explicit');
assert.match(page, /volume_boundary_splat_mode/, 'splat mode is routable from the browser URL');
assert.match(page, /boundarySplatMode/, 'browser controls carry the splat mode into the renderer');

assert.match(core, /boundarySplatCompactPipeline/, 'renderer owns a GPU splat compaction pipeline');
assert.match(core, /boundarySplatFinalizePipeline/, 'renderer caps the indirect instance count after compaction');
assert.match(core, /boundarySplatRenderPipeline/, 'renderer owns a GPU splat raster pipeline');
assert.match(core, /boundarySplatReadbackPipeline/, 'witness owns a same-route RGBA8 splat readback pipeline');
assert.match(core, /atomicAdd\(&boundarySplatDraw\.candidateCount/, 'compaction counts live sidecar candidates on GPU');
assert.match(core, /min\(atomicLoad\(&boundarySplatDraw\.candidateCount\),\s*BOUNDARY_SPLAT_CAPACITY\)/, 'indirect instance count is clamped to the declared capacity');
assert.match(core, /fn boundarySplatAttributeFeatures[\s\S]*features\[0\]\s*=\s*sidecar\.x[\s\S]*features\[15\]\s*=\s*micro\.w/, 'WGSL builds the ordered 16-channel learned-attribute feature vector');
assert.match(core, /fn applyBoundarySplatAttributeHook[\s\S]*analyticColorOpacity[\s\S]*analyticRadiusScale[\s\S]*BoundarySplatAttributeHookOutput/, 'WGSL exposes a no-op learned-attribute output hook before model integration');
assert.match(core, /applyBoundarySplatAttributeHook[\s\S]*boundarySplats\[candidateIndex\]\.colorOpacity\s*=\s*attributeOutput\.colorOpacity[\s\S]*radius \* attributeOutput\.radiusScale\.x[\s\S]*radius \* attributeOutput\.radiusScale\.y/, 'splat color opacity and radius scale flow through the hook without changing candidate selection');
assert.match(core, /copyBufferToBuffer\(boundarySplatDrawBuffer,\s*0,\s*boundarySplatIndirectBuffer,\s*0,\s*16\)/, 'storage draw state is copied into a separate indirect-only buffer');
assert.match(core, /boundarySplatComputeBindGroups/, 'splat compute uses separate bind groups from raster');
assert.match(core, /boundarySplatRenderBindGroup[\s\S]*resource:\s*\{\s*buffer:\s*boundarySplatBuffer\s*\}/, 'splat raster reads the compacted candidate buffer directly after compute passes');
assert.doesNotMatch(core, /boundarySplatRenderBuffer/, 'renderer no longer allocates a full-capacity render-copy buffer');
assert.match(core, /pass\.drawIndirect\(boundarySplatIndirectBuffer,\s*0\)/, 'splat raster count comes from the GPU indirect buffer');
const splatDrawFunction = core.match(/function encodeBoundarySplatDraw\([\s\S]*?\n  \}/)?.[0] || '';
assert.doesNotMatch(splatDrawFunction, /mapAsync|await/, 'live splat drawing must not depend on CPU readback');

assert.match(core, /encodeBoundarySidecar\(encoder\)[\s\S]*encodeBoundarySplats\(encoder\)/, 'splat compaction runs after the current frame sidecar bake');
assert.match(core, /boundarySplatRequested[\s\S]*encodeBoundarySplatDraw/, 'the opt-in route selects splat rasterization instead of silently falling back');
assert.match(core, /sampleFrame[\s\S]*encodeBoundarySidecar\(encoder\)[\s\S]*encodeBoundarySplats\(encoder\)[\s\S]*encodeBoundarySplatDraw\(encoder,\s*frameTexture\.createView\(\),\s*boundarySplatReadbackPipeline\)/, 'frozen witness renders the requested splat route instead of substituting raymarch');
assert.match(core, /renderFrozenScaleToCanvas[\s\S]*encodeBoundarySidecar\(encoder\)[\s\S]*encodeBoundarySplats\(encoder\)[\s\S]*encodeBoundarySplatDraw\(encoder,\s*currentTexture\.createView\(\)\)/, 'controlled canvas capture renders the requested splat route instead of substituting raymarch');
assert.match(core, /boundarySplatRendererIdentity:\s*boundarySplatEffectiveRendererIdentity\(/, 'runtime state reports the effective analytic or learned splat renderer identity');
assert.match(core, /boundarySplatSourceAuthority:\s*BOUNDARY_SPLAT_SOURCE_AUTHORITY/, 'runtime state reports splat source authority');
assert.match(core, /boundarySplatCapacity:\s*BOUNDARY_SPLAT_CAPACITY/, 'runtime state reports the hard primitive capacity');
assert.match(core, /boundarySplatCandidateCount/, 'runtime state exposes candidate-count evidence');
assert.match(core, /boundarySplatOverflowCount/, 'runtime state exposes overflow evidence');
assert.match(core, /boundarySplatFallbackReason/, 'runtime state fails loud when the requested splat route cannot execute');
assert.match(core, /return \{\s*ok:\s*true,[\s\S]*boundarySplatCandidateCount:\s*boundarySplatSample\?\.candidateCount\s*\?\?\s*state\.boundarySplatCandidateCount[\s\S]*boundarySplatOverflowCount:\s*boundarySplatSample\?\.overflowCount\s*\?\?\s*state\.boundarySplatOverflowCount[\s\S]*boundarySplatCountAuthority:\s*boundarySplatSample\?\.authority/, 'successful frame samples prefer post-submit GPU splat counts over stale asynchronous telemetry');
assert.match(core, /boundarySplatCountAuthority:\s*'gpu-indirect-async-readback'/, 'candidate count authority identifies asynchronous GPU indirect readback');
assert.match(core, /copyBufferToBuffer\(boundarySplatDrawBuffer[\s\S]*boundarySplatReadbackBuffer/, 'telemetry copies the GPU indirect state without blocking rendering');
assert.match(core, /async function sampleBoundarySplatDrawState[\s\S]*copyBufferToBuffer\(boundarySplatDrawBuffer[\s\S]*mapAsync\(GPUMapMode\.READ\)/, 'frame witness samples draw state after the render submission completes');
assert.match(witness, /boundarySplatRendererIdentity:\s*sample\.boundarySplatRendererIdentity\s*\?\?\s*state\.boundarySplatRendererIdentity/, 'witness preserves effective splat renderer identity');
assert.match(witness, /boundarySplatSourceAuthority:\s*sample\.boundarySplatSourceAuthority\s*\?\?\s*state\.boundarySplatSourceAuthority/, 'witness preserves live splat source authority');
assert.match(witness, /boundarySplatCandidateCount:\s*sample\.boundarySplatCandidateCount\s*\?\?\s*state\.boundarySplatCandidateCount/, 'witness preserves candidate-count evidence');
assert.match(witness, /boundarySplatOverflowCount:\s*sample\.boundarySplatOverflowCount\s*\?\?\s*state\.boundarySplatOverflowCount/, 'witness preserves overflow evidence');
assert.match(witness, /boundarySplatFallbackReason:\s*sample\.boundarySplatFallbackReason\s*\?\?\s*state\.boundarySplatFallbackReason/, 'witness preserves explicit splat fallback state');

assert.match(core, /BOUNDARY_SPLAT_GPU_PROFILE_IDENTITY\s*=\s*'boundary-splat-stage-gpu-timestamp-profile-v0'/, 'splat timing profile has a durable schema identity');
assert.match(core, /boundarySplatTimestampStatus:\s*'(?:unsupported|available)'/, 'splat timing distinguishes unsupported timestamps from zero-time stages');
assert.match(core, /timestamp-query/, 'splat timing explicitly requests WebGPU timestamp-query support when available');
assert.match(core, /boundarySplatGpuProfile[\s\S]*simulation[\s\S]*sidecar[\s\S]*compaction[\s\S]*candidateCopy[\s\S]*indirectSetup[\s\S]*splatRaster[\s\S]*matchedRaymarchRaster[\s\S]*total/, 'splat profile names every required timing stage');
assert.match(core, /boundarySplatCopyDisposition[\s\S]*removed-full-capacity-copy/, 'splat state records the full-capacity candidate-copy disposition');
assert.match(core, /candidateCopyBytes[\s\S]*boundarySplatCopyBytesThisFrame/, 'splat profile records effective candidate-copy bytes');
assert.doesNotMatch(core, /copyBufferToBuffer\(boundarySplatBuffer,\s*0,\s*boundarySplatRenderBuffer,\s*0,\s*BOUNDARY_SPLAT_CAPACITY\s*\*\s*48\)/, 'renderer must not copy the full candidate capacity every frame');
assert.match(witness, /boundarySplatGpuProfile:\s*sample\.boundarySplatGpuProfile\s*\?\?\s*state\.boundarySplatGpuProfile/, 'witness preserves splat GPU timing profile evidence');
assert.match(witness, /boundarySplatCopyDisposition:\s*sample\.boundarySplatCopyDisposition\s*\?\?\s*state\.boundarySplatCopyDisposition/, 'witness preserves splat copy disposition evidence');

console.log('boundary splat renderer contracts passed');
