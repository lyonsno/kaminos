import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const benchCorePath = join(root, 'finger-fluid-bench-core.js');
const webgpuCorePath = join(root, 'finger-fluid-webgpu-core.js');
const benchWitnessPath = join(root, 'finger-fluid-bench-witness.mjs');
const truthWitnessPath = join(root, 'finger-fluid-truth-witness.mjs');
const indexPath = join(root, 'index.html');
const hdrEnvironmentPath = join(root, 'assets/hdr/studio_small_09_1k.hdr');

assert.ok(existsSync(benchCorePath), 'Kaminos-native finger fluid bench core exists');
assert.ok(existsSync(webgpuCorePath), 'Kaminos-native WebGPU 3D fluid core exists');
assert.ok(existsSync(benchWitnessPath), 'Kaminos-native finger fluid bench witness exists');
assert.ok(existsSync(truthWitnessPath), 'Kaminos-native fluid-truth trajectory witness exists');
assert.ok(existsSync(indexPath), 'Kaminos app shell exists');
assert.ok(existsSync(hdrEnvironmentPath), 'source-pinned HDR environment asset exists');
assert.equal(
  createHash('sha256').update(readFileSync(hdrEnvironmentPath)).digest('hex'),
  'e7cfda5f4e98e623db12b8bfd0184e048488e4855d9c83e2751fb44a32e80c45',
  'vendored HDR bytes match the source-identified Poly Haven asset',
);

const benchCoreSource = readFileSync(benchCorePath, 'utf8');
const webgpuCoreSource = readFileSync(webgpuCorePath, 'utf8');
const benchWitnessSource = readFileSync(benchWitnessPath, 'utf8');
const truthWitnessSource = readFileSync(truthWitnessPath, 'utf8');
const indexSource = readFileSync(indexPath, 'utf8');
const computeDensityLambdaSource = webgpuCoreSource.match(
  /fn compute_density_lambda[\s\S]*?(?=@compute @workgroup_size\([^\n]+\)\nfn solve_position_delta)/,
)?.[0] ?? '';

assert.match(benchCoreSource, /KAMINOS_FINGER_FLUID_BENCH_STATE_SCHEMA\s*=\s*'kaminos\.finger-fluid-bench\.state\.v0'/, 'bench state schema is explicit');
assert.match(benchCoreSource, /KAMINOS_FINGER_FLUID_BENCH_ROUTE\s*=\s*'kaminos\/finger-fluid-bench'/, 'bench route identity is explicit');
assert.match(benchCoreSource, /BIG_PAPA_FLUID_SOURCE_SCHEMA\s*=\s*'big-papa\.finger-fluid\.synthetic-source\.v0'/, 'bench source schema is explicit');
assert.match(benchCoreSource, /webgpu-pbf-linked-cell-fluid-v0/, 'bench records the real GPU solver identity');
assert.match(benchCoreSource, /kaminos_native_synthetic_fluid_not_lerms_source_truth/, 'bench keeps synthetic source downgrade loud');
assert.match(benchCoreSource, /particle_render_not_final_surface_reconstruction/, 'bench distinguishes particle rendering from final surface reconstruction');
assert.match(benchCoreSource, /createFingerFluidBenchState/, 'bench core exports state creation');

assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_GPU_SOLVER_ROUTE\s*=\s*'webgpu-pbf-linked-cell-fluid-v0'/, 'GPU solver route is explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_NEIGHBOR_GRID_CONTRACT\s*=\s*'wgsl-linked-cell-neighbor-grid-v0'/, 'linked-cell neighbor grid contract is explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_DENSITY_CONTRACT\s*=\s*'wgsl-pbf-density-constraint-v0'/, 'PBF density contract is explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_BOUNDARY_PRESSURE_CONTRACT\s*=\s*'wgsl-analytic-boundary-density-support-v0'/, 'analytic solids participate in a versioned pressure-support contract');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_SUPPORT_FRICTION_CONTRACT\s*=\s*'wgsl-analytic-contact-partial-slip-v0'/, 'analytic support friction has an explicit partial-slip contract');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_DEFAULT_SUPPORT_FRICTION\s*=\s*1\.6/, 'measured partial slip is the explicit native bench default');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_ENERGY_LEDGER_CONTRACT\s*=\s*'wgsl-per-pass-kinetic-energy-ledger-v0'/, 'per-pass kinetic-energy attribution has an explicit contract');
assert.match(webgpuCoreSource, /fn analytic_boundary_density_support\(position: vec3<f32>\) -> vec4<f32>/, 'terrain and sphere boundary support share one analytic density/gradient function');
assert.match(computeDensityLambdaSource, /let boundarySupport = analytic_boundary_density_support\(position\)[\s\S]*density = density \+ boundarySupport\.w[\s\S]*gradientSelf = gradientSelf \+ boundarySupport\.xyz/, 'analytic boundary density and gradient enter the lambda solve');
assert.doesNotMatch(computeDensityLambdaSource, /gradientSquared = gradientSquared \+ dot\(boundarySupport\.xyz, boundarySupport\.xyz\)/, 'static boundary support is not counted as a separately movable neighbor in the lambda denominator');
assert.match(webgpuCoreSource, /fn solve_position_delta[\s\S]*let boundarySupport = analytic_boundary_density_support\(position\)[\s\S]*correction = correction \+ lambda \* boundarySupport\.xyz/, 'analytic boundary support enters position correction before collision fallback');
assert.match(webgpuCoreSource, /boundaryRelativeDensityErrorMean[\s\S]*boundaryRelativeDensityErrorP95[\s\S]*bulkRelativeDensityErrorMean[\s\S]*maximumBoundaryPenetration/, 'truth snapshots distinguish boundary pressure quality from bulk convergence and penetration');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_VORTICITY_CONTRACT\s*=\s*'wgsl-neighbor-vorticity-confinement-v0'/, 'neighbor-derived vorticity contract is explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_OBSTACLE_CONTRACT\s*=\s*'shared-solver-render-obstacle-v0'/, 'solver and renderer share an obstacle contract');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_GPU_RENDERER_ROUTE\s*=\s*'webgpu-particle-sphere-renderer-v0'/, 'direct GPU renderer route is explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_ROUTE\s*=\s*'webgpu-screen-space-liquid-surface-v0'/, 'screen-space liquid renderer route is explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_REFRACTION_RENDERER_ROUTE\s*=\s*'webgpu-screen-space-liquid-refraction-v0'/, 'screen-space liquid refraction renderer route is explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_OPTICAL_TRANSPORT_ROUTE\s*=\s*'snell-two-interface-screen-space-slab-v0'/, 'two-interface optical transport identity is explicit');
assert.match(
  webgpuCoreSource,
  /let curvatureSum = 0;[\s\S]*let resolvedCurvatureRecordCount = 0;[\s\S]*for \(let index = 0; index < activeInterfaceCount; index \+= 1\)[\s\S]*if \(record\.confidence > 0\)[\s\S]*resolvedCurvatureRecordCount \+= 1;[\s\S]*absoluteCurvatureSum \+= Math\.abs\(record\.curvature\)/,
  'interface diagnostics define and populate curvature accumulators before reporting them',
);
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_OPTICAL_SLAB_ROUTE\s*=\s*'wgsl-particle-projected-front-back-slab-v0'/, 'projected particle slab identity is explicit and separate from optical transport');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_SPHERE_DEBUG_RENDERER_ROUTE\s*=\s*'webgpu-particle-sphere-debug-renderer-v0'/, 'particle sphere renderer survives as an explicit debug route');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_RENDERER_MODES\s*=\s*Object\.freeze\(\['screen_space_surface', 'screen_space_refraction', 'sphere_debug'\]\)/, 'surface, refraction, and sphere-debug renderer modes are explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_OPTICAL_DEBUG_MODES\s*=\s*Object\.freeze\(\[[^\]]*'transmitted_transport', 'reflected_transport', 'scatter_transport', 'pre_tonemap_luminance', 'normal_variance', 'reflection_footprint', 'exit_normal_variance', 'transmission_footprint'[^\]]*\]\)/, 'transport decomposition and independent reflection/transmission footprint diagnostics are explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_OPTICAL_LIGHTING_MODES\s*=\s*Object\.freeze\(\['transport_only', 'bounded_ggx', 'legacy_shading'\]\)/, 'transport-only, bounded-GGX, and legacy diagnostic lighting identities are explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_OPTICAL_FOOTPRINT_MODES\s*=\s*Object\.freeze\(\['resolved_detail', 'variance_filtered'\]\)/, 'resolved-detail baseline and variance-filtered optical footprint identities are explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_TRANSMISSION_FOOTPRINT_MODES\s*=\s*Object\.freeze\(\['resolved_exit', 'dense_exit_filtered'\]\)/, 'resolved-exit baseline and dense filtered transmission footprint identities are explicit');
assert.match(webgpuCoreSource, /opticalDebugMode == 16u[\s\S]*return vec4<f32>\(1\.0\)/, 'sphere-debug exposes exact binary particle occupancy through the shared liquid-support diagnostic');
assert.match(webgpuCoreSource, /resolveFingerFluidRendererMode/, 'renderer mode resolution is testable and fails loud');
assert.match(webgpuCoreSource, /resolveFingerFluidOpticalDebugMode/, 'optical debug mode resolution is testable and fails loud');
assert.match(webgpuCoreSource, /resolveFingerFluidOpticalLightingMode/, 'optical lighting mode resolution is testable and fails loud');
assert.match(webgpuCoreSource, /resolveFingerFluidOpticalFootprintMode/, 'optical footprint mode resolution is testable and fails loud');
assert.match(webgpuCoreSource, /resolveFingerFluidTransmissionFootprintMode/, 'transmission footprint mode resolution is testable and fails loud');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_BODY_TRANSPORT_MODES\s*=\s*Object\.freeze\(\['geometric_slab', 'robust_dense_body'\]\)/, 'dense-body transport exposes exact baseline and robust requested modes');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_GEOMETRIC_SLAB_BODY_TRANSPORT_ROUTE\s*=\s*'wgsl-liquid-geometric-slab-body-transport-v0'/, 'geometric slab body transport has an exact route identity');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_ROBUST_DENSE_BODY_TRANSPORT_ROUTE\s*=\s*'wgsl-liquid-robust-dense-body-transport-v1'/, 'robust dense-body transport has an exact route identity');
assert.match(webgpuCoreSource, /resolveFingerFluidBodyTransportMode/, 'body transport mode resolution is testable and fails loud');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_INTERFACE_FREQUENCY_MODES\s*=\s*Object\.freeze\(\['coupled_detail', 'macro_micro_separated'\]\)/, 'interface-frequency transport exposes exact coupled baseline and macro/micro-separated requested modes');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_COUPLED_DETAIL_INTERFACE_FREQUENCY_ROUTE\s*=\s*'wgsl-liquid-coupled-detail-interface-frequency-v0'/, 'coupled detail interface frequency has an exact baseline route identity');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_MACRO_MICRO_INTERFACE_FREQUENCY_ROUTE\s*=\s*'wgsl-liquid-macro-micro-interface-frequency-v1'/, 'macro/micro-separated interface frequency has an exact route identity');
assert.match(webgpuCoreSource, /resolveFingerFluidInterfaceFrequencyMode/, 'interface-frequency mode resolution is testable and fails loud');
assert.match(webgpuCoreSource, /requestedRendererMode[\s\S]*effectiveRendererMode[\s\S]*fallbackReason/, 'runtime state distinguishes requested/effective renderer identity and fallback');
assert.match(webgpuCoreSource, /requestedOpticalLightingMode[\s\S]*effectiveOpticalLightingMode[\s\S]*opticalLightingFallbackReason/, 'runtime state distinguishes requested/effective optical lighting identity and fallback');
assert.match(webgpuCoreSource, /requestedOpticalFootprintMode[\s\S]*effectiveOpticalFootprintMode[\s\S]*opticalFootprintFallbackReason/, 'runtime state distinguishes requested/effective optical footprint identity and fallback');
assert.match(webgpuCoreSource, /requestedTransmissionFootprintMode[\s\S]*effectiveTransmissionFootprintMode[\s\S]*transmissionFootprintFallbackReason/, 'runtime state distinguishes requested/effective transmission footprint identity and fallback');
assert.match(webgpuCoreSource, /transmissionQuadratureMinimumSampleCount:\s*lastEffectiveTransmissionFootprintMode === 'not_executed'[\s\S]*transmissionQuadratureMaximumSampleCount:[\s\S]*lastEffectiveTransmissionFootprintMode === 'dense_exit_filtered' \? 5 : 1/, 'runtime evidence exposes exact adaptive transmission quadrature sample-count bounds');
assert.match(webgpuCoreSource, /effectiveRendererMode === 'screen_space_refraction'[\s\S]*resolvedOpticalLightingMode[\s\S]*'not_executed'/, 'only the refraction renderer may claim an effective optical lighting mode');
assert.match(webgpuCoreSource, /SCREEN_SPACE_SURFACE_SHADER/, 'screen-space renderer owns a separate shading pass');
assert.match(webgpuCoreSource, /kaminos-finger-fluid-surface-accumulation/, 'screen-space renderer allocates particle depth plus optical thickness accumulation');
assert.match(webgpuCoreSource, /screenSpaceSurfaceAccumulationPipeline/, 'renderer has a particle depth/thickness accumulation pipeline');
assert.match(webgpuCoreSource, /struct AccumFragmentOutput\s*\{[\s\S]*@location\(0\) accumulation:[\s\S]*@location\(1\) frontDepth:[\s\S]*@location\(2\) backDepth:/, 'particle raster emits accumulation plus independent front and back slab depths');
assert.match(webgpuCoreSource, /input\.viewDepth - cap \* input\.radius/, 'entry depth comes from the projected particle sphere front cap');
assert.match(webgpuCoreSource, /input\.viewDepth \+ cap \* input\.radius/, 'exit depth comes from the projected particle sphere back cap');
assert.match(webgpuCoreSource, /kaminos-finger-fluid-optical-slab-front-depth/, 'renderer owns a front-depth slab texture');
assert.match(webgpuCoreSource, /kaminos-finger-fluid-optical-slab-back-depth/, 'renderer owns a back-depth slab texture');
assert.match(webgpuCoreSource, /format:\s*'rgba16float'[\s\S]*operation:\s*'min'[\s\S]*format:\s*'rgba16float'[\s\S]*operation:\s*'max'/, 'front and back slab attachments use independent deterministic min/max blending');
assert.match(webgpuCoreSource, /screenSpaceSurfaceCompositePipeline/, 'renderer has a fullscreen smoothing/normal/shading pipeline');
assert.match(
  webgpuCoreSource,
  /fn fs_composite\([^)]*@builtin\(position\) fragmentPosition:[^)]*\)[\s\S]*let pixel = vec2<i32>\(fragmentPosition\.xy\)/,
  'screen-space composite addresses the accumulation texture in fragment framebuffer coordinates without a clip-space Y reflection',
);
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_DEPTH_ROUTE/, 'screen-space liquid names its analytic support-depth authority');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_PRESENTATION_ROUTE\s*=\s*'wgsl-analytic-heightfield-obstacle-presentation-v0'/, 'shared support color and depth have an explicit presentation route');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_DEFERRED_SCENE_ROUTE\s*=\s*'webgpu-deferred-indexed-mesh-scene-v0'/, 'deferred arbitrary-mesh scene route is explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_WORLD_SPACE_REFLECTION_ROUTE\s*=\s*'wgsl-indexed-mesh-world-space-reflection-v0'/, 'world-space reflection provider route is explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_REFLECTION_QUERY_SCHEMA\s*=\s*'kaminos\.reflection-query-provider\.v0'/, 'reflection query boundary has an explicit schema');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_OPTICAL_QUERY_SCHEMA\s*=\s*'kaminos\.optical-query-provider\.v0'/, 'reflection and refraction share an explicit optical query result schema');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_HYBRID_OPTICAL_QUERY_ROUTE\s*=\s*'wgsl-hybrid-deferred-world-optical-query-v0'/, 'hybrid optical query route identity is explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_DEFERRED_RAY_TRAVERSAL_ROUTE\s*=\s*'wgsl-deferred-linear-depth-ray-traversal-v0'/, 'screen-space depth traversal identity is explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_INTERFACE_FIDELITY_ROUTE\s*=\s*'wgsl-regime-aware-interface-footprint-v0'/, 'regime-aware interface fidelity route identity is explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_OPTICAL_QUERY_RESOLVER_ORDER\s*=\s*'deferred_depth_then_uncapped_world_mesh_then_hdr_environment-v0'/, 'hybrid query resolver order is exact and source-honest');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_REFLECTION_ACCELERATION_ROUTE\s*=\s*'uncapped-exact-triangle-scan-v0'/, 'V0 names its exact uncapped traversal honestly rather than claiming a BVH');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_REFLECTION_QUADRATURE_ROUTE\s*=\s*'deterministic-five-ray-cone-quadrature-v0'/, 'finite-footprint world reflection names its quadrature route explicitly');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_VARIANCE_FILTERED_REFLECTION_QUADRATURE_ROUTE\s*=\s*'deterministic-nine-ray-trimmed-variance-footprint-quadrature-v0'/, 'variance-filtered reflection counterfactual has a separate robust normalized quadrature identity');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_RESOLVED_EXIT_TRANSMISSION_ROUTE\s*=\s*'deterministic-one-ray-exit-transport-v0'/, 'resolved transmission names its exact one-ray exit transport');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_DENSE_EXIT_TRANSMISSION_QUADRATURE_ROUTE\s*=\s*'deterministic-five-ray-trimmed-exit-footprint-quadrature-v0'/, 'dense transmission names its robust finite exit footprint');
assert.match(webgpuCoreSource, /fn integrateWorldReflectionQuadrature\([\s\S]*var samples: array<ReflectionSample, 9>[\s\S]*minimumIndex[\s\S]*maximumIndex[\s\S]*\/ 7\.0/, 'variance-filtered quadrature trims one dark and one bright query discontinuity before normalized integration');
assert.match(webgpuCoreSource, /if \(maximumIndex == minimumIndex\)[\s\S]*maximumIndex = select\(0, 1, minimumIndex == 0\)/, 'trimmed quadrature always removes two distinct samples even when all sample luminances tie');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ROUTE\s*=\s*'radiance-rgbe-equirectangular-environment-v0'/, 'HDR environment route identity is explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ASSET_ID\s*=\s*'polyhaven-studio-small-09-1k'/, 'HDR environment asset identity is explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_SHA256\s*=\s*'e7cfda5f4e98e623db12b8bfd0184e048488e4855d9c83e2751fb44a32e80c45'/, 'HDR runtime pins the exact vendored source bytes');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_SOURCE_ASSET_URL\s*=\s*'https:\/\/dl\.polyhaven\.org\/file\/ph-assets\/HDRIs\/hdr\/1k\/studio_small_09_1k\.hdr'/, 'HDR evidence preserves the official source asset URL separately from its runtime path');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_LINEAR_HDR_SCENE_ROUTE\s*=\s*'webgpu-linear-hdr-scene-radiance-v0'/, 'linear scene-radiance custody has an explicit route');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_HDR_WORLD_BACKGROUND_ROUTE\s*=\s*'wgsl-shared-hdr-world-background-v0'/, 'visible HDR world background has an explicit route');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_ENVIRONMENT_FILTER_ROUTE\s*=\s*'deterministic-five-tap-roughness-cone-v0'/, 'roughness-aware environment filtering has an explicit route');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_FINAL_PRESENTATION_ROUTE\s*=\s*'wgsl-linear-exposure-aces-presentation-v0'/, 'the one final display transform has an explicit route');
assert.match(webgpuCoreSource, /const LINEAR_SCENE_FORMAT = 'rgba16float';/, 'scene-radiance authority uses a float attachment rather than the canvas format');
assert.match(webgpuCoreSource, /kaminos-finger-fluid-linear-scene-radiance[\s\S]*format:\s*LINEAR_SCENE_FORMAT[\s\S]*GPUTextureUsage\.RENDER_ATTACHMENT\s*\|\s*GPUTextureUsage\.TEXTURE_BINDING\s*\|\s*GPUTextureUsage\.COPY_SRC/, 'linear scene radiance is renderable, sampleable, and copyable for refraction');
assert.match(webgpuCoreSource, /copyTextureToTexture\([\s\S]*texture:\s*linearSceneRadianceTexture[\s\S]*texture:\s*screenSpaceRefractionSceneTexture/, 'refraction captures the shared linear scene rather than the display-encoded swapchain');
assert.match(webgpuCoreSource, /const FINAL_PRESENTATION_SHADER[\s\S]*toneMapAces\(linearRadiance \* exposure\)[\s\S]*opticalDebugMode == 16[\s\S]*return source/, 'one final presenter tone-maps linear radiance while preserving exact binary support output');
assert.match(webgpuCoreSource, /const FINAL_PRESENTATION_SHADER[\s\S]*@binding\(2\) var presentationSurfaceAccumulation[\s\S]*@binding\(3\) var presentationSupportFrontDepth[\s\S]*@binding\(4\) var presentationCompositeDepth: texture_depth_2d[\s\S]*let expectedLiquidDepth = viewDepthToNdc\(supportOrderingDepth \+ 0\.003\)[\s\S]*let liquidVisible = liquidResident[\s\S]*abs\(presentedDepth - expectedLiquidDepth\)[\s\S]*diagnosticQuantity && liquidVisible/, 'final presentation bypasses display transforms only where the executed hardware depth test retained diagnostic liquid');
assert.doesNotMatch(webgpuCoreSource, /vec4<f32>\(toneMapAces\((?:sampleEnvironment\(reflectionDirection\)|reflectionRadiance|environmentContribution)\)/, 'HDR diagnostics remain linear until the final presentation transform');
assert.match(webgpuCoreSource, /fn sampleEnvironmentFiltered\([\s\S]*roughness[\s\S]*sampleEnvironment\([\s\S]*tangent[\s\S]*bitangent/, 'environment radiance is filtered by a deterministic roughness footprint');
assert.match(webgpuCoreSource, /const HDR_WORLD_BACKGROUND_SHADER[\s\S]*sampleEnvironment[\s\S]*cameraForward[\s\S]*hdrEnvironmentTexture/, 'the visible world samples the same HDR environment used by liquid reflection');
assert.match(webgpuCoreSource, /linearHdrSceneEvidence:\s*\{[\s\S]*requestedRoute:\s*KAMINOS_FINGER_FLUID_LINEAR_HDR_SCENE_ROUTE[\s\S]*effectiveRoute:\s*KAMINOS_FINGER_FLUID_LINEAR_HDR_SCENE_ROUTE[\s\S]*format:\s*LINEAR_SCENE_FORMAT[\s\S]*fallbackReason:\s*null/, 'runtime evidence binds requested/effective linear scene custody without fallback');
assert.match(webgpuCoreSource, /finalPresentationEvidence:\s*\{[\s\S]*requestedRoute:\s*KAMINOS_FINGER_FLUID_FINAL_PRESENTATION_ROUTE[\s\S]*effectiveRoute:\s*KAMINOS_FINGER_FLUID_FINAL_PRESENTATION_ROUTE[\s\S]*toneMap:\s*'aces-fitted-v0'[\s\S]*diagnosticVisibilityRoute:\s*'post-composite-depth24plus-identity-v0'[\s\S]*passCount:/, 'runtime evidence binds the final display transform, diagnostic visibility authority, and executed pass count');
assert.match(webgpuCoreSource, /hdrEnvironment = await loadFingerFluidHdrEnvironment\(\);[\s\S]*catch \(error\) \{\s*device\.destroy\(\);\s*return createUnavailableSolver\(`HDR environment initialization failed:/, 'pre-output HDR initialization failure releases the acquired WebGPU device');
assert.match(webgpuCoreSource, /hitKindDiagnosticScope:\s*'center_ray_only_v0'/, 'runtime evidence limits hit-kind attribution to the exact center ray it classifies');
assert.match(webgpuCoreSource, /fn vs_analytic_support_presentation[\s\S]*toyFloorHeight[\s\S]*toyFloorNormal/, 'support presentation is rasterized from the solver analytic heightfield and its continuous normal');
assert.match(webgpuCoreSource, /fn fs_analytic_support_presentation[\s\S]*fwidth[\s\S]*worldPosition/, 'support presentation exposes world-anchored antialiased calibration landmarks');
assert.match(webgpuCoreSource, /@builtin\(frag_depth\) depth: f32/, 'screen-space composite emits reconstructed liquid depth');
assert.match(webgpuCoreSource, /output\.accumulation = vec4<f32>\(opticalThickness, input\.tracer \* opticalThickness, depthWeight, supportSafeViewDepth \* depthWeight\);[\s\S]*output\.frontDepth = vec4<f32>\([^,]+, supportSafeViewDepth,/, 'continuous shading depth accumulates a weighted sum while the min-blended slab stores collision-safe nearest-center ordering separately');
assert.match(webgpuCoreSource, /fn weightedDepth\(sampleValue: vec4<f32>\) -> f32 \{[\s\S]*sampleValue\.w \/ max\(sampleValue\.z, 0\.0001\)/, 'shading depth resolves the accumulated depth-weighted sum instead of a nearest-particle Voronoi owner');
assert.match(webgpuCoreSource, /fn readSupportOrderingDepth\([\s\S]*textureLoad\(opticalSlabFrontDepth[\s\S]*\.y/, 'support ordering reads the independent nearest-center channel from the min-blended front slab');
assert.match(webgpuCoreSource, /depth_weighted_view_depth_sum[\s\S]*nearest_particle_center_view_depth_min/, 'runtime evidence names both continuous shading depth and collision-safe ordering depth channels');
assert.match(webgpuCoreSource, /let supportOrderingDepth = readSupportOrderingDepth\(pixel\);[\s\S]*let shadingDepth = edgePreservingDepth\(pixel, centerAccum\);[\s\S]*output\.depth = clamp\(viewDepthToNdc\(supportOrderingDepth/, 'neighbor-smoothed shading depth cannot pull hidden liquid in front of analytic support');
assert.match(webgpuCoreSource, /format: 'rgba16float',[\s\S]*alpha: \{ srcFactor: 'one', dstFactor: 'one', operation: 'add' \}[\s\S]*clearValue: \{ r: 0, g: 0, b: 0, a: 0 \}/, 'weighted shading depth uses additive alpha blending from a zero clear value');
assert.match(webgpuCoreSource, /screenSpaceSurfaceCompositePipeline[\s\S]*depthStencil:\s*\{\s*format:\s*'depth24plus',\s*depthWriteEnabled:\s*true,\s*depthCompare:\s*'less'/, 'screen-space liquid preserves its executed final visibility in the presentation depth authority');
assert.match(webgpuCoreSource, /const screenSpaceCompositeLayout = device\.createBindGroupLayout\(\{[\s\S]*binding: 7[\s\S]*\}\);\n  const analyticSupportPresentationLayout/, 'surface composite layout declares the front slab channel that owns nearest-center support ordering');
assert.match(webgpuCoreSource, /screenSpaceSurfaceCompositeBindGroup = device\.createBindGroup\(\{[\s\S]*binding: 7, resource: screenSpaceOpticalSlabFrontDepthTexture\.createView\(\)[\s\S]*\}\);\n    screenSpaceRefractionCompositeBindGroup/, 'surface composite bind group supplies the front slab ordering texture');
assert.match(webgpuCoreSource, /hdrWorldBackgroundPass[\s\S]*loadOp:\s*'clear'[\s\S]*analyticSupportPresentationPass[\s\S]*view:\s*linearSceneRadianceView,[\s\S]*loadOp:\s*'load'[\s\S]*depthLoadOp:\s*'clear'[\s\S]*analyticSupportPresentationPipeline/, 'HDR world clears linear radiance before analytic support loads it and writes collision-authoritative depth');
assert.match(webgpuCoreSource, /analyticSupportPresentationPass\.draw\(analyticSupportVertexCount\)[\s\S]*if \(effectiveRendererMode === 'sphere_debug'\)/, 'all renderer modes execute the complete adaptive support presentation before their liquid-specific branch');
assert.match(webgpuCoreSource, /kaminos-finger-fluid-deferred-world-normal-roughness/, 'scene owns a sampleable world-normal and roughness attachment');
assert.match(webgpuCoreSource, /kaminos-finger-fluid-deferred-albedo-metallic/, 'scene owns a sampleable albedo and metallic attachment');
assert.match(webgpuCoreSource, /kaminos-finger-fluid-deferred-linear-depth-object/, 'scene owns a sampleable linear-depth and object-identity attachment');
assert.match(webgpuCoreSource, /dynamicIndexedMeshPass\.setVertexBuffer\([\s\S]*dynamicIndexedMeshPass\.setIndexBuffer\([\s\S]*dynamicIndexedMeshPass\.drawIndexed\(DYNAMIC_REFLECTION_MESH_INDEX_COUNT\)/, 'deferred scene executes a real indexed dynamic mesh draw');
assert.match(webgpuCoreSource, /fn traceClosestSurface\([\s\S]*traceIndexedMesh\([\s\S]*traceAnalyticSphere\([\s\S]*fn shadeSurfaceHit[\s\S]*sampleEnvironment\(/, 'liquid reflection uses an attributable world-space provider boundary with HDR environment misses');
assert.match(webgpuCoreSource, /@group\(0\) @binding\(13\) var deferredLinearDepthObject: texture_2d<f32>;[\s\S]*@binding\(14\) var deferredWorldNormalRoughness: texture_2d<f32>;[\s\S]*@binding\(15\) var deferredAlbedoMetallic: texture_2d<f32>;/, 'hybrid optical queries consume deferred depth, normal, and material truth directly');
assert.match(webgpuCoreSource, /fn traceDeferredScene\([\s\S]*deferredLinearDepthObject[\s\S]*sceneDepth[\s\S]*objectId[\s\S]*return hit;/, 'the first resolver performs bounded traversal against the same-camera deferred linear depth field');
assert.match(webgpuCoreSource, /fn sampleHybridOpticalQuery\([\s\S]*traceDeferredScene\([\s\S]*sampleWorldOpticalQuery\(/, 'deferred traversal falls through to the shared uncapped world query instead of silently sampling a clamped UV');
assert.match(webgpuCoreSource, /let exitWorldPosition = reconstructWorldPosition\(exitPixel, sampledExitDepth\);[\s\S]*let outgoingWorldRay = viewDirectionToWorld\([^\n]+\);[\s\S]*sampleHybridOpticalQuery\(exitWorldPosition \+ outgoingWorldRay \* 0\.035, outgoingWorldRay\)/, 'two-interface refraction submits its reconstructed exit position and physical outgoing ray to the hybrid query');
assert.match(webgpuCoreSource, /@group\(0\) @binding\(12\) var hdrEnvironmentTexture: texture_2d<f32>;/, 'refraction shader binds the source HDR environment independently of scene color');
assert.match(webgpuCoreSource, /fn decodeRgbe\([\s\S]*exp2\(/, 'WGSL reconstructs linear radiance from RGBE mantissas and exponent');
assert.match(webgpuCoreSource, /fn loadEnvironmentTexel\([\s\S]*textureLoad\(hdrEnvironmentTexture/, 'WGSL loads exact source RGBE texels before filtering');
assert.match(webgpuCoreSource, /fn sampleEnvironment\([\s\S]*mix\(top, bottom, blend\.y\)/, 'WGSL manually bilinear-filters decoded linear environment radiance');
assert.doesNotMatch(webgpuCoreSource, /fn sampleEnvironment\([\s\S]{0,500}let sky = mix/, 'environment misses cannot silently use the old procedural sky');
assert.match(webgpuCoreSource, /fn integrateParticipatingRadiance\([\s\S]*return vec3<f32>\(0\.0\)/, 'future Flame radiance owns an explicit zero-contribution boundary rather than a fake surface hit');
assert.match(webgpuCoreSource, /REFLECTION_HIT_ENVIRONMENT[\s\S]*REFLECTION_HIT_ANALYTIC[\s\S]*REFLECTION_HIT_INDEXED_MESH/, 'environment, analytic, and arbitrary-mesh reflection hits remain distinct');
assert.match(webgpuCoreSource, /refractedRadiance \* absorption \* \(1\.0 - fresnel\)[\s\S]*reflectionRadiance \* fresnel/, 'Fresnel conservatively partitions absorbed hybrid exit-ray radiance and reflection');
assert.match(webgpuCoreSource, /let calibratedAbsorptionCoefficient = vec3<f32>\(1\.10, 0\.42, 0\.18\);[\s\S]*let legacyAbsorptionCoefficient = vec3<f32>\(0\.46, 0\.15, 0\.055\);[\s\S]*select\(calibratedAbsorptionCoefficient, legacyAbsorptionCoefficient, opticalLightingMode == 2\)[\s\S]*let absorption = exp\(-absorptionCoefficient \* absorptionPath\);/, 'scene-scale Beer-Lambert absorption materially separates thick water from bright transmitted HDR radiance while preserving an exact legacy baseline');
assert.match(webgpuCoreSource, /absorptionCoefficients:\s*lastEffectiveOpticalLightingMode === 'not_executed'[\s\S]*\? null[\s\S]*fingerFluidAbsorptionCoefficientsForLightingMode\(lastEffectiveOpticalLightingMode\)/, 'runtime evidence records coefficients only when the exact effective optical lighting mode executed');
assert.match(webgpuCoreSource, /fn reconstructWorldReflectionNormal\([\s\S]*edgePreservingDepth\([\s\S]*reconstructWorldPosition\([\s\S]*cross\(/, 'reflection reconstructs a perspective-correct world normal from the edge-preserved continuous depth field');
assert.match(webgpuCoreSource, /fn reconstructWorldReflectionNormal\([\s\S]*pixel \+ vec2<i32>\(-6, 0\)[\s\S]*pixel \+ vec2<i32>\(6, 0\)[\s\S]*pixel \+ vec2<i32>\(0, -6\)[\s\S]*pixel \+ vec2<i32>\(0, 6\)/, 'world reflection uses a wider macronormal chord than the fine refraction and specular normal');
assert.match(webgpuCoreSource, /fn integrateWorldReflectionQuadrature\([\s\S]*centerDirection[\s\S]*tangent \* coneRadius[\s\S]*tangent \* -coneRadius[\s\S]*bitangent \* coneRadius[\s\S]*bitangent \* -coneRadius/, 'world reflection integrates a deterministic center-plus-four-lobe cone quadrature');
assert.match(webgpuCoreSource, /let reflectionQuadrature = integrateWorldReflectionQuadrature\([\s\S]*worldPosition,[\s\S]*cameraRay,[\s\S]*reflectionSurfaceNormal,[\s\S]*reflectionConeRadius,[\s\S]*effectiveFootprintQuadratureMode,[\s\S]*let reflectionRadiance = reflectionQuadrature\.radiance;/, 'shaded refraction consumes the exact effective finite-footprint world-reflection quadrature around the bounded optical normal');
assert.match(webgpuCoreSource, /let opticalDebugMode = i32\(round\(params\.cameraUp\.w\)\);[\s\S]*if \(opticalDebugMode == 11\)[\s\S]*sampleHybridOpticalQuery\(exitWorldPosition[\s\S]*let reflectionEntryDepth[\s\S]*if \(opticalDebugMode == 13 \|\| opticalDebugMode == 14\)[\s\S]*sampleHybridOpticalQuery\(worldPosition[\s\S]*integrateWorldReflectionQuadrature/, 'cheap interface diagnostics return before hybrid traversal while refraction and reflection diagnostics exercise their physical query rays');
assert.match(webgpuCoreSource, /if \(opticalDebugMode == 15\)[\s\S]*sampleEnvironmentFiltered\(reflectionDirection, reflectionRoughness\)[\s\S]*if \(opticalDebugMode == 13 \|\| opticalDebugMode == 14\)/, 'environment diagnostic samples the roughness-filtered HDR map without laundering mesh hits into its output');
assert.match(webgpuCoreSource, /if \(opticalDebugMode == 16\)[\s\S]*vec4<f32>\(1\.0, 1\.0, 1\.0, 1\.0\)/, 'binary liquid-support diagnostic is emitted directly from the GPU liquid fragment predicate');
assert.match(webgpuCoreSource, /let centerCoverage = smoothstep\([\s\S]*centerAccum\.z[\s\S]*centerAccum\.x[\s\S]*let geometricCoverage[\s\S]*if \(opticalDebugMode == 18\)/, 'coverage is an inspectable geometric support quantity derived before optical transport');
assert.match(webgpuCoreSource, /for \(var coverageY = -2; coverageY <= 2; coverageY = coverageY \+ 1\)[\s\S]*coverageSupportSum[\s\S]*coverageContinuity/, 'coverage integrates a local support footprint instead of saturating from one resident pixel');
assert.match(webgpuCoreSource, /struct InterfaceNormalEstimate\s*\{[\s\S]*detailNormal:[\s\S]*filteredNormal:[\s\S]*variance:[\s\S]*denseBodyConfidence:/, 'interface fidelity exposes its detail normal, filtered normal, unresolved variance, and dense-body regime confidence');
assert.match(webgpuCoreSource, /fn reconstructEntryNormalAtRadius\([\s\S]*radius: i32[\s\S]*fn estimateInterfaceNormal\([\s\S]*reconstructEntryNormalAtRadius\(pixel, centerDepth, 1\)[\s\S]*reconstructEntryNormalAtRadius\(pixel, centerDepth, 3\)/, 'entry normal fidelity compares one-pixel detail against a wider three-pixel interface chord');
assert.match(webgpuCoreSource, /let legacyCoverage =[\s\S]*let denseCoverageClosure =[\s\S]*let adaptiveCoverage = mix\(legacyCoverage, denseCoverageClosure, interfaceNormal\.denseBodyConfidence\)/, 'coverage closure is confined to the analytically classified dense-body regime');
assert.match(webgpuCoreSource, /let interfaceFidelityEnabled = opticalDebugMode != 22[ui]*;[\s\S]*let geometricCoverage = select\(legacyCoverage, adaptiveCoverage, interfaceFidelityEnabled\);/, 'legacy-interface debug mode preserves an exact same-state pre-fidelity coverage path');
assert.match(webgpuCoreSource, /if \(opticalDebugMode == 23\)[\s\S]*interfaceNormal\.denseBodyConfidence[\s\S]*coverageContinuity[\s\S]*interfaceNormal\.variance/, 'interface-fidelity diagnostic independently encodes body regime, local continuity, and unresolved normal variance');
assert.match(webgpuCoreSource, /fn evaluateBoundedGgxDirectSpecular\([\s\S]*distributionGgx[\s\S]*geometrySmith[\s\S]*fresnelSchlick[\s\S]*min\(specular, vec3<f32>\(0\.22\)\)/, 'bounded direct lighting uses view-dependent GGX and an explicit energy ceiling');
assert.match(webgpuCoreSource, /let transportOnlyColor = transmittedTransport \+ reflectedTransport \+ scatterTransport;[\s\S]*var color = transportOnlyColor;[\s\S]*opticalLightingMode == 1[\s\S]*evaluateBoundedGgxDirectSpecular[\s\S]*opticalLightingMode == 2[\s\S]*broadSpecular/, 'transport-only is the decomposed zero-direct-additive base while bounded GGX and legacy additive lighting remain explicit branches');
assert.doesNotMatch(webgpuCoreSource, /let transportOnlyColor[^;]*\+[^;]*(?:broadSpecular|crestSpecular|evaluateBoundedGgxDirectSpecular)/, 'the production transport base cannot unconditionally add direct-light energy after Fresnel composition');
assert.match(webgpuCoreSource, /let transmittedTransport = refractedRadiance \* absorption \* \(1\.0 - fresnel\);[\s\S]*let reflectedTransport = reflectionRadiance \* fresnel;[\s\S]*let scatterTransport = waterScatter \* \(1\.0 - fresnel\);[\s\S]*let transportOnlyColor = transmittedTransport \+ reflectedTransport \+ scatterTransport;/, 'transport-only shading is exactly decomposed into absorbed transmission, Fresnel-weighted reflection, and scatter');
assert.match(webgpuCoreSource, /opticalDebugMode == 24[\s\S]*transmittedTransport[\s\S]*opticalDebugMode == 25[\s\S]*reflectedTransport[\s\S]*opticalDebugMode == 26[\s\S]*scatterTransport[\s\S]*opticalDebugMode == 27[\s\S]*preToneLuminance/, 'transport decomposition and pre-presentation luminance are independently inspectable');
assert.match(webgpuCoreSource, /let opticalFootprintMode = i32\(round\(params\.cameraPosition\.w\)\);[\s\S]*let footprintActivation = interfaceNormal\.denseBodyConfidence[\s\S]*unresolvedNormalVariance[\s\S]*select\(baselineReflectionConeRadius, varianceFilteredConeRadius, opticalFootprintMode == 1\)/, 'variance filtering widens only the dense unresolved reflection footprint and does not alter solver geometry');
assert.match(webgpuCoreSource, /fn integrateWorldReflectionQuadrature\([\s\S]*opticalFootprintMode: i32[\s\S]*if \(opticalFootprintMode == 0\)[\s\S]*center\.radiance \* 0\.36[\s\S]*radianceSum[\s\S]*\/ 7\.0/, 'baseline five-ray and variance-filtered trimmed nine-ray quadratures use explicit normalized weights');
assert.match(webgpuCoreSource, /if \(opticalDebugMode == 28\)[\s\S]*unresolvedNormalVariance[\s\S]*footprintActivation[\s\S]*if \(opticalDebugMode == 29\)[\s\S]*baselineReflectionConeRadius[\s\S]*reflectionConeRadius/, 'normal variance and effective reflection footprint are independently inspectable');
assert.match(webgpuCoreSource, /let transmissionFootprintMode = i32\(round\(params\.opticalModes\.x\)\);[\s\S]*let exitNormalVariance[\s\S]*let transmissionFootprintActivation = interfaceNormal\.denseBodyConfidence[\s\S]*effectiveTransmissionQuadratureMode/, 'transmission footprint uses its own uniform identity and activates only on dense unresolved exit geometry');
assert.match(webgpuCoreSource, /let bodyTransportMode = i32\(round\(params\.opticalModes\.y\)\);/, 'body transport consumes an independent shader uniform identity');
assert.match(webgpuCoreSource, /let interfaceFrequencyMode = i32\(round\(params\.opticalModes\.z\)\);/, 'interface-frequency separation consumes an independent shader uniform identity');
assert.match(webgpuCoreSource, /struct InterfaceNormalEstimate\s*\{[\s\S]*detailNormal:[\s\S]*macroNormal:[\s\S]*microResidual:[\s\S]*variance:/, 'interface estimate publishes explicit macro geometry and its micro residual');
assert.match(webgpuCoreSource, /let coupledTransportNormal = select\(interfaceNormal\.detailNormal, interfaceNormal\.filteredNormal, interfaceFidelityEnabled\);[\s\S]*let transportNormal = select\(coupledTransportNormal, interfaceNormal\.macroNormal, interfaceFrequencyMode == 1\);[\s\S]*refract\(-viewDir, transportNormal, 1\.0 \/ 1\.333\)/, 'entry Snell transport is macro-owned only on the separated route while preserving the coupled baseline');
assert.match(webgpuCoreSource, /let exitTransportNormal = select\(exitNormal, exitMacroNormal, interfaceFrequencyMode == 1\);[\s\S]*refract\(insideRay, -exitTransportNormal, 1\.333\)/, 'exit Snell transport is macro-owned only on the separated route');
assert.doesNotMatch(webgpuCoreSource, /refract\([^;]*(?:microResidual|reflectionSurfaceNormal|reflectionDetailNormal)/, 'micro normal detail cannot enter either Snell interface');
assert.match(webgpuCoreSource, /let macroFresnelNormal = worldNormal;[\s\S]*let ndv = clamp\(dot\(macroFresnelNormal, viewToCamera\), 0\.0, 1\.0\);[\s\S]*let fresnel = f0 \+/, 'primary Fresnel remains owned by the stable world-space macro normal');
assert.match(webgpuCoreSource, /let microReflectionWeight = select\([\s\S]*0\.0,[\s\S]*clamp\([\s\S]*0\.0,[\s\S]*0\.24,[\s\S]*interfaceFrequencyMode == 1,[\s\S]*let reflectionSurfaceNormal = normalize\(mix\(worldNormal, reflectionDetailNormal, microReflectionWeight\)\);[\s\S]*reflect\(cameraRay, reflectionSurfaceNormal\)/, 'separated micro detail can steer only a tightly bounded reflection lobe');
assert.match(webgpuCoreSource, /let opticalThicknessPath = thickness \* 0\.12;[\s\S]*let denseBodyPathActivation = interfaceNormal\.denseBodyConfidence[\s\S]*queryValidity[\s\S]*let robustBodyPath = mix\([\s\S]*geometricPathLength[\s\S]*max\(geometricPathLength, opticalThicknessPath\)[\s\S]*denseBodyPathActivation[\s\S]*let absorptionPath = select\([\s\S]*robustBodyPath[\s\S]*bodyTransportMode == 1\)/, 'robust body transport can only lengthen valid dense geometric paths toward optical-thickness evidence');
assert.match(webgpuCoreSource, /let bodyRadianceLowFrequency = transmissionQuadratureRadiance;[\s\S]*let bodyRadianceDirectionalResidual = refractionQuery\.radiance - bodyRadianceLowFrequency;[\s\S]*let bodyRadianceResidualWeight[\s\S]*let transmissionDetailWeight[\s\S]*let robustBodyRadiance = max\(bodyRadianceLowFrequency \+ bodyRadianceDirectionalResidual \* transmissionDetailWeight, vec3<f32>\(0\.0\)\)[\s\S]*let refractedRadiance = mix\([\s\S]*robustBodyRadiance[\s\S]*bodyTransportMode == 1/, 'robust body radiance preserves low-frequency transport and gates only its directional residual');
assert.match(webgpuCoreSource, /let pathConditionedDetailDecay =[\s\S]*interfaceNormal\.denseBodyConfidence[\s\S]*queryValidity[\s\S]*smoothstep\([^;]*absorptionPath\);[\s\S]*let transmissionDetailWeight = select\(\s*bodyRadianceResidualWeight,[\s\S]*interfaceFrequencyMode == 1,[\s\S]*bodyRadianceLowFrequency \+ bodyRadianceDirectionalResidual \* transmissionDetailWeight/, 'separated transmission preserves low-frequency body radiance while path-conditioning only directional detail');
assert.match(webgpuCoreSource, /opticalDebugMode == 34[\s\S]*interfaceNormal\.macroNormal[\s\S]*opticalDebugMode == 35[\s\S]*interfaceNormal\.microResidual[\s\S]*opticalDebugMode == 36[\s\S]*microReflectionWeight[\s\S]*opticalDebugMode == 37[\s\S]*transmissionDetailWeight/, 'macro normal, micro residual, bounded reflection roughness, and transmission detail weight are independently inspectable');
assert.match(webgpuCoreSource, /opticalDebugMode == 32[\s\S]*geometricPathLength[\s\S]*opticalThicknessPath[\s\S]*absorptionPath[\s\S]*opticalDebugMode == 33[\s\S]*transmissionDetailWeight/, 'body path closure and effective radiance detail weight are independently inspectable');
assert.match(webgpuCoreSource, /let transmissionConeRadius = clamp\([\s\S]*0\.22,[\s\S]*transmissionConeRadius \/ 0\.22/, 'dense transmission footprint exposes a bounded but materially testable angular support and source-honest diagnostic normalization');
assert.match(webgpuCoreSource, /fn integrateTransmissionQuadrature\([\s\S]*transmissionFootprintMode: i32[\s\S]*if \(transmissionFootprintMode == 0\)[\s\S]*var samples: array<OpticalQuerySample, 5>[\s\S]*minimumIndex[\s\S]*maximumIndex[\s\S]*\/ 3\.0/, 'filtered transmission uses a normalized trimmed five-ray hybrid-query footprint while baseline stays one ray');
assert.match(webgpuCoreSource, /if \(opticalDebugMode == 30\)[\s\S]*exitNormalVariance[\s\S]*transmissionFootprintActivation[\s\S]*if \(opticalDebugMode == 31\)[\s\S]*transmissionConeRadius[\s\S]*effectiveTransmissionQuadratureMode/, 'exit-normal variance and effective transmission footprint are independently inspectable');
assert.match(webgpuCoreSource, /deferredHit\.valid > 0\.5 && deferredHit\.confidence >= 0\.55/, 'hybrid optical queries reject marginal deferred crossings before they can punch dark scene-color holes');
assert.match(webgpuCoreSource, /screenSpaceRefractionCompositePipeline = await device\.createRenderPipelineAsync\([\s\S]*format: LINEAR_SCENE_FORMAT,[\s\S]*srcFactor: 'src-alpha'/, 'refraction composites geometric coverage into the linear scene with alpha blending');
assert.match(webgpuCoreSource, /return refractionOutput\(vec4<f32>\(color, geometricCoverage\)/, 'shaded liquid exports geometric coverage independently from optical color');
assert.doesNotMatch(webgpuCoreSource, /fresnel\s*=\s*fresnel\s*\*/, 'geometric coverage cannot hide the rim by mutating Fresnel');
assert.match(webgpuCoreSource, /let reflectionRoughness = clamp\([\s\S]*unresolvedNormalVariance[\s\S]*pow\(1\.0 - ndv, 2\.0\)/, 'reflection filtering expands at unresolved normals and grazing reconstruction angles without changing Fresnel');
assert.match(webgpuCoreSource, /struct ReflectionQuadrature[\s\S]*radiance: vec3<f32>[\s\S]*environmentRadiance: vec3<f32>/, 'production reflection quadrature preserves attributable environment radiance beside total radiance');
assert.match(webgpuCoreSource, /let reflectionQuadrature = integrateWorldReflectionQuadrature[\s\S]*let environmentContribution = reflectionQuadrature\.environmentRadiance \* fresnel[\s\S]*opticalDebugMode == 17[\s\S]*vec4<f32>\(environmentContribution[\s\S]*let transmittedTransport = refractedRadiance \* absorption \* \(1\.0 - fresnel\)[\s\S]*let reflectedTransport = reflectionRadiance \* fresnel/, 'environment contribution diagnostic stays linear after production quadrature and Fresnel immediately before exact transport decomposition');
assert.match(webgpuCoreSource, /liquidSupportDiagnostic[\s\S]*loadOp: liquidSupportDiagnostic \? 'clear' : 'load'/, 'binary liquid-support presentation clears prior scene color instead of inheriting mesh pixels');
assert.match(webgpuCoreSource, /let reflectionEntryDepth = coherentSlabDepth\(pixel, shadingDepth, false\);[\s\S]*let worldPosition = reconstructWorldPosition\(pixel, reflectionEntryDepth\);[\s\S]*let worldNormal = reconstructWorldReflectionNormal\(pixel\);[\s\S]*let macroFresnelNormal = worldNormal;[\s\S]*let ndv = clamp\(dot\(macroFresnelNormal, viewToCamera\), 0\.0, 1\.0\);/, 'reflection keeps its origin on the optical entry interface while Fresnel stays on the edge-preserved macro normal');
assert.doesNotMatch(webgpuCoreSource, /let worldPosition = reconstructWorldPosition\(pixel, shadingDepth\);/, 'reflection cannot launch secondary rays from smoothed particle-center depth behind the optical entry surface');
assert.doesNotMatch(webgpuCoreSource, /let worldNormal = reconstructWorldEntryNormal\(pixel, reflectionEntryDepth\);/, 'raw projected sphere-front scallops cannot directly steer the shaded world-space reflection ray');
assert.match(webgpuCoreSource, /effectiveRendererMode === 'sphere_debug'[\s\S]*pass\.draw\(6, safeParticleCount\)/, 'sphere-debug preserves particle spheres without drawing tiled support proxies');
assert.doesNotMatch(webgpuCoreSource, /draw\(6, safeParticleCount \+ PLAYGROUND_TILE_COUNT/, 'sphere-debug cannot silently restore particle-tiled support geometry');
assert.match(webgpuCoreSource, /compositePass[\s\S]*depthStencilAttachment:\s*\{[\s\S]*view:\s*depthTexture\.createView\(\)[\s\S]*depthLoadOp:\s*'load'/, 'surface composite loads analytic support depth instead of painting through terrain');
assert.match(webgpuCoreSource, /edgePreservingDepth/, 'screen-space shader performs edge-preserving depth smoothing');
assert.match(webgpuCoreSource, /reconstructSurfaceNormal/, 'screen-space shader reconstructs normals from smoothed particle depth');
assert.match(webgpuCoreSource, /fresnel/, 'screen-space shader exposes Fresnel/specular water shading');
assert.match(webgpuCoreSource, /absorption/, 'screen-space shader exposes optical-thickness absorption');
assert.match(webgpuCoreSource, /kaminos-finger-fluid-refraction-scene-color/, 'refraction captures a renderer-owned scene-color texture');
assert.match(webgpuCoreSource, /screenSpaceRefractionScenePassCount/, 'runtime evidence counts actual scene-color capture passes');
assert.match(webgpuCoreSource, /screenSpaceRefractionCompositePipeline/, 'refraction owns a distinct fullscreen optical transport pipeline');
assert.match(webgpuCoreSource, /fn reconstructRefractionOffset/, 'refraction derives an inspectable screen-space transport offset');
assert.match(webgpuCoreSource, /refract\(-viewDir, transportNormal, 1\.0 \/ 1\.333\)/, 'entry refraction applies air-to-water Snell transport through the explicit transport normal');
assert.match(webgpuCoreSource, /refract\(insideRay, -exitTransportNormal, 1\.333\)/, 'exit refraction applies water-to-air Snell transport through the explicit outward transport normal');
assert.match(webgpuCoreSource, /clamp\(offsetPixels, vec2<f32>\(-28\.0\), vec2<f32>\(28\.0\)\)/, 'two-interface screen-space transport cannot leave an unbounded sampling displacement');
assert.match(webgpuCoreSource, /struct OpticalSlab\s*\{[\s\S]*entryDepth:[\s\S]*exitDepth:[\s\S]*geometricPathLength:[\s\S]*supportPerSpanConfidence:[\s\S]*exitValidity:/, 'optical slab makes entry, exit, path, confidence, and validity independently inspectable');
assert.match(webgpuCoreSource, /fn reconstructExitNormal/, 'back-depth gradients produce an explicit exit-normal estimate');
assert.match(webgpuCoreSource, /let unclampedExitUv =[\s\S]*let exitInFrame = all\(unclampedExitUv >= vec2<f32>\(0\.001\)\) && all\(unclampedExitUv <= vec2<f32>\(0\.999\)\)/, 'off-screen exit invalidity is measured before scene-coordinate clamping');
assert.match(webgpuCoreSource, /entry_interface_only_no_exit_claim_v0/, 'invalid slab geometry has an evidence-named non-exit disposition instead of silent two-interface fallback');
assert.match(webgpuCoreSource, /fn makeNoOpticalQuerySample\(\) -> OpticalQuerySample[\s\S]*sample\.hitKind = REFLECTION_HIT_NONE[\s\S]*sample\.providerKind = OPTICAL_PROVIDER_NONE/, 'invalid slabs have an explicit no-query sample identity');
assert.match(webgpuCoreSource, /var refractionQuery = makeNoOpticalQuerySample\(\);\s*if \(queryValidity > 0\.5\) \{\s*refractionQuery = sampleHybridOpticalQuery\(exitWorldPosition \+ outgoingWorldRay \* 0\.035, outgoingWorldRay\);\s*\}/, 'the hybrid exit-ray query executes only after the binary two-interface validity predicate authorizes it');
assert.doesNotMatch(webgpuCoreSource, /let refractionQuery = sampleHybridOpticalQuery\(exitWorldPosition/, 'an unconditional refracted exit query cannot bypass slab validity');
assert.match(webgpuCoreSource, /let queryValidity = select\(0\.0, 1\.0, exitValidity > 0\.5\)/, 'one binary predicate governs whether two-interface query transport contributes');
assert.match(webgpuCoreSource, /mix\(entryOnlyOffset, twoInterfaceOffset, queryValidity\)[\s\S]*let opticalThicknessPath = thickness \* 0\.12;[\s\S]*let geometricSlabPath = mix\(opticalThicknessPath, geometricPathLength, queryValidity\)[\s\S]*let refractedRadiance = mix\([\s\S]*refractedScene\.rgb[\s\S]*queryValidity/, 'no-query slabs retain the complete legacy entry-interface offset, thickness absorption, and scene-radiance path');
assert.match(webgpuCoreSource, /var transmissionQuadratureRadiance = refractionQuery\.radiance;[\s\S]*if \(queryValidity > 0\.5\)[\s\S]*integrateTransmissionQuadrature[\s\S]*let refractedRadiance = mix\([\s\S]*refractedScene\.rgb[\s\S]*select\(transmissionQuadratureRadiance, robustBodyRadiance, bodyTransportMode == 1\)[\s\S]*queryValidity/, 'finite transmission integration and robust body radiance remain behind the exact binary exit-validity predicate and preserve invalid-slab fallback');
assert.doesNotMatch(webgpuCoreSource, /mix\(refractedScene\.rgb, refractionQuery\.radiance, exitValidity\)/, 'marginal no-query slabs cannot blend toward the zero sentinel radiance');
assert.match(webgpuCoreSource, /fn fs_refraction[\s\S]{0,120}-> CompositeOutput/, 'refraction emits reconstructed liquid fragment depth instead of bypassing support ordering');
assert.match(webgpuCoreSource, /fn fs_refraction\(@builtin\(position\) fragmentPosition: vec4<f32>\) -> CompositeOutput[\s\S]*let pixel = vec2<i32>\(fragmentPosition\.xy\)/, 'refraction reads accumulation in framebuffer coordinates instead of vertically inverted fullscreen UV space');
assert.match(webgpuCoreSource, /fn fs_refraction[\s\S]*centerAccum\.z < 0\.018 \|\| centerAccum\.x < 0\.012[\s\S]*discard/, 'refraction residency uses landed depth weight and optical thickness channels');
assert.match(webgpuCoreSource, /fn fs_refraction[\s\S]*let supportOrderingDepth = readSupportOrderingDepth\(pixel\);[\s\S]*let shadingDepth = edgePreservingDepth\(pixel, centerAccum\);[\s\S]*let thickness = centerAccum\.x;/, 'refraction keeps raw nearest-center ordering separate from smoothed weighted shading depth and optical thickness');
assert.match(webgpuCoreSource, /fn refractionOutput[\s\S]*output\.depth = clamp\(viewDepthToNdc\(supportOrderingDepth \+ 0\.003\)/, 'every optical debug and shaded return carries the same raw support-ordering depth');
assert.match(webgpuCoreSource, /context\.configure\(\{ device, format, alphaMode: canvasAlphaMode, usage: GPUTextureUsage\.RENDER_ATTACHMENT \| GPUTextureUsage\.COPY_SRC \}\)/, 'refraction can capture the exact same-camera support presentation from the current canvas texture');
assert.match(webgpuCoreSource, /kaminos-finger-fluid-refraction-scene-color[\s\S]*GPUTextureUsage\.COPY_DST/, 'renderer-owned refraction scene color accepts the exact support presentation copy');
assert.match(webgpuCoreSource, /copyTextureToTexture\([\s\S]*texture: linearSceneRadianceTexture[\s\S]*texture: screenSpaceRefractionSceneTexture/, 'scene color is copied from the shared linear scene instead of the display-encoded swapchain');
assert.match(webgpuCoreSource, /analyticSupportPresentationPass\.end\(\)[\s\S]*copyTextureToTexture\([\s\S]*screenSpaceRefractionSceneTexture/, 'refraction captures scene color only after the analytic support presentation is complete');
assert.match(webgpuCoreSource, /dynamicIndexedMeshPass\.end\(\)[\s\S]*copyTextureToTexture\([\s\S]*screenSpaceRefractionSceneTexture/, 'refraction captures scene color only after the deferred dynamic-mesh scene is complete');
assert.match(webgpuCoreSource, /screenSpaceRefractionCompositePipeline[\s\S]*depthStencil:\s*\{\s*format:\s*'depth24plus',\s*depthWriteEnabled:\s*true,\s*depthCompare:\s*'less'/, 'refraction preserves its executed final visibility in the presentation depth authority');
assert.match(webgpuCoreSource, /two-interface-optical-slab-composite[\s\S]*loadOp: liquidSupportDiagnostic \? 'clear' : 'load'/, 'normal refraction retains the copied scene while binary liquid support clears prior color');
assert.match(webgpuCoreSource, /opticalDebugMode/, 'runtime evidence records the effective optical debug quantity');
assert.match(webgpuCoreSource, /refractionEvidence:\s*\{[\s\S]*opticalTransportRoute:[\s\S]*sceneColorTexture:[\s\S]*scenePassCount:[\s\S]*compositePassCount:/, 'refraction evidence binds route, scene source, and executed passes');
assert.match(webgpuCoreSource, /refractionEvidence:\s*\{[\s\S]*supportDepthRoute:\s*KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_DEPTH_ROUTE[\s\S]*analyticSupportDepthPassCount/, 'refraction evidence names the landed analytic support-depth route and executed pass count');
assert.match(webgpuCoreSource, /supportPresentationEvidence:\s*\{[\s\S]*route:\s*KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_PRESENTATION_ROUTE[\s\S]*colorDepthAuthority:\s*'same_pass_same_analytic_geometry_v0'[\s\S]*particleSupportDrawCount/, 'runtime evidence binds the shared support presentation route, same-geometry authority, and absence of proxy draws');
assert.match(webgpuCoreSource, /refractionEvidence:\s*\{[\s\S]*slabRoute:\s*KAMINOS_FINGER_FLUID_OPTICAL_SLAB_ROUTE[\s\S]*slabGeometryPassCount[\s\S]*frontDepthTexture:[\s\S]*backDepthTexture:[\s\S]*invalidSlabDisposition:/, 'refraction evidence binds slab route, executed geometry passes, textures, and invalidity disposition');
assert.match(webgpuCoreSource, /refractionEvidence:\s*\{[\s\S]*interfaceFidelityRoute:\s*KAMINOS_FINGER_FLUID_INTERFACE_FIDELITY_ROUTE[\s\S]*coverageClosure:\s*'dense_support_footprint_closure_sparse_identity_v0'[\s\S]*normalFiltering:\s*'detail_macro_chord_variance_blend_v0'[\s\S]*legacyDebugMode:\s*'legacy_interface'/, 'runtime evidence binds the exact interface-fidelity route and its sparse-preserving A/B contract');
assert.match(webgpuCoreSource, /opticalQueryEvidence:\s*\{[\s\S]*minimumDeferredConfidence:\s*0\.55/, 'runtime evidence publishes the deferred crossing confidence floor used by the shader');
assert.match(webgpuCoreSource, /environmentMapEvidence:\s*\{[\s\S]*requestedRoute:\s*KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ROUTE[\s\S]*effectiveRoute:\s*KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ROUTE[\s\S]*assetSha256:\s*hdrEnvironment\.assetSha256[\s\S]*runtimeAssetUrl:\s*KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ASSET_URL[\s\S]*sourceAssetUrl:\s*KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_SOURCE_ASSET_URL[\s\S]*fallbackReason:\s*null/, 'runtime evidence binds exact requested/effective HDR route, runtime path, official source, and observed asset bytes without fallback');
assert.match(webgpuCoreSource, /assetSha256:\s*hdrEnvironment\.assetSha256/, 'runtime evidence publishes the observed fetched-byte hash rather than repainting the expected constant');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_STABILITY_CONTRACT\s*=\s*'bounded-pbf-energy-v0'/, 'bounded-energy stability contract is explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_TRUTH_GAUNTLET_CONTRACT\s*=\s*'kaminos-fluid-truth-gauntlet-v0'/, 'fluid-truth gauntlet has an explicit contract');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_TRUTH_SCENES/, 'canonical truth-scene registry is explicit');
assert.match(webgpuCoreSource, /measureFingerFluidTruthSnapshot/, 'authoritative diagnostics expose one reusable fluid-truth snapshot');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_DEFAULT_MAX_SPEED\s*=\s*Math\.fround\(3\.2\)/, 'default fluid speed ceiling is explicit, f32-exact, and source-owned');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_SPEED_REFERENCE_SCALE\s*=\s*3\.2/, 'fixed diagnostic and interface speed scale is named independently from the solver ceiling');
assert.match(webgpuCoreSource, /restDensity:\s*24\.3/, 'calibrated packed-state rest density is exposed');
assert.match(webgpuCoreSource, /GRID_DIMS\s*=\s*\[32, 20, 32\]/, 'linked-cell domain has 3D neighborhood resolution');
assert.match(webgpuCoreSource, /BOUNDS_MIN\s*=\s*\[-3\.4, -1\.2, -3\.4\]/, 'fluid domain leaves room around the finite liquid body');
assert.match(webgpuCoreSource, /let radial = 0\.15 \* \(p\.x \* p\.x \+ p\.z \* p\.z\)/, 'smoke basin confines the calibrated volume into a deep finite body');
assert.match(webgpuCoreSource, /fn floorNormal\(p: vec3<f32>\) -> vec3<f32>/, 'height-field collision exposes an analytic terrain normal');
assert.match(webgpuCoreSource, /p = p \+ normal \* \(penetration \/ max\(normal\.y, 0\.15\)\)/, 'terrain penetration resolves along the support normal');
assert.match(webgpuCoreSource, /velocity = velocity - normal \* normalSpeed/, 'terrain contact removes inward normal velocity without vertical teleport energy');
assert.match(webgpuCoreSource, /supportTangentialRetention\s*=\s*exp\(-params\.particleShift\.y \* supportContact \* params\.dt\)/, 'support friction damps only contact-weighted tangential velocity with a time-step-invariant exponential law');
assert.match(webgpuCoreSource, /ENERGY_DIAGNOSTICS_SHADER/, 'kinetic-energy attribution owns a separate diagnostic shader instead of consuming another main solver storage binding');
assert.match(webgpuCoreSource, /fn measure_projection_energy[\s\S]*fn measure_viscosity_energy[\s\S]*fn measure_vorticity_energy[\s\S]*fn measure_cohesion_energy/, 'energy diagnostics measure all four solver stages explicitly');
assert.match(webgpuCoreSource, /const OBSTACLE_CENTER = \[0\.85, -0\.43, 0\.02\]/, 'obstacle center has one JavaScript source of truth');
assert.match(webgpuCoreSource, /const OBSTACLE_RADIUS = 0\.52/, 'obstacle radius has one JavaScript source of truth');
assert.match(webgpuCoreSource, /const VORTICITY_UPDATE_INTERVAL = 3/, 'vorticity cadence is explicit rather than silently omitted under load');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_FREE_SURFACE_CONTRACT\s*=\s*'wgsl-neighbor-free-surface-cohesion-v0'/, 'free-surface classification and cohesion contract is explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_REST_STATE_CONTRACT\s*=\s*'wgsl-support-aware-persistent-rest-state-v0'/, 'persistent support-aware rest-state contract is explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_SUPPORT_TRANSPORT_CONTRACT\s*=\s*'wgsl-support-tangential-transport-v0'/, 'support-adjacent active transport has an explicit contract');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_TOPOLOGY_CONTRACT\s*=\s*'wgsl-four-neighbor-topology-retention-v0'/, 'persistent neighbor topology diagnostics have an explicit contract');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_PARTICLE_SHIFT_CONTRACT\s*=\s*'wgsl-opt-in-support-tangential-particle-shift-v0'/, 'opt-in support-tangential particle shifting has an explicit contract');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_CHEMISTRY_CONTRACT\s*=\s*'wgsl-passive-material-tracer-diffusion-v0'/, 'passive transported material has an explicit non-reactive contract');
assert.match(webgpuCoreSource, /struct MaterialTracerState\s*\{[\s\S]*concentrationDeltaRecipeSource:[\s\S]*\}/, 'transported concentration stays separate from immutable particle source identity');
assert.match(webgpuCoreSource, /@group\(0\) @binding\(8\) var<storage, read_write> materialTracers:\s*array<MaterialTracerState>/, 'passive material state remains GPU resident beside solver state');
assert.match(webgpuCoreSource, /fn compute_material_tracer_diffusion\(/, 'neighbor diffusion computes a separate pending delta');
assert.match(webgpuCoreSource, /neighborDelta = chemistryWeight \* \(neighborConcentration - concentration\)/, 'diffusion uses pair-symmetric concentration differences');
assert.match(webgpuCoreSource, /materialTracers\[index\]\.concentrationDeltaRecipeSource\.y = params\.chemistry\.x \* params\.dt \* concentrationDelta/, 'diffusion compute writes only the pending delta before the dispatch barrier');
assert.match(webgpuCoreSource, /fn apply_material_tracer_diffusion\([\s\S]*state\.concentrationDeltaRecipeSource\.x = state\.concentrationDeltaRecipeSource\.x \+ state\.concentrationDeltaRecipeSource\.y[\s\S]*state\.concentrationDeltaRecipeSource\.y = 0\.0/, 'diffusion applies and clears the pending delta in a distinct pass');
assert.match(webgpuCoreSource, /let sourceResetDelta = state\.concentrationDeltaRecipeSource\.z - state\.concentrationDeltaRecipeSource\.x[\s\S]*state\.concentrationDeltaRecipeSource\.w = state\.concentrationDeltaRecipeSource\.w \+ sourceResetDelta/, 'source recirculation records its concentration mass adjustment instead of masquerading as diffusion drift');
assert.match(webgpuCoreSource, /struct NeighborTopologyState\s*\{[\s\S]*neighborIds:\s*vec4<u32>[\s\S]*metrics:\s*vec4<f32>/, 'GPU topology state preserves actual neighbor ids and retention metrics');
assert.match(webgpuCoreSource, /@group\(0\) @binding\(7\) var<storage, read_write> neighborTopology:\s*array<NeighborTopologyState>/, 'topology state remains GPU resident beside solver state');
assert.match(webgpuCoreSource, /fn measure_neighbor_topology\(/, 'solver measures nearest-neighbor topology after the final support rebuild');
assert.match(webgpuCoreSource, /retentionAge = select\(0\.0, prior\.metrics\.y \+ params\.dt, retention >= 0\.75 && validNeighborCount >= 3u\)/, 'topology age accumulates only under material neighbor retention');
assert.match(webgpuCoreSource, /movingLocked = select\(0\.0, 1\.0, retentionAge >= 0\.5 && speed >= 0\.35\)/, 'moving topology lock has an explicit age and speed predicate');
assert.match(webgpuCoreSource, /fn compute_support_particle_shift\(/, 'opt-in shift derives from the current support neighborhood');
assert.match(webgpuCoreSource, /topologyLock = smoothstep\(0\.2, 0\.9, neighborTopology\[index\]\.metrics\.y\) \* smoothstep\(0\.55, 0\.85, neighborTopology\[index\]\.metrics\.x\)/, 'particle shifting targets measured persistent topology instead of every supported particle');
assert.match(webgpuCoreSource, /f32\(params\.frameIndex % 997u\) \* 2\.176/, 'decorrelation direction changes rapidly enough that adjacent neighborhoods do not translate coherently');
assert.match(webgpuCoreSource, /shiftMagnitude = 0\.0045 \* params\.particleShift\.x \* supportContact \* topologyLock/, 'decorrelation amplitude is explicit and self-disables when topology breaks');
assert.match(webgpuCoreSource, /fn apply_support_particle_shift\(/, 'opt-in shift has a distinct application pass');
assert.match(webgpuCoreSource, /pipelineFor\('compute_material_tracer_diffusion'\)/, 'solver compiles passive tracer diffusion');
assert.match(webgpuCoreSource, /pipelineFor\('apply_material_tracer_diffusion'\)/, 'solver compiles the separate tracer application pass');
assert.match(webgpuCoreSource, /if \(safeChemistryDiffusion > 0\) \{[\s\S]*dispatch\(pass, pipelines\.computeChemistry, safeParticleCount\);[\s\S]*dispatch\(pass, pipelines\.applyChemistry, safeParticleCount\);[\s\S]*chemistryDiffusionPassCount \+= 2/, 'zero diffusion dispatches no hidden chemistry work while enabled diffusion crosses two passes');
assert.match(webgpuCoreSource, /particle\.position = vec4<f32>\(shiftedPosition, particle\.position\.w\)[\s\S]*particle\.predicted = vec4<f32>\(shiftedPosition, particle\.predicted\.w\)/, 'particle shifting moves current and predicted positions together without inventing velocity');
assert.match(webgpuCoreSource, /const INTERFACE_ENTER_THRESHOLD = 0\.38/, 'interface entry threshold is explicit');
assert.match(webgpuCoreSource, /const INTERFACE_EXIT_THRESHOLD = 0\.22/, 'interface exit threshold is lower than entry for persistent hysteresis');
assert.match(webgpuCoreSource, /restStates:\s*array<vec4<f32>>/, 'persistent interface and support-rest state stays GPU resident');
assert.match(webgpuCoreSource, /let wasInterface = priorRestState\.x >= \$\{INTERFACE_THRESHOLD\}/, 'free-surface classification consumes prior persistent state');
assert.match(webgpuCoreSource, /let enterInterface = rawSurfaceFactor >= \$\{INTERFACE_ENTER_THRESHOLD\}/, 'new interface particles cross the stronger entry threshold');
assert.match(webgpuCoreSource, /let retainInterface = wasInterface && rawSurfaceFactor >= \$\{INTERFACE_EXIT_THRESHOLD\}/, 'existing interface particles use a lower exit threshold');
assert.match(webgpuCoreSource, /transition = select\(transition, 1\.0, isInterface && !wasInterface\)/, 'rest state records interface entries');
assert.match(webgpuCoreSource, /transition = select\(transition, -1\.0, !isInterface && wasInterface\)/, 'rest state records interface exits');
assert.match(webgpuCoreSource, /supportRestWeight = supportContact \* \(1\.0 - smoothstep\(0\.06, 0\.28, speed\)\)/, 'supported low-motion particles receive an explicit rest weight');
assert.match(webgpuCoreSource, /restViscosityBlend = clamp\([\s\S]*params\.forces\.z \* transportViscosityScale \+ supportRestWeight \* 0\.16 \+ freeFlightWeight \* params\.chemistry\.w[\s\S]*0\.24/, 'neighbor relaxation separates supported transport, supported rest, and unsupported free-flight sheets');
assert.match(webgpuCoreSource, /supportTransportWeight = supportContact \* smoothstep\(0\.22, 0\.72, tangentialSpeed\) \* \(1\.0 - supportRestWeight\)/, 'supported moving particles enter a distinct tangential transport phase');
assert.match(webgpuCoreSource, /transportViscosityScale = 1\.0 - supportTransportWeight \* 0\.68/, 'supported transport reduces neighbor drag without weakening global or resting relaxation');
assert.match(webgpuCoreSource, /cohesionActivity = \(1\.0 - restStates\[index\]\.z \* 0\.72\) \* \(1\.0 - supportTransportWeight \* 0\.62\)/, 'surface cohesion releases moving supported sheets before the persistent rest phase');
assert.match(webgpuCoreSource, /confinementActivity = 1\.0 - restStates\[index\]\.z \* 0\.92/, 'vorticity confinement is suppressed for supported rest without disabling active flow');
assert.match(webgpuCoreSource, /label:\s*'kaminos-finger-fluid-rest-state-readback'/, 'sparse diagnostics read back the complete persistent rest state');
assert.match(webgpuCoreSource, /interfaceTransitionCount/, 'runtime diagnostics expose interface churn rather than inferring it visually');
assert.match(webgpuCoreSource, /supportedRestingParticleCount/, 'runtime diagnostics expose the supported-rest population');
assert.match(webgpuCoreSource, /activeTransportParticleCount/, 'runtime diagnostics independently preserve active transport population');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_PLAYGROUND_CONTRACT\s*=\s*'wgsl-shared-multi-regime-toy-playground-v0'/, 'multi-regime toy playground contract is explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_INTERFACE_CARRIER_SCHEMA\s*=\s*'kaminos\.liquid-interface-carrier\.v0'/, 'compact liquid-interface carrier schema is explicit');
assert.match(webgpuCoreSource, /KAMINOS_LIQUID_FIRE_CONTACT_DESCRIPTOR_SCHEMA\s*=\s*'kaminos\.liquid-fire-contact-descriptor\.v1'/, 'fire composition owns a source-honest sparse liquid-contact descriptor schema');
assert.match(webgpuCoreSource, /KAMINOS_LIQUID_FIRE_CONTACT_DESCRIPTOR_PACKING\s*=\s*'gpu-sparse-liquid-fire-contact-source-vec4x8-v1'/, 'contact descriptor publishes an explicit source-space record packing identity');
assert.match(webgpuCoreSource, /struct LiquidFireContactRecord\s*\{[\s\S]*worldPositionId:[\s\S]*sourcePositionConfidence:[\s\S]*normalThickness:[\s\S]*velocityNormalSpeed:[\s\S]*tangentVelocitySpeed:[\s\S]*wetnessMaterialTracerVolume:[\s\S]*sourceGenerationEpochTick:[\s\S]*supportSourceFlags:/, 'public contact records preserve source-world geometry, motion, material, tracer, volume, and source identity without claiming receiver transformation');
assert.match(webgpuCoreSource, /struct LiquidFireContactHeader\s*\{[\s\S]*magic:[\s\S]*version:[\s\S]*allocationGeneration:[\s\S]*epoch:[\s\S]*writeTick:[\s\S]*valid:[\s\S]*complete:[\s\S]*sourceFrameHash:[\s\S]*sourceCount:[\s\S]*packedCount:[\s\S]*contactCount:[\s\S]*rejectedCount:[\s\S]*capacity:[\s\S]*overflowCount:[\s\S]*malformedCount:[\s\S]*recordWords:[\s\S]*flags:/, 'GPU contact header carries source identity, completion, exact accounting, capacity, overflow, and malformed counts');
assert.match(webgpuCoreSource, /liquidFireContactRecords:\s*array<LiquidFireContactRecord>/, 'sparse contact records remain GPU resident');
assert.match(webgpuCoreSource, /liquidFireContactHeader:\s*LiquidFireContactHeader/, 'contact accounting and validity remain GPU resident');
assert.match(webgpuCoreSource, /pipelineFor\('clear_liquid_fire_contact_descriptor'\)/, 'each write tick invalidates and clears the public contact descriptor on GPU');
assert.match(webgpuCoreSource, /pipelineFor\('compact_liquid_fire_contacts'\)/, 'contact-qualified liquid records are compacted into the public ABI on GPU');
assert.match(webgpuCoreSource, /pipelineFor\('finalize_liquid_fire_contact_descriptor'\)/, 'a distinct producer completion dispatch seals the descriptor after compaction');
assert.match(webgpuCoreSource, /liquidFireContactCapacity:\s*safeParticleCount/, 'fire contact capacity covers the complete liquid population without a hidden cap');
assert.match(webgpuCoreSource, /candidateCapMode:\s*'uncapped_exact_particle_population_capacity'/, 'fire contact descriptor discloses its uncapped capacity mode');
assert.match(webgpuCoreSource, /function getLiquidFireContactDescriptor\(\)/, 'the solver exposes a same-device GPU descriptor without CPU transcription');
assert.match(webgpuCoreSource, /device,[\s\S]*queue:\s*device\.queue,[\s\S]*headerBuffer:\s*liquidFireContactHeaderBuffer,[\s\S]*recordsBuffer:\s*liquidFireContactRecordsBuffer/, 'descriptor consumers receive the exact device, queue, header, and record buffers');
assert.match(webgpuCoreSource, /dispatch\(pass, pipelines\.clearLiquidFireContacts, 1\);[\s\S]*dispatch\(pass, pipelines\.compactLiquidFireContacts, safeParticleCount\);[\s\S]*dispatch\(pass, pipelines\.finalizeLiquidFireContacts, 1\);/, 'producer invalidation, compaction, and completion execute in one ordered compute pass');
assert.match(webgpuCoreSource, /getLiquidFireContactDescriptor,/, 'the public solver API exports the same-device contact descriptor handle');
assert.match(webgpuCoreSource, /adapter\.limits\.maxStorageBuffersPerShaderStage < requiredStorageBindings/, 'unsupported contact-buffer binding capacity fails loud before device creation');
assert.match(webgpuCoreSource, /requiredLimits:\s*\{ maxStorageBuffersPerShaderStage:\s*requiredStorageBindings \}/, 'device creation requests the measured storage-binding capacity used by the public ABI');
assert.match(webgpuCoreSource, /label:\s*'kaminos-liquid-fire-contact-header',[\s\S]*GPUBufferUsage\.COPY_DST/, 'the initialized contact header explicitly declares copy-destination usage');
assert.match(webgpuCoreSource, /label:\s*'kaminos-liquid-fire-contact-header-readback'/, 'explicit diagnostics own a dedicated public-header readback buffer');
assert.match(webgpuCoreSource, /copyBufferToBuffer\(liquidFireContactHeaderBuffer, 0, liquidFireContactHeaderReadbackBuffer, 0, LIQUID_FIRE_CONTACT_HEADER_BYTES\)/, 'explicit diagnostics copy the complete GPU contact header');
assert.match(webgpuCoreSource, /const liquidFireContactHeaderWords = new Uint32Array\(liquidFireContactHeaderReadbackBuffer\.getMappedRange\(\)\)/, 'diagnostics parse the GPU-written header without consulting projected JavaScript state');
assert.match(webgpuCoreSource, /const liquidFireContactDescriptor = validateLiquidFireContactDescriptorHeader\(/, 'diagnostics validate the authoritative GPU header before publishing it');
assert.match(webgpuCoreSource, /sourceCount:\s*liquidFireContactHeaderWords\[8\]/, 'public diagnostics expose the exact GPU source count');
assert.match(webgpuCoreSource, /packedCount:\s*liquidFireContactHeaderWords\[9\]/, 'public diagnostics expose the exact GPU source-space packed count');
assert.match(webgpuCoreSource, /contactCount:\s*liquidFireContactHeaderWords\[10\]/, 'public diagnostics expose the exact GPU contact count');
assert.match(webgpuCoreSource, /rejectedCount:\s*liquidFireContactHeaderWords\[11\]/, 'public diagnostics expose the exact GPU rejection count');
assert.match(webgpuCoreSource, /const PLAYGROUND_WGSL\s*=\s*\/\* wgsl \*\//, 'one WGSL playground source feeds collision and rendering');
assert.match(webgpuCoreSource, /\$\{PLAYGROUND_WGSL\}[\s\S]*?const RENDER_SHADER[\s\S]*?\$\{PLAYGROUND_WGSL\}/, 'compute and render shaders consume the same playground geometry source');
assert.match(webgpuCoreSource, /source_shelf[\s\S]*spillway[\s\S]*shallow_pool[\s\S]*deep_pool[\s\S]*obstacle_channel[\s\S]*catch_basin/, 'playground names every load-bearing flow regime');
assert.match(webgpuCoreSource, /const PLAYGROUND_SKIRT_COLUMNS = 22/, 'source shelf owns an explicit rendered cliff skirt');
assert.match(webgpuCoreSource, /const PLAYGROUND_SKIRT_ROWS = 5/, 'source shelf cliff has enough vertical samples to read as connected support');
assert.match(webgpuCoreSource, /let x = mix\(-2\.55, 1\.75, \(f32\(skirtX\)/, 'the cliff skirt is localized to the source shelf rather than spanning the whole world');
assert.match(webgpuCoreSource, /radius = 0\.14;/, 'the cliff skirt remains subordinate to the fluid subject');
assert.match(webgpuCoreSource, /materialOccupancyThreshold:\s*materialThreshold/, 'zone diagnostics disclose the threshold used to reject token occupancy');
assert.match(webgpuCoreSource, /materiallyOccupiedZoneCount:\s*rows\.filter\(zone => zone\.particleCount >= materialThreshold\)\.length/, 'zone diagnostics distinguish durable regimes from single-particle residue');
assert.match(webgpuCoreSource, /const zoneSchedule = \[0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5\]/, 'the long-lived source reservoir receives forty percent of the finite fluid volume');
assert.match(webgpuCoreSource, /fn sourceParticleResetPosition\(index: u32\) -> vec3<f32>/, 'the synthetic playground owns a deterministic finite-particle recirculation route');
assert.match(webgpuCoreSource, /atomicAdd\(&interfaceCounters\[2\], 1u\)/, 'actual source recirculations are counted on GPU');
assert.match(webgpuCoreSource, /sourceRecirculationCount:\s*interfaceCounters\[2\]/, 'runtime diagnostics expose the actual cumulative source recirculation count');
assert.match(webgpuCoreSource, /if \(contact > 0\.5 && dot\(interfaceNormal, contactSupportNormal\) < 0\.0\)/, 'contact interface records orient their normals away from the actual support geometry');
assert.match(webgpuCoreSource, /stabilityAgeSource = vec4<f32>\([^;]*supportAlignment\)/, 'interface records preserve local support alignment as falsifiable carrier evidence');
assert.match(webgpuCoreSource, /struct InterfaceRecord\s*\{[\s\S]*positionId:[\s\S]*velocityConfidence:[\s\S]*normalCurvature:[\s\S]*thicknessContactWetnessMaterial:[\s\S]*stabilityAgeSource:/, 'interface carrier record preserves geometry, motion, material, contact, stability, and source fields');
assert.match(webgpuCoreSource, /interfaceRecords:\s*array<InterfaceRecord>/, 'interface records are GPU-resident storage');
assert.match(webgpuCoreSource, /interfaceCounters:\s*array<atomic<u32>>/, 'interface compaction owns exact GPU counters');
assert.match(webgpuCoreSource, /pipelineFor\('clear_interface_counters'\)/, 'interface counters are cleared on GPU before compaction');
assert.match(webgpuCoreSource, /pipelineFor\('compact_interface_records'\)/, 'qualifying interface particles are compacted on GPU');
assert.match(webgpuCoreSource, /interfaceCapacity:\s*safeParticleCount/, 'interface capacity covers the complete particle population without a hidden cap');
assert.match(webgpuCoreSource, /candidateCapMode:\s*'uncapped_exact_particle_population_capacity'/, 'interface diagnostics disclose the uncapped capacity contract');
assert.match(webgpuCoreSource, /label:\s*'kaminos-finger-fluid-interface-records-readback',[\s\S]*size:\s*safeParticleCount \* INTERFACE_RECORD_BYTES/, 'diagnostics readback can validate the complete compacted carrier population');
assert.match(webgpuCoreSource, /const sampleIndex = Math\.floor\(index \* \(activeInterfaceCount - 1\) \/ Math\.max\(1, sampleRecordCount - 1\)\)/, 'carrier evidence samples the active population stratified across its complete range');
assert.match(webgpuCoreSource, /validatedRecordCount:\s*activeInterfaceCount/, 'carrier diagnostics disclose complete active-population validation');
assert.match(webgpuCoreSource, /malformedRecordCount/, 'carrier diagnostics count malformed records rather than hiding them behind selected samples');
assert.match(webgpuCoreSource, /contactRecordCount/, 'carrier diagnostics count all contact records');
assert.match(webgpuCoreSource, /minimumContactSupportAlignment/, 'carrier diagnostics preserve the worst support alignment across every contact record');
assert.match(webgpuCoreSource, /Promise\.allSettled\(/, 'diagnostic mapping waits for every readback result before cleanup');
assert.match(webgpuCoreSource, /buffer\.mapState === 'mapped'/, 'diagnostic cleanup unmaps every successfully mapped buffer after partial failures');
assert.match(webgpuCoreSource, /let diagnosticsRequestCount = 0/, 'full GPU diagnostics expose an exact request count');
assert.match(webgpuCoreSource, /let diagnosticsCompletionCount = 0/, 'full GPU diagnostics expose an exact completion count');
assert.match(webgpuCoreSource, /diagnosticsRequestCount \+= 1/, 'accepted full-diagnostic requests are counted at their execution boundary');
assert.match(webgpuCoreSource, /diagnosticsCompletionCount \+= 1/, 'completed full-diagnostic snapshots are counted separately from requests');
assert.match(webgpuCoreSource, /analyticSupportPresentationPass\.draw\(analyticSupportVertexCount\)/, 'direct renderer draws the scene-scoped shared analytic support in the operator viewport');
assert.match(webgpuCoreSource, /playgroundZoneDiagnostics/, 'sparse diagnostics measure population and energy by playground regime');
assert.match(webgpuCoreSource, /supportedTransportParticleCount/, 'sparse diagnostics expose the support-adjacent transport population');
assert.match(webgpuCoreSource, /averageSupportedTangentialSpeed/, 'sparse diagnostics quantify support-adjacent lateral speed');
assert.match(webgpuCoreSource, /averageNeighborRetention/, 'sparse diagnostics quantify actual nearest-neighbor retention');
assert.match(webgpuCoreSource, /averageNeighborRetentionAge/, 'sparse diagnostics expose how long topology remains locked');
assert.match(webgpuCoreSource, /movingLockedParticleCount/, 'sparse diagnostics count energetic particles trapped in persistent topology');
assert.match(webgpuCoreSource, /neighborRetentionHistogram/, 'sparse diagnostics expose retention distribution instead of laundering it into one average');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_COLOR_MODES\s*=\s*Object\.freeze\(\['phase', 'particle_id', 'speed', 'density', 'surface', 'neighbor_retention', 'chemistry', 'sheet_release'\]\)/, 'renderer diagnostic modes include transported material and sheet release reasons');
assert.match(webgpuCoreSource, /@group\(0\) @binding\(2\) var<storage, read> neighborTopology:\s*array<NeighborTopologyState>/, 'renderer consumes the same GPU topology state measured by the solver');
assert.match(webgpuCoreSource, /@group\(0\) @binding\(3\) var<storage, read> materialTracers:\s*array<MaterialTracerState>/, 'renderer reads the transported tracer directly from GPU state');
assert.match(webgpuCoreSource, /let sphereCenter = vec3<f32>\(\$\{OBSTACLE_CENTER\[0\]\}, \$\{OBSTACLE_CENTER\[1\]\}, \$\{OBSTACLE_CENTER\[2\]\}\)/, 'collision shader consumes the shared obstacle center');
assert.match(webgpuCoreSource, /let sphereRadius = \$\{OBSTACLE_RADIUS\} \+ radius/, 'collision shader consumes the shared obstacle radius');
assert.match(webgpuCoreSource, /const y = sampleFingerFluidPlaygroundHeight\(x, z\) \+ 0\.055 \+ yIndex \* spacing/, 'each packed regime begins above the same sampled playground support');
assert.match(webgpuCoreSource, /GPUBufferUsage\.STORAGE/, 'particle and neighbor state lives in GPU storage buffers');
assert.match(webgpuCoreSource, /atomicExchange\s*\(/, 'particles are binned into GPU linked cells');
assert.match(webgpuCoreSource, /cellHeads/, 'linked-cell head storage is present');
assert.match(webgpuCoreSource, /particleNext/, 'linked-cell particle links are present');
assert.match(webgpuCoreSource, /pipelineFor\('predict_positions'\)/, 'solver predicts 3D positions on GPU');
assert.match(webgpuCoreSource, /pipelineFor\('compute_density_lambda'\)/, 'solver computes PBF density lambdas');
assert.match(webgpuCoreSource, /pipelineFor\('solve_position_delta'\)/, 'solver computes density position corrections');
assert.match(webgpuCoreSource, /pipelineFor\('apply_position_delta'\)/, 'solver applies density position corrections');
assert.match(webgpuCoreSource, /pipelineFor\('compute_vorticity'\)/, 'solver computes neighbor-derived curl after projection');
assert.match(webgpuCoreSource, /pipelineFor\('apply_vorticity_confinement'\)/, 'solver applies a separate vorticity confinement pass');
assert.match(webgpuCoreSource, /pipelineFor\('classify_free_surface'\)/, 'solver classifies the neighbor-derived free surface');
assert.match(webgpuCoreSource, /pipelineFor\('apply_surface_cohesion'\)/, 'solver applies bounded cohesion to classified interface particles');
assert.match(webgpuCoreSource, /dispatch\(pass, pipelines\.vorticity, safeParticleCount\);[\s\S]*?dispatch\(pass, pipelines\.confinement, safeParticleCount\);/, 'vorticity passes execute across separate GPU dispatch barriers');
assert.match(webgpuCoreSource, /dispatch\(pass, pipelines\.clear, GRID_CELL_COUNT\);\s*dispatch\(pass, pipelines\.build, safeParticleCount\);\s*linkedCellGridBuildCount \+= 1;\s*postProjectionGridRefreshCount \+= 1;\s*dispatch\(pass, pipelines\.measureTopology, safeParticleCount\);\s*topologyMeasurementPassCount \+= 1;[\s\S]*?dispatch\(pass, pipelines\.classifySurface, safeParticleCount\);[\s\S]*?dispatch\(pass, pipelines\.cohesion, safeParticleCount\);[\s\S]*?dispatch\(pass, pipelines\.applyVelocity, safeParticleCount\);/, 'topology, passive transport, and free-surface forces consume a linked grid rebuilt after the final density correction');
assert.doesNotMatch(webgpuCoreSource, /let swirl = vec3<f32>/, 'neighbor-derived vorticity replaces synthetic global swirl forcing');
assert.match(webgpuCoreSource, /dispatchWorkgroups/, 'solver dispatches GPU compute work');
assert.match(webgpuCoreSource, /createRenderPipeline/, 'solver state is rendered directly on GPU');
assert.match(webgpuCoreSource, /createWebGPUFingerFluidSolver/, 'GPU solver factory is exported');
assert.match(webgpuCoreSource, /stepCount:\s*diagnosticsStepCount/, 'sparse GPU diagnostics carry the exact simulation step they represent');
assert.match(webgpuCoreSource, /const diagnosticsCapturedAtMs = performance\.now\(\);[\s\S]*?createCommandEncoder/, 'diagnostic age begins when the GPU copy is submitted');
assert.match(webgpuCoreSource, /capturedAtMs:\s*Number\(diagnosticsCapturedAtMs\.toFixed\(1\)\)/, 'sparse GPU diagnostics preserve submission-time provenance');
assert.match(webgpuCoreSource, /averageVorticity/, 'GPU diagnostics quantify settled curl rather than only counting passes');
assert.match(webgpuCoreSource, /vorticityPassCount/, 'runtime evidence reports executed vorticity passes');
assert.match(webgpuCoreSource, /vorticityUpdateInterval/, 'runtime evidence reports the effective vorticity cadence');
assert.match(webgpuCoreSource, /surfaceParticleCount/, 'GPU diagnostics quantify classified interface population');
assert.match(webgpuCoreSource, /averageSurfaceFactor/, 'GPU diagnostics quantify interface confidence rather than only counting passes');
assert.match(webgpuCoreSource, /freeSurfaceClassificationPassCount/, 'runtime evidence reports executed free-surface classification passes');
assert.match(webgpuCoreSource, /surfaceCohesionPassCount/, 'runtime evidence reports executed cohesion passes');
assert.match(webgpuCoreSource, /postProjectionGridRefreshCount/, 'runtime evidence reports exact post-projection support refreshes');
assert.match(webgpuCoreSource, /isObstacle/, 'the direct renderer distinguishes shared obstacle support geometry');
assert.match(webgpuCoreSource, /geometrySource:\s*'toyFloorHeight_toyFloorNormal_plus_analytic_obstacle_v0'/, 'the exact solver playground and obstacle are named as analytic support presentation geometry');
assert.doesNotMatch(webgpuCoreSource, /shared_analytic_heightfield_billboard_tiles_and_cliff_skirt_v0/, 'human-visible support metadata cannot advertise the retired billboard topology');
assert.match(webgpuCoreSource, /supportGeometryMode:\s*'shared_analytic_heightfield_mesh_plus_analytic_obstacle_v0'[\s\S]*supportPresentationRoute:\s*KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_PRESENTATION_ROUTE[\s\S]*supportGeometryCount:\s*analyticSupportVertexCount[\s\S]*supportGeometryCountUnit:\s*'vertices'/, 'playground receipt names the effective scene-scoped analytic presentation topology, route, and count unit');
assert.match(webgpuCoreSource, /obstacle:\s*\{[^}]*rendered:\s*directRenderFrameCount\s*>\s*0[^}]*\}/, 'obstacle render evidence derives from an actual submitted render frame');

assert.match(indexSource, /data-tab="finger-fluid-bench"/, 'Kaminos sidebar exposes a Finger Fluid bench tab');
assert.match(indexSource, /id="tab-finger-fluid-bench"/, 'Kaminos app shell contains Finger Fluid bench content');
assert.match(indexSource, /kaminos_finger_fluid_bench=1/, 'Kaminos route can open directly into the fluid bench');
assert.match(indexSource, /id="finger-fluid-bench-canvas"/, 'fluid bench owns a native canvas');
assert.match(indexSource, /window\.kaminosFingerFluidBenchDebugState/, 'fluid bench exposes browser witness state');
assert.match(indexSource, /async function requestFingerFluidBenchDiagnostics\(\)/, 'full diagnostics remain available through an explicit operator/witness request');
assert.match(indexSource, /window\.kaminosFingerFluidBenchRequestDiagnostics = requestFingerFluidBenchDiagnostics/, 'the explicit full-diagnostics hook is addressable from the witness surface');
assert.doesNotMatch(indexSource, /now - fingerFluidBenchDiagnosticsRequestedAt > 1800/, 'ordinary operator frames must not schedule periodic full-population readback');
assert.match(indexSource, /createWebGPUFingerFluidSolver/, 'native bench constructs the real WebGPU fluid solver');
assert.match(indexSource, /finger_fluid_color_mode/, 'native route accepts an explicit diagnostic color mode');
assert.match(indexSource, /finger_fluid_renderer/, 'native route accepts an explicit renderer mode');
assert.match(indexSource, /requestedRendererMode/, 'native debug state preserves requested renderer identity');
assert.match(indexSource, /effectiveRendererMode/, 'native debug state preserves effective renderer identity');
assert.match(indexSource, /requestedRendererModeLabel[\s\S]*effectiveRendererModeLabel[\s\S]*finger-fluid-bench-renderer/, 'human-visible renderer readout names exact requested and effective modes');
assert.match(indexSource, /requestedOpticalLightingModeLabel[\s\S]*effectiveOpticalLightingModeLabel[\s\S]*finger-fluid-bench-lighting-requested[\s\S]*finger-fluid-bench-lighting-effective/, 'human-visible optical readout names exact requested and effective lighting modes');
assert.match(indexSource, /rejectedOpticalLightingMode[\s\S]*requestedOpticalLightingMode:\s*rejectedOpticalLightingMode[\s\S]*effectiveOpticalLightingMode:\s*'config_rejected'/, 'config rejection preserves the exact unsupported request and reports no executed lighting mode');
assert.match(indexSource, /finger-fluid-bench-renderer-route[\s\S]*grid-column:\s*1\s*\/\s*-1/, 'requested/effective renderer identities remain fully visible in the two-column bench readout');
assert.match(indexSource, /finger_fluid_renderer=sphere_debug/, 'native route preserves the current sphere renderer as explicit debug mode');
assert.match(indexSource, /schema:\s*'kaminos\.finger-fluid\.same-state-renderer-witness\.v0'[\s\S]*supportPresentationEvidence:\s*runtime\.supportPresentationEvidence/, 'same-state renderer receipts preserve the effective analytic support presentation evidence');
assert.match(indexSource, /schema:\s*'kaminos\.finger-fluid\.same-state-renderer-witness\.v0'[\s\S]*linearHdrSceneEvidence:\s*runtime\.linearHdrSceneEvidence[\s\S]*finalPresentationEvidence:\s*runtime\.finalPresentationEvidence/, 'same-state renderer receipts preserve linear HDR custody and final presentation evidence');
assert.match(indexSource, /kaminosFingerFluidBenchSetReflectionMeshPhaseForWitness/, 'browser exposes a bounded dynamic-mesh transform hook for frozen-state reflection evidence');
assert.match(indexSource, /deferredSceneEvidence:\s*runtime\.deferredSceneEvidence[\s\S]*\.\.\.\(runtime\.worldSpaceReflectionEvidence \? \{[\s\S]*worldSpaceReflectionEvidence:\s*runtime\.worldSpaceReflectionEvidence[\s\S]*\} : \{\}\)/, 'same-state receipts only publish reflection provider evidence when the current renderer executed it');
assert.match(webgpuCoreSource, /\.\.\.\(lastEffectiveRendererMode === 'screen_space_refraction' && lastOpticalDebugMode !== 'interface_fidelity' \? \{[\s\S]*worldSpaceReflectionEvidence:\s*\{[\s\S]*\} : \{\}\)/, 'runtime omits stale reflection provider evidence from non-refraction frames and the early-return interface diagnostic');
assert.match(indexSource, /finger_fluid_renderer=screen_space_refraction/, 'native route exposes refraction as an explicit requested renderer mode');
assert.match(indexSource, /finger_fluid_optical_debug/, 'native route accepts an explicit optical sidecar debug view');
assert.match(indexSource, /finger_fluid_optical_lighting/, 'native route accepts an explicit optical lighting identity');
assert.match(indexSource, /requestedOpticalLightingMode[\s\S]*effectiveOpticalLightingMode/, 'native route and runtime state preserve requested/effective optical lighting identity');
assert.match(indexSource, /requestedOpticalDebugMode/, 'native debug state preserves requested optical debug identity');
assert.match(indexSource, /effectiveOpticalDebugMode/, 'native debug state preserves effective optical debug identity');
assert.match(indexSource, /finger_fluid_particle_shift/, 'native route accepts an explicit particle-shift strength');
assert.match(indexSource, /requestedColorMode/, 'native debug state preserves requested color-mode identity');
assert.match(indexSource, /particleShiftStrength/, 'native debug state preserves effective particle-shift strength');
assert.match(indexSource, /finger_fluid_chemistry_diffusion/, 'native route accepts explicit passive tracer diffusion strength');
assert.match(indexSource, /finger_fluid_truth_scene/, 'native route accepts an explicit canonical fluid-truth scene');
assert.match(indexSource, /requestedTruthScene/, 'native debug state preserves requested fluid-truth scene identity');
assert.match(indexSource, /effectiveTruthScene/, 'native debug state preserves effective fluid-truth scene identity');
assert.match(indexSource, /requestedChemistryDiffusion/, 'native config records requested tracer diffusion');
assert.match(indexSource, /effectiveChemistryDiffusion/, 'native config records effective tracer diffusion');
assert.match(indexSource, /fingerFluidBenchCamera = \{ yaw: -0\.62, pitch: 0\.52, distance: 6\.2/, 'default camera gives the multi-regime playground material viewport occupancy');
assert.doesNotMatch(indexSource, /smoothFluidNoise/, 'native bench no longer renders a synthetic noise field');
const canvasExtentFunction = indexSource.match(/function ensureFingerFluidBenchCanvasSize\(canvas\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(canvasExtentFunction, 'fluid bench canvas extent measurement exists');
assert.doesNotMatch(canvasExtentFunction, /canvas\.(?:width|height)\s*=/, 'page code must not resize a WebGPU-configured drawing buffer');
assert.match(indexSource, /kaminos\/finger-fluid-bench/, 'fluid bench displays route identity');
assert.doesNotMatch(indexSource, /finger-fluid-bench-open-direct/, 'fluid bench must not expose Open Direct/new-tab acceptance escape');
assert.doesNotMatch(indexSource, /id="finger-fluid-bench-frame"/, 'fluid bench must not use iframe as acceptance surface');

assert.match(benchWitnessSource, /kaminos_finger_fluid_bench=1/, 'bench witness opens the native fluid bench route');
assert.match(benchWitnessSource, /kaminosFingerFluidBenchDebugState/, 'bench witness reads native fluid bench debug state');
assert.match(benchWitnessSource, /automaticDiagnosticsRequestCount !== 0/, 'bench witness rejects hidden automatic full diagnostics before its explicit request');
assert.match(benchWitnessSource, /kaminosFingerFluidBenchRequestDiagnostics/, 'bench witness explicitly requests the authoritative full diagnostic snapshot it consumes');
assert.match(benchWitnessSource, /diagnosticsCompletionCount !== diagnosticsRequestCount/, 'bench witness rejects partial or unfinished full-diagnostic evidence');
assert.match(benchWitnessSource, /deltaDiagnosticsRequests !== 0/, 'cadence witness rejects any recurring full-diagnostic request after its explicit snapshot');
assert.match(benchWitnessSource, /kaminos\.finger-fluid-bench\.state\.v0/, 'bench witness requires bench state schema');
assert.match(benchWitnessSource, /primary_output_written/, 'bench witness writes durable failure reports before screenshot success');
assert.match(benchWitnessSource, /activeRatio/, 'bench witness measures visible activity ratio');
assert.match(benchWitnessSource, /canvasActivity\.activeRatio < 0\.09/, 'bench witness rejects a fluid subject that wastes the viewport');
assert.match(benchWitnessSource, /supportPixelRatio/, 'bench witness measures playground support pixels separately from generic fluid activity');
assert.match(benchWitnessSource, /supportPixelRatio < 0\.025/, 'bench witness rejects support geometry that is absent from the operator viewport');
assert.match(benchWitnessSource, /kaminos_native_synthetic_fluid_not_lerms_source_truth/, 'bench witness requires synthetic downgrade evidence');
assert.match(benchWitnessSource, /webgpu_compute/, 'bench witness requires the WebGPU compute backend');
assert.match(benchWitnessSource, /webgpu_direct_render/, 'bench witness requires direct WebGPU rendering');
assert.match(benchWitnessSource, /linkedCellGridBuildCount/, 'bench witness requires linked-cell grid evidence');
assert.match(benchWitnessSource, /densityIterationCount/, 'bench witness requires density iteration evidence');
assert.match(benchWitnessSource, /vorticityPassCount/, 'bench witness requires vorticity execution evidence');
assert.match(benchWitnessSource, /Number\.isSafeInteger\(lastDebugState\.runtime\?\.vorticityPassCount\)/, 'bench witness rejects missing or malformed vorticity pass counts before comparing them');
assert.match(benchWitnessSource, /averageVorticity/, 'bench witness requires quantitative curl evidence');
assert.match(benchWitnessSource, /wgsl-neighbor-free-surface-cohesion-v0/, 'bench witness requires the free-surface/cohesion contract');
assert.match(benchWitnessSource, /wgsl-support-aware-persistent-rest-state-v0/, 'bench witness requires the persistent rest-state execution contract');
assert.match(benchWitnessSource, /interfaceChurnRatio/, 'bench witness rejects memoryless interface churn');
assert.match(benchWitnessSource, /supportedRestingParticleCount/, 'bench witness requires a material supported-rest population');
assert.match(benchWitnessSource, /activeTransportParticleCount/, 'bench witness rejects global damping that erases active transport');
assert.match(benchWitnessSource, /settledPoolAverageEnergy/, 'bench witness measures pool energy independently from active source and spillway energy');
assert.match(benchWitnessSource, /activeTransportAverageEnergy/, 'bench witness measures source and spillway energy independently from settled pools');
assert.match(benchWitnessSource, /activeTransportAverageEnergy <= settledPoolAverageEnergy \* 4/, 'bench witness rejects a fake rest improvement that damps every regime together');
assert.match(benchWitnessSource, /sourceShelf\.averageKineticEnergy < 0\.55 \|\| sourceShelf\.activeTransportRatio < 0\.55/, 'bench witness preserves an absolute source-shelf transport floor');
assert.match(benchWitnessSource, /spillway\.averageKineticEnergy < 0\.35 \|\| spillway\.activeTransportRatio < 0\.4/, 'bench witness preserves an absolute spillway transport floor');
assert.match(benchWitnessSource, /quietSupportedPoolCount < 2/, 'bench witness requires quiet support-local rest in more than one pool');
assert.match(benchWitnessSource, /Number\.isSafeInteger\(lastDebugState\.runtime\?\.freeSurfaceClassificationPassCount\)/, 'bench witness rejects missing free-surface pass evidence');
assert.match(benchWitnessSource, /Number\.isSafeInteger\(lastDebugState\.runtime\?\.surfaceCohesionPassCount\)/, 'bench witness rejects missing cohesion pass evidence');
assert.match(benchWitnessSource, /surfaceParticleRatio/, 'bench witness rejects empty or whole-volume surface classifications');
assert.match(benchWitnessSource, /averageSurfaceFactor/, 'bench witness requires quantitative interface confidence');
assert.match(benchWitnessSource, /shared-solver-render-obstacle-v0/, 'bench witness requires attributable obstacle geometry');
assert.match(benchWitnessSource, /wgsl-shared-multi-regime-toy-playground-v0/, 'bench witness requires the shared playground route');
assert.match(benchWitnessSource, /wgsl-support-tangential-transport-v0/, 'bench witness requires the supported-transport solver route');
assert.match(benchWitnessSource, /kaminos\.liquid-interface-carrier\.v0/, 'bench witness requires the compact liquid-interface carrier');
assert.match(benchWitnessSource, /materiallyOccupiedZoneCount\s*<\s*5/, 'bench witness rejects a playground whose regime count is propped up by token residue');
assert.match(benchWitnessSource, /minimumMaterialOccupancy\s*=\s*Math\.ceil\(lastDebugState\.runtime\.particleCount \* 0\.01\)/, 'bench witness independently derives the one-percent material occupancy threshold');
assert.match(benchWitnessSource, /sourceRecirculationCount\s*<\s*1/, 'bench witness requires evidence that the finite source loop actually ran');
assert.match(benchWitnessSource, /supportedTransportParticleCount\s*<\s*128/, 'bench witness rejects a mud-arrested support transport population');
assert.match(benchWitnessSource, /averageSupportedTangentialSpeed\s*<\s*0\.32/, 'bench witness requires material support-adjacent tangential motion');
assert.match(benchWitnessSource, /receivingTransportZones\.length\s*<\s*2/, 'bench witness requires supported transport in more than one receiving regime');
assert.match(benchWitnessSource, /wgsl-four-neighbor-topology-retention-v0/, 'bench witness requires the live topology diagnostic contract');
assert.match(benchWitnessSource, /averageNeighborRetention/, 'bench witness requires quantitative topology retention evidence');
assert.match(benchWitnessSource, /movingLockedParticleCount/, 'bench witness requires the moving-lock population rather than visual inference alone');
assert.match(benchWitnessSource, /activeParticleCount \+ dormantParticleCount !== lastDebugState\.runtime\.particleCount/, 'bench witness requires exact active and dormant population accounting');
assert.match(benchWitnessSource, /neighborRetentionHistogram\.reduce\(\(sum, count\) => sum \+ count, 0\) !== activeParticleCount/, 'bench witness requires exact active topology histogram population accounting');
assert.match(benchWitnessSource, /requestedColorMode\s*!==\s*effectiveColorMode/, 'bench witness rejects silent color-mode fallback');
assert.match(benchWitnessSource, /requestedParticleShiftStrength\s*!==\s*effectiveParticleShiftStrength/, 'bench witness rejects silent particle-shift fallback');
assert.match(benchWitnessSource, /effectiveParticleShiftStrength === 0 && lastDebugState\.runtime\?\.particleShiftPassCount !== 0/, 'zero-strength witness rejects hidden particle-shift work');
assert.match(benchWitnessSource, /effectiveParticleShiftStrength > 0 && lastDebugState\.runtime\?\.particleShiftPassCount < lastDebugState\.runtime\.stepCount \* 2/, 'enabled witness requires both shift passes per solver step');
assert.match(benchWitnessSource, /wgsl-passive-material-tracer-diffusion-v0/, 'bench witness requires the passive tracer contract');
assert.match(benchWitnessSource, /effectiveChemistryDiffusion === 0 && lastDebugState\.runtime\?\.chemistryDiffusionPassCount !== 0/, 'zero-diffusion witness rejects hidden chemistry work');
assert.match(benchWitnessSource, /effectiveChemistryDiffusion > 0 && lastDebugState\.runtime\?\.chemistryDiffusionPassCount < lastDebugState\.runtime\.stepCount \* 2/, 'enabled witness requires compute and apply tracer passes');
assert.match(benchWitnessSource, /chemistryHistogram\.reduce\(\(sum, count\) => sum \+ count, 0\) !== lastDebugState\.runtime\.particleCount/, 'chemistry witness requires exact population accounting');
assert.match(benchWitnessSource, /Math\.abs\(chemistry\.diffusionMassDrift\) > chemistry\.massTolerance/, 'chemistry witness rejects unexplained tracer mass creation or loss');
assert.match(benchWitnessSource, /chemistry\.minimum < -0\.001 \|\| chemistry\.maximum > 1\.001/, 'chemistry witness rejects unstable concentration overshoot');
assert.match(benchWitnessSource, /record\.contact >= 0\.5 && record\.supportAlignment < -0\.001/, 'bench witness rejects normals facing into their local support geometry');
assert.match(benchWitnessSource, /interfaceCarrier\.capacity\s*!==\s*lastDebugState\.runtime\.particleCount/, 'bench witness rejects hidden interface capacity caps');
assert.match(benchWitnessSource, /interfaceCarrier\.overflowCount\s*!==\s*0/, 'bench witness rejects interface compaction overflow');
assert.match(benchWitnessSource, /interfaceCarrier\.sampleRecords/, 'bench witness checks concrete compact-interface record evidence');
assert.match(benchWitnessSource, /record\.confidence < 0 \|\| record\.confidence > 1\.001/, 'bench witness bounds interface geometry confidence without rejecting explicitly unresolved curvature');
assert.match(benchWitnessSource, /record\.confidence === 0 && Math\.abs\(record\.curvature\) > 0\.0001/, 'bench witness rejects unresolved interface records that still claim resolved curvature');
assert.doesNotMatch(benchWitnessSource, /record\.confidence < 0\.3/, 'bench witness does not misclassify sparse spray with unresolved curvature as malformed geometry');
assert.match(benchWitnessSource, /validatedRecordCount !== interfaceCarrier\.activeCount/, 'bench witness requires complete active-carrier validation');
assert.match(benchWitnessSource, /malformedRecordCount !== 0/, 'bench witness rejects any malformed active interface record');
assert.match(benchWitnessSource, /contactRecordCount < 64/, 'bench witness requires material contact coverage rather than conditional validation');
assert.match(benchWitnessSource, /kaminos\.liquid-fire-contact-descriptor\.v1/, 'bench witness requires the public source-honest liquid/fire contact descriptor');
assert.match(benchWitnessSource, /liquidFireContactDescriptor\.contactCount !== interfaceCarrier\.contactRecordCount/, 'bench witness reconciles public contact output with the complete dense contact census');
assert.match(benchWitnessSource, /liquidFireContactDescriptor\.sourceCount !== liquidFireContactDescriptor\.packedCount \+ liquidFireContactDescriptor\.rejectedCount/, 'bench witness rejects public contact accounting mismatch');
assert.match(benchWitnessSource, /liquidFireContactDescriptor\.malformedCount !== 0/, 'bench witness rejects malformed records from the authoritative sparse header');
assert.match(benchWitnessSource, /liquidFireContactDescriptor\.writeTick > liquidFireContactDescriptor\.diagnosticsStepCount/, 'bench witness rejects impossible future contact write ticks');
assert.match(benchWitnessSource, /liquidFireContactDescriptor\.overflowCount !== 0/, 'bench witness rejects public descriptor overflow');
assert.match(benchWitnessSource, /minimumContactSupportAlignment < -0\.001/, 'bench witness rejects inward support alignment anywhere in the active contact carrier');
assert.match(benchWitnessSource, /activeExtent3d/, 'bench witness requires non-flat 3D extent evidence');
assert.match(benchWitnessSource, /maxSpeed\s*>\s*3\.35/, 'bench witness rejects energetic solver blow-up');
assert.match(benchWitnessSource, /relativeDensityError/, 'bench witness rejects density convergence to the wrong basin');
assert.match(benchWitnessSource, /diagnosticsAgeMs > 3000/, 'bench witness rejects stale sparse diagnostics by elapsed time rather than frame count');
assert.match(benchWitnessSource, /cadenceProbe/, 'bench witness measures settled live cadence');
assert.match(benchWitnessSource, /--cadence-ms/, 'bench witness accepts an explicit, reportable cadence observation window');
assert.match(benchWitnessSource, /args\.get\('--cadence-ms'\) \|\| 4200/, 'default cadence observation spans multiple former 1800ms diagnostic periods');
assert.match(benchWitnessSource, /cadenceMs < 3600/, 'short cadence windows fail loud instead of presenting non-authoritative recurrence evidence');
assert.match(benchWitnessSource, /--device-scale-factor/, 'bench witness can reproduce Retina drawing-buffer behavior');
assert.match(benchWitnessSource, /deviceScaleFactor/, 'bench witness records and applies its effective device scale factor');
assert.match(benchWitnessSource, /cadenceWindowMs:\s*cadenceMs/, 'bench witness records its effective cadence window');
assert.match(benchWitnessSource, /fallback/, 'bench witness explicitly rejects fallback closure');
assert.match(benchWitnessSource, /finger_fluid_renderer/, 'bench witness records requested renderer mode');
assert.match(benchWitnessSource, /screen_space_surface/, 'bench witness can target the reconstructed surface route');
assert.match(benchWitnessSource, /sphere_debug/, 'bench witness preserves same-state sphere debug comparison');
assert.match(benchWitnessSource, /sameStateRendererComparison/, 'bench witness captures same solver state renderer A/B evidence');
assert.match(benchWitnessSource, /rendererFreezeReceipt[\s\S]*kaminosFingerFluidBenchRenderCurrentStateForWitness/, 'same-state comparison freezes and snapshots counters in one browser call instead of racing an animation frame');
assert.match(benchWitnessSource, /minimumActiveRatio = 0\.05/, 'same-state nonblank gate accepts the measured 6.97% sphere truth while still rejecting sparse output');
assert.match(benchWitnessSource, /mode === 'screen_space_refraction' && opticalDebugMode === 'shaded' && activity\.activeRatio < minimumActiveRatio/, 'shaded refraction nonblank validation honors the caller threshold instead of silently shadowing it');
assert.match(benchWitnessSource, /surfaceRegistrationViews/, 'bench witness captures the reconstructed surface against sphere debug from multiple camera angles');
assert.match(benchWitnessSource, /sameStateBodyTransportViewComparisons/, 'renderer-only body transport is compared across a fixed multi-view camera set');
assert.match(benchWitnessSource, /kaminos\.finger-fluid\.same-state-body-transport-multi-view-comparison\.v0/, 'multi-view body transport evidence has an explicit schema');
assert.match(benchWitnessSource, /body_bright_oblique[\s\S]*body_low_side[\s\S]*body_opposite_high[\s\S]*body_support_grazing/, 'body transport witness spans bright, low, opposite, and grazing views');
assert.match(benchWitnessSource, /body-transport-geometric-slab\.png[\s\S]*body-transport-robust-dense-body\.png/, 'each body transport view preserves exact geometric and robust image artifacts');
assert.match(benchWitnessSource, /kaminosFingerFluidBenchSetCameraForWitness[\s\S]*captureFrozenOptical[\s\S]*'geometric_slab'[\s\S]*captureFrozenOptical[\s\S]*'robust_dense_body'/, 'multi-view body comparison uses the bounded camera setter and exact frozen optical routes');
assert.match(benchWitnessSource, /measureDenseBodyTransportComparison\([\s\S]*requirePalePopulation = true[\s\S]*measureDenseBodyTransportComparison\([\s\S]*requirePalePopulation: false/, 'dark multi-view preservation does not require the bright-view pale defect to exist');
assert.match(benchWitnessSource, /id: camera\.id[\s\S]*sameCamera: true/, 'each multi-view body transport record preserves its requested camera identity');
assert.match(benchWitnessSource, /measurement\.meanLuminanceRatio < 0\.75[\s\S]*measurement\.sparseRimRetention < 0\.78[\s\S]*measurement\.thinSheetRetention < 0\.78/, 'multi-view body transport fails loud on catastrophic energy loss or erased sparse support');
assert.match(benchWitnessSource, /bodyTransportViews\.every\([\s\S]*view\.id[\s\S]*view\.sameCamera === true[\s\S]*geometricSlab\.receipt\.effectiveBodyTransportRoute === bodyTransportRoutes\.geometric_slab[\s\S]*robustDenseBody\.receipt\.effectiveBodyTransportRoute === bodyTransportRoutes\.robust_dense_body/, 'report-level body transport evidence rejects missing per-view identity, camera agreement, or paired route evidence');
assert.match(benchWitnessSource, /measureSharedSupportIdentity/, 'bench witness compares captured support pixels across every renderer route');
assert.match(benchWitnessSource, /sharedSupportIdentity\.mismatchRatio > 0\.002/, 'shared support witness fails on route-dependent or partial support presentation');
assert.match(benchWitnessSource, /sphere-debug-liquid-support\.png[\s\S]*renderSameState\('sphere_debug',[\s\S]*'liquid_support'/, 'multi-angle registration captures exact sphere-debug GPU liquid occupancy at the same camera and state');
assert.match(benchWitnessSource, /sphereLiquidSupportField = measureBinaryLiquidSupport\(sphereLiquidSupportPath\)/, 'sphere-debug occupancy uses the exact binary nonblank and contamination gate instead of shaded chroma activity');
assert.match(benchWitnessSource, /exactSphereSupportPath[\s\S]*exactRefractionSupportPath[\s\S]*const exactLiquid = exactSphereLiquid \|\| exactRefractionLiquid/, 'support identity unions exact occupancy from both renderer routes');
assert.match(benchWitnessSource, /liquidMaskDilationPixels:\s*0[\s\S]*liquidMaskDilationBasis:\s*'exact_route_union_no_dilation_v0'/, 'support identity reports that no sample-tuned exclusion halo is applied');
assert.match(benchWitnessSource, /supportPresentationEvidence\?\.route !== 'wgsl-analytic-heightfield-obstacle-presentation-v0'/, 'bench witness rejects a missing or substituted analytic support presentation route');
assert.match(benchWitnessSource, /supportPresentationEvidence\?\.particleSupportDrawCount !== 0/, 'bench witness rejects any hidden particle-support proxy draw');
assert.match(benchWitnessSource, /function requireLinearHdrWorldClosure[\s\S]*webgpu-linear-hdr-scene-radiance-v0[\s\S]*rgba16float/, 'bench witness requires exact linear HDR scene custody and format');
assert.match(benchWitnessSource, /displayTransformCountPerFrame !== 1/, 'bench witness rejects duplicated or missing final display transforms');
assert.match(benchWitnessSource, /diagnosticVisibilityRoute !== 'post-composite-depth24plus-identity-v0'/, 'bench witness rejects inferred or stale diagnostic visibility routing');
assert.match(benchWitnessSource, /exactDiagnosticBypass !== 'liquid_support'/, 'bench witness requires exact binary-support preservation through final presentation');
assert.match(benchWitnessSource, /requiredWorldLightingConsumers[\s\S]*visible_world_background[\s\S]*analytic_support[\s\S]*dynamic_indexed_mesh[\s\S]*liquid_world_reflection[\s\S]*hasExactWorldLightingConsumers/, 'bench witness rejects missing, duplicated, or substituted shared-world lighting consumers');
assert.match(benchWitnessSource, /same-camera-linear-hdr-scene-radiance-v0/, 'bench witness requires refraction to sample the shared float scene authority');
assert.match(benchWitnessSource, /environmentMapEvidence\?\.filterRoute !== 'deterministic-five-tap-roughness-cone-v0'/, 'bench witness rejects stale or substituted environment filtering');
assert.match(benchWitnessSource, /playground\.supportGeometryMode !== 'shared_analytic_heightfield_mesh_plus_analytic_obstacle_v0'/, 'bench witness rejects stale billboard playground metadata');
assert.match(benchWitnessSource, /playground\.supportGeometryCount !== playground\.terrainVertexCount \+ playground\.obstacleVertexCount/, 'bench witness verifies the exact analytic support topology count rather than a loose proxy threshold');
assert.match(benchWitnessSource, /support_grazing[\s\S]*pitch:\s*-0\.15[\s\S]*minimumShadedActiveRatio:\s*0\.02[\s\S]*minimumShadedHighlightRatio:\s*0\.003/, 'grazing registration uses measured thin-silhouette and HDR-highlight evidence floors');
assert.match(benchWitnessSource, /normalizedCentroidDistance/, 'multi-angle registration rejects a reconstructed surface that is displaced from the particle projection');
assert.match(benchWitnessSource, /minimumBoundsOverlap/, 'multi-angle registration rejects a reflected surface even when both renderer outputs are nonblank');
assert.match(benchWitnessSource, /screen-space-refraction-thickness\.png/, 'multi-angle registration captures a high-contrast refraction support mask at the same camera and state');
assert.match(benchWitnessSource, /screen-space-refraction-liquid-support\.png[\s\S]*'liquid_support'/, 'multi-angle registration captures exact GPU liquid residency at the same camera and state');
assert.match(benchWitnessSource, /const exactLiquid = exactSphereLiquid \|\| exactRefractionLiquid;[\s\S]*\|\| exactLiquid/, 'support identity consumes exact binary liquid masks instead of depending on HDR-sensitive color heuristics');
assert.match(benchWitnessSource, /screen-space-refraction-shaded\.png[\s\S]*renderSameState\([\s\S]*'screen_space_refraction',[\s\S]*shadedRefractionPath,[\s\S]*'shaded',[\s\S]*activity: shadedRefraction\.activity/, 'multi-angle registration preserves each shaded refraction artifact with its exact nonblank activity evidence');
assert.match(benchWitnessSource, /renderSameState\([\s\S]*'screen_space_refraction',[\s\S]*shadedRefractionPath,[\s\S]*'shaded',[\s\S]*camera\.minimumShadedActiveRatio \?\? 0\.025,[\s\S]*\)/, 'multi-angle shaded refraction preserves the general nonblank floor while allowing an explicit measured grazing-view floor');
assert.match(benchWitnessSource, /shadedRefraction\.activity\.highlightRatio < \(camera\.minimumShadedHighlightRatio \?\? 0\.001\)/, 'multi-angle HDR registration rejects a dark partial silhouette even when its active-area floor is camera-specific');
assert.match(benchWitnessSource, /acceptance:[\s\S]*minimumActiveRatio: camera\.minimumShadedActiveRatio \?\? 0\.025,[\s\S]*minimumHighlightRatio: camera\.minimumShadedHighlightRatio \?\? 0\.001/, 'multi-angle registration records the exact per-view nonblank and HDR-highlight acceptance floors');
assert.match(benchWitnessSource, /mask === 'optical_thickness'/, 'refraction registration measures the complete optical-thickness silhouette instead of a shading-dependent blue subset');
assert.match(benchWitnessSource, /refractionProjection/, 'multi-angle registration measures refraction independently of reconstructed-surface registration');
assert.match(benchWitnessSource, /refraction registration mismatch/, 'multi-angle registration rejects vertically inverted or displaced optical transport support');
assert.match(benchWitnessSource, /finger-fluid-bench-overlay[\s\S]*visibility = 'hidden'/, 'registration masks exclude the diagnostic HUD instead of accepting its fixed cyan bounds as fluid');
assert.match(benchWitnessSource, /fps-counter[\s\S]*visibility = 'hidden'/, 'binary liquid-support captures exclude the live FPS text instead of misclassifying antialiased glyphs as scene pixels');
assert.match(benchWitnessSource, /screen_space_refraction/, 'bench witness captures the explicit refraction route');
assert.match(benchWitnessSource, /sameStateOpticalComparison/, 'bench witness records same-state sphere/surface/refraction A/B/C evidence');
assert.match(benchWitnessSource, /frozenStateWorldReflectionWitness/, 'bench witness records frozen-liquid moving-mesh reflection evidence');
assert.match(benchWitnessSource, /measureBinarySupportMaskedRgb24Delta/, 'world reflection motion and HDR distinctness are measured inside authoritative binary liquid support');
assert.match(benchWitnessSource, /worldSpaceReflectionEvidence\?\.providerRoute !== 'wgsl-indexed-mesh-world-space-reflection-v0'/, 'bench witness rejects substituted or fallback world-space providers');
assert.match(benchWitnessSource, /deferredSceneEvidence\?\.route !== 'webgpu-deferred-indexed-mesh-scene-v0'/, 'bench witness rejects stale or missing deferred scene routes');
assert.match(benchWitnessSource, /deferredSceneEvidence\?\.requestedRoute !== 'webgpu-deferred-indexed-mesh-scene-v0'[\s\S]*deferredSceneEvidence\?\.effectiveRoute !== 'webgpu-deferred-indexed-mesh-scene-v0'/, 'bench witness independently requires canonical requested and effective deferred scene identities');
assert.match(benchWitnessSource, /worldSpaceReflectionEvidence\?\.requestedProviderRoute !== 'wgsl-indexed-mesh-world-space-reflection-v0'[\s\S]*worldSpaceReflectionEvidence\?\.effectiveProviderRoute !== 'wgsl-indexed-mesh-world-space-reflection-v0'/, 'bench witness independently requires canonical requested and effective reflection provider identities');
assert.match(benchWitnessSource, /opticalQueryEvidence\?\.requestedRoute !== 'wgsl-hybrid-deferred-world-optical-query-v0'[\s\S]*opticalQueryEvidence\?\.effectiveRoute !== 'wgsl-hybrid-deferred-world-optical-query-v0'/, 'bench witness rejects stale, default, fallback, or substituted hybrid query routes');
assert.match(benchWitnessSource, /opticalQueryEvidence\?\.resolverOrder !== 'deferred_depth_then_uncapped_world_mesh_then_hdr_environment-v0'/, 'bench witness rejects a substituted hybrid resolver order');
assert.match(benchWitnessSource, /opticalQueryEvidence\?\.queryFrameId !== renderFrameId/, 'bench witness rejects optical query evidence inherited from a stale frame');
assert.match(benchWitnessSource, /opticalQueryEvidence\?\.deferredInputs\?\.linearDepthObject\?\.format !== 'rgba16float'[\s\S]*worldNormalRoughness\?\.format !== 'rgba16float'[\s\S]*albedoMetallic\?\.format !== 'rgba8unorm'/, 'bench witness rejects missing or partial deferred query inputs');
assert.match(benchWitnessSource, /const opticalDebugModes = \[[^\]]*'refraction_hit_kind', 'refraction_distance', 'refraction_fallback_delta', 'legacy_interface', 'interface_fidelity'[^\]]*\]/, 'bench witness captures the physical refracted-exit query fields and same-state interface-fidelity A/B');
assert.match(benchWitnessSource, /const opticalDebugModes = \[[^\]]*'transmitted_transport', 'reflected_transport', 'scatter_transport', 'pre_tonemap_luminance', 'normal_variance', 'reflection_footprint', 'exit_normal_variance', 'transmission_footprint', 'body_transport_path', 'body_transport_residual', 'macro_interface_normal', 'micro_normal_residual', 'interface_roughness', 'transmission_detail_weight'\]/, 'bench witness captures the complete transport decomposition, footprint fields, dense-body closure, and interface-frequency diagnostics');
assert.match(benchWitnessSource, /refractionHitKindField = measureRefractionHitKinds\([\s\S]*deferredScenePixels < 10000[\s\S]*environmentPixels < 500/, 'bench witness requires material deferred-scene and HDR-fallback populations on the refracted exit ray');
assert.match(benchWitnessSource, /measureRefractionHitKinds\(hitKindPath, validityPath, maskPath\)/, 'refracted hit-kind attribution consumes the independently captured exit-validity field');
assert.match(benchWitnessSource, /invalidQueryHitPixels !== 0[\s\S]*invalidNoQueryPixels < 100/, 'witness rejects any provider hit on an invalid slab and requires a material explicit no-query population');
assert.match(benchWitnessSource, /opticalDebugOutputs\.refraction_hit_kind,\s*opticalDebugOutputs\.exit_validity,\s*opticalDebugOutputs\.liquid_support/, 'refracted query population evidence cross-checks hit kind against exit validity under authoritative liquid support');
assert.match(benchWitnessSource, /measureNoQueryFallbackDelta\(deltaPath, hitKindPath, validityPath, maskPath\)/, 'witness measures query-induced shaded fallback delta over explicit no-query pixels');
assert.match(benchWitnessSource, /noQueryPixels < 100 \|\| leakingPixels !== 0/, 'witness requires a material no-query population with zero query-radiance leakage');
assert.match(benchWitnessSource, /measureInterfaceFidelityField\(opticalDebugOutputs\.interface_fidelity, opticalDebugOutputs\.liquid_support\)/, 'witness measures dense-body regime, local continuity, and normal variance inside authoritative liquid support');
assert.match(benchWitnessSource, /measureInterfaceFidelityComparison\(screenSpaceRefractionOut, opticalDebugOutputs\.legacy_interface, opticalDebugOutputs\.liquid_support, opticalDebugOutputs\.interface_fidelity\)/, 'witness compares adaptive and legacy interface shading at identical simulation state and camera with diagnostic-sourced regime masks');
assert.match(benchWitnessSource, /adaptiveTotalVariation >= legacyTotalVariation \* 0\.98/, 'witness requires interface fidelity to materially reduce masked particle-frequency luminance variation');
assert.match(benchWitnessSource, /denseHighlightTileCoverage < 0\.08[\s\S]*sparseIdentityResponseTileCoverage < 0\.25/, 'witness rejects a tiny concentrated highlight remnant and requires distributed dense-body and sparse-identity optical response');
assert.match(benchWitnessSource, /sparseBoundaryContrast[\s\S]*!isBinaryLiquidPixel[\s\S]*adaptiveSparseLegibilityResponsePixels/, 'sparse optical legibility accepts local silhouette/rim contrast against exact binary support instead of requiring a bright HDR response');
assert.match(benchWitnessSource, /adaptiveDenseHighlightPixels < 500[\s\S]*adaptiveSparseLegibilityResponsePixels < 100[\s\S]*adaptiveLuminanceP99 < legacyLuminanceP99 \* 0\.65/, 'witness retains material regime-specific response and upper-tail energy without canonizing legacy blown-out combs');
assert.match(webgpuCoreSource, /opticalTransportExecution:\s*lastEffectiveRendererMode !== 'screen_space_refraction'[\s\S]*not_executed_non_refraction_renderer_v0[\s\S]*lastOpticalDebugMode === 'interface_fidelity'[\s\S]*not_executed_early_interface_diagnostic_v0/, 'runtime receipt marks non-refraction frames and the early-return interface diagnostic as transport-inactive');
assert.match(webgpuCoreSource, /lastEffectiveRendererMode === 'screen_space_refraction'[\s\S]*lastOpticalDebugMode !== 'interface_fidelity'[\s\S]*opticalQueryEvidence:/, 'runtime omits query/provider execution evidence from the early-return interface diagnostic');
assert.match(benchWitnessSource, /opticalDebugMode !== 'interface_fidelity'\)/, 'browser witness rejects query/provider evidence on the interface diagnostic while retaining exact interface route evidence');
assert.match(benchWitnessSource, /const refractionRenderer = receipt\?\.effectiveRendererMode === 'screen_space_refraction'[\s\S]*effectiveOpticalFootprintMode !== \(refractionRenderer[\s\S]*effectiveTransmissionFootprintMode !== \(refractionRenderer/, 'early refraction diagnostics retain requested/effective optical mode identity while execution-only provider evidence remains absent');
assert.match(benchWitnessSource, /worldSpaceReflectionEvidence\?\.quadratureRoute !== \(effectiveFootprintMode === 'variance_filtered'[\s\S]*'deterministic-nine-ray-trimmed-variance-footprint-quadrature-v0'[\s\S]*'deterministic-five-ray-cone-quadrature-v0'\)/, 'bench witness rejects missing or substituted finite-footprint reflection quadrature');
assert.match(benchWitnessSource, /worldSpaceReflectionEvidence\?\.quadratureEstimator !== \(effectiveFootprintMode === 'variance_filtered'[\s\S]*'trimmed_min_max_7_of_9_equal_weight_v0'[\s\S]*'weighted_five_ray_mean_v0'\)/, 'bench witness rejects substituted or unreported quadrature estimators');
assert.match(benchWitnessSource, /worldSpaceReflectionEvidence\?\.hitKindDiagnosticScope !== 'center_ray_only_v0'/, 'bench witness refuses quadrature-wide attribution from the center-ray hit-kind diagnostic');
assert.match(benchWitnessSource, /environmentMapEvidence\?\.effectiveRoute !== 'radiance-rgbe-equirectangular-environment-v0'/, 'bench witness rejects missing, substituted, or fallback HDR environment routes');
assert.match(benchWitnessSource, /environmentMapEvidence\?\.assetSha256 !== 'e7cfda5f4e98e623db12b8bfd0184e048488e4855d9c83e2751fb44a32e80c45'/, 'bench witness binds HDR evidence to the exact vendored asset bytes');
assert.match(benchWitnessSource, /measureBinaryLiquidSupport\(opticalDebugOutputs\.liquid_support\)/, 'witness validates a dedicated binary GPU liquid-support field');
assert.match(benchWitnessSource, /measureHdrEnvironmentField\(opticalDebugOutputs\.environment, opticalDebugOutputs\.liquid_support\)/, 'HDR environment diagnostics are evaluated only on the binary GPU liquid-support mask');
assert.match(benchWitnessSource, /measureEnvironmentContributionField\(\s*opticalDebugOutputs\.environment_contribution,\s*opticalDebugOutputs\.liquid_support,?\s*\)/, 'witness requires attributable production-quadrature HDR contribution over binary liquid support');
assert.match(benchWitnessSource, /environmentContributionDistinctness = measureBinarySupportMaskedRgb24Delta\(\s*opticalDebugOutputs\.environment,\s*opticalDebugOutputs\.environment_contribution,\s*opticalDebugOutputs\.liquid_support/, 'witness directly compares raw environment and production contribution over identical binary liquid support');
assert.match(benchWitnessSource, /requireHdrProductionContributionDistinct\(environmentContributionDistinctness\)/, 'witness rejects a direct-environment frame substituted for production HDR contribution');
assert.match(benchWitnessSource, /directEnvironmentAlias = measureBinarySupportMaskedRgb24Delta\(\s*opticalDebugOutputs\.environment,\s*opticalDebugOutputs\.environment,\s*opticalDebugOutputs\.liquid_support[\s\S]*requireHdrProductionContributionDistinct\(directEnvironmentAlias\)[\s\S]*if \(!directEnvironmentAliasError\)/, 'witness deliberately submits the raw environment as fake production contribution and requires the lie to fail');
assert.match(benchWitnessSource, /delta\.changedRatio < 0\.1 \|\| delta\.meanAbsoluteChannelDelta < 10/, 'HDR contribution anti-alias floor rejects exact and near-identical direct-environment substitution');
assert.match(benchWitnessSource, /measureReflectionHitKinds\([\s\S]*opticalDebugOutputs\.reflection_hit_kind,[\s\S]*opticalDebugOutputs\.liquid_support/, 'reflection attribution uses binary GPU liquid support rather than screenshot chroma inference');
assert.match(benchWitnessSource, /liquidSupportIndependence[\s\S]*changedPixels !== 0/, 'frozen-mesh witness rejects any binary liquid-support change caused by reflection-provider motion');
assert.match(benchWitnessSource, /brightRatio < 0\.05[\s\S]*shadowRatio < 0\.1[\s\S]*midtoneRatio < 0\.03[\s\S]*luminanceP95 - environmentMapField\.luminanceP05 < 100/, 'HDR environment evidence requires a material highlight, shadow, midtone, and luminance-range field');
assert.match(benchWitnessSource, /binary_liquid_support_masked_hdr_environment_luminance_field_v0/, 'HDR environment evidence names its authoritative binary-support-masked luminance route');
assert.match(benchWitnessSource, /frontDepthTexture\?\.channels\?\.join\('\|'\) !== 'projected_particle_sphere_front_view_depth_min\|nearest_particle_center_view_depth_min'/, 'bench witness requires exact front-slab channel semantics rather than format-only evidence');
assert.match(benchWitnessSource, /accumulationTexture\?\.channels\?\.join\('\|'\) !== 'optical_thickness\|material_weighted_thickness\|depth_weight\|depth_weighted_view_depth_sum'/, 'bench witness requires exact weighted accumulation channel semantics');
assert.match(
  benchWitnessSource,
  /if \(effectiveRendererMode === 'screen_space_refraction'\) \{[\s\S]*?frontDepthTexture\?\.channels\?\.join\('\|'\) !== 'projected_particle_sphere_front_view_depth_min\|nearest_particle_center_view_depth_min'[\s\S]*?backDepthTexture\?\.channel !== 'projected_particle_sphere_back_view_depth_max'[\s\S]*?accumulationTexture\?\.channels\?\.join\('\|'\) !== 'optical_thickness\|material_weighted_thickness\|depth_weight\|depth_weighted_view_depth_sum'[\s\S]*?refraction route evidence missing or partial/,
  'initial runtime refraction receipt rejects format-correct textures with stale or substituted channel semantics',
);
assert.match(benchWitnessSource, /deferredSceneEvidence\?\.deferredSceneFrameId !== renderFrameId/, 'bench witness rejects deferred evidence inherited from an older render frame');
assert.match(benchWitnessSource, /deferredSceneEvidence\?\.dynamicIndexedMeshLastDrawFrameId !== renderFrameId/, 'bench witness requires a current-frame direct mesh draw outside isolated reflection diagnostics');
assert.match(benchWitnessSource, /worldSpaceReflectionEvidence\?\.reflectionProviderFrameId !== renderFrameId/, 'bench witness rejects a reflection provider inherited from an older render frame');
assert.match(benchWitnessSource, /requestedOpticalDebugMode === effectiveOpticalDebugMode[\s\S]*includes\(effectiveOpticalDebugMode\)/, 'bench witness only accepts direct-draw suppression for an exact current reflection diagnostic route');
assert.match(benchWitnessSource, /suppressed_in_reflection_debug_provider_remains_active_v0/, 'reflection motion proof suppresses direct mesh presentation while preserving the provider');
assert.match(benchWitnessSource, /reflectionHitKindField\.environmentPixels < 1000 \|\| reflectionHitKindField\.indexedMeshPixels < 500/, 'reflection witness requires material pixel evidence for environment and indexed-mesh hits');
assert.match(benchWitnessSource, /refractionEvidence/, 'bench witness requires source-honest optical transport evidence');
assert.match(benchWitnessSource, /refractionEvidence\?\.supportDepthRoute !== 'wgsl-analytic-heightfield-obstacle-depth-v0'/, 'bench witness rejects refraction that silently drops landed support-depth authority');
assert.match(benchWitnessSource, /refractionEvidence\?\.analyticSupportDepthPassCount < 1/, 'bench witness rejects refraction evidence without an executed analytic support-depth pass');
assert.match(benchWitnessSource, /refractionEvidence\?\.interfaceFidelityRoute !== 'wgsl-regime-aware-interface-footprint-v0'/, 'bench witness rejects stale, missing, or substituted interface-fidelity routes');
assert.match(benchWitnessSource, /opticalQueryEvidence\?\.minimumDeferredConfidence !== 0\.55/, 'bench witness rejects optical-query evidence that does not match the shader confidence floor');
assert.match(benchWitnessSource, /opticalDebugViews/, 'bench witness preserves same-state analytical optical-field captures');
assert.match(benchWitnessSource, /captureFrozenOptical\([\s\S]*'resolved_detail'[\s\S]*captureFrozenOptical\([\s\S]*'variance_filtered'/, 'witness compares both footprint modes at an identical frozen simulation state and camera');
assert.match(benchWitnessSource, /sameStateOpticalFootprintComparison[\s\S]*meanLuminanceRatio[\s\S]*isolatedHighlightComponentDelta[\s\S]*totalVariationRatio[\s\S]*sparseRimRetention[\s\S]*thinSheetRetention/, 'witness records energy, stipple, combing, droplet-rim, and thin-sheet counterfactual evidence');
assert.match(benchWitnessSource, /if \(!dense\[pixel\][\s\S]*for \(const neighbor of \[x > 0 \? pixel - 1 : -1, x \+ 1 < width \? pixel \+ 1 : -1, y > 0 \? pixel - width : -1, y \+ 1 < height \? pixel \+ width : -1\]\)[\s\S]*sparseRimPixels \+= 1/, 'sparse-rim retention classifies complete support before testing all four neighboring pixels');
assert.match(benchWitnessSource, /transportComponentAttribution[\s\S]*dominantTransmittedBrightPixels[\s\S]*dominantReflectedBrightPixels[\s\S]*dominantScatterBrightPixels[\s\S]*unattributedBrightPixels/, 'witness attributes final bright liquid pixels to additive transport components under authoritative support');
assert.match(benchWitnessSource, /meanLuminanceRatio < 0\.82 \|\| meanLuminanceRatio > 1\.18/, 'footprint counterfactual rejects material transport-energy loss or gain');
assert.match(benchWitnessSource, /invalidOpticalFootprintState[\s\S]*silent_footprint_fallback[\s\S]*config_rejected[\s\S]*invalidOpticalFootprintOut/, 'unsupported optical footprint requests preserve raw identity and fail to a blank captured frame');
assert.match(benchWitnessSource, /captureFrozenOptical\([\s\S]*'resolved_exit'[\s\S]*captureFrozenOptical\([\s\S]*'dense_exit_filtered'/, 'witness compares both transmission footprint modes at an identical frozen simulation state and camera');
assert.match(benchWitnessSource, /sameStateTransmissionFootprintComparison[\s\S]*meanLuminanceRatio[\s\S]*broadPaleComponentDelta[\s\S]*totalVariationRatio[\s\S]*sparseRimRetention[\s\S]*thinSheetRetention/, 'transmission witness records energy, broad pale structure, variation, droplet-rim, and thin-sheet counterfactual evidence');
assert.match(benchWitnessSource, /sameStateBodyTransportComparison[\s\S]*geometricSlab[\s\S]*robustDenseBody[\s\S]*denseBodyPaleRatio[\s\S]*cyanDepthRetention[\s\S]*sparseRimRetention[\s\S]*thinSheetRetention/, 'body transport witness compares frozen baseline and robust closure without accepting global dimming or support erasure');
assert.match(benchWitnessSource, /invalidBodyTransportState[\s\S]*silent_body_transport_fallback[\s\S]*config_rejected[\s\S]*invalidBodyTransportOut/, 'unsupported body transport requests preserve raw identity and fail to a blank captured frame');
assert.match(benchWitnessSource, /resolvedTransmissionTransportOut[\s\S]*filteredTransmissionTransportOut[\s\S]*transmittedTransportDelta/, 'transmission witness isolates the same-state transmitted lobe instead of inferring estimator influence from the final composite');
assert.match(benchWitnessSource, /invalidTransmissionFootprintState[\s\S]*silent_transmission_fallback[\s\S]*config_rejected[\s\S]*invalidTransmissionFootprintOut/, 'unsupported transmission footprint requests preserve raw identity and fail to a blank captured frame');
assert.match(indexSource, /finger-fluid-bench-footprint-requested[\s\S]*finger-fluid-bench-footprint-effective/, 'human-visible readout distinguishes requested and effective optical footprint identity');
assert.match(benchCoreSource, /requestedOpticalFootprintMode[\s\S]*effectiveOpticalFootprintMode[\s\S]*requestedOpticalFootprintRoute[\s\S]*effectiveOpticalFootprintRoute[\s\S]*opticalFootprintFallbackReason/, 'bench state carries exact optical footprint route evidence');
assert.match(indexSource, /finger_fluid_transmission_footprint/, 'bench URL exposes an explicit transmission footprint request');
assert.match(indexSource, /finger_fluid_body_transport/, 'bench URL exposes an explicit body transport request');
assert.match(indexSource, /finger_fluid_interface_frequency/, 'bench URL exposes an explicit interface-frequency request');
assert.match(benchCoreSource, /requestedInterfaceFrequencyMode[\s\S]*effectiveInterfaceFrequencyMode[\s\S]*requestedInterfaceFrequencyRoute[\s\S]*effectiveInterfaceFrequencyRoute[\s\S]*interfaceFrequencyFallbackReason/, 'bench state carries exact interface-frequency route evidence');
assert.match(benchWitnessSource, /sameStateInterfaceFrequencyViewComparisons[\s\S]*coupled_detail[\s\S]*macro_micro_separated[\s\S]*sameSimulationState[\s\S]*identityComplete/, 'browser witness compares coupled and separated interface frequency across fixed views at one frozen simulation state');
assert.match(benchWitnessSource, /invalidInterfaceFrequencyState[\s\S]*silent_interface_frequency_fallback[\s\S]*config_rejected[\s\S]*invalidInterfaceFrequencyOut/, 'unsupported interface-frequency requests preserve raw identity and fail to a blank captured frame');
assert.match(benchCoreSource, /requestedTransmissionFootprintMode[\s\S]*effectiveTransmissionFootprintMode[\s\S]*requestedTransmissionFootprintRoute[\s\S]*effectiveTransmissionFootprintRoute[\s\S]*transmissionFootprintFallbackReason/, 'bench state carries exact transmission footprint route evidence');
assert.match(benchCoreSource, /requestedBodyTransportMode[\s\S]*effectiveBodyTransportMode[\s\S]*requestedBodyTransportRoute[\s\S]*effectiveBodyTransportRoute[\s\S]*bodyTransportFallbackReason/, 'bench state carries exact body transport route evidence');
assert.match(benchWitnessSource, /measureHdrEnvironmentField\(\s*opticalDebugOutputs\.environment,\s*opticalDebugOutputs\.liquid_support,?\s*\)/, 'bench witness measures a dedicated HDR environment diagnostic artifact on authoritative binary liquid support');
assert.match(benchWitnessSource, /refractionEvidence\?\.slabRoute !== 'wgsl-particle-projected-front-back-slab-v0'/, 'bench witness rejects a missing or substituted optical slab route');
assert.match(benchWitnessSource, /refractionEvidence\?\.slabGeometryPassCount < 1/, 'bench witness rejects slab evidence without an executed geometry pass');
assert.match(benchWitnessSource, /slabValidityField/, 'bench witness preserves pixel evidence for valid and invalid exit geometry');
assert.match(benchWitnessSource, /visualDeltaFromShaded/, 'every optical field carries pixel evidence against shaded refraction');
assert.match(benchWitnessSource, /visualDeltaFromPreviousDebug/, 'optical fields cannot all collapse to one non-shaded diagnostic output');
assert.match(benchWitnessSource, /primaryFrameBinding/, 'primary output records the exact synchronously rendered route receipt and canvas evidence');
assert.match(benchWitnessSource, /primary screenshot renderer disagreement/, 'primary output rejects requested/effective renderer or optical mode drift');
assert.match(benchWitnessSource, /optical renderer disagreement/, 'bench witness rejects stale/default optical route substitution');
assert.match(benchWitnessSource, /blank refraction output/, 'bench witness rejects blank refraction captures');
assert.match(benchWitnessSource, /screenSpaceSurfaceEvidence/, 'bench witness records reconstructed-surface visual evidence');
assert.match(benchWitnessSource, /renderer disagreement/, 'bench witness rejects requested/effective renderer disagreement');
assert.match(benchWitnessSource, /optical lighting disagreement rejected/, 'bench witness rejects requested/effective optical lighting disagreement');
assert.match(benchWitnessSource, /same_state_optical_lighting_comparison[\s\S]*transport_only[\s\S]*bounded_ggx[\s\S]*legacy_shading/, 'bench witness compares all lighting identities against one frozen simulation state');
assert.match(benchWitnessSource, /nonRefractionLightingApplicability[\s\S]*screen_space_surface[\s\S]*sphere_debug[\s\S]*not_executed[\s\S]*not-executed-non-refraction-renderer-v0/, 'focused browser evidence proves non-refraction renderers cannot claim execution of a requested optical lighting route');
assert.match(benchWitnessSource, /renderer_only_no_solver_continuity_claim[\s\S]*opticalLightingOnly/, 'focused optical evidence names its narrow renderer-only scope instead of claiming solver continuity');
assert.match(benchWitnessSource, /invalid_optical_lighting_route[\s\S]*silent_legacy_fallback[\s\S]*activeRatio > 0\.002/, 'focused optical evidence rejects unsupported lighting and stale painted output');
assert.match(benchWitnessSource, /invalidOpticalLightingWitness = \{[\s\S]{0,900}requestedOpticalLightingMode:[\s\S]{0,500}effectiveOpticalLightingRoute:/, 'invalid-lighting report preserves the exact rejected request and non-executed effective route it verified');
assert.match(benchWitnessSource, /blank reconstructed-surface output/, 'bench witness rejects blank screen-space surface captures');
assert.match(benchWitnessSource, /rendererResizeWitness/, 'bench witness records a live accumulation resize/recreate receipt');
assert.match(benchWitnessSource, /route-specific renderer counters/, 'bench witness rejects cross-mode pass-counter drift');
assert.match(benchWitnessSource, /screenSpaceRefractionRenderFrameCount < screenSpaceRefraction\.receipt\.screenSpaceRefractionRenderFrameCount/, 'resize evidence allows lawful concurrent live-route frames but rejects refraction counter rollback');
assert.doesNotMatch(benchWitnessSource, /resizedSurface\.receipt\.screenSpaceRefractionRenderFrameCount !== screenSpaceRefraction\.receipt\.screenSpaceRefractionRenderFrameCount/, 'resize evidence does not assume the live requested route stops presenting during viewport recreation');
assert.match(benchWitnessSource, /concurrentRefractionFrameDelta/, 'resize evidence reports live-route presentation that occurred around explicit same-state surface renders');
assert.match(benchWitnessSource, /invalidRendererWitness/, 'bench witness records invalid renderer route rejection');
assert.match(benchWitnessSource, /stale painted fallback evidence/, 'bench witness rejects invalid-route canvas residue');
assert.match(benchWitnessSource, /pre-output failure/, 'bench witness reports failures before primary output without pretending success');
assert.match(indexSource, /kaminosFingerFluidBenchSetCameraForWitness/, 'bench exposes a bounded camera setter for frozen-state multi-angle registration evidence');
assert.match(indexSource, /worldSpaceReflectionEvidence: runtime\.worldSpaceReflectionEvidence[\s\S]*environmentMapEvidence: runtime\.environmentMapEvidence/, 'same-state browser receipts preserve exact reflection and HDR environment identities together');
assert.match(indexSource, /pitch < -0\.2 \|\| pitch > 1\.25/, 'witness camera preserves the operator orbit bounds');
assert.ok(
  benchWitnessSource.indexOf("phase = 'measure_canvas'") < benchWitnessSource.indexOf("phase = 'cadence_probe'"),
  'visual evidence is preserved before a later cadence failure',
);

assert.match(truthWitnessSource, /kaminos\.finger-fluid-truth-witness\.v0/, 'truth witness writes a distinct durable report schema');
assert.match(truthWitnessSource, /requestedTruthScene\s*!==\s*effectiveTruthScene/, 'truth witness rejects silent scene fallback');
assert.match(truthWitnessSource, /primary_output_written/, 'truth witness reports failures before primary visual output');
assert.match(truthWitnessSource, /diagnosticsRequestCount/, 'truth witness records explicit full-diagnostics request identity');
assert.match(truthWitnessSource, /trajectory/, 'truth witness records multiple dynamics checkpoints');
assert.match(truthWitnessSource, /fluidTruthSnapshot/, 'truth witness consumes the authoritative dynamics snapshot');
assert.match(truthWitnessSource, /retainedParticleRatio/, 'truth witness rejects particle loss in closed-population scenes');
assert.match(truthWitnessSource, /relativeDensityErrorMean/, 'truth witness measures density convergence against the declared basin');
assert.match(truthWitnessSource, /totalKineticEnergy/, 'truth witness measures energy evolution rather than one final speed');
assert.match(truthWitnessSource, /occupiedCellCount/, 'truth witness records support-volume occupancy rather than particle count alone');
assert.match(truthWitnessSource, /requestedUrl/, 'truth witness records the exact requested route');
assert.match(truthWitnessSource, /effectiveUrl/, 'truth witness records the effective browser route');
assert.match(truthWitnessSource, /requestedSupportFriction\s*!==\s*effectiveSupportFriction/, 'truth witness rejects silent support-friction fallback');
assert.match(truthWitnessSource, /energyLedger/, 'truth witness records per-pass kinetic-energy attribution at every requested checkpoint');
assert.match(truthWitnessSource, /energyLedger\.stepCount\s*!==\s*state\.runtime\.diagnostics\?\.stepCount/, 'energy attribution is bound to the captured diagnostics step rather than a later live animation step');
assert.match(truthWitnessSource, /supportDiagnostics[\s\S]*averageSupportedTangentialSpeed[\s\S]*supportedRestingParticleRatio[\s\S]*movingLockedParticleRatio/, 'truth checkpoints preserve support-slip, rest, and topology-lock evidence together');
assert.match(truthWitnessSource, /--checkpoint-steps/, 'truth witness accepts explicit minimum solver-step horizons independently of wall-clock checkpoint offsets');
assert.match(truthWitnessSource, /checkpointStepTargets/, 'truth witness records the effective solver-step horizon for every checkpoint');
assert.match(truthWitnessSource, /checkpointStepTargets\.length\s*!==\s*checkpointOffsetsMs\.length/, 'truth witness rejects partial wall-time/solver-step checkpoint identity');
assert.match(truthWitnessSource, /runtime\?\.stepCount\s*>=\s*targetStep/, 'truth witness waits for the live simulation to reach the requested solver-step horizon');
assert.match(truthWitnessSource, /state\.runtime\.diagnostics\.stepCount\s*<\s*targetStep/, 'truth witness rejects diagnostics captured before the requested solver-step horizon');
assert.match(indexSource, /finger_fluid_support_friction/, 'bench route exposes an explicit support-friction request');
assert.match(indexSource, /params\.get\('finger_fluid_support_friction'\)\s*\?\?\s*KAMINOS_FINGER_FLUID_DEFAULT_SUPPORT_FRICTION/, 'route omission resolves to the measured partial-slip default rather than free slip');

const mod = await import(benchCorePath);
assert.equal(mod.KAMINOS_FINGER_FLUID_BENCH_STATE_SCHEMA, 'kaminos.finger-fluid-bench.state.v0');
assert.equal(mod.KAMINOS_FINGER_FLUID_BENCH_ROUTE, 'kaminos/finger-fluid-bench');
assert.equal(mod.BIG_PAPA_FLUID_SOURCE_SCHEMA, 'big-papa.finger-fluid.synthetic-source.v0');
assert.equal(typeof mod.createFingerFluidBenchState, 'function');

const state = mod.createFingerFluidBenchState({
  viewport: { width: 1280, height: 800 },
  timeSeconds: 2.5,
  fieldColumns: 96,
  fieldRows: 64,
  basinFillRatio: 0.46,
  activeRatio: 0.38,
  frameTimeMsEstimate: 26.5,
});

assert.equal(state.schema, 'kaminos.finger-fluid-bench.state.v0');
assert.equal(state.route, 'kaminos/finger-fluid-bench');
assert.equal(state.source.schema, 'big-papa.finger-fluid.synthetic-source.v0');
assert.equal(state.source.producerDiaulos, 'big-papa-finger-fluid');
assert.equal(state.solver.identity, 'webgpu-pbf-linked-cell-fluid-v0');
assert.deepEqual(state.solver.gridDimensions, [32, 20, 32]);
assert.equal(state.solver.boundaryPressureContract, 'wgsl-analytic-boundary-density-support-v0');
assert.equal(state.solver.vorticityConfinement, 'wgsl-neighbor-vorticity-confinement-v0');
assert.equal(state.solver.restStateContract, 'wgsl-support-aware-persistent-rest-state-v0');
assert.equal(state.solver.supportTransportContract, 'wgsl-support-tangential-transport-v0');
assert.equal(state.solver.topologyContract, 'wgsl-four-neighbor-topology-retention-v0');
assert.equal(state.solver.particleShiftContract, 'wgsl-opt-in-support-tangential-particle-shift-v0');
assert.equal(state.renderer.identity, 'webgpu-screen-space-liquid-surface-v0');
assert.equal(state.renderer.effectiveMode, 'screen_space_surface');
assert.equal(state.renderer.requestedOpticalLightingMode, 'transport_only');
assert.equal(state.renderer.effectiveOpticalLightingMode, 'not_executed');
assert.equal(state.renderer.requestedOpticalLightingRoute, 'wgsl-liquid-transport-only-lighting-v0');
assert.equal(state.renderer.effectiveOpticalLightingRoute, 'not-executed-non-refraction-renderer-v0');
assert.equal(state.renderer.obstacleContract, 'shared-solver-render-obstacle-v0');
assert.equal(state.solver.playgroundContract, 'wgsl-shared-multi-regime-toy-playground-v0');
assert.equal(state.solver.interfaceCarrierSchema, 'kaminos.liquid-interface-carrier.v0');
assert.equal(state.graduation.mode, 'remain_in_kaminos_terrarium_until_source_exports_earn_extraction');
assert.ok(state.downgrades.includes('kaminos_native_synthetic_fluid_not_lerms_source_truth'));
assert.ok(state.downgrades.includes('particle_render_not_final_surface_reconstruction'));
assert.ok(state.compatibility.lermsEventSchemas.includes('lerms.juice-hit-event.v0'));
assert.ok(state.visual.activeRatio >= 0.38);
assert.ok(state.visual.basinFillRatio >= 0.46);
assert.equal(state.acceptance.acceptanceSurface, 'native_kaminos_route');
assert.equal(state.acceptance.iframeAcceptance, false);
assert.equal(state.acceptance.openDirectAcceptance, false);

const rejectedLightingState = mod.createFingerFluidBenchState({
  status: 'error',
  solverBackend: 'config_rejected',
  renderBackend: 'config_rejected',
  requestedOpticalLightingMode: 'silent_legacy_fallback',
  effectiveOpticalLightingMode: 'config_rejected',
  requestedOpticalLightingRoute: 'unsupported-optical-lighting-mode:silent_legacy_fallback',
  effectiveOpticalLightingRoute: 'not-executed-config-rejected-v0',
  opticalLightingFallbackReason: 'config_rejected:Unsupported finger fluid optical lighting mode: silent_legacy_fallback',
});
assert.equal(rejectedLightingState.renderer.requestedOpticalLightingMode, 'silent_legacy_fallback');
assert.equal(rejectedLightingState.renderer.effectiveOpticalLightingMode, 'config_rejected');
assert.equal(rejectedLightingState.renderer.requestedOpticalLightingRoute, 'unsupported-optical-lighting-mode:silent_legacy_fallback');
assert.equal(rejectedLightingState.renderer.effectiveOpticalLightingRoute, 'not-executed-config-rejected-v0');

const webgpuMod = await import(webgpuCorePath);
assert.equal(typeof webgpuMod.decodeRadianceHdrRgbe, 'function');
const syntheticHdrHeader = new TextEncoder().encode('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 8\n');
const syntheticHdrScanline = new Uint8Array([
  2, 2, 0, 8,
  8, 1, 2, 3, 4, 5, 6, 7, 8,
  8, 11, 12, 13, 14, 15, 16, 17, 18,
  8, 21, 22, 23, 24, 25, 26, 27, 28,
  136, 129,
]);
const syntheticHdrBytes = new Uint8Array(syntheticHdrHeader.length + syntheticHdrScanline.length);
syntheticHdrBytes.set(syntheticHdrHeader);
syntheticHdrBytes.set(syntheticHdrScanline, syntheticHdrHeader.length);
const syntheticHdr = webgpuMod.decodeRadianceHdrRgbe(syntheticHdrBytes.buffer);
assert.equal(syntheticHdr.width, 8);
assert.equal(syntheticHdr.height, 1);
assert.equal(syntheticHdr.format, '32-bit_rle_rgbe');
assert.equal(syntheticHdr.orientation, '-Y +X');
assert.deepEqual(
  Array.from(syntheticHdr.rgbe.slice(0, 8)),
  [1, 11, 21, 129, 2, 12, 22, 129],
  'Radiance channel RLE is interleaved into exact RGBE texels without display-space conversion',
);
assert.throws(
  () => webgpuMod.decodeRadianceHdrRgbe(syntheticHdrBytes.slice(0, -1).buffer),
  /Radiance HDR.*truncated|Radiance HDR.*run/i,
  'truncated HDR input fails loud instead of producing a partial environment',
);
assert.deepEqual(webgpuMod.KAMINOS_FINGER_FLUID_TRUTH_SCENES, ['multi_regime_playground', 'deep_pool_rest', 'dam_break', 'laminar_inlets', 'waterfall_resolution_oracle', 'live_hand_inlets']);
assert.equal(webgpuMod.resolveFingerFluidTruthScene('deep_pool_rest'), 'deep_pool_rest');
assert.throws(() => webgpuMod.resolveFingerFluidTruthScene('quietly_default'), /Unsupported finger fluid truth scene/);
assert.equal(typeof webgpuMod.createFingerFluidTruthSceneParticles, 'function');
assert.equal(typeof webgpuMod.measureFingerFluidTruthSnapshot, 'function');
assert.equal(typeof webgpuMod.evaluateFingerFluidTruthTrajectory, 'function');
assert.equal(typeof webgpuMod.evaluateAnalyticBoundaryKernelSupport, 'function');
assert.equal(typeof webgpuMod.evaluateStaticBoundaryLambdaDenominator, 'function');
assert.equal(webgpuMod.resolveFingerFluidSupportFriction('1.6'), 1.6);
assert.equal(webgpuMod.resolveFingerFluidSupportFriction(), 1.6);
assert.equal(webgpuMod.resolveFingerFluidSupportFriction(0), 0);
assert.equal(webgpuMod.resolveFingerFluidSupportFriction(200), 200, 'support friction has no unmeasured artificial upper cap');
assert.throws(() => webgpuMod.resolveFingerFluidSupportFriction(-0.01), /support friction/i);
assert.throws(() => webgpuMod.resolveFingerFluidSupportFriction(Number.POSITIVE_INFINITY), /support friction/i);
assert.throws(() => webgpuMod.resolveFingerFluidSupportFriction('partial'), /support friction/i);
const supportFrictionVelocity = webgpuMod.applySupportFrictionVelocity(
  [1, 0.25, 0],
  [0, 1, 0],
  1,
  1.6,
  1 / 60,
);
assert.equal(supportFrictionVelocity[1], 0.25, 'support friction preserves normal escape velocity exactly');
assert.ok(supportFrictionVelocity[0] > 0 && supportFrictionVelocity[0] < 1, 'support friction reduces tangential slip without freezing it');
assert.deepEqual(
  webgpuMod.applySupportFrictionVelocity([1, 0.25, 0], [0, 1, 0], 0, 1.6, 1 / 60),
  [1, 0.25, 0],
  'airborne particles are unaffected by support friction',
);
const supportFrictionFullStep = webgpuMod.applySupportFrictionVelocity([1, 0.25, 0], [0, 1, 0], 1, 1.6, 1 / 60);
const supportFrictionHalfStepA = webgpuMod.applySupportFrictionVelocity([1, 0.25, 0], [0, 1, 0], 1, 1.6, 1 / 120);
const supportFrictionHalfStepB = webgpuMod.applySupportFrictionVelocity(supportFrictionHalfStepA, [0, 1, 0], 1, 1.6, 1 / 120);
assert.ok(Math.abs(supportFrictionFullStep[0] - supportFrictionHalfStepB[0]) < 1e-12, 'support friction is invariant to solver substep count');
const energyLedger = webgpuMod.summarizeFingerFluidEnergyLedger(new Float32Array([
  1, 0.8, 0.9, 0.7,
  3, 2.4, 2.7, 2.1,
]), 2, 19);
assert.equal(energyLedger.contract, 'wgsl-per-pass-kinetic-energy-ledger-v0');
assert.equal(energyLedger.stepCount, 19);
assert.ok(Math.abs(energyLedger.averageKineticEnergy.projection - 2) < 1e-6);
assert.ok(Math.abs(energyLedger.averageKineticEnergy.viscosity - 1.6) < 1e-6);
assert.ok(Math.abs(energyLedger.averageKineticEnergy.vorticity - 1.8) < 1e-6);
assert.ok(Math.abs(energyLedger.averageKineticEnergy.cohesion - 1.4) < 1e-6);
assert.ok(Math.abs(energyLedger.stageDelta.viscosity + 0.4) < 1e-6);
assert.ok(Math.abs(energyLedger.stageDelta.vorticity - 0.2) < 1e-6);
assert.ok(Math.abs(energyLedger.stageDelta.cohesion + 0.4) < 1e-6);
assert.throws(
  () => webgpuMod.summarizeFingerFluidEnergyLedger(new Float32Array([1, 2, 3]), 1, 1),
  /energy ledger/i,
  'partial GPU energy readback cannot masquerade as complete attribution',
);
assert.equal(
  webgpuMod.evaluateStaticBoundaryLambdaDenominator([1, 2, 2], 0.012),
  9.012,
  'a static solid contributes once through the particle self-gradient rather than once again as a movable neighbor',
);
assert.throws(
  () => webgpuMod.evaluateAnalyticBoundaryKernelSupport([{ distance: 0, normal: [0, 0, 0] }]),
  /invalid boundary normal/,
  'a zero-length normal cannot manufacture boundary density without a usable constraint gradient',
);
const oneWallSupport = webgpuMod.evaluateAnalyticBoundaryKernelSupport([
  { distance: 0, normal: [0, 1, 0] },
], { kernelRadius: 0.185, restDensity: 24.3 });
assert.ok(Math.abs(oneWallSupport.missingFraction - 0.5) < 1e-9, 'a particle centered on one planar support recovers exactly the missing half-kernel');
assert.ok(Math.abs(oneWallSupport.densityContribution - 11.65) < 1e-9, 'one planar support restores half of non-self rest density');
assert.ok(oneWallSupport.constraintGradient[1] < 0, 'boundary density decreases in the outward support-normal direction');
const twoWallSupport = webgpuMod.evaluateAnalyticBoundaryKernelSupport([
  { distance: 0, normal: [0, 1, 0] },
  { distance: 0, normal: [1, 0, 0] },
], { kernelRadius: 0.185, restDensity: 24.3 });
assert.ok(Math.abs(twoWallSupport.missingFraction - 0.75) < 1e-9, 'two orthogonal contacting supports compose as a bounded solid-union fraction');
assert.ok(Math.abs(twoWallSupport.densityContribution - 17.475) < 1e-9, 'two supports cannot double-count more than their union kernel volume');
const outsideSupport = webgpuMod.evaluateAnalyticBoundaryKernelSupport([
  { distance: 0.185, normal: [0, 1, 0] },
], { kernelRadius: 0.185, restDensity: 24.3 });
assert.equal(outsideSupport.missingFraction, 0, 'solid support contributes nothing outside the compact kernel radius');
const multiRegimeInitial = webgpuMod.createFingerFluidTruthSceneParticles(1024, 'multi_regime_playground');
const deepPoolInitial = webgpuMod.createFingerFluidTruthSceneParticles(1024, 'deep_pool_rest');
const damBreakInitial = webgpuMod.createFingerFluidTruthSceneParticles(1024, 'dam_break');
const laminarInletInitial = webgpuMod.createFingerFluidTruthSceneParticles(1024, 'laminar_inlets');
assert.equal(multiRegimeInitial.length, 1024 * 16);
assert.equal(deepPoolInitial.length, 1024 * 16);
assert.equal(damBreakInitial.length, 1024 * 16);
assert.equal(laminarInletInitial.length, 1024 * 16);
assert.ok(Array.from({ length: 1024 }, (_, index) => Math.hypot(...multiRegimeInitial.slice(index * 16 + 8, index * 16 + 11))).some(speed => speed > 0.1), 'multi-regime scene preserves authored transport');
assert.ok(Array.from({ length: 1024 }, (_, index) => Math.hypot(...deepPoolInitial.slice(index * 16 + 8, index * 16 + 11))).every(speed => speed === 0), 'deep-pool scene begins at rest');
assert.ok(Array.from({ length: 1024 }, (_, index) => Math.hypot(...damBreakInitial.slice(index * 16 + 8, index * 16 + 11))).every(speed => speed === 0), 'dam-break scene begins from gravity rather than hidden launch velocity');
assert.ok(Array.from({ length: 1024 }, (_, index) => Math.hypot(...laminarInletInitial.slice(index * 16 + 8, index * 16 + 11))).some(speed => speed > 0.5), 'laminar inlet scene begins with authored aperture-profile transport');
assert.notDeepEqual([...laminarInletInitial.slice(0, 16)], [...damBreakInitial.slice(0, 16)], 'laminar inlet scene cannot fall through to the dam-break initializer');
const damBreakHeights = Array.from({ length: 1024 }, (_, index) => damBreakInitial[index * 16 + 1]);
assert.ok(Math.max(...damBreakHeights) - Math.min(...damBreakHeights) > 0.5, 'dam-break scene starts as a materially tall retained column');
const syntheticTruthParticles = new Float32Array(2 * 16);
syntheticTruthParticles.set([0, -0.5, 0, 1, 0, -0.5, 0, 0, 1, 0, 0, 0.4, 0, 0, 0, 24.3], 0);
syntheticTruthParticles.set([0.2, -0.5, 0, 1, 0.2, -0.5, 0, 0, 0, 0, 0, 0.4, 0, 0, 0, 20], 16);
const syntheticTruthSnapshot = webgpuMod.measureFingerFluidTruthSnapshot(syntheticTruthParticles, 2, {
  scene: 'deep_pool_rest',
  restDensity: 24.3,
  sourceRecirculationCount: 0,
});
assert.equal(syntheticTruthSnapshot.schema, 'kaminos.finger-fluid-truth-snapshot.v0');
assert.equal(syntheticTruthSnapshot.scene, 'deep_pool_rest');
assert.equal(syntheticTruthSnapshot.finiteParticleCount, 2);
assert.equal(syntheticTruthSnapshot.retainedParticleRatio, 1);
assert.equal(syntheticTruthSnapshot.totalKineticEnergy, 0.5);
assert.equal(syntheticTruthSnapshot.occupiedCellCount, 1);
assert.ok(syntheticTruthSnapshot.relativeDensityErrorMean > 0 && syntheticTruthSnapshot.relativeDensityErrorMean < 0.1);
assert.equal(syntheticTruthSnapshot.boundaryPressureContract, 'wgsl-analytic-boundary-density-support-v0');
assert.equal(syntheticTruthSnapshot.boundaryParticleCount + syntheticTruthSnapshot.bulkParticleCount, 2);
assert.ok(Number.isFinite(syntheticTruthSnapshot.boundaryRelativeDensityErrorMean));
assert.ok(Number.isFinite(syntheticTruthSnapshot.bulkRelativeDensityErrorMean));
assert.ok(Number.isFinite(syntheticTruthSnapshot.maximumBoundaryPenetration));
const truthCheckpoint = (elapsedMs, overrides = {}, scene = 'deep_pool_rest') => ({
  elapsedMs,
  fluidTruthSnapshot: {
    schema: 'kaminos.finger-fluid-truth-snapshot.v0',
    contract: 'kaminos-fluid-truth-gauntlet-v0',
    boundaryPressureContract: 'wgsl-analytic-boundary-density-support-v0',
    scene,
    particleCount: 100,
    finiteParticleCount: 100,
    retainedParticleCount: 100,
    retainedParticleRatio: 1,
    sourceRecirculationCount: 0,
    centerOfMass: [0, 0, 0],
    totalKineticEnergy: 100,
    relativeDensityErrorMean: 0.02,
    relativeDensityErrorP95: 0.05,
    boundaryParticleCount: 40,
    bulkParticleCount: 60,
    boundaryRelativeDensityErrorMean: 0.03,
    boundaryRelativeDensityErrorP95: 0.06,
    bulkRelativeDensityErrorMean: 0.015,
    bulkRelativeDensityErrorP95: 0.04,
    maximumBoundaryPenetration: 0,
    occupiedCellCount: 32,
    occupiedVolumeProxy: 5,
    ...overrides,
  },
});
const deepPoolTrajectory = webgpuMod.evaluateFingerFluidTruthTrajectory('deep_pool_rest', [
  truthCheckpoint(500),
  truthCheckpoint(7000, { totalKineticEnergy: 20, occupiedVolumeProxy: 5.1 }),
]);
assert.equal(deepPoolTrajectory.accepted, true);
assert.equal(deepPoolTrajectory.contract, 'kaminos-fluid-truth-trajectory-v0');
assert.equal(deepPoolTrajectory.energyRetentionRatio, 0.2);
assert.throws(() => webgpuMod.evaluateFingerFluidTruthTrajectory('deep_pool_rest', [
  truthCheckpoint(500),
  truthCheckpoint(7000, { totalKineticEnergy: 85 }),
]), /failed to dissipate/);
assert.throws(() => webgpuMod.evaluateFingerFluidTruthTrajectory('deep_pool_rest', [
  truthCheckpoint(500),
  truthCheckpoint(1000, { totalKineticEnergy: 20 }),
]), /requires at least 5000ms/);
assert.throws(() => webgpuMod.evaluateFingerFluidTruthTrajectory('deep_pool_rest', [
  truthCheckpoint(500, { schema: 'malformed.snapshot.v0' }),
  truthCheckpoint(7000, { totalKineticEnergy: 20 }),
]), /snapshot schema/);
assert.throws(() => webgpuMod.evaluateFingerFluidTruthTrajectory('deep_pool_rest', [
  truthCheckpoint(500, { contract: 'wrong-truth-contract-v0' }),
  truthCheckpoint(7000, { totalKineticEnergy: 20 }),
]), /snapshot contract/);
assert.throws(() => webgpuMod.evaluateFingerFluidTruthTrajectory('deep_pool_rest', [
  truthCheckpoint(500, {}, 'dam_break'),
  truthCheckpoint(7000, { totalKineticEnergy: 20 }),
]), /snapshot scene/);
assert.throws(() => webgpuMod.evaluateFingerFluidTruthTrajectory('deep_pool_rest', [
  truthCheckpoint(500, { relativeDensityErrorMean: Number.NaN }),
  truthCheckpoint(7000, { totalKineticEnergy: 20 }),
]), /density evidence/);
assert.throws(() => webgpuMod.evaluateFingerFluidTruthTrajectory('deep_pool_rest', [
  truthCheckpoint(500, { boundaryPressureContract: 'fallback-boundary-pressure-v0' }),
  truthCheckpoint(7000, { totalKineticEnergy: 20 }),
]), /boundary pressure contract/);
assert.throws(() => webgpuMod.evaluateFingerFluidTruthTrajectory('deep_pool_rest', [
  truthCheckpoint(500, { boundaryRelativeDensityErrorP95: Number.NaN }),
  truthCheckpoint(7000, { totalKineticEnergy: 20 }),
]), /non-finite or partial state/);
assert.throws(() => webgpuMod.evaluateFingerFluidTruthTrajectory('deep_pool_rest', [
  truthCheckpoint(500, { boundaryParticleCount: 39 }),
  truthCheckpoint(7000, { totalKineticEnergy: 20 }),
]), /boundary density evidence/);
assert.throws(() => webgpuMod.evaluateFingerFluidTruthTrajectory('deep_pool_rest', [
  truthCheckpoint(500),
  truthCheckpoint(7000, { totalKineticEnergy: -20 }),
]), /kinetic energy evidence/);
assert.throws(() => webgpuMod.evaluateFingerFluidTruthTrajectory('deep_pool_rest', [
  truthCheckpoint(500, { occupiedCellCount: 1, occupiedVolumeProxy: 0.009 }),
  truthCheckpoint(7000, { totalKineticEnergy: 20, occupiedCellCount: 1, occupiedVolumeProxy: 0.009 }),
]), /occupied support/);
assert.throws(() => webgpuMod.evaluateFingerFluidTruthTrajectory('deep_pool_rest', [
  truthCheckpoint(500, { occupiedVolumeProxy: 0.000001 }),
  truthCheckpoint(7000, { totalKineticEnergy: 20, occupiedVolumeProxy: 0.000001 }),
]), /absolute support/);
assert.throws(() => webgpuMod.evaluateFingerFluidTruthTrajectory('deep_pool_rest', [
  truthCheckpoint(500),
  truthCheckpoint(7000, {
    particleCount: 99,
    finiteParticleCount: 99,
    retainedParticleCount: 99,
    totalKineticEnergy: 20,
  }),
]), /particle identity/);
const damBreakTrajectory = webgpuMod.evaluateFingerFluidTruthTrajectory('dam_break', [
  truthCheckpoint(250, { centerOfMass: [0, 0.35, -1.7], totalKineticEnergy: 100, occupiedVolumeProxy: 5 }, 'dam_break'),
  truthCheckpoint(1500, { centerOfMass: [0, -0.4, -0.5], totalKineticEnergy: 70, occupiedVolumeProxy: 5.8 }, 'dam_break'),
  truthCheckpoint(9000, { centerOfMass: [0, -0.9, 0.4], totalKineticEnergy: 4, occupiedVolumeProxy: 5.2 }, 'dam_break'),
]);
assert.equal(damBreakTrajectory.accepted, true);
assert.equal(damBreakTrajectory.downstreamDisplacement, 2.1);
assert.equal(damBreakTrajectory.verticalCollapse, 1.25);
assert.throws(() => webgpuMod.evaluateFingerFluidTruthTrajectory('dam_break', [
  truthCheckpoint(250, { centerOfMass: [0, 0.35, -1.7], totalKineticEnergy: 100, occupiedVolumeProxy: 5 }, 'dam_break'),
  truthCheckpoint(1500, { centerOfMass: [0, -0.4, -0.5], totalKineticEnergy: 70, occupiedVolumeProxy: 5.8 }, 'dam_break'),
  truthCheckpoint(9000, { centerOfMass: [0, -0.9, 0.4], totalKineticEnergy: -4, occupiedVolumeProxy: 5.2 }, 'dam_break'),
]), /kinetic energy evidence/);
assert.throws(() => webgpuMod.evaluateFingerFluidTruthTrajectory('dam_break', [
  truthCheckpoint(250, { centerOfMass: [0, 0.35, -1.7] }, 'dam_break'),
  truthCheckpoint(1500, { centerOfMass: [0, -0.4, -1.6], totalKineticEnergy: 70, occupiedVolumeProxy: 5.8 }, 'dam_break'),
  truthCheckpoint(9000, { centerOfMass: [0, -0.9, -1.5], totalKineticEnergy: 4 }, 'dam_break'),
]), /failed to travel downstream/);
assert.throws(() => webgpuMod.evaluateFingerFluidTruthTrajectory('dam_break', [
  truthCheckpoint(250, { centerOfMass: [0, 0.35, -1.7] }, 'dam_break'),
  truthCheckpoint(9000, { centerOfMass: [0, -0.9, 0.4], totalKineticEnergy: 4, occupiedVolumeProxy: 5.8 }, 'dam_break'),
]), /requires at least three checkpoints/);
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_SUPPORT_TRANSPORT_CONTRACT, 'wgsl-support-tangential-transport-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_TOPOLOGY_CONTRACT, 'wgsl-four-neighbor-topology-retention-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_PARTICLE_SHIFT_CONTRACT, 'wgsl-opt-in-support-tangential-particle-shift-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_CHEMISTRY_CONTRACT, 'wgsl-passive-material-tracer-diffusion-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_ROUTE, 'webgpu-screen-space-liquid-surface-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_REFRACTION_RENDERER_ROUTE, 'webgpu-screen-space-liquid-refraction-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_OPTICAL_TRANSPORT_ROUTE, 'snell-two-interface-screen-space-slab-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_OPTICAL_SLAB_ROUTE, 'wgsl-particle-projected-front-back-slab-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_SPHERE_DEBUG_RENDERER_ROUTE, 'webgpu-particle-sphere-debug-renderer-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_DEPTH_ROUTE, 'wgsl-analytic-heightfield-obstacle-depth-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_PRESENTATION_ROUTE, 'wgsl-analytic-heightfield-obstacle-presentation-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_DEFERRED_SCENE_ROUTE, 'webgpu-deferred-indexed-mesh-scene-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_WORLD_SPACE_REFLECTION_ROUTE, 'wgsl-indexed-mesh-world-space-reflection-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_REFLECTION_QUERY_SCHEMA, 'kaminos.reflection-query-provider.v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_OPTICAL_QUERY_SCHEMA, 'kaminos.optical-query-provider.v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_HYBRID_OPTICAL_QUERY_ROUTE, 'wgsl-hybrid-deferred-world-optical-query-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_DEFERRED_RAY_TRAVERSAL_ROUTE, 'wgsl-deferred-linear-depth-ray-traversal-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_INTERFACE_FIDELITY_ROUTE, 'wgsl-regime-aware-interface-footprint-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_OPTICAL_QUERY_RESOLVER_ORDER, 'deferred_depth_then_uncapped_world_mesh_then_hdr_environment-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_REFLECTION_ACCELERATION_ROUTE, 'uncapped-exact-triangle-scan-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_REFLECTION_QUADRATURE_ROUTE, 'deterministic-five-ray-cone-quadrature-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ROUTE, 'radiance-rgbe-equirectangular-environment-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_LINEAR_HDR_SCENE_ROUTE, 'webgpu-linear-hdr-scene-radiance-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_HDR_WORLD_BACKGROUND_ROUTE, 'wgsl-shared-hdr-world-background-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_ENVIRONMENT_FILTER_ROUTE, 'deterministic-five-tap-roughness-cone-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_FINAL_PRESENTATION_ROUTE, 'wgsl-linear-exposure-aces-presentation-v0');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ASSET_ID, 'polyhaven-studio-small-09-1k');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_SHA256, 'e7cfda5f4e98e623db12b8bfd0184e048488e4855d9c83e2751fb44a32e80c45');
assert.equal(webgpuMod.KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_SOURCE_ASSET_URL, 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr');
assert.equal(webgpuMod.resolveFingerFluidRendererMode('screen_space_surface'), 'screen_space_surface');
assert.equal(webgpuMod.resolveFingerFluidRendererMode('screen_space_refraction'), 'screen_space_refraction');
assert.equal(webgpuMod.resolveFingerFluidRendererMode('sphere_debug'), 'sphere_debug');
assert.throws(() => webgpuMod.resolveFingerFluidRendererMode('fallback'), /Unsupported finger fluid renderer mode/);
assert.equal(typeof webgpuMod.validateFingerFluidTruthRendererState, 'function');
const deferredSceneEvidence = {
  requestedRoute: webgpuMod.KAMINOS_FINGER_FLUID_DEFERRED_SCENE_ROUTE,
  effectiveRoute: webgpuMod.KAMINOS_FINGER_FLUID_DEFERRED_SCENE_ROUTE,
  route: webgpuMod.KAMINOS_FINGER_FLUID_DEFERRED_SCENE_ROUTE,
  fallbackReason: null,
  passCount: 7,
  dynamicIndexedMeshDrawCount: 7,
  renderFrameId: 7,
  deferredSceneFrameId: 7,
  dynamicIndexedMeshLastDrawFrameId: 7,
  dynamicMesh: { objectId: 101, vertexCount: 24, indexCount: 36, triangleCount: 12, transformGeneration: 1, phase: 0.36, presentationMode: 'deferred_scene_visible_v0' },
  attachments: {
    worldNormalRoughness: { format: 'rgba16float' },
    albedoMetallic: { format: 'rgba8unorm' },
    linearDepthObject: { format: 'rgba16float' },
  },
};
const linearHdrSceneEvidence = {
  requestedRoute: webgpuMod.KAMINOS_FINGER_FLUID_LINEAR_HDR_SCENE_ROUTE,
  effectiveRoute: webgpuMod.KAMINOS_FINGER_FLUID_LINEAR_HDR_SCENE_ROUTE,
  format: 'rgba16float',
  colorSpace: 'scene_linear_rec2020_agnostic_rgb_v0',
  backgroundRoute: webgpuMod.KAMINOS_FINGER_FLUID_HDR_WORLD_BACKGROUND_ROUTE,
  environmentFilterRoute: webgpuMod.KAMINOS_FINGER_FLUID_ENVIRONMENT_FILTER_ROUTE,
  backgroundPassCount: 7,
  worldLightingConsumers: ['visible_world_background', 'analytic_support', 'dynamic_indexed_mesh', 'liquid_world_reflection'],
  fallbackReason: null,
};
const finalPresentationEvidence = {
  requestedRoute: webgpuMod.KAMINOS_FINGER_FLUID_FINAL_PRESENTATION_ROUTE,
  effectiveRoute: webgpuMod.KAMINOS_FINGER_FLUID_FINAL_PRESENTATION_ROUTE,
  sourceFormat: 'rgba16float',
  toneMap: 'aces-fitted-v0',
  exposure: 0.58,
  exactDiagnosticBypass: 'liquid_support',
  diagnosticVisibilityRoute: 'post-composite-depth24plus-identity-v0',
  displayTransformCountPerFrame: 1,
  passCount: 7,
  fallbackReason: null,
};
const screenSpaceRendererRuntime = {
  requestedRendererMode: 'screen_space_surface',
  effectiveRendererMode: 'screen_space_surface',
  requestedRenderer: webgpuMod.KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_ROUTE,
  effectiveRenderer: webgpuMod.KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_ROUTE,
  fallbackReason: null,
  opticalDebugMode: 'shaded',
  deferredSceneEvidence,
  supportPresentationEvidence: {
    route: webgpuMod.KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_PRESENTATION_ROUTE,
    depthRoute: webgpuMod.KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_DEPTH_ROUTE,
    colorDepthAuthority: 'same_pass_same_analytic_geometry_v0',
    refractionCaptureOrder: 'copy_after_deferred_scene_v0',
    passCount: 7,
    particleSupportDrawCount: 0,
  },
  linearHdrSceneEvidence,
  finalPresentationEvidence,
  screenSpaceSurfaceEvidence: {
    route: webgpuMod.KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_ROUTE,
    shaderRoute: webgpuMod.KAMINOS_FINGER_FLUID_SCREEN_SPACE_SHADER_ROUTE,
    supportDepthRoute: webgpuMod.KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_DEPTH_ROUTE,
    analyticSupportDepthPassCount: 7,
    accumulationTexture: {
      format: 'rgba16float',
      channels: ['optical_thickness', 'material_weighted_thickness', 'depth_weight', 'depth_weighted_view_depth_sum'],
    },
    accumulationPassCount: 7,
    compositePassCount: 7,
  },
};
assert.deepEqual(
  webgpuMod.validateFingerFluidTruthRendererState('screen_space_surface', screenSpaceRendererRuntime),
  {
    requestedRendererMode: 'screen_space_surface',
    effectiveRendererMode: 'screen_space_surface',
    requestedRenderer: webgpuMod.KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_ROUTE,
    effectiveRenderer: webgpuMod.KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_ROUTE,
    fallbackReason: null,
    deferredSceneEvidence,
    supportPresentationEvidence: screenSpaceRendererRuntime.supportPresentationEvidence,
    linearHdrSceneEvidence,
    finalPresentationEvidence,
    screenSpaceSurfaceEvidence: screenSpaceRendererRuntime.screenSpaceSurfaceEvidence,
  },
);
assert.deepEqual(
  webgpuMod.validateFingerFluidTruthRendererState('sphere_debug', {
    requestedRendererMode: 'sphere_debug',
    effectiveRendererMode: 'sphere_debug',
    requestedRenderer: webgpuMod.KAMINOS_FINGER_FLUID_SPHERE_DEBUG_RENDERER_ROUTE,
    effectiveRenderer: webgpuMod.KAMINOS_FINGER_FLUID_SPHERE_DEBUG_RENDERER_ROUTE,
    fallbackReason: null,
    deferredSceneEvidence,
    supportPresentationEvidence: screenSpaceRendererRuntime.supportPresentationEvidence,
    linearHdrSceneEvidence,
    finalPresentationEvidence,
  }).effectiveRenderer,
  webgpuMod.KAMINOS_FINGER_FLUID_SPHERE_DEBUG_RENDERER_ROUTE,
);
const refractionRendererRuntime = {
  requestedRendererMode: 'screen_space_refraction',
  effectiveRendererMode: 'screen_space_refraction',
  requestedRenderer: webgpuMod.KAMINOS_FINGER_FLUID_REFRACTION_RENDERER_ROUTE,
  effectiveRenderer: webgpuMod.KAMINOS_FINGER_FLUID_REFRACTION_RENDERER_ROUTE,
  fallbackReason: null,
  opticalDebugMode: 'shaded',
  deferredSceneEvidence,
  requestedOpticalDebugMode: 'shaded',
  effectiveOpticalDebugMode: 'shaded',
  requestedOpticalFootprintMode: 'resolved_detail',
  effectiveOpticalFootprintMode: 'resolved_detail',
  requestedOpticalFootprintRoute: webgpuMod.KAMINOS_FINGER_FLUID_RESOLVED_DETAIL_FOOTPRINT_ROUTE,
  effectiveOpticalFootprintRoute: webgpuMod.KAMINOS_FINGER_FLUID_RESOLVED_DETAIL_FOOTPRINT_ROUTE,
  opticalFootprintFallbackReason: null,
  requestedTransmissionFootprintMode: 'resolved_exit',
  effectiveTransmissionFootprintMode: 'resolved_exit',
  requestedTransmissionFootprintRoute: webgpuMod.KAMINOS_FINGER_FLUID_RESOLVED_EXIT_TRANSMISSION_FOOTPRINT_ROUTE,
  effectiveTransmissionFootprintRoute: webgpuMod.KAMINOS_FINGER_FLUID_RESOLVED_EXIT_TRANSMISSION_FOOTPRINT_ROUTE,
  transmissionFootprintFallbackReason: null,
  requestedBodyTransportMode: 'geometric_slab',
  effectiveBodyTransportMode: 'geometric_slab',
  requestedBodyTransportRoute: webgpuMod.KAMINOS_FINGER_FLUID_GEOMETRIC_SLAB_BODY_TRANSPORT_ROUTE,
  effectiveBodyTransportRoute: webgpuMod.KAMINOS_FINGER_FLUID_GEOMETRIC_SLAB_BODY_TRANSPORT_ROUTE,
  bodyTransportFallbackReason: null,
  requestedInterfaceFrequencyMode: 'coupled_detail',
  effectiveInterfaceFrequencyMode: 'coupled_detail',
  requestedInterfaceFrequencyRoute: webgpuMod.KAMINOS_FINGER_FLUID_COUPLED_DETAIL_INTERFACE_FREQUENCY_ROUTE,
  effectiveInterfaceFrequencyRoute: webgpuMod.KAMINOS_FINGER_FLUID_COUPLED_DETAIL_INTERFACE_FREQUENCY_ROUTE,
  interfaceFrequencyFallbackReason: null,
  supportPresentationEvidence: screenSpaceRendererRuntime.supportPresentationEvidence,
  linearHdrSceneEvidence,
  finalPresentationEvidence,
  refractionEvidence: {
    route: webgpuMod.KAMINOS_FINGER_FLUID_REFRACTION_RENDERER_ROUTE,
    shaderRoute: webgpuMod.KAMINOS_FINGER_FLUID_SCREEN_SPACE_SHADER_ROUTE,
    opticalTransportRoute: webgpuMod.KAMINOS_FINGER_FLUID_OPTICAL_TRANSPORT_ROUTE,
    opticalQueryRoute: webgpuMod.KAMINOS_FINGER_FLUID_HYBRID_OPTICAL_QUERY_ROUTE,
    deferredTraversalRoute: webgpuMod.KAMINOS_FINGER_FLUID_DEFERRED_RAY_TRAVERSAL_ROUTE,
    interfaceFidelityRoute: webgpuMod.KAMINOS_FINGER_FLUID_INTERFACE_FIDELITY_ROUTE,
    coverageClosure: 'dense_support_footprint_closure_sparse_identity_v0',
    normalFiltering: 'detail_macro_chord_variance_blend_v0',
    legacyDebugMode: 'legacy_interface',
    opticalTransportExecution: 'executed_refraction_and_reflection_transport_v0',
    supportDepthRoute: webgpuMod.KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_DEPTH_ROUTE,
    slabRoute: webgpuMod.KAMINOS_FINGER_FLUID_OPTICAL_SLAB_ROUTE,
    analyticSupportDepthPassCount: 7,
    slabGeometryPassCount: 7,
    frontDepthTexture: {
      format: 'rgba16float',
      channels: ['projected_particle_sphere_front_view_depth_min', 'nearest_particle_center_view_depth_min'],
    },
    backDepthTexture: {
      format: 'rgba16float',
      channel: 'projected_particle_sphere_back_view_depth_max',
    },
    accumulationTexture: {
      format: 'rgba16float',
      channels: ['optical_thickness', 'material_weighted_thickness', 'depth_weight', 'depth_weighted_view_depth_sum'],
    },
    invalidSlabDisposition: 'entry_interface_only_no_exit_claim_v0',
    opticalDebugMode: 'shaded',
    requestedOpticalFootprintMode: 'resolved_detail',
    effectiveOpticalFootprintMode: 'resolved_detail',
    requestedOpticalFootprintRoute: webgpuMod.KAMINOS_FINGER_FLUID_RESOLVED_DETAIL_FOOTPRINT_ROUTE,
    effectiveOpticalFootprintRoute: webgpuMod.KAMINOS_FINGER_FLUID_RESOLVED_DETAIL_FOOTPRINT_ROUTE,
    opticalFootprintFallbackReason: null,
    reflectionFootprintComposition: 'resolved_detail_normalized_five_ray_reflection_lobe_v0',
    requestedTransmissionFootprintMode: 'resolved_exit',
    effectiveTransmissionFootprintMode: 'resolved_exit',
    requestedTransmissionFootprintRoute: webgpuMod.KAMINOS_FINGER_FLUID_RESOLVED_EXIT_TRANSMISSION_FOOTPRINT_ROUTE,
    effectiveTransmissionFootprintRoute: webgpuMod.KAMINOS_FINGER_FLUID_RESOLVED_EXIT_TRANSMISSION_FOOTPRINT_ROUTE,
    transmissionFootprintFallbackReason: null,
    transmissionFootprintComposition: 'resolved_exit_single_hybrid_query_radiance_v0',
    transmissionQuadratureRoute: webgpuMod.KAMINOS_FINGER_FLUID_RESOLVED_EXIT_TRANSMISSION_ROUTE,
    transmissionQuadratureSampleCountMode: 'fixed_1_v0',
    transmissionQuadratureEstimator: 'resolved_center_ray_v0',
    transmissionApplicability: 'dense_body_and_unresolved_entry_or_exit_normal_only_sparse_sheet_resolved_v0',
    requestedBodyTransportMode: 'geometric_slab',
    effectiveBodyTransportMode: 'geometric_slab',
    requestedBodyTransportRoute: webgpuMod.KAMINOS_FINGER_FLUID_GEOMETRIC_SLAB_BODY_TRANSPORT_ROUTE,
    effectiveBodyTransportRoute: webgpuMod.KAMINOS_FINGER_FLUID_GEOMETRIC_SLAB_BODY_TRANSPORT_ROUTE,
    bodyTransportFallbackReason: null,
    bodyTransportComposition: 'geometric_valid_exit_path_with_entry_thickness_fallback_v0',
    requestedInterfaceFrequencyMode: 'coupled_detail',
    effectiveInterfaceFrequencyMode: 'coupled_detail',
    requestedInterfaceFrequencyRoute: webgpuMod.KAMINOS_FINGER_FLUID_COUPLED_DETAIL_INTERFACE_FREQUENCY_ROUTE,
    effectiveInterfaceFrequencyRoute: webgpuMod.KAMINOS_FINGER_FLUID_COUPLED_DETAIL_INTERFACE_FREQUENCY_ROUTE,
    interfaceFrequencyFallbackReason: null,
    interfaceFrequencyComposition: 'coupled_detail_interface_transport_baseline_v0',
    sceneColorTexture: { source: 'same-camera-linear-hdr-scene-radiance-v0' },
    scenePassCount: 7,
    accumulationPassCount: 7,
    compositePassCount: 7,
  },
  opticalQueryEvidence: {
    schema: webgpuMod.KAMINOS_FINGER_FLUID_OPTICAL_QUERY_SCHEMA,
    requestedRoute: webgpuMod.KAMINOS_FINGER_FLUID_HYBRID_OPTICAL_QUERY_ROUTE,
    effectiveRoute: webgpuMod.KAMINOS_FINGER_FLUID_HYBRID_OPTICAL_QUERY_ROUTE,
    route: webgpuMod.KAMINOS_FINGER_FLUID_HYBRID_OPTICAL_QUERY_ROUTE,
    deferredTraversalRoute: webgpuMod.KAMINOS_FINGER_FLUID_DEFERRED_RAY_TRAVERSAL_ROUTE,
    worldProviderRoute: webgpuMod.KAMINOS_FINGER_FLUID_WORLD_SPACE_REFLECTION_ROUTE,
    environmentRoute: webgpuMod.KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ROUTE,
    resolverOrder: webgpuMod.KAMINOS_FINGER_FLUID_OPTICAL_QUERY_RESOLVER_ORDER,
    fallbackReason: null,
    queryFrameId: 7,
    compositePassCount: 7,
    maximumDeferredMarchSteps: 24,
    minimumDeferredConfidence: 0.55,
    deferredInputs: {
      linearDepthObject: { format: 'rgba16float' },
      worldNormalRoughness: { format: 'rgba16float' },
      albedoMetallic: { format: 'rgba8unorm' },
    },
    consumers: ['reflection_center_ray', 'two_interface_refraction_exit_ray'],
    resultFields: ['origin', 'direction', 'cone', 'interval', 'hit_kind', 'object_id', 'distance', 'normal', 'material', 'radiance', 'transmittance', 'confidence', 'provider', 'fallback'],
  },
  worldSpaceReflectionEvidence: {
    schema: webgpuMod.KAMINOS_FINGER_FLUID_REFLECTION_QUERY_SCHEMA,
    requestedProviderRoute: webgpuMod.KAMINOS_FINGER_FLUID_WORLD_SPACE_REFLECTION_ROUTE,
    effectiveProviderRoute: webgpuMod.KAMINOS_FINGER_FLUID_WORLD_SPACE_REFLECTION_ROUTE,
    providerRoute: webgpuMod.KAMINOS_FINGER_FLUID_WORLD_SPACE_REFLECTION_ROUTE,
    accelerationRoute: webgpuMod.KAMINOS_FINGER_FLUID_REFLECTION_ACCELERATION_ROUTE,
    quadratureRoute: webgpuMod.KAMINOS_FINGER_FLUID_REFLECTION_QUADRATURE_ROUTE,
    requestedFootprintMode: 'resolved_detail',
    effectiveFootprintMode: 'resolved_detail',
    requestedFootprintRoute: webgpuMod.KAMINOS_FINGER_FLUID_RESOLVED_DETAIL_FOOTPRINT_ROUTE,
    effectiveFootprintRoute: webgpuMod.KAMINOS_FINGER_FLUID_RESOLVED_DETAIL_FOOTPRINT_ROUTE,
    footprintFallbackReason: null,
    minimumQuadratureSampleCount: 5,
    maximumQuadratureSampleCount: 5,
    quadratureSampleCountMode: 'fixed_5_v0',
    quadratureEstimator: 'weighted_five_ray_mean_v0',
    quadratureWeightSum: 1,
    hitKindDiagnosticScope: 'center_ray_only_v0',
    fallbackReason: null,
    compositePassCount: 7,
    candidateCapMode: 'uncapped_exact_dynamic_mesh_triangle_population_v0',
    exactTriangleCount: 12,
    hitKinds: ['environment', 'analytic_sphere', 'indexed_mesh'],
    reflectionProviderFrameId: 7,
    dynamicMeshTransformGeneration: 1,
  },
  environmentMapEvidence: {
    schema: 'kaminos.hdr-environment-map.v0',
    requestedRoute: webgpuMod.KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ROUTE,
    effectiveRoute: webgpuMod.KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ROUTE,
    assetId: webgpuMod.KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ASSET_ID,
    assetSha256: webgpuMod.KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_SHA256,
    runtimeAssetUrl: './assets/hdr/studio_small_09_1k.hdr',
    sourceAssetUrl: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr',
    sourcePageUrl: 'https://polyhaven.com/a/studio_small_09',
    license: 'CC0-1.0',
    decodeRoute: 'cpu-radiance-rle-rgbe-v0',
    samplingRoute: 'wgsl-manual-bilinear-rgbe-equirectangular-v0',
    width: 1024,
    height: 512,
    gpuTextureFormat: 'rgba8unorm',
    fallbackReason: null,
  },
};
assert.deepEqual(
  webgpuMod.validateFingerFluidTruthRendererState('screen_space_refraction', refractionRendererRuntime),
  {
    requestedRendererMode: 'screen_space_refraction',
    effectiveRendererMode: 'screen_space_refraction',
    requestedRenderer: webgpuMod.KAMINOS_FINGER_FLUID_REFRACTION_RENDERER_ROUTE,
    effectiveRenderer: webgpuMod.KAMINOS_FINGER_FLUID_REFRACTION_RENDERER_ROUTE,
    fallbackReason: null,
    deferredSceneEvidence,
    requestedOpticalDebugMode: 'shaded',
    effectiveOpticalDebugMode: 'shaded',
    requestedOpticalFootprintMode: 'resolved_detail',
    effectiveOpticalFootprintMode: 'resolved_detail',
    requestedOpticalFootprintRoute: webgpuMod.KAMINOS_FINGER_FLUID_RESOLVED_DETAIL_FOOTPRINT_ROUTE,
    effectiveOpticalFootprintRoute: webgpuMod.KAMINOS_FINGER_FLUID_RESOLVED_DETAIL_FOOTPRINT_ROUTE,
    opticalFootprintFallbackReason: null,
    requestedTransmissionFootprintMode: 'resolved_exit',
    effectiveTransmissionFootprintMode: 'resolved_exit',
    requestedTransmissionFootprintRoute: webgpuMod.KAMINOS_FINGER_FLUID_RESOLVED_EXIT_TRANSMISSION_FOOTPRINT_ROUTE,
    effectiveTransmissionFootprintRoute: webgpuMod.KAMINOS_FINGER_FLUID_RESOLVED_EXIT_TRANSMISSION_FOOTPRINT_ROUTE,
    transmissionFootprintFallbackReason: null,
    requestedBodyTransportMode: 'geometric_slab',
    effectiveBodyTransportMode: 'geometric_slab',
    requestedBodyTransportRoute: webgpuMod.KAMINOS_FINGER_FLUID_GEOMETRIC_SLAB_BODY_TRANSPORT_ROUTE,
    effectiveBodyTransportRoute: webgpuMod.KAMINOS_FINGER_FLUID_GEOMETRIC_SLAB_BODY_TRANSPORT_ROUTE,
    bodyTransportFallbackReason: null,
    requestedInterfaceFrequencyMode: 'coupled_detail',
    effectiveInterfaceFrequencyMode: 'coupled_detail',
    requestedInterfaceFrequencyRoute: webgpuMod.KAMINOS_FINGER_FLUID_COUPLED_DETAIL_INTERFACE_FREQUENCY_ROUTE,
    effectiveInterfaceFrequencyRoute: webgpuMod.KAMINOS_FINGER_FLUID_COUPLED_DETAIL_INTERFACE_FREQUENCY_ROUTE,
    interfaceFrequencyFallbackReason: null,
    supportPresentationEvidence: screenSpaceRendererRuntime.supportPresentationEvidence,
    linearHdrSceneEvidence,
    finalPresentationEvidence,
    screenSpaceSurfaceEvidence: null,
    refractionEvidence: refractionRendererRuntime.refractionEvidence,
    opticalQueryEvidence: refractionRendererRuntime.opticalQueryEvidence,
    worldSpaceReflectionEvidence: refractionRendererRuntime.worldSpaceReflectionEvidence,
    environmentMapEvidence: refractionRendererRuntime.environmentMapEvidence,
  },
);
const varianceFilteredRendererRuntime = {
  ...refractionRendererRuntime,
  requestedOpticalFootprintMode: 'variance_filtered',
  effectiveOpticalFootprintMode: 'variance_filtered',
  requestedOpticalFootprintRoute: webgpuMod.KAMINOS_FINGER_FLUID_VARIANCE_FILTERED_FOOTPRINT_ROUTE,
  effectiveOpticalFootprintRoute: webgpuMod.KAMINOS_FINGER_FLUID_VARIANCE_FILTERED_FOOTPRINT_ROUTE,
  refractionEvidence: {
    ...refractionRendererRuntime.refractionEvidence,
    requestedOpticalFootprintMode: 'variance_filtered',
    effectiveOpticalFootprintMode: 'variance_filtered',
    requestedOpticalFootprintRoute: webgpuMod.KAMINOS_FINGER_FLUID_VARIANCE_FILTERED_FOOTPRINT_ROUTE,
    effectiveOpticalFootprintRoute: webgpuMod.KAMINOS_FINGER_FLUID_VARIANCE_FILTERED_FOOTPRINT_ROUTE,
    reflectionFootprintComposition: 'dense_unresolved_variance_widens_normalized_nine_ray_reflection_lobe_v0',
  },
  worldSpaceReflectionEvidence: {
    ...refractionRendererRuntime.worldSpaceReflectionEvidence,
    quadratureRoute: webgpuMod.KAMINOS_FINGER_FLUID_VARIANCE_FILTERED_REFLECTION_QUADRATURE_ROUTE,
    requestedFootprintMode: 'variance_filtered',
    effectiveFootprintMode: 'variance_filtered',
    requestedFootprintRoute: webgpuMod.KAMINOS_FINGER_FLUID_VARIANCE_FILTERED_FOOTPRINT_ROUTE,
    effectiveFootprintRoute: webgpuMod.KAMINOS_FINGER_FLUID_VARIANCE_FILTERED_FOOTPRINT_ROUTE,
    maximumQuadratureSampleCount: 9,
    quadratureSampleCountMode: 'adaptive_5_sparse_9_dense_v0',
    quadratureEstimator: 'trimmed_min_max_7_of_9_equal_weight_v0',
  },
};
assert.equal(
  webgpuMod.validateFingerFluidTruthRendererState('screen_space_refraction', varianceFilteredRendererRuntime).worldSpaceReflectionEvidence.quadratureRoute,
  webgpuMod.KAMINOS_FINGER_FLUID_VARIANCE_FILTERED_REFLECTION_QUADRATURE_ROUTE,
);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_refraction', {
  ...varianceFilteredRendererRuntime,
  worldSpaceReflectionEvidence: {
    ...varianceFilteredRendererRuntime.worldSpaceReflectionEvidence,
    quadratureRoute: webgpuMod.KAMINOS_FINGER_FLUID_REFLECTION_QUADRATURE_ROUTE,
  },
}), /world-space reflection evidence is missing or partial/);
const interfaceDiagnosticRuntime = {
  ...refractionRendererRuntime,
  opticalDebugMode: 'interface_fidelity',
  refractionEvidence: {
    ...refractionRendererRuntime.refractionEvidence,
    opticalTransportExecution: 'not_executed_early_interface_diagnostic_v0',
  },
  opticalQueryEvidence: undefined,
  worldSpaceReflectionEvidence: undefined,
  environmentMapEvidence: undefined,
};
const validatedInterfaceDiagnostic = webgpuMod.validateFingerFluidTruthRendererState('screen_space_refraction', interfaceDiagnosticRuntime);
assert.equal(validatedInterfaceDiagnostic.refractionEvidence.opticalTransportExecution, 'not_executed_early_interface_diagnostic_v0');
assert.equal(validatedInterfaceDiagnostic.opticalQueryEvidence, null);
assert.equal(validatedInterfaceDiagnostic.worldSpaceReflectionEvidence, null);
assert.equal(validatedInterfaceDiagnostic.environmentMapEvidence, null);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_refraction', {
  ...interfaceDiagnosticRuntime,
  opticalQueryEvidence: refractionRendererRuntime.opticalQueryEvidence,
}), /interface diagnostic published inactive optical provider evidence/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('sphere_debug', {
  requestedRendererMode: 'sphere_debug',
  effectiveRendererMode: 'sphere_debug',
  requestedRenderer: webgpuMod.KAMINOS_FINGER_FLUID_SPHERE_DEBUG_RENDERER_ROUTE,
  effectiveRenderer: webgpuMod.KAMINOS_FINGER_FLUID_SPHERE_DEBUG_RENDERER_ROUTE,
  fallbackReason: null,
  deferredSceneEvidence,
}), /support presentation evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_surface', {
  ...screenSpaceRendererRuntime,
  deferredSceneEvidence: { ...deferredSceneEvidence, effectiveRoute: 'fallback-scene' },
}), /deferred scene evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_surface', {
  ...screenSpaceRendererRuntime,
  linearHdrSceneEvidence: { ...linearHdrSceneEvidence, effectiveRoute: 'swapchain-direct-fallback' },
}), /linear HDR scene evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_surface', {
  ...screenSpaceRendererRuntime,
  linearHdrSceneEvidence: {
    ...linearHdrSceneEvidence,
    worldLightingConsumers: linearHdrSceneEvidence.worldLightingConsumers.filter((consumer) => consumer !== 'dynamic_indexed_mesh'),
  },
}), /linear HDR scene evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_surface', {
  ...screenSpaceRendererRuntime,
  linearHdrSceneEvidence: {
    ...linearHdrSceneEvidence,
    worldLightingConsumers: [...linearHdrSceneEvidence.worldLightingConsumers, 'fallback_world'],
  },
}), /linear HDR scene evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_surface', {
  ...screenSpaceRendererRuntime,
  finalPresentationEvidence: { ...finalPresentationEvidence, displayTransformCountPerFrame: 2 },
}), /final presentation evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_surface', {
  ...screenSpaceRendererRuntime,
  finalPresentationEvidence: { ...finalPresentationEvidence, sourceFormat: 'bgra8unorm' },
}), /final presentation evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_surface', {
  ...screenSpaceRendererRuntime,
  finalPresentationEvidence: { ...finalPresentationEvidence, exposure: 99 },
}), /final presentation evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_surface', {
  ...screenSpaceRendererRuntime,
  finalPresentationEvidence: { ...finalPresentationEvidence, exactDiagnosticBypass: 'none' },
}), /final presentation evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_surface', {
  ...screenSpaceRendererRuntime,
  finalPresentationEvidence: { ...finalPresentationEvidence, diagnosticVisibilityRoute: 'pre-composite-proxy' },
}), /final presentation evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_refraction', {
  ...refractionRendererRuntime,
  opticalQueryEvidence: { ...refractionRendererRuntime.opticalQueryEvidence, effectiveRoute: 'screen-color-offset-fallback' },
}), /hybrid optical query evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_refraction', {
  ...refractionRendererRuntime,
  refractionEvidence: { ...refractionRendererRuntime.refractionEvidence, interfaceFidelityRoute: 'legacy-interface-default' },
}), /refraction renderer evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_refraction', {
  ...refractionRendererRuntime,
  opticalQueryEvidence: { ...refractionRendererRuntime.opticalQueryEvidence, minimumDeferredConfidence: 0.18 },
}), /hybrid optical query evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_refraction', {
  ...refractionRendererRuntime,
  opticalQueryEvidence: { ...refractionRendererRuntime.opticalQueryEvidence, resolverOrder: 'hdr_environment_first' },
}), /hybrid optical query evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_refraction', {
  ...refractionRendererRuntime,
  opticalQueryEvidence: { ...refractionRendererRuntime.opticalQueryEvidence, queryFrameId: 6 },
}), /hybrid optical query evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_refraction', {
  ...refractionRendererRuntime,
  opticalQueryEvidence: {
    ...refractionRendererRuntime.opticalQueryEvidence,
    deferredInputs: { ...refractionRendererRuntime.opticalQueryEvidence.deferredInputs, albedoMetallic: null },
  },
}), /hybrid optical query evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_refraction', {
  ...refractionRendererRuntime,
  worldSpaceReflectionEvidence: { ...refractionRendererRuntime.worldSpaceReflectionEvidence, fallbackReason: 'provider unavailable' },
}), /world-space reflection evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_refraction', {
  ...refractionRendererRuntime,
  worldSpaceReflectionEvidence: { ...refractionRendererRuntime.worldSpaceReflectionEvidence, quadratureRoute: 'single-delta-ray' },
}), /world-space reflection evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_refraction', {
  ...refractionRendererRuntime,
  environmentMapEvidence: { ...refractionRendererRuntime.environmentMapEvidence, effectiveRoute: 'procedural-sky-fallback' },
}), /HDR environment evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_refraction', {
  ...refractionRendererRuntime,
  environmentMapEvidence: { ...refractionRendererRuntime.environmentMapEvidence, assetSha256: 'stale-asset' },
}), /HDR environment evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_refraction', {
  ...refractionRendererRuntime,
  deferredSceneEvidence: { ...deferredSceneEvidence, deferredSceneFrameId: 6 },
}), /deferred scene evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_refraction', {
  ...refractionRendererRuntime,
  deferredSceneEvidence: { ...deferredSceneEvidence, dynamicIndexedMeshLastDrawFrameId: 6 },
}), /deferred scene evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_refraction', {
  ...refractionRendererRuntime,
  worldSpaceReflectionEvidence: { ...refractionRendererRuntime.worldSpaceReflectionEvidence, reflectionProviderFrameId: 6 },
}), /world-space reflection evidence is missing or partial/);
const reflectionDiagnosticRuntime = {
  ...refractionRendererRuntime,
  opticalDebugMode: 'reflection_hit_kind',
  deferredSceneEvidence: {
    ...deferredSceneEvidence,
    dynamicIndexedMeshLastDrawFrameId: 6,
    dynamicMesh: {
      ...deferredSceneEvidence.dynamicMesh,
      presentationMode: 'suppressed_in_reflection_debug_provider_remains_active_v0',
    },
  },
};
assert.equal(
  webgpuMod.validateFingerFluidTruthRendererState('screen_space_refraction', reflectionDiagnosticRuntime).worldSpaceReflectionEvidence.reflectionProviderFrameId,
  7,
);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_refraction', {
  ...reflectionDiagnosticRuntime,
  deferredSceneEvidence: { ...reflectionDiagnosticRuntime.deferredSceneEvidence, dynamicIndexedMeshLastDrawFrameId: 7 },
}), /deferred scene evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_surface', {
  ...screenSpaceRendererRuntime,
  supportPresentationEvidence: {
    ...screenSpaceRendererRuntime.supportPresentationEvidence,
    particleSupportDrawCount: 1,
  },
}), /support presentation evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_refraction', {
  ...refractionRendererRuntime,
  supportPresentationEvidence: {
    ...refractionRendererRuntime.supportPresentationEvidence,
    refractionCaptureOrder: 'copy_before_support_presentation',
  },
}), /support presentation evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_refraction', {
  ...refractionRendererRuntime,
  refractionEvidence: {
    ...refractionRendererRuntime.refractionEvidence,
    analyticSupportDepthPassCount: 0,
  },
}), /refraction renderer evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_refraction', {
  ...refractionRendererRuntime,
  refractionEvidence: {
    ...refractionRendererRuntime.refractionEvidence,
    slabGeometryPassCount: 0,
  },
}), /refraction renderer evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_surface', {
  ...screenSpaceRendererRuntime,
  effectiveRendererMode: 'sphere_debug',
  effectiveRenderer: webgpuMod.KAMINOS_FINGER_FLUID_SPHERE_DEBUG_RENDERER_ROUTE,
}), /renderer mode disagreement/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_surface', {
  ...screenSpaceRendererRuntime,
  screenSpaceSurfaceEvidence: {
    ...screenSpaceRendererRuntime.screenSpaceSurfaceEvidence,
    analyticSupportDepthPassCount: 0,
  },
}), /screen-space renderer evidence is missing or partial/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_surface', {
  ...screenSpaceRendererRuntime,
  effectiveRenderer: webgpuMod.KAMINOS_FINGER_FLUID_SPHERE_DEBUG_RENDERER_ROUTE,
}), /renderer identity disagreement/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_surface', {
  ...screenSpaceRendererRuntime,
  fallbackReason: 'surface pipeline unavailable',
}), /renderer fallback/);
assert.throws(() => webgpuMod.validateFingerFluidTruthRendererState('screen_space_surface', {
  ...screenSpaceRendererRuntime,
  screenSpaceSurfaceEvidence: {
    ...screenSpaceRendererRuntime.screenSpaceSurfaceEvidence,
    accumulationPassCount: 0,
  },
}), /screen-space renderer evidence/);
assert.deepEqual(webgpuMod.KAMINOS_FINGER_FLUID_OPTICAL_DEBUG_MODES, ['shaded', 'depth', 'entry_depth', 'normal', 'exit_depth', 'exit_normal', 'thickness', 'path_length', 'exit_validity', 'refraction_offset', 'fresnel', 'absorption', 'reflection', 'reflection_hit_kind', 'reflection_distance', 'environment', 'liquid_support', 'environment_contribution', 'coverage', 'refraction_hit_kind', 'refraction_distance', 'refraction_fallback_delta', 'legacy_interface', 'interface_fidelity', 'transmitted_transport', 'reflected_transport', 'scatter_transport', 'pre_tonemap_luminance', 'normal_variance', 'reflection_footprint', 'exit_normal_variance', 'transmission_footprint', 'body_transport_path', 'body_transport_residual', 'macro_interface_normal', 'micro_normal_residual', 'interface_roughness', 'transmission_detail_weight']);
assert.deepEqual(webgpuMod.KAMINOS_FINGER_FLUID_OPTICAL_LIGHTING_MODES, ['transport_only', 'bounded_ggx', 'legacy_shading']);
assert.deepEqual(webgpuMod.KAMINOS_FINGER_FLUID_OPTICAL_FOOTPRINT_MODES, ['resolved_detail', 'variance_filtered']);
assert.deepEqual(webgpuMod.KAMINOS_FINGER_FLUID_TRANSMISSION_FOOTPRINT_MODES, ['resolved_exit', 'dense_exit_filtered']);
assert.equal(webgpuMod.resolveFingerFluidOpticalLightingMode('transport_only'), 'transport_only');
assert.equal(webgpuMod.resolveFingerFluidOpticalLightingMode('bounded_ggx'), 'bounded_ggx');
assert.throws(() => webgpuMod.resolveFingerFluidOpticalLightingMode('silent_legacy_fallback'), /Unsupported finger fluid optical lighting mode/);
assert.equal(webgpuMod.resolveFingerFluidOpticalFootprintMode('resolved_detail'), 'resolved_detail');
assert.equal(webgpuMod.resolveFingerFluidOpticalFootprintMode('variance_filtered'), 'variance_filtered');
assert.throws(() => webgpuMod.resolveFingerFluidOpticalFootprintMode('silent_footprint_fallback'), /Unsupported finger fluid optical footprint mode/);
assert.equal(webgpuMod.resolveFingerFluidTransmissionFootprintMode('resolved_exit'), 'resolved_exit');
assert.equal(webgpuMod.resolveFingerFluidTransmissionFootprintMode('dense_exit_filtered'), 'dense_exit_filtered');
assert.throws(() => webgpuMod.resolveFingerFluidTransmissionFootprintMode('silent_transmission_fallback'), /Unsupported finger fluid transmission footprint mode/);
assert.deepEqual(webgpuMod.KAMINOS_FINGER_FLUID_BODY_TRANSPORT_MODES, ['geometric_slab', 'robust_dense_body']);
assert.equal(webgpuMod.resolveFingerFluidBodyTransportMode('geometric_slab'), 'geometric_slab');
assert.equal(webgpuMod.resolveFingerFluidBodyTransportMode('robust_dense_body'), 'robust_dense_body');
assert.throws(() => webgpuMod.resolveFingerFluidBodyTransportMode('silent_body_transport_fallback'), /Unsupported finger fluid body transport mode/);
assert.deepEqual(webgpuMod.KAMINOS_FINGER_FLUID_INTERFACE_FREQUENCY_MODES, ['coupled_detail', 'macro_micro_separated']);
assert.equal(webgpuMod.resolveFingerFluidInterfaceFrequencyMode('coupled_detail'), 'coupled_detail');
assert.equal(webgpuMod.resolveFingerFluidInterfaceFrequencyMode('macro_micro_separated'), 'macro_micro_separated');
assert.throws(() => webgpuMod.resolveFingerFluidInterfaceFrequencyMode('silent_interface_frequency_fallback'), /Unsupported finger fluid interface frequency mode/);
assert.deepEqual(webgpuMod.fingerFluidAbsorptionCoefficientsForLightingMode('transport_only'), [1.10, 0.42, 0.18]);
assert.deepEqual(webgpuMod.fingerFluidAbsorptionCoefficientsForLightingMode('bounded_ggx'), [1.10, 0.42, 0.18]);
assert.deepEqual(webgpuMod.fingerFluidAbsorptionCoefficientsForLightingMode('legacy_shading'), [0.46, 0.15, 0.055]);
assert.equal(webgpuMod.resolveFingerFluidOpticalDebugMode('refraction_offset'), 'refraction_offset');
assert.equal(webgpuMod.resolveFingerFluidOpticalDebugMode('environment'), 'environment');
assert.equal(webgpuMod.resolveFingerFluidOpticalDebugMode('liquid_support'), 'liquid_support');
assert.equal(webgpuMod.resolveFingerFluidOpticalDebugMode('environment_contribution'), 'environment_contribution');
assert.throws(() => webgpuMod.resolveFingerFluidOpticalDebugMode('pretty_fallback'), /Unsupported finger fluid optical debug mode/);
assert.equal(webgpuMod.KAMINOS_LIQUID_FIRE_CONTACT_DESCRIPTOR_SCHEMA, 'kaminos.liquid-fire-contact-descriptor.v1');
assert.equal(webgpuMod.KAMINOS_LIQUID_FIRE_CONTACT_DESCRIPTOR_PACKING, 'gpu-sparse-liquid-fire-contact-source-vec4x8-v1');
assert.equal(typeof webgpuMod.validateLiquidFireContactDescriptorHeader, 'function');
const validContactHeader = {
  schema: webgpuMod.KAMINOS_LIQUID_FIRE_CONTACT_DESCRIPTOR_SCHEMA,
  packing: webgpuMod.KAMINOS_LIQUID_FIRE_CONTACT_DESCRIPTOR_PACKING,
  magic: 0x4b4c4643,
  version: 1,
  allocationGeneration: 7,
  epoch: 11,
  writeTick: 29,
  valid: true,
  complete: true,
  sourceCount: 91,
  packedCount: 80,
  contactCount: 80,
  rejectedCount: 11,
  capacity: 24576,
  overflowCount: 0,
  malformedCount: 0,
  sourceFrameId: 'kaminos/finger-fluid-bench:gpu-simulation-frame',
};
assert.deepEqual(webgpuMod.validateLiquidFireContactDescriptorHeader(validContactHeader, {
  allocationGeneration: 7,
  epoch: 11,
  minimumWriteTick: 29,
  sourceFrameId: 'kaminos/finger-fluid-bench:gpu-simulation-frame',
}), validContactHeader, 'complete source-honest contact headers pass unchanged');
assert.throws(() => webgpuMod.validateLiquidFireContactDescriptorHeader({ ...validContactHeader, complete: false }, { allocationGeneration: 7, epoch: 11, minimumWriteTick: 29, sourceFrameId: validContactHeader.sourceFrameId }), /not complete/, 'incomplete producer writes fail closed');
assert.throws(() => webgpuMod.validateLiquidFireContactDescriptorHeader({ ...validContactHeader, writeTick: 28 }, { allocationGeneration: 7, epoch: 11, minimumWriteTick: 29, sourceFrameId: validContactHeader.sourceFrameId }), /stale write tick/, 'stale contact descriptors fail closed');
assert.throws(() => webgpuMod.validateLiquidFireContactDescriptorHeader({ ...validContactHeader, allocationGeneration: 6 }, { allocationGeneration: 7, epoch: 11, minimumWriteTick: 29, sourceFrameId: validContactHeader.sourceFrameId }), /allocation generation/, 'wrong-generation contact descriptors fail closed');
assert.throws(() => webgpuMod.validateLiquidFireContactDescriptorHeader({ ...validContactHeader, sourceFrameId: 'fallback-frame' }, { allocationGeneration: 7, epoch: 11, minimumWriteTick: 29, sourceFrameId: validContactHeader.sourceFrameId }), /source frame identity/, 'fallback source frames cannot impersonate liquid world truth');
assert.throws(() => webgpuMod.validateLiquidFireContactDescriptorHeader({ ...validContactHeader, packedCount: 79 }, { allocationGeneration: 7, epoch: 11, minimumWriteTick: 29, sourceFrameId: validContactHeader.sourceFrameId }), /accounting/, 'source, packed, and rejected counts must reconcile exactly');
assert.throws(() => webgpuMod.validateLiquidFireContactDescriptorHeader({ ...validContactHeader, malformedCount: 1 }, { allocationGeneration: 7, epoch: 11, minimumWriteTick: 29, sourceFrameId: validContactHeader.sourceFrameId }), /malformed/, 'malformed source records fail closed');
assert.deepEqual(webgpuMod.KAMINOS_FINGER_FLUID_COLOR_MODES, ['phase', 'particle_id', 'speed', 'density', 'surface', 'neighbor_retention', 'chemistry', 'sheet_release']);
assert.equal(typeof webgpuMod.measureNeighborRetention, 'function');
assert.equal(webgpuMod.measureNeighborRetention([1, 2, 3, 4], [1, 2, 3, 4]), 1);
assert.equal(webgpuMod.measureNeighborRetention([1, 2, 3, 4], [2, 4, 5, 6]), 0.5);
assert.equal(webgpuMod.measureNeighborRetention([1, 2, 0xffffffff, 0xffffffff], [1, 3, 0xffffffff, 0xffffffff]), 0.5);
assert.equal(webgpuMod.resolveFingerFluidColorMode('neighbor_retention'), 'neighbor_retention');
assert.throws(() => webgpuMod.resolveFingerFluidColorMode('quietly_fallback'), /Unsupported finger fluid color mode/);
assert.equal(webgpuMod.resolveFingerFluidChemistryDiffusion('0.18'), 0.18);
assert.equal(webgpuMod.resolveFingerFluidChemistryDiffusion(0), 0);
assert.throws(() => webgpuMod.resolveFingerFluidChemistryDiffusion(-0.1), /chemistry diffusion strength must be in/);
assert.throws(() => webgpuMod.resolveFingerFluidChemistryDiffusion('quietly_default'), /chemistry diffusion strength must be in/);
assert.equal(typeof webgpuMod.diffusePassiveScalarStep, 'function');
const passiveDiffusion = webgpuMod.diffusePassiveScalarStep([0, 0.25, 0.75, 1], [[0, 1, 1], [1, 2, 0.5], [2, 3, 1]], 0.2, 0.1);
assert.ok(passiveDiffusion.values[0] > 0 && passiveDiffusion.values[3] < 1, `passive tracer must visibly mix: ${JSON.stringify(passiveDiffusion)}`);
assert.ok(Math.abs(passiveDiffusion.massDrift) < 1e-12, `pair-symmetric passive diffusion must conserve scalar mass: ${JSON.stringify(passiveDiffusion)}`);
assert.deepEqual(webgpuMod.diffusePassiveScalarStep([0, 0.25, 0.75, 1], [[0, 1, 1]], 0, 0.1).values, [0, 0.25, 0.75, 1], 'zero diffusion is an exact no-op');
assert.equal(typeof webgpuMod.measureSupportTransport, 'function');
assert.equal(typeof webgpuMod.sampleFingerFluidPlaygroundHeight, 'function');
const supportY = webgpuMod.sampleFingerFluidPlaygroundHeight(0, 0) + 0.185 * 0.22;
const movingSupport = webgpuMod.measureSupportTransport([0, supportY, 0], [0.8, 0, 0]);
assert.ok(movingSupport.supportContact > 0.9, `floor-adjacent transport must detect support: ${JSON.stringify(movingSupport)}`);
assert.ok(movingSupport.tangentialSpeed > 0.75, `lateral floor motion must remain tangentially legible: ${JSON.stringify(movingSupport)}`);
assert.ok(movingSupport.supportTransportWeight > 0.8, `moving supported fluid must enter transport phase: ${JSON.stringify(movingSupport)}`);
const restingSupport = webgpuMod.measureSupportTransport([0, supportY, 0], [0.04, 0, 0]);
assert.ok(restingSupport.supportTransportWeight < 0.01, `resting supported fluid must not masquerade as transport: ${JSON.stringify(restingSupport)}`);
const airborne = webgpuMod.measureSupportTransport([0, supportY + 0.5, 0], [0.8, 0, 0]);
assert.ok(airborne.supportContact < 0.01 && airborne.supportTransportWeight < 0.01, `airborne flow must not masquerade as supported transport: ${JSON.stringify(airborne)}`);
