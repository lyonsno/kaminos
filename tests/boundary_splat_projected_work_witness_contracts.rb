require 'minitest/autorun'

class BoundarySplatProjectedWorkWitnessContracts < Minitest::Test
  ROOT = File.expand_path('..', __dir__)

  def witness_path
    File.join(ROOT, 'volume-boundary-splat-projected-work-witness.mjs')
  end

  def witness
    @witness ||= File.exist?(witness_path) ? File.read(witness_path) : ''
  end

  def test_projected_work_witness_exists_and_declares_assignment_schema
    assert(File.exist?(witness_path), 'Census must own the authored-basin projected-work witness')
    assert_match(/kaminos\.boundary-splat\.authored-basin-projected-work\.v0/, witness)
    assert_match(/authored-basin-same-state-projected-work-v0/, witness)
    assert_match(/operator-explored-splat-experiment-protocol/, witness)
  end

  def test_witness_requires_authored_same_state_inputs
    assert_match(/--authored-basin-manifest/, witness)
    assert_match(/--sample-report/, witness)
    assert_match(/missing-authored-basin-manifest/, witness)
    assert_match(/missing-sample-report/, witness)
    assert_match(/sameStateIdentityMismatch/, witness)
    assert_match(/sameRouteIdentityMismatch/, witness)
    assert_match(/sameControlIdentityMismatch/, witness)
    assert_match(/operatorExplored/, witness)
    assert_match(/operator-authored-production-basin-anchor/, witness)
  end

  def test_witness_rejects_reduction_policy_and_preserves_source_rows
    assert_match(/sourceRowsPreserved/, witness)
    assert_match(/preserveAllSourceRows/, witness)
    assert_match(/hiddenCapInstalled/, witness)
    assert_match(/requestedCandidateBudget:\s*'uncapped'/, witness)
    assert_match(/reductionPolicyAllowed:\s*false/, witness)
    refute_match(/candidateBudget\s*=\s*Math\.min/, witness)
    refute_match(/slice\(0,\s*\d+\)/, witness)
  end

  def test_witness_records_projected_work_frontier_accounting
    assert_match(/projectedSurvivors/, witness)
    assert_match(/footprintIntersections/, witness)
    assert_match(/fragmentWork/, witness)
    assert_match(/overlap/, witness)
    assert_match(/depthBinOccupancy/, witness)
    assert_match(/sortCost/, witness)
    assert_match(/accumulationCost/, witness)
    assert_match(/memory/, witness)
    assert_match(/buildCost/, witness)
    assert_match(/renderCost/, witness)
    assert_match(/reuseCadence/, witness)
  end

  def test_witness_rejects_false_evidence_paths_and_writes_failure_report
    assert_match(/fallbackRoute/, witness)
    assert_match(/overflowOrCopy/, witness)
    assert_match(/blankOrPartialReport/, witness)
    assert_match(/staleOrCachedOutput/, witness)
    assert_match(/failed-before-primary-output/, witness)
    assert_match(/lastTrustworthyEvidence/, witness)
    assert_match(/writeReport\(failure\)/, witness)
  end
end
