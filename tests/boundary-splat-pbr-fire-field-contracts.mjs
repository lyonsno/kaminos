import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const witness = await readFile(new URL('../volume-boundary-splat-pbr-witness.mjs', import.meta.url), 'utf8').catch(() => '');

assert.match(core, /BOUNDARY_SPLAT_PBR_FIRE_FIELD_IDENTITY\s*=\s*'boundary-splat-pbr-fire-field-v0'/, 'runtime must publish a stable PBR fire-field identity');
assert.match(core, /BOUNDARY_SPLAT_PBR_FIXED_SUBSTRATE_IDENTITY\s*=\s*'operator-pretty-four-flame-substrate-v0'/, 'PBR route must bind the operator-selected flame substrate without retuning it');
assert.match(core, /function normalizeBoundarySplatPbrScene/, 'runtime must normalize the requested PBR scene explicitly');
assert.match(page, /volume_boundary_splat_pbr_scene/, 'operator route must own the requested PBR scene');
assert.match(page, /id="volume-boundary-splat-pbr-scene"/, 'operator UI must expose the PBR scene as an option set');
assert.match(page, /boundary-splat-pbr-fire-field-camera-v0/, 'PBR route must publish a deterministic effective camera identity');

assert.match(core, /const BOUNDARY_SPLAT_PBR_WGSL\s*=\s*`/, 'native renderer must own an explicit PBR scene shader');
assert.match(core, /@builtin\(frag_depth\)/, 'PBR scene shader must write hardware depth');
assert.match(core, /let ndc = vec2<f32>\(uv\.x \* 2\.0 - 1\.0, uv\.y \* 2\.0 - 1\.0\)/, 'PBR ray reconstruction must preserve WebGPU clip-space Y so the scene is not vertically inverted behind upright splats');
assert.match(core, /boundarySplatPbrScenePipeline/, 'runtime must own a PBR scene pipeline on the live-volume device');
assert.match(core, /depthStencil:\s*\{[\s\S]*format:\s*'depth24plus'[\s\S]*depthWriteEnabled:\s*true[\s\S]*depthCompare:\s*'less'/, 'PBR scene pipeline must write the shared depth attachment');
assert.match(core, /boundarySplatRenderPipeline[\s\S]*depthStencil:\s*\{[\s\S]*format:\s*'depth24plus'[\s\S]*depthWriteEnabled:\s*false[\s\S]*depthCompare:\s*'less-equal'/, 'learned splats must test against PBR scene depth without replacing it');
assert.match(core, /encodeBoundarySplatPbrScene\(\s*encoder,\s*currentTexture\.createView\(\),\s*boundarySplatPbrDepthTexture\.createView\(\)/, 'frame must render the PBR scene before splats on the same color/depth targets');
assert.match(core, /encodeBoundarySplatDraw\(\s*encoder,\s*currentTexture\.createView\(\)[\s\S]*depthView:[\s\S]*loadColor:\s*pbrSceneApplied[\s\S]*loadDepth:\s*pbrSceneApplied/, 'splat pass must load PBR color and shared depth instead of clearing them');

assert.match(core, /boundarySplatPbrSceneIdentity/, 'debug state must expose effective PBR scene identity');
assert.match(core, /boundarySplatPbrDepthAuthority/, 'debug state must expose hardware depth authority');
assert.match(core, /boundarySplatPbrCameraAuthority/, 'debug state must expose camera ownership');
assert.match(core, /boundarySplatPbrFixedSubstrateIdentity/, 'debug state must expose the locked visual substrate identity');
assert.match(core, /pbrSceneRaster/, 'GPU profile must separate PBR scene raster from splat raster');
assert.match(core, /const requiredTimestampPairs\s*=\s*advanceSimulation[\s\S]*\[\[4, 5\], \[6, 7\], \[8, 9\], \[9, 10\]\]/, 'GPU timestamps must be validated within stages because compute and raster stages may overlap');
assert.doesNotMatch(core, /requiredTimestamps\[index\]\s*<\s*requiredTimestamps\[index\s*-\s*1\]/, 'profiler must not reject legal cross-stage GPU overlap as nonmonotonic');
assert.match(core, /sampleBoundarySplatPbrCostLadder/, 'runtime must expose a frozen-state 0/1/4/16/100 PBR cost ladder');
assert.match(core, /sampleBoundarySplatDrawState,[\s\S]*sampleBoundarySplatPbrCostLadder/, 'runtime must expose explicit physical draw-state sampling to evidence witnesses');
assert.match(core, /sampleBoundarySplatLiveCadence[\s\S]*indirectCommand:\s*null[\s\S]*indirectCommandAgreement:\s*null[\s\S]*indirectCommandAuthority:\s*'live-cadence-not-physical-command-sampled-v0'/, 'live cadence must explicitly withhold physical command authority instead of copying cached evidence');
assert.match(core, /renderFrozenScaleToCanvas[\s\S]*const boundarySplatExactDrawState = boundarySplatRequested\(\)[\s\S]*await sampleBoundarySplatDrawState\(\)[\s\S]*boundarySplatIndirectCommand:\s*boundarySplatExactDrawState\?\.indirectCommand/, 'frozen visual capture must return a fresh post-submit physical command sample');

assert.match(witness, /kaminos\.volume\.boundary-splat-pbr-witness\.v0/, 'witness must publish a stable report schema');
assert.match(witness, /\[0, 1, 4, 16, 100\]/, 'witness must measure the required PBR count ladder');
assert.match(witness, /sampleBoundarySplatPbrCostLadder/, 'witness must use timestamp-backed runtime measurements');
assert.match(witness, /cameraSweep/, 'witness must preserve a multi-pose parallax and occlusion sequence');
assert.match(witness, /kaminosSetCameraDebugPose/, 'camera sweep must drive the real composition camera');
assert.match(witness, /camera-sweep-simulator-advanced/, 'camera sweep must fail if any pose advances the authoritative simulator');
assert.match(witness, /operator-pretty-four-flame-substrate-v0/, 'witness must verify the locked operator substrate identity');
assert.match(witness, /depth-occlusion-authority-missing/, 'witness must fail when scene depth authority is absent');
assert.match(witness, /stale-or-default-pbr-scene/, 'witness must fail when requested and effective PBR scenes disagree');
assert.match(witness, /fallback-route/, 'witness must reject fallback rendering');
assert.match(witness, /blank-or-partial-native-capture/, 'witness must reject missing or blank visual output');
assert.match(witness, /duplicated-simulation-authority/, 'witness must reject any PBR path that adds a simulator');
assert.match(witness, /gpu-indirect-command-buffer-post-submit-readback-v0/, 'PBR evidence must require physical indirect-command readback authority');
assert.match(witness, /indirect-command-readback-disagreement/, 'PBR evidence must fail when the physical draw command disagrees with logical allocation state');
assert.match(witness, /sampleBoundarySplatDrawState\(\)/, 'PBR witness must request fresh physical command samples for initial and final state evidence');
assert.match(witness, /physicalCommand\.vertexCount !== 6[\s\S]*physicalCommand\.instanceCount !== renderedInstanceCount[\s\S]*physicalCommand\.firstVertex !== 0[\s\S]*physicalCommand\.firstInstance !== 0/, 'PBR witness must bind physical command shape to the evidence row it accepts');
assert.match(witness, /live-cadence-not-physical-command-sampled-v0/, 'PBR witness must recognize cadence as explicitly non-authoritative for physical command identity');
assert.match(witness, /validateAllocationEvidence\(capture,[\s\S]*native-100-flame-capture/, 'PBR witness must validate the exact command returned by the primary visual capture');
assert.match(witness, /validateAllocationEvidence\(poseCapture,[\s\S]*camera-sweep-/, 'PBR witness must validate the exact command returned by every camera capture');
assert.match(witness, /sampleBoundarySplatHistorySlotMetadata\(\)/, 'PBR witness must read GPU-completed history-slot metadata after priming');
assert.match(witness, /validateHistoryMetadata\(historyMetadata, initialState\)/, 'PBR witness must validate requested, allocated, active, and effective depth against the requested route');
assert.match(witness, /requestedHistoryDepth:[\s\S]*allocatedHistoryDepth:[\s\S]*activeHistoryDepth:[\s\S]*effectiveHistoryDepth:[\s\S]*measuredUpperHistoryDepth:/, 'compact report state must preserve the complete history-depth authority chain');
assert.match(witness, /history-depth-refusal:[\s\S]*depthRefusalReasons/, 'PBR witness must reject any nonempty depth-refusal telemetry');
assert.match(witness, /stale-or-default-history-depth/, 'PBR witness must reject requested/effective depth disagreement');
assert.match(witness, /failed-before-primary-output/, 'witness must durably report failure before primary output exists');

console.log('boundary splat PBR fire-field contracts passed');
