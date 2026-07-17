require 'minitest/autorun'

class BoundarySplatLiveUnionOccupancyContracts < Minitest::Test
  ROOT = File.expand_path('..', __dir__)

  def witness_path
    File.join(ROOT, 'volume-boundary-splat-live-union-witness.mjs')
  end

  def witness
    @witness ||= File.read(witness_path)
  end

  def test_live_union_witness_exists_and_declares_schema
    assert(File.exist?(witness_path), 'Census must own a live union occupancy witness before Integration pushes the consumer head')
    assert_match(/kaminos\.boundary-splat\.live-union-occupancy\.v0/, witness)
    assert_match(/full-flame-ridge-nonridge-live-union-v0/, witness)
    assert_match(/two-anchor-live-union-census-v0/, witness)
  end

  def test_witness_requires_exact_pushed_integration_consumer_head
    assert_match(/--expected-integration-head/, witness)
    assert_match(/--expected-tiger-head/, witness)
    assert_match(/missing-expected-integration-head/, witness)
    assert_match(/missing-expected-tiger-head/, witness)
    assert_match(/stale-integration-consumer-head/, witness)
    assert_match(/stale-tiger-consumer-head/, witness)
    assert_match(/8e68e8bbbe6564ed7c34d2a2c15a48a4e169396c/, witness)
    assert_match(/35e76f70/, witness)
    refute_match(/174c06af5c17bb31a1310ce0cfa7d4b8d3957746['"]?\s*\|\|/, witness,
      'the old Integration base must not be an implicit acceptable consumer head')
  end

  def test_witness_uses_actual_landed_union_evidence_surface
    assert_match(/sampleBoundarySplatFootprintAudit/, witness)
    assert_match(/sampleBoundarySplatGpuProfile/, witness)
    assert_match(/boundarySplatUnionReceipt/, witness)
    assert_match(/sampleFrame/, witness)
    assert_match(/volume-live-nonridge-union-witness\.mjs/, witness)
    assert_match(/volume-layer-coefficient-live-union-witness\.mjs/, witness)
    assert_match(/sampleBoundarySplatLiveUnionOccupancyMissingIsNotBlocker/, witness)
  end

  def test_witness_records_uncapped_layer_counts_and_union_math
    assert_match(/ridgeOnly/, witness)
    assert_match(/nonRidgeOnly/, witness)
    assert_match(/overlap/, witness)
    assert_match(/union/, witness)
    assert_match(/unionCountMismatch/, witness)
    assert_match(/hiddenCapInstalled/, witness)
    assert_match(/requestedCandidateBudget/, witness)
    assert_match(/effectiveCandidateBudget/, witness)
  end

  def test_witness_records_cost_overdraw_memory_and_route_identity
    assert_match(/selectorGpuMs/, witness)
    assert_match(/splatRasterGpuMs/, witness)
    assert_match(/projectedFootprintPixels/, witness)
    assert_match(/meanDepthComplexity/, witness)
    assert_match(/peakDepthComplexity/, witness)
    assert_match(/candidateBufferBytes/, witness)
    assert_match(/peakGpuBufferBytes/, witness)
    assert_match(/candidateBufferBytesAuthority/, witness)
    assert_match(/peakGpuBufferBytesAuthority/, witness)
    assert_match(/routeIdentity/, witness)
    assert_match(/supportIdentity/, witness)
    assert_match(/coefficientIdentity/, witness)
    assert_match(/covarianceIdentity/, witness)
  end

  def test_witness_preserves_two_anchor_population_discrepancy_and_causal_fields
    assert_match(/integrationAnchor/, witness)
    assert_match(/tigerImportedStateAnchor/, witness)
    assert_match(/populationRatio/, witness)
    assert_match(/627/, witness)
    assert_match(/stateWitnessSha256/, witness)
    assert_match(/controlSha256/, witness)
    assert_match(/stableNativeCellIdSha256/, witness)
    assert_match(/sourceFieldManifest/, witness)
    assert_match(/sourceHashes/, witness)
    assert_match(/unresolvedCausalDifference/, witness)
  end

  def test_witness_rejects_false_evidence_paths_and_preserves_failure_reports
    assert_match(/fallbackRoute/, witness)
    assert_match(/overflowOrCopy/, witness)
    assert_match(/blankOrPartialReport/, witness)
    assert_match(/failed-before-primary-output/, witness)
    assert_match(/lastTrustworthyEvidence/, witness)
    assert_match(/writeReport\(failure\)/, witness)
  end
end
