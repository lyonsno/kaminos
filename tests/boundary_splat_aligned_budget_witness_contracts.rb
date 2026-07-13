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

  def test_aligned_pair_uses_native_gpu_readback_not_cdp_screenshot
    aligned_sequence = @witness[/async function captureAlignedBudgetSequence[\s\S]*?\n}\n\nasync function captureAlignedBudgetRendererReadback/, 0]
    refute_nil aligned_sequence
    native_readback = @witness[/async function captureAlignedBudgetRendererReadback[\s\S]*?\n}\n\nasync function captureRenderer/, 0]
    refute_nil native_readback
    assert_match(/captureAlignedBudgetRendererReadback/, @witness)
    assert_match(/sampleFrame\(\{[\s\S]*advanceSim:\s*false[\s\S]*includeRgba:\s*true/, @witness)
    assert_match(/readAlignedBudgetRgbaChunks/, @witness)
    assert_match(/aligned-budget-native-gpu-readback-chunked-v0/, @witness)
    assert_match(/sample\.image\.rgba\s*=\s*null/, @witness)
    assert_match(/gpu-frame-texture-rgba8-readback/, @witness)
    assert_match(/writeRgbaPng/, @witness)
    assert_match(/nativeReadbackAuthority/, @witness)
    assert_match(/aligned-budget-native-gpu-readback-v0/, @witness)
    assert_match(/captureAuthority:\s*'native-gpu-readback'/, @witness)
    refute_match(/captureRenderer/, aligned_sequence)
    refute_match(/Page\.captureScreenshot/, aligned_sequence)
    refute_match(/writeRgbaPng\([^)]*sample\.image\.rgba/, native_readback)
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

  def test_aligned_pair_certifies_its_own_sequence_motion_not_analytic_repeat_noise
    assert_match(/sequenceCertification/, @witness)
    assert_match(/certifyAlignedBudgetSequence/, @witness)
    assert_match(/aligned-budget-learned-sequence-certification-v0/, @witness)
    assert_match(/certifiedMotionSequenceCount/, @witness)
    assert_match(/certifiedFramePairCount/, @witness)
    assert_match(/minMotionMeanAbsDiff/, @witness)
    assert_match(/aligned-budget live motion rejected/, @witness)
    assert_match(/aligned-budget quality summary missing/, @witness)
    aligned_false_closure = @witness[/function rejectAlignedBudgetFalseClosure[\s\S]*?\n}\n\nfunction validateAlignedBudgetCapture/, 0]
    refute_nil aligned_false_closure
    assert_match(/certifyAlignedBudgetSequence/, aligned_false_closure)
    refute_match(/frozenDeterminism/, aligned_false_closure)
    refute_match(/analytic-splat-determinism-repeat/, aligned_false_closure)
  end

  def test_failure_reports_keep_last_trustworthy_pair_evidence
    assert_match(/lastTrustworthyEvidence\.alignedBudgetPair/, @witness)
    assert_match(/failurePhase\s*=\s*'aligned-budget-capture'/, @witness)
    assert_match(/failurePhase\s*=\s*'aligned-budget-false-closure-validation'/, @witness)
    assert_match(/sourceAuthority:\s*SOURCE_AUTHORITY/, @witness)
    assert_match(/expectedLearnedModelIdentity:\s*EXPECTED_LEARNED_MODEL/, @witness)
  end
end
