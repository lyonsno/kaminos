import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const witness = await readFile(new URL('../volume-witness.mjs', import.meta.url), 'utf8');
const featureCapture = await import('../boundary-splat-feature-capture.mjs');
const { canonicalizeBoundarySplatAuditRows } = await import('../volume-core.js');
const modelArtifact = JSON.parse(await readFile(new URL('../models/boundary-splat-attribute/analytic-teacher-h64-v0/model-artifact.json', import.meta.url), 'utf8'));

assert.match(core, /BOUNDARY_SPLAT_RENDERER_IDENTITY\s*=\s*'live-boundary-sidecar-analytic-splats-v0'/, 'splat renderer route identity is explicit');
assert.match(core, /BOUNDARY_SPLAT_SOURCE_AUTHORITY\s*=\s*'live-baked-sidecar-plus-fluid-material-v0'/, 'splat source authority names live sidecar and material fields');
assert.match(core, /BOUNDARY_SPLAT_ATTRIBUTE_HOOK_IDENTITY\s*=\s*'boundary-splat-learned-attribute-hook-v0'/, 'splat renderer exposes a stable learned-attribute hook identity');
assert.deepEqual(featureCapture.BOUNDARY_SPLAT_FEATURE_ORDER, modelArtifact.features, 'live feature capture and compiled model preserve one exact feature order');
assert.deepEqual(modelArtifact.outputs, ['color.r', 'color.g', 'color.b', 'opacity', 'radius.x', 'radius.y'], 'compiled live model preserves the declared output order');
assert.match(core, /function normalizeBoundarySplatMode/, 'splat mode normalization is explicit');
assert.match(page, /volume_boundary_splat_mode/, 'splat mode is routable from the browser URL');
assert.match(page, /boundarySplatMode/, 'browser controls carry the splat mode into the renderer');
assert.match(page, /id="volume-boundary-splat-radius"/, 'browser exposes a live learned-splat radius control');
assert.match(page, /id="volume-boundary-splat-sharpness"/, 'browser exposes a live learned-splat kernel sharpness control');
assert.match(page, /volume_boundary_splat_radius/, 'splat radius is preserved in basin URLs');
assert.match(page, /volume_boundary_splat_sharpness/, 'splat sharpness is preserved in basin URLs');
assert.match(page, /Splat authority:[\s\S]*support heat\/reaction\/front\/interface[\s\S]*Step width and boundary display\/color controls remain raymarch-only/, 'interface names the effective splat-control boundary instead of implying every neighboring raymarch control is live');

assert.match(core, /boundarySplatCompactPipeline/, 'renderer owns a GPU splat compaction pipeline');
assert.match(core, /boundarySplatFinalizePipeline/, 'renderer caps the indirect instance count after compaction');
assert.match(core, /boundarySplatRenderPipeline/, 'renderer owns a GPU splat raster pipeline');
assert.match(core, /boundarySplatReadbackPipeline/, 'witness owns a same-route RGBA8 splat readback pipeline');
const canonicalRowA = [0.5, -0.5, 0.25, 0.8, ...Array.from({ length: 20 }, (_, index) => index + 1)];
const canonicalRowB = [-0.5, 0.5, -0.25, 0.6, ...Array.from({ length: 20 }, (_, index) => index + 21)];
const canonicalForward = canonicalizeBoundarySplatAuditRows(Float32Array.from([...canonicalRowA, ...canonicalRowB]), 2, 24);
const canonicalPermuted = canonicalizeBoundarySplatAuditRows(Float32Array.from([...canonicalRowB, ...canonicalRowA]), 2, 24);
assert.deepEqual(canonicalForward.positionSupport, canonicalPermuted.positionSupport, 'candidate identity ignores GPU atomic append permutation');
assert.deepEqual(canonicalForward.attributes, canonicalPermuted.attributes, 'effective live-union attributes remain paired with canonical candidate rows');
assert.match(core, /atomicAdd\(&boundarySplatDraw\.candidateCount/, 'compaction counts live sidecar candidates on GPU');
assert.match(core, /min\(atomicLoad\(&boundarySplatDraw\.candidateCount\),\s*boundarySplatDraw\.capacity\)/, 'indirect instance count is clamped to the runtime buffer capacity');
assert.doesNotMatch(core, /const BOUNDARY_SPLAT_CAPACITY:\s*u32/, 'the shader must not compile a fixed first-N spatial truncation capacity');
assert.match(core, /function nextBoundarySplatCapacity\([\s\S]*Math\.min\(gridCellCount\(gridSize\),[\s\S]*nextPowerOfTwo/, 'capacity growth is bounded by physical grid cells and otherwise rounds up to avoid repeated reallocations');
assert.match(core, /async function resolveBoundarySplatTelemetry[\s\S]*overflowCount\s*>\s*0[\s\S]*growBoundarySplatCapacity\(candidateCount\)/, 'asynchronous GPU overflow evidence triggers buffer growth instead of leaving a bisected volume');
assert.match(core, /new Uint32Array\(\[[\s\S]*?6,\s*0,\s*0,\s*0,\s*0,\s*0,\s*boundarySplatCapacity,\s*0,[\s\S]*?\]\)/, 'each compaction pass publishes the effective runtime capacity to WGSL');
assert.match(core, /fn boundarySplatAttributeFeatures[\s\S]*features\[0\]\s*=\s*sidecar\.x[\s\S]*features\[15\]\s*=\s*micro\.w/, 'WGSL builds the ordered 16-channel learned-attribute feature vector');
assert.match(core, /fn applyBoundarySplatAttributeHook[\s\S]*analyticColorOpacity[\s\S]*analyticRadiusScale[\s\S]*BoundarySplatAttributeHookOutput/, 'WGSL exposes a no-op learned-attribute output hook before model integration');
assert.match(core, /applyBoundarySplatAttributeHook[\s\S]*baseMajorRadius\s*=\s*radius \* attributeOutput\.radiusScale\.x[\s\S]*baseMinorRadius\s*=\s*radius \* attributeOutput\.radiusScale\.y[\s\S]*boundarySplats\[candidateIndex\]\.colorOpacity\s*=\s*attributeOutput\.colorOpacity/, 'splat color opacity and base radius scale flow through the hook without changing candidate selection');
assert.match(core, /corner\.x \* splat\.shape\.x \* boundarySplatCamera\.controls\.x[\s\S]*corner\.y \* splat\.shape\.y \* boundarySplatCamera\.controls\.x/, 'live radius control scales learned and analytic splat footprints in the raster vertex stage');
assert.match(core, /let kernelSharpness = clamp\(boundarySplatCamera\.controls\.w,[\s\S]*let gaussian = exp\(-radius2 \* kernelSharpness\)/, 'live sharpness control changes the Gaussian kernel instead of applying a screen-space post-filter');
assert.match(core, /let footprintRadius = clamp\(boundarySplatCamera\.controls\.x,[\s\S]*let energyRatio = \(kernelSharpness \/ 3\.4\) \/ max\(footprintRadius \* footprintRadius,[\s\S]*let energyCompensation = clamp\(sqrt\(energyRatio\),[\s\S]*in\.colorOpacity\.a \* gaussian \* energyCompensation/, 'radius and kernel ablations preserve approximate integrated splat opacity without overdriving dense alpha-over overlap');
assert.match(core, /fn boundarySplatKernelIntegral\(kernelSharpness: f32\) -> f32/, 'compaction WGSL defines the Gaussian kernel integral used by coefficient normalization');
assert.match(core, /fn boundarySplatEnergyCompensation\(footprintRadius: f32, kernelSharpness: f32\) -> f32/, 'compaction WGSL defines the same bounded footprint energy compensation used by raster');
assert.match(core, /fn boundarySplatSupportAt\(cell: vec3<i32>\) -> f32/, 'compaction WGSL defines bounded support reads used to orient anisotropic splats');
assert.match(core, /fn boundarySplatSupportGradient\(cell: vec3<u32>\) -> vec3<f32>/, 'compaction WGSL defines the sidecar support gradient used as the live splat normal');
assert.ok(
  core.indexOf('fn boundarySplatKernelIntegral') < core.indexOf('let kernelIntegral = boundarySplatKernelIntegral'),
  'compaction WGSL declares kernel normalization helpers before their call sites',
);
assert.ok(
  core.indexOf('fn boundarySplatSupportGradient') < core.indexOf('let worldNormal = boundarySplatSupportGradient'),
  'compaction WGSL declares support-gradient helpers before their call sites',
);
assert.match(core, /splatCamera\.set\(\[normalizeBoundarySplatRadius\(controlsSnapshot\.boundarySplatRadius\),[\s\S]*normalizeBoundarySplatSharpness\(controlsSnapshot\.boundarySplatSharpness\)\]/, 'each frame publishes normalized radius and sharpness controls to WGSL');
assert.match(core, /copyBufferToBuffer\(boundarySplatDrawBuffer,\s*0,\s*boundarySplatIndirectBuffer,\s*0,\s*16\)/, 'storage draw state is copied into a separate indirect-only buffer');
assert.match(core, /boundarySplatComputeBindGroups/, 'splat compute uses separate bind groups from raster');
assert.match(core, /boundarySplatRenderBindGroup[\s\S]*resource:\s*\{\s*buffer:\s*boundarySplatBuffer\s*\}/, 'splat raster reads the compacted candidate buffer directly after compute passes');
assert.doesNotMatch(core, /boundarySplatRenderBuffer/, 'renderer no longer allocates a full-capacity render-copy buffer');
assert.match(core, /pass\.drawIndirect\(boundarySplatIndirectBuffer,\s*0\)/, 'splat raster count comes from the GPU indirect buffer');
const splatDrawFunction = core.match(/function encodeBoundarySplatDraw\([\s\S]*?\n  \}/)?.[0] || '';
assert.doesNotMatch(splatDrawFunction, /mapAsync|await/, 'live splat drawing must not depend on CPU readback');
assert.match(splatDrawFunction, /const loadOp\s*=\s*options\.loadOp\s*===\s*'load'\s*\?\s*'load'\s*:\s*'clear'/, 'splat drawing explicitly normalizes clear versus composite attachment loading');
assert.match(splatDrawFunction, /loadOp,/, 'splat drawing applies the normalized attachment load operation');

assert.match(core, /encodeBoundarySidecar\(encoder\)[\s\S]*encodeBoundarySplats\(encoder\)/, 'splat compaction runs after the current frame sidecar bake');
assert.match(core, /boundarySplatRequested[\s\S]*encodeBoundarySplatDraw/, 'the opt-in route selects splat rasterization instead of silently falling back');
assert.match(core, /const nativeDevicePixelRatio\s*=\s*Math\.max\(1,\s*Number\(win\?\.devicePixelRatio\)\s*\|\|\s*1\)/, 'renderer reads the physical display pixel ratio explicitly');
assert.match(core, /const canvasDevicePixelRatio\s*=\s*boundarySplatRequested\(\)\s*\?\s*nativeDevicePixelRatio\s*:\s*1/, 'live splats rasterize at native device pixel ratio without changing the raymarch default');
assert.match(core, /state\.canvasDevicePixelRatio\s*=\s*canvasDevicePixelRatio/, 'runtime state exposes the effective canvas pixel ratio used for splat rasterization');
assert.match(core, /return \{\s*ok:\s*true,[\s\S]*cssWidth:\s*state\.cssWidth[\s\S]*nativeDevicePixelRatio:\s*state\.nativeDevicePixelRatio[\s\S]*canvasDevicePixelRatio:\s*state\.canvasDevicePixelRatio/, 'successful frame samples preserve CSS size and requested/effective device pixel ratios');
assert.match(core, /sampleFrame[\s\S]*encodeBoundarySidecar\(encoder[\s\S]*encodeBoundarySplats\(encoder[\s\S]*encodeBoundarySplatDraw\(\s*encoder,\s*frameTexture\.createView\(\),\s*boundarySplatReadbackPipeline[\s\S]{0,180}\)/, 'frozen witness renders the requested splat route instead of substituting raymarch');
assert.match(core, /renderFrozenScaleToCanvas[\s\S]*encodeBoundarySidecar\(encoder[\s\S]*encodeBoundarySplats\(encoder[\s\S]*encodeBoundarySplatDraw\(\s*encoder,\s*currentTexture\.createView\(\)[\s\S]{0,180}\)/, 'controlled canvas capture renders the requested splat route instead of substituting raymarch');
const frozenRenderFunction = core.match(/async function renderFrozenScaleToCanvas\(options = \{\}\) \{[\s\S]*?\n  \}\n\n  return \{/)?.[0] || '';
assert.match(frozenRenderFunction, /boundarySplatCompositionRequested/, 'frozen splat capture records the requested composition independently from splat mode');
assert.match(frozenRenderFunction, /boundarySplatCompositionRequestedRaw[\s\S]*unsupported-boundary-splat-composition/, 'direct frozen-render callers fail loud on unsupported raw composition values instead of silently becoming splat-only');
assert.match(frozenRenderFunction, /selectiveHeadLiveRenderCompositionRequest\(boundarySplatCompositionRequestedRaw\)/, 'frozen capture resolves the same explicit public composition identities as live rendering');
assert.match(frozenRenderFunction, /compositionDefinition\.raymarch[\s\S]*encodeDraw\(encoder,\s*currentTexture\.createView\(\)/, 'frozen capture encodes raymarch only when the requested public composition owns that pass');
assert.match(frozenRenderFunction, /compositionDefinition\.splat[\s\S]*encodeBoundarySplatDraw\([\s\S]*loadOp:\s*raymarchEncoded\s*\?\s*'load'\s*:\s*'clear'/, 'frozen capture composites splats over raymarch only for compositions that request both passes');
assert.match(frozenRenderFunction, /compositionAuthority[\s\S]*raymarchFireAuthority/, 'frozen receipts expose smoke-only versus full-fire raymarch authority');
assert.match(frozenRenderFunction, /boundarySplatCompositionRequested[\s\S]*boundarySplatCompositionEffective[\s\S]*raymarchApplied[\s\S]*splatApplied/, 'frozen capture receipt distinguishes requested and effective composition plus both applied render passes');
assert.match(frozenRenderFunction, /raymarchEncoded[\s\S]*splatEncoded[\s\S]*device\.queue\.submit\(\[encoder\.finish\(\)\]\)[\s\S]*raymarchApplied\s*=\s*raymarchEncoded[\s\S]*splatApplied\s*=\s*splatEncoded/, 'applied pass flags become true only after the encoded command buffer is submitted');
assert.match(frozenRenderFunction, /reason:\s*'boundary-splat-frozen-canvas-route-unavailable'[\s\S]*raymarchEncoded[\s\S]*splatEncoded[\s\S]*raymarchApplied:\s*false[\s\S]*splatApplied:\s*false/, 'failed hybrid receipts distinguish discarded encoded work from submitted applied work');
assert.match(core, /boundarySplatRendererIdentity:\s*boundarySplatEffectiveRendererIdentity\(/, 'runtime state reports the effective analytic or learned splat renderer identity');
assert.match(core, /boundarySplatSourceAuthority:\s*BOUNDARY_SPLAT_SOURCE_AUTHORITY/, 'runtime state reports splat source authority');
assert.match(core, /boundarySplatCapacity:\s*boundarySplatCapacity/, 'runtime state reports the currently allocated primitive capacity');
assert.match(core, /boundarySplatRadius:\s*normalizeBoundarySplatRadius\(/, 'runtime state reports effective global splat radius');
assert.match(core, /boundarySplatSharpness:\s*normalizeBoundarySplatSharpness\(/, 'runtime state reports effective Gaussian sharpness');
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
assert.match(witness, /cssWidth:\s*sample\.cssWidth\s*\?\?\s*state\.cssWidth/, 'witness preserves the CSS-pixel render extent');
assert.match(witness, /nativeDevicePixelRatio:\s*sample\.nativeDevicePixelRatio\s*\?\?\s*state\.nativeDevicePixelRatio/, 'witness preserves the physical display pixel ratio');
assert.match(witness, /canvasDevicePixelRatio:\s*sample\.canvasDevicePixelRatio\s*\?\?\s*state\.canvasDevicePixelRatio/, 'witness preserves the effective canvas pixel ratio');

assert.match(core, /BOUNDARY_SPLAT_GPU_PROFILE_IDENTITY\s*=\s*'boundary-splat-stage-gpu-timestamp-profile-v0'/, 'splat timing profile has a durable schema identity');
assert.match(core, /boundarySplatTimestampStatus:\s*'(?:unsupported|available)'/, 'splat timing distinguishes unsupported timestamps from zero-time stages');
assert.match(core, /timestamp-query/, 'splat timing explicitly requests WebGPU timestamp-query support when available');
assert.match(core, /timestampWrites:\s*\{[\s\S]*querySet[\s\S]*endOfPassWriteIndex/, 'splat timing uses current pass-descriptor timestamp writes');
assert.doesNotMatch(core, /encoder\.writeTimestamp/, 'splat timing does not depend on the removed command-encoder timestamp API');
assert.match(core, /timestamps\.some\(value\s*=>\s*value\s*===\s*0n\)/, 'splat timing rejects incomplete timestamp query writes');
assert.match(core, /timestamps\[index\]\s*<\s*timestamps\[index\s*-\s*1\]/, 'splat timing rejects nonmonotonic timestamp results');
assert.match(core, /boundarySplatGpuProfile[\s\S]*simulation[\s\S]*sidecar[\s\S]*compaction[\s\S]*candidateCopy[\s\S]*indirectSetup[\s\S]*splatRaster[\s\S]*matchedRaymarchRaster[\s\S]*total/, 'splat profile names every required timing stage');
assert.match(core, /boundarySplatCopyDisposition[\s\S]*removed-full-capacity-copy/, 'splat state records the full-capacity candidate-copy disposition');
assert.match(core, /candidateCopyBytes[\s\S]*boundarySplatCopyBytesThisFrame/, 'splat profile records effective candidate-copy bytes');
assert.doesNotMatch(core, /copyBufferToBuffer\(boundarySplatBuffer,\s*0,\s*boundarySplatRenderBuffer,\s*0,\s*BOUNDARY_SPLAT_CAPACITY\s*\*\s*48\)/, 'renderer must not copy the full candidate capacity every frame');
assert.match(witness, /boundarySplatGpuProfile:\s*sample\.boundarySplatGpuProfile\s*\?\?\s*state\.boundarySplatGpuProfile/, 'witness preserves splat GPU timing profile evidence');
assert.match(witness, /boundarySplatCopyDisposition:\s*sample\.boundarySplatCopyDisposition\s*\?\?\s*state\.boundarySplatCopyDisposition/, 'witness preserves splat copy disposition evidence');

console.log('boundary splat renderer contracts passed');
