require 'minitest/autorun'

class BoundarySplatSmartSelectorContracts < Minitest::Test
  ROOT = File.expand_path('..', __dir__)

  def core
    @core ||= File.read(File.join(ROOT, 'volume-core.js'))
  end

  def page
    @page ||= File.read(File.join(ROOT, 'index.html'))
  end

  def motion_witness
    @motion_witness ||= File.read(File.join(ROOT, 'volume-boundary-splat-motion-witness.mjs'))
  end

  def pbr_witness_path
    File.join(ROOT, 'volume-boundary-splat-pbr-witness.mjs')
  end

  def pbr_witness
    @pbr_witness ||= File.read(pbr_witness_path)
  end

  def test_runtime_declares_projected_area_nested_prefix_selector
    assert_match(/BOUNDARY_SPLAT_ADAPTIVE_LOD_IDENTITY\s*=\s*'boundary-splat-projected-area-nested-tiers-v0'/, core)
    assert_match(/BOUNDARY_SPLAT_SELECTOR_POLICY_IDENTITY\s*=\s*'boundary-splat-nested-permutation-prefix-v0'/, core)
    assert_match(/BOUNDARY_SPLAT_SELECTOR_BUDGETS\s*=\s*\[0,\s*12800,\s*6400,\s*3200,\s*1600,\s*800\]/, core)
    assert_match(/BOUNDARY_SPLAT_ADAPTIVE_TIER_BUDGETS\s*=\s*\[800,\s*1600,\s*3200,\s*6400,\s*12800,\s*0\]/, core)
  end

  def test_runtime_exports_deterministic_allocation_functions
    assert_match(/export function normalizeBoundarySplatLodMode/, core)
    assert_match(/export function boundarySplatProjectedTierBudget/, core)
    assert_match(/export function boundarySplatApplyBudgetCeiling/, core)
    assert_match(/export function boundarySplatGroupDescriptorsByTier/, core)
    assert_match(/export function boundarySplatNestedSourceIndex/, core)
  end

  def test_gpu_path_preserves_tier_and_budget_authority
    assert_match(/struct BoundarySplatDrawGroup[\s\S]*descriptorStart:\s*u32[\s\S]*descriptorCount:\s*u32[\s\S]*requestedCandidateBudget:\s*u32[\s\S]*effectiveCandidateBudget:\s*u32/, core)
    assert_match(/fn boundarySplatNestedSourceIndex\(rank:\s*u32,\s*sourceCount:\s*u32\)/, core)
    assert_match(/archiveBoundarySplatHistory[\s\S]*boundarySplatNestedSourceIndex\(candidateIndex,\s*boundarySplatDraw\.sourceCandidateCount\)/, core)
    assert_match(/addedSimulationPasses:\s*0[\s\S]*addedHistoryArchivePasses:\s*1/, core)
    assert_match(/boundarySplatLodMode[\s\S]*boundarySplatAdaptiveLodIdentity[\s\S]*boundarySplatTierGroups[\s\S]*boundarySplatGlobalRenderedInstanceCount/, core)
  end

  def test_operator_route_exposes_fixed_versus_projected_area_allocation
    assert_match(/id="volume-boundary-splat-lod-mode"[\s\S]*value="fixed"[\s\S]*value="projected-area"/, page)
    assert_match(/volume_boundary_splat_lod_mode/, page)
    assert_match(/boundarySplatCandidateBudget[\s\S]*max:\s*12800/, page)
  end

  def test_witnesses_preserve_smart_selector_authority_and_false_closure_checks
    assert(File.exist?(pbr_witness_path), 'PBR selector witness must exist before adaptive claims')
    assert_match(/volume_boundary_splat_lod_mode/, pbr_witness)
    assert_match(/boundarySplatAdaptiveLodIdentity[\s\S]*boundarySplatTierGroups[\s\S]*boundarySplatGlobalRenderedInstanceCount/, pbr_witness)
    assert_match(/stale-or-default-adaptive-lod|adaptive-lod-allocation-mismatch/, pbr_witness)

    assert_match(/boundary-splat-nested-permutation-prefix-v0/, motion_witness)
    assert_match(/boundarySplatAdaptiveLodIdentity[\s\S]*boundarySplatTierGroups[\s\S]*boundarySplatGlobalRenderedInstanceCount/, motion_witness)
    assert_match(/smart-selector|lod mode|boundarySplatLodMode/, motion_witness)
  end

  def test_pbr_witness_launches_child_owned_browser_inside_greenroom_job
    assert_match(/function launchBrowser/, pbr_witness)
    assert_match(/failurePhase\s*=\s*'browser-launch'/, pbr_witness)
    assert_match(/--enable-unsafe-webgpu/, pbr_witness)
    assert_match(/mode:\s*browserSession\s*\?\s*'self-launched'/, pbr_witness)
    assert_match(/browserProcessIdentity\s*=\s*discoverBrowserProcessIdentity\(port\)/, pbr_witness)
  end

  def test_adaptive_lod_does_not_depend_on_indirect_first_instance_residency
    assert_match(/BOUNDARY_SPLAT_INDIRECT_DRAW_IDENTITY\s*=\s*'boundary-splat-single-global-indirect-no-first-instance-v0'/, core)

    compaction = core[/function encodeBoundarySplats\([\s\S]*?\n  function encodeBoundarySplatPbrScene/, 0]
    refute_nil(compaction, 'compaction path must be present')
    assert_match(/copyBufferToBuffer\(\s*boundarySplatDrawBuffer,\s*0,\s*boundarySplatIndirectBuffer,\s*0,\s*BOUNDARY_SPLAT_INDIRECT_STRIDE_BYTES,?\s*\)/, compaction)
    refute_match(/copyBufferToBuffer\(\s*boundarySplatDrawGroupBuffer[\s\S]*boundarySplatIndirectBuffer/, compaction,
      'adaptive LOD must not copy per-tier firstInstance values into indirect draw commands')

    renderer = core[/function encodeBoundarySplatDraw\([\s\S]*?\n  function encodeBoundarySplatTelemetry/, 0]
    refute_nil(renderer, 'splat render path must be present')
    assert_match(/pass\.drawIndirect\(boundarySplatIndirectBuffer,\s*0\)/, renderer)
    refute_match(/for\s*\(let groupIndex = 0; groupIndex < BOUNDARY_SPLAT_DRAW_GROUP_COUNT; groupIndex \+= 1\)[\s\S]*pass\.drawIndirect/, renderer,
      'renderer must issue one global indirect draw so tier residency is decoded in shader, not by fragile indirect firstInstance')

    assert_match(/indirectDrawIdentity:\s*BOUNDARY_SPLAT_INDIRECT_DRAW_IDENTITY/, core,
      'draw-state and PBR ladder evidence must publish the indirect draw identity that protects adaptive residency')
    assert_match(/indirectDrawIdentity:\s*draw\?\.indirectDrawIdentity/, core,
      'PBR ladder rows must preserve the effective indirect draw identity from GPU draw-state readback')
  end
end
