# frozen_string_literal: true

require "minitest/autorun"

ROOT = File.expand_path("..", __dir__)

class BoundarySplatAlignedBudgetWitnessContracts < Minitest::Test
  def setup
    @witness = File.read(File.join(ROOT, "volume-boundary-splat-motion-witness.mjs"))
  end

  def test_aligned_budget_pair_route_is_explicit_and_narrow
    assert_match(/kaminos\.volume\.boundary-splat-aligned-budget-pair\.v0/, @witness)
    assert_match(/volume_boundary_splat_aligned_budget_pair/, @witness)
    assert_match(/parseAlignedBudgetPair/, @witness)
    assert_match(/ALIGNED_BUDGET_PAIR\s*=\s*\[6400,\s*1600\]/, @witness)
    assert_match(/ALIGNED_BUDGET_INSTANCE_COUNT\s*=\s*100/, @witness)
    assert_match(/aligned-budget-pair requires exact 100 instances/, @witness)
    assert_match(/aligned-budget-pair requires exact 6400\/1600 budgets/, @witness)
  end

  def test_pair_captures_same_state_budgets_and_costs
    assert_match(/captureAlignedBudgetPair/, @witness)
    assert_match(/alignedBudgetPair/, @witness)
    assert_match(/sameStateCaptureId/, @witness)
    assert_match(/baselineBudget/, @witness)
    assert_match(/testBudget/, @witness)
    assert_match(/boundarySplatRequestedCandidateBudget/, @witness)
    assert_match(/boundarySplatEffectiveCandidateBudget/, @witness)
    assert_match(/boundarySplatSelectedCandidateCount/, @witness)
    assert_match(/boundarySplatSelectorPolicyIdentity/, @witness)
    assert_match(/selectorPlusRasterMs/, @witness)
    assert_match(/splatRasterMs/, @witness)
    assert_match(/selectorGpuMs/, @witness)
    assert_match(/MIXED_CURRENT_AND_LIVE_HISTORY_PHASE_SOURCE\s*=\s*'mixed-current-and-live-history-offset'/, @witness)
  end

  def test_pair_reports_quality_loss_and_rejects_false_closure
    assert_match(/budgetQualityComparisons/, @witness)
    assert_match(/retainedLightRatio/, @witness)
    assert_match(/coverageRetainedRatio/, @witness)
    assert_match(/structuralMeanAbsDiff/, @witness)
    assert_match(/meanLumaDelta/, @witness)
    assert_match(/litPixelsDelta/, @witness)
    assert_match(/costRatio/, @witness)
    assert_match(/rejectAlignedBudgetFalseClosure/, @witness)
    assert_match(/aligned-budget stale requested\/effective budget/, @witness)
    assert_match(/aligned-budget selector policy disagreement/, @witness)
    assert_match(/aligned-budget fallback rejected/, @witness)
    assert_match(/aligned-budget copy\/overflow rejected/, @witness)
    assert_match(/aligned-budget blank\/partial evidence rejected/, @witness)
  end

  def test_failure_reports_keep_last_trustworthy_pair_evidence
    assert_match(/lastTrustworthyEvidence\.alignedBudgetPair/, @witness)
    assert_match(/failurePhase\s*=\s*'aligned-budget-capture'/, @witness)
    assert_match(/failurePhase\s*=\s*'aligned-budget-false-closure-validation'/, @witness)
    assert_match(/sourceAuthority:\s*SOURCE_AUTHORITY/, @witness)
    assert_match(/expectedLearnedModelIdentity:\s*EXPECTED_LEARNED_MODEL/, @witness)
  end
end
