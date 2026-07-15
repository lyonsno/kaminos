# Aggressive rs010 residual sweep

Post-freeze residual sweep artifacts for the latest-main Kaminos fire/smoke route.

This sweep exposed a false-evidence route in the frozen same-state browser witness: residual models could load and report telemetry while `renderFrozenScaleToCanvas` skipped the residual pass. The repo now has a contract test preventing that regression, and `same-state-browser-smoke-fixed/` contains the corrected evidence.

`existing-latest-main-direct/` stores the browser-exported candidates used by the fixed witness. The fixed visual result is a negative product verdict but positive routing verdict: the candidates are active, not inert, but they push flame brightness/speckle and smoke suppression rather than matching the same-state native reference.

Follow-on code in this branch adds material-focused training support so fire/interface and smoke residual specialists can be trained and composited instead of forcing one direct kernel to satisfy both visual targets.
