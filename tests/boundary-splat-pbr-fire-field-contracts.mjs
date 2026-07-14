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
assert.match(core, /encodeBoundarySplatPbrScene\(encoder,\s*currentTexture\.createView\(\),\s*boundarySplatPbrDepthTexture\.createView\(\)/, 'frame must render the PBR scene before splats on the same color/depth targets');
assert.match(core, /encodeBoundarySplatDraw\(encoder,\s*currentTexture\.createView\(\)[\s\S]*depthView:[\s\S]*loadColor:\s*pbrSceneApplied[\s\S]*loadDepth:\s*pbrSceneApplied/, 'splat pass must load PBR color and shared depth instead of clearing them');

assert.match(core, /boundarySplatPbrSceneIdentity/, 'debug state must expose effective PBR scene identity');
assert.match(core, /boundarySplatPbrDepthAuthority/, 'debug state must expose hardware depth authority');
assert.match(core, /boundarySplatPbrCameraAuthority/, 'debug state must expose camera ownership');
assert.match(core, /boundarySplatPbrFixedSubstrateIdentity/, 'debug state must expose the locked visual substrate identity');
assert.match(core, /pbrSceneRaster/, 'GPU profile must separate PBR scene raster from splat raster');
assert.match(core, /const requiredTimestampPairs\s*=\s*advanceSimulation[\s\S]*\[\[4, 5\], \[6, 7\], \[8, 9\], \[9, 10\]\]/, 'GPU timestamps must be validated within stages because compute and raster stages may overlap');
assert.doesNotMatch(core, /requiredTimestamps\[index\]\s*<\s*requiredTimestamps\[index\s*-\s*1\]/, 'profiler must not reject legal cross-stage GPU overlap as nonmonotonic');
assert.match(core, /sampleBoundarySplatPbrCostLadder/, 'runtime must expose a frozen-state 0/1/4/16/100 PBR cost ladder');

assert.match(witness, /kaminos\.volume\.boundary-splat-pbr-witness\.v0/, 'witness must publish a stable report schema');
assert.match(witness, /\[0, 1, 4, 16, 100\]/, 'witness must measure the required PBR count ladder');
assert.match(witness, /sampleBoundarySplatPbrCostLadder/, 'witness must use timestamp-backed runtime measurements');
assert.match(witness, /cameraSweep/, 'witness must preserve a multi-pose parallax and occlusion sequence');
assert.match(witness, /kaminosSetCameraDebugPose/, 'camera sweep must drive the real composition camera');
assert.match(witness, /camera-sweep-simulator-advanced/, 'camera sweep must fail if any pose advances the authoritative simulator');
assert.match(witness, /close-foreground-whiteout/, 'camera sweep must include a close foreground pose that can reproduce operator-observed white blowout');
assert.match(witness, /overexposedPixels/, 'witness image metrics must count overexposed pixels instead of only nonblank light');
assert.match(witness, /whiteoutPixels/, 'witness image metrics must count near-white foreground saturation separately from general brightness');
assert.match(witness, /saturationSummary/, 'witness report must summarize the worst saturation pose for operator diagnosis');
assert.match(witness, /closeCameraSaturationUnchecked/, 'false-closure checks must fail loud if close-camera saturation is not measured');
assert.match(witness, /operator-pretty-four-flame-substrate-v0/, 'witness must verify the locked operator substrate identity');
assert.match(witness, /depth-occlusion-authority-missing/, 'witness must fail when scene depth authority is absent');
assert.match(witness, /stale-or-default-pbr-scene/, 'witness must fail when requested and effective PBR scenes disagree');
assert.match(witness, /fallback-route/, 'witness must reject fallback rendering');
assert.match(witness, /blank-or-partial-native-capture/, 'witness must reject missing or blank visual output');
assert.match(witness, /duplicated-simulation-authority/, 'witness must reject any PBR path that adds a simulator');
assert.match(witness, /failed-before-primary-output/, 'witness must durably report failure before primary output exists');

console.log('boundary splat PBR fire-field contracts passed');
