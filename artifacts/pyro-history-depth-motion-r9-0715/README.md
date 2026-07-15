# Continuous truthful-history depth motion R9

Question: How does one live learned-splat fire behave when 100 instances address truthful archived candidate states at history depths 16, 32, 64, and a freshly measured upper depth?

Result: Depths 16, 32, and 64 each produced a coherent finite 63-frame motion witness over 10.08 seconds from one continuing simulator, one browser, and one page. All physical slots were GPU-verified initialized; all frames were distinct and nonperiodic; overflow, candidate-copy, and fallback remained zero. The fresh stability-selected depth 543 initialized all 543 slots and remained visually coherent for 29 captured frames, but the runtime changed effective history depth from 543 to zero before frame 30. A freshly measured maximum is therefore not a stable ten-second operating depth under live candidate churn. Depth 64 is the deepest completed stable row in this witness.

## Interpretation

- depth-16-motion.mp4, depth-32-motion.mp4, and depth-64-motion.mp4 are serial portions of one continuing live simulator episode. They are not simultaneous same-frame A/B renders.
- Every visible instance is backed by a truthful live-history candidate slot. These are not learned future predictions, copied frames, or a looping clip.
- The complete videos support judging motion diversity, phase separation, and coherence. Low-frequency brightness differences between depth rows cannot be attributed to depth alone because simulator time continues between rows.
- The depth-543 anchors show valid frames 1, 15, and 29. There is intentionally no frame 30: runtime validation observed effective depth zero before that screenshot could be accepted.

## Route

- Repo: /private/tmp/kaminos-pyro-phase-lag-counterfeiter-0713
- Branch/head: cc/pyro-phase-lag-counterfeiter-0713@93731b9
- Greenroom job: b4d5a75f8ee7
- Job type: kaminos_boundary_splat_history_depth_motion_witness
- Backend/device: WebGPU:apple
- Effective renderer: live-boundary-sidecar-learned-attribute-splats-v0
- Model: sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472
- Source authority: live-baked-sidecar-plus-fluid-material-v0
- Composition/phase: boundary-splat-composed-field-v0, age-sweep-history, phase stride 5, history frame stride 8
- Camera: history-depth-motion-fixed-camera-v0
- Capture: 63 frames, 160 ms request cadence, 6.25 fps encoding, 10.08 seconds, 1800x1746
- Timeout/fallback: null/null

Exact submission:

    /Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom submit kaminos_boundary_splat_history_depth_motion_witness 'http://127.0.0.1:8139/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_boundary_sidecar_source=baked&volume_boundary_splat_mode=learned&volume_boundary_splat_instances=100&volume_boundary_splat_composition=field&volume_boundary_splat_pbr_scene=fire-field&volume_boundary_splat_phase_mode=age-sweep&volume_boundary_splat_phase_stride=5&volume_boundary_splat_history_depth=16&volume_boundary_splat_history_frame_stride=8&volume_boundary_splat_radius=1.0&volume_boundary_splat_sharpness=3.4&volume_render_scale=1&history_ring_smoke=16&volume_boundary_splat_lod_mode=projected-area&volume_boundary_splat_candidate_budget=0&buffer_integrity_witness=pyro-history-depth-motion-r9-0715' /private/tmp/kaminos-history-depth-motion-r9-0715 --cwd /private/tmp/kaminos-pyro-phase-lag-counterfeiter-0713 -p history_depths=16,32,64 frames=63 frame_ms=160 chrome_port=19441 settle_ms=4000 warmup_samples=3 steady_samples=12 window_size=1280,960

## Evidence map

- inspection-guide.html: operator-facing contextual motion and anchor guide.
- depth-{16,32,64}-motion.mp4: complete non-looping live motion rows.
- anchors/depth-{16,32,64}-frame-{0001,0032,0063}.png: inspected early/middle/terminal anchors for each complete row.
- anchors/depth-543-frame-{0001,0015,0029}.png: inspected valid frames before abrupt runtime depth loss.
- metrics-summary.json: compact quantitative and route evidence.
- receipts/history-depth-motion-report.json: full durable witness report, including last trustworthy evidence.
- receipts/request.json and receipts/receipt.json: Greenroom requested/effective route and null-timeout receipt.
- SHA256SUMS: hashes for every preserved evidence file.

## Claim boundary

This proves coherent, temporally distinct truthful-history motion through depth 64 on one live basin and falsifies a single fresh measured upper depth as a stable ten-second control point. It does not isolate depth causally at matched simulator time, compare against an analytical raymarch, prove learned future prediction, establish multi-basin behavior, authorize runtime uptake, or show that depth 64 is the maximum stable depth.
