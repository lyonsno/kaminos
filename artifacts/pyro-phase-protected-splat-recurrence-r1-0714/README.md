# Protected Splat Recurrence Witness

Question: Was the long-horizon collapse caused only by predicted candidate attributes feeding back into occupancy, or does the recurrent splat-appearance state have its own attractor?

Result: Both mechanisms are real. Protecting the canonical candidate track removes the catastrophic support break: occupancy no longer consumes predicted appearance, candidate state remains canonical, and support IoU beats identity on all `63/63` recurrent steps. The recurrent nine-channel splat appearance nevertheless loses to copied-current state in every motion-bearing cohort. Normalized state-MSE ratios versus control are Q3 `1.8994`, Q4 `1.7548`, transported `2.2684`, and birth `2.1330`; corresponding energy retention is also lower in all four cohorts. Direct inspection shows the basin envelope remains populated while the predicted orange flame sheet drains toward a dim blue/cyan field with isolated bright residuals.

## Roles And Time

- `REFERENCE`, left: exact held-out target restricted to the registered motion-cohort witness.
- `CONTROL`, middle: copied current state projected onto the exact motion cohorts.
- `PREDICTED`, right: recurrent learned splat appearance on the separately advanced canonical occupancy/support track.
- Frames are one continuous 63-step rollout at `160 ms` per step, from `0.16 s` through `10.08 s`. The videos are finite and do not loop.
- Q1/Q2 static cohorts are attenuated to `0.1` in all roles. The debug video applies a display-only cohort color mix at exact requested/effective gain `0.625`.

## Images And Video

- `protected-splat-recurrence-comparison.mp4`: labeled 63-frame beauty comparison, 960x240, 6.25 fps, 10.08 seconds.
- `protected-splat-recurrence-debug-comparison.mp4`: the same payloads and cadence with the display-only `0.625` cohort mix.
- `beauty-early-middle-late.png`: nine chronological beauty samples. Top row is frames `0,1,2`; middle row is `30,31,32`; bottom row is `60,61,62`. Every tile contains reference/control/predicted from left to right.
- `debug-early-middle-late.png`: identical chronology and role layout under the debug mix.
- `inspection-guide.html`: operator-facing contextual viewer for the videos and images.
- `inspection-guide-smoke.png`: inspected browser capture proving the routed contextual guide loads; it is route/UI evidence, not a research comparator.

## Mechanism Separation

- Candidate state is protected byte-for-byte and never receives recurrent appearance values.
- Occupancy feedback is disabled; the occupancy head consumes only the canonical track.
- Splat appearance remains recurrent across its nine non-position channels.
- Support IoU beats identity on all `63/63` steps; the minimum prediction/identity IoU ratio is `1.033491941850016`.
- Support-count inflation remains an occupancy-only error: final predicted count is `93,365` versus exact `70,612` (`1.3222x`).
- Appearance collapse remains independently: all Q3/Q4/transport/birth state and energy comparisons lose to copied-current control despite the stronger support.

## Exact Identity

- Repo/worktree: `/private/tmp/kaminos-pyro-phase-lag-counterfeiter-0713`
- Branch: `cc/pyro-phase-lag-counterfeiter-0713`
- Protected recurrence implementation: `fa581a3e95c690790488e7e6a809e375cb1dfc88`
- Greenroom job: `b2b14aaf72f8`, completed exit `0`, MLX `Device(gpu, 0)`, null fallback, null timeout.
- Evaluation corpus SHA-256: `d38028655e038df55af0fb5f1c9cfc5c40f3464992ebd26b106c29b234f88c78`
- Training corpus SHA-256: `f1ccbfa37eb90b065d461b54e814b7dd339a9d619b237143669a4371ff6d40b1`
- Occupancy model SHA-256: `e51c23d25eb38ec778c65774aae46c78bbcb02808d582539843417b10043c073`
- Destination-state model SHA-256: `46d7686dd59b192243e35f9e90c94082a1d100478d7e51b5460dc6c6a9eda5d4`
- Prediction report SHA-256: `e3498e6935b32e1c979af927acd0061d79fb25c216f87bddd2a30000c058d56c`
- Motion-cohort audit SHA-256: `84531388ff33e09080a997fd66c3d8127f54e3527597514cbcd1ea513c2e4729`
- Beauty video SHA-256: `48d7adba7b8723c44d2d8ad73db5d39a9a9fb38dda57a38b90dddb214b3418dd`
- Debug video SHA-256: `9f64f2adf0eeffe57640485424d502cdcbb19c8d3ebcb61ce040f329cc326ea6`

## Claim Boundary

This establishes two separable failure mechanisms on one held-out live basin under the isolated offline splat raster: candidate-to-occupancy feedback caused the earlier support collapse, and recurrent splat appearance has an independent exposure-bias/energy attractor. It does not establish analytical-raymarch image error, multi-basin generalization, a successful rollout-aware remedy, or runtime uptake. The positive product-shaped evidence remains the independently evaluated one-step prediction; this recurrent route is negative evidence for uncorrected free rollout.
