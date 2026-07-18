require 'minitest/autorun'
require 'json'
require 'open3'
require 'tmpdir'

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

  def test_witness_supports_mechanism_anchor_without_weakening_production_anchor
    assert_match(/--anchor-class/, witness)
    assert_match(/mechanism-anchor/, witness)
    assert_match(/production-anchor/, witness)
    assert_match(/--mechanism-report/, witness)
    assert_match(/missing-mechanism-report/, witness)
    assert_match(/operator-unseen/, witness)
    assert_match(/productionAnchorPredicateUnchanged/, witness)
  end

  def test_mechanism_anchor_requires_exact_uncapped_tiger_state_120_source
    assert_match(/kaminos\.volume\.layer-coefficient-live-union-witness\.v0/, witness)
    assert_match(/coefficient-state-120-f120-s120/, witness)
    assert_match(/1899742/, witness)
    assert_match(/7ae361b23c60/, witness)
    assert_match(/mechanismAnchorSourceRowsPreserved/, witness)
    assert_match(/mechanismAnchorWrongPopulation/, witness)
    assert_match(/mechanismAnchorWrongState/, witness)
  end

  def test_mechanism_anchor_reports_missing_sockets_instead_of_estimating_them
    assert_match(/missingSocket/, witness)
    assert_match(/unavailable/, witness)
    assert_match(/footprintOrTileIntersections/, witness)
    assert_match(/depthComplexity/, witness)
    assert_match(/sortBinWork/, witness)
    assert_match(/opticalContributionDistribution/, witness)
    assert_match(/projectedFootprintDistribution/, witness)
    refute_match(/estimatedFromCandidateCount/, witness)
  end

  def test_mechanism_anchor_fixture_captures_without_authored_basin_manifest
    Dir.mktmpdir('kaminos-mechanism-anchor-contract') do |dir|
      input_path = File.join(dir, 'mechanism-report.json')
      output_path = File.join(dir, 'report.json')
      File.write(input_path, JSON.pretty_generate(mechanism_report_fixture))

      stdout, stderr, status = Open3.capture3(
        'node',
        witness_path,
        '--anchor-class', 'mechanism-anchor',
        '--mechanism-report', input_path,
        '--out-dir', dir,
        '--report', output_path,
      )

      assert(status.success?, "mechanism fixture should capture\nstdout=#{stdout}\nstderr=#{stderr}")
      report = JSON.parse(File.read(output_path))
      assert_equal('captured', report.fetch('status'))
      assert_equal('mechanism-anchor', report.fetch('anchorClass'))
      assert_equal(true, report.fetch('productionAnchorPredicateUnchanged'))
      assert_equal(1_899_742, report.dig('budgets', 'effectiveCandidateBudget'))
      assert_equal('unavailable', report.dig('mechanismAnchor', 'projectedWork', 'footprintOrTileIntersections', 'status'))
      assert_equal('operator-unseen', report.dig('mechanismAnchor', 'operatorFacingDisposition', 'productionOccupancy'))
    end
  end

  def test_mechanism_anchor_preserves_live_projected_work_sockets_when_source_exposes_them
    Dir.mktmpdir('kaminos-mechanism-projected-work-contract') do |dir|
      input_path = File.join(dir, 'mechanism-report.json')
      output_path = File.join(dir, 'report.json')
      source = mechanism_report_fixture
      source[:conditions][0][:populationAudit].merge!(
        descriptorFrameMetrics: {
          authority: 'gpu-flow-kernel-descriptor-plus-compacted-candidate-readback-v0',
          finiteFrameCount: 1_899_742,
          tangentLengthMin: 0.0125,
          tangentLengthMax: 0.224,
          tangentNormalCrossLengthMin: 0.011,
          tangentNormalCrossLengthMax: 0.219
        },
        projectionMetrics: {
          authority: 'cpu-projected-ellipse-footprint-from-gpu-compacted-candidates-v0',
          positiveClipWCount: 1_812_345,
          centerInFrustumCount: 1_204_321,
          candidateCount: 1_899_742,
          projectedFootprintPixels: 36_543_210.5,
          totalSplatPixelWork: 36_543_210.5,
          meanDepthComplexity: 42.29538252314815,
          depthBinOccupancy: {
            authority: 'clip-z-bin-occupancy-from-projected-candidate-centers-v0',
            binCount: 64,
            occupiedBins: 41,
            meanEntriesPerOccupiedBin: 44_201.09756097561,
            maxEntriesPerOccupiedBin: 88_123
          }
        }
      )
      source[:conditions][0][:render][:boundarySplatGpuProfile] = {
        identity: 'boundary-splat-gpu-profile-v0',
        timestampStatus: 'available',
        timeUnit: 'ms',
        candidateCopyBytes: 0,
        stages: {
          compaction: { status: 'sampled', ms: 1.25 },
          candidateCopy: { status: 'sampled', ms: 0, disposition: 'removed-full-capacity-copy', candidateCopyBytes: 0 },
          indirectSetup: { status: 'sampled', ms: 0.07 },
          splatRaster: { status: 'sampled', ms: 5.75 },
          total: { status: 'sampled', ms: 8.5 }
        }
      }
      File.write(input_path, JSON.pretty_generate(source))

      stdout, stderr, status = Open3.capture3(
        'node',
        witness_path,
        '--anchor-class', 'mechanism-anchor',
        '--mechanism-report', input_path,
        '--out-dir', dir,
        '--report', output_path,
      )

      assert(status.success?, "mechanism projected-work fixture should capture\nstdout=#{stdout}\nstderr=#{stderr}")
      report = JSON.parse(File.read(output_path))
      projected = report.dig('mechanismAnchor', 'projectedWork')
      assert_equal('captured', projected.dig('footprintOrTileIntersections', 'status'))
      assert_equal(1_812_345, projected.dig('footprintOrTileIntersections', 'positiveClipWCount'))
      assert_equal(1_204_321, projected.dig('footprintOrTileIntersections', 'centerInFrustumCount'))
      assert_equal('captured', projected.dig('footprintIntersections', 'status'))
      assert_equal(36_543_210.5, projected.dig('footprintIntersections', 'value'))
      assert_equal('captured', projected.dig('fragmentWork', 'status'))
      assert_equal(36_543_210.5, projected.dig('fragmentWork', 'value'))
      assert_equal('captured', projected.dig('depthComplexity', 'status'))
      assert_equal(42.29538252314815, projected.dig('depthComplexity', 'mean'))
      assert_equal(64, projected.dig('depthBinOccupancy', 'binCount'))
      assert_equal(1.25, projected.dig('buildCost', 'ms'))
      assert_equal(5.75, projected.dig('accumulationCost', 'ms'))
      assert_equal(8.5, projected.dig('renderCost', 'ms'))
      assert_equal('captured', report.dig('mechanismAnchor', 'distributions', 'projectedFootprintDistribution', 'status'))
    end
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

  def mechanism_report_fixture
    {
      schema: 'kaminos.volume.layer-coefficient-live-union-witness.v0',
      status: 'captured',
      requestedUrl: 'http://127.0.0.1:60545/?kaminos_volume_smoke=1',
      route: {
        effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
        backend: 'WebGPU:apple'
      },
      source: {
        sameStateCaptureId: 'coefficient-state-120-f120-s120',
        fieldManifest: { sha256: '2841b79f3ae625bba8b7f36f2b5f7ae40755814b95214a2607a95b3390456483' },
        sourceHashes: {
          fluidSha256: '98d1d0650d67fcdf32f2fc7f5c353bac5355f7df01f45d1e0211c51eb02a7620',
          frontSha256: '27491552ce2c0294125d35658c3dd47289c91d0d068909c0c244e5167d7c7e35',
          boundarySidecarSha256: '33a6943c6a2cb644f244d5edeeb544dbce52d0cef98e3fb9d705abd49b941216',
          majorantSha256: '0b73c83d00b34d7fd2176f3d0709800b5b9a6617f04c736a359c3d30b2d71da1'
        },
        sourceHashAudit: { status: 'matched' },
        importReceipt: {
          initializationAuthority: 'checksum-addressed-live-replay-resume-v0',
          fluidByteLength: 262_144_000,
          frontByteLength: 16_384_000,
          fluidChunkCount: 63,
          frontChunkCount: 4
        },
        state: { frameCount: 120, simStepCount: 120 },
        camera: { position: [0, 0, 1], target: [0, 0, 0] }
      },
      presentation: { camera: { position: [0, 0, 1], target: [0, 0, 0] } },
      conditions: [
        {
          label: 'analytical-exact',
          render: {
            sameStateCaptureId: 'coefficient-state-120-f120-s120',
            boundarySplatMode: 'kernel_moment_full_flame_union',
            boundarySplatRendererIdentity: 'live-ridge-nonridge-union-kernel-moment-covariance-splats-v0',
            boundarySplatAttributeModelIdentity: 'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472',
            boundarySplatCapacity: 2_097_152,
            boundarySplatInitialOverflowCount: 1_768_670,
            boundarySplatCapacityRetryCount: 1,
            boundarySplatFallbackReason: nil,
            flowKernelIdentity: 'flow-tangent-positive-symmetric-trilinear-v0'
          },
          populationAudit: {
            status: 'effective',
            stableNativeCellIdSha256: '995f195f0079108fd9de2b51c3e011fb758af4c0e3a594c2d24b9dcc5306e9f9',
            candidateCount: 1_899_742,
            instanceCount: 1_899_742,
            overflowCount: 0,
            unionReceipt: union_receipt_fixture
          },
          metrics: {
            width: 900,
            height: 960,
            pixelCount: 864_000,
            litPixels: 323_020,
            litPixelRatio: 0.37386574074074075,
            meanLuma: 45.7576173431272,
            maxLuma: 255,
            nonblank: true
          }
        },
        {
          label: 'learned-baseline',
          overlay: true,
          populationAudit: {
            candidateCount: 1_899_742,
            instanceCount: 1_899_742,
            overflowCount: 0,
            lookupMissCount: 0,
            lookupExtraCount: 0
          },
          metrics: {
            width: 900,
            height: 960,
            pixelCount: 864_000,
            litPixels: 263_447,
            litPixelRatio: 0.30491550925925925,
            meanLuma: 37.567134470220175,
            maxLuma: 255,
            nonblank: true
          }
        }
      ]
    }
  end

  def union_receipt_fixture
    {
      effectiveMode: 'kernel_moment_full_flame_union',
      selectorAuthorityEffective: 'explicit-source-field-operator-v0',
      selectorRecipeSha256: '541836e6c45ef014ab0b8be23ebd8dce9898900a7639a0c4e21f38336daef8f9',
      compositionIdentity: 'separate-ridge-nonridge-shared-total-extinction-v0',
      ridgeLayerIdentity: 'authored-ridge-support-coefficient-layer-v0',
      nonRidgeLayerIdentity: 'authored-nonridge-support-coefficient-layer-v0',
      counts: {
        ridgeOnly: 0,
        nonRidgeOnly: 1_775_043,
        overlap: 124_699,
        union: 1_899_742
      },
      fallbackReason: nil
    }
  end
end
