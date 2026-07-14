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
end
