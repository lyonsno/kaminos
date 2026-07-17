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
  end

  def test_witness_requires_exact_pushed_integration_consumer_head
    assert_match(/--expected-integration-head/, witness)
    assert_match(/missing-expected-integration-head/, witness)
    assert_match(/stale-integration-consumer-head/, witness)
    assert_match(/boundarySplatLiveUnionConsumerHead/, witness)
    refute_match(/174c06af5c17bb31a1310ce0cfa7d4b8d3957746['"]?\s*\|\|/, witness,
      'the old Integration base must not be an implicit acceptable consumer head')
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
    assert_match(/routeIdentity/, witness)
    assert_match(/supportIdentity/, witness)
    assert_match(/coefficientIdentity/, witness)
    assert_match(/covarianceIdentity/, witness)
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
