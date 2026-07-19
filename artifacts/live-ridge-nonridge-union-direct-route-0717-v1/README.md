# Live Ridge/Non-Ridge Union Direct Route

This artifact proves the exact operator URL on repaired source `86f8468d609c55aa7ad434511df277a8ac77e03c`. The witness loaded that URL directly and measured no post-load control or composition mutation.

- Requested/effective splat mode: `kernel_moment_full_flame_union`.
- Effective route/backend: `native-3d-compute-fluid-raymarch-v0`, `WebGPU:apple`.
- Effective composition: `smoke-raymarch-under-splats-v0`.
- Applied passes: raymarch encoded/applied; splat encoded/applied.
- Candidate counts: `3612` union, `2993` Non-Ridge-only, `619` overlap, `0` Ridge-only.
- Overflow/fallback/control substitutions: `0` / none / none.
- Initial/final control SHA-256: `0aaf9e054316288a6e4c665f2cde7c896878269da5a6f86c20fed268f892021a` / identical.
- Initial/final composition SHA-256: `0c64e70faabcc366ba76a3bbc506b0c06c60cfab7e7e479a469135da7197ac62` / identical.
- Visible pixels: `250719/645120` (`38.8639%`), mean luma `23.4165`, maximum `255`.
- Screenshot SHA-256: `01b281aa9f2e7cf162a5455f1a5c23d2841086bd54fa912ea2ef2d99a6490d88`.

`report.json` is the authority for requested/effective controls, pass application, candidate identities, source maturity, backend, route, and failure state. `full-flame-live-union-direct-route.png` is the inspected operator-visible canvas. The image is nonblank and contains a blue-white flame with broad smoke, but the flame is overexposed; this artifact proves route and pass correctness, not visual parity or tuned appearance.

## Review Disposition

Three bounded Codex/GPT-5.5 regression cycles ran after Gemini failed without review output due `IneligibleTierError`. Cycle one found two material witness false-closure holes: literal no-mutation claims and recorded-but-unasserted renderer/pass identity. Both were accepted and fixed by measured initial/final control and composition hashes plus exact renderer, raymarch-applied, and splat-applied assertions. Cycle two found no material code issue but rejected stale review-head metadata; the probolē was corrected. Cycle three proposed that the direct live-route witness should also freeze frame/simulation state and perform the zero-gradient mutation. That candidate is rejected as a predicate conflation: this witness must preserve live advancement and perform no post-load mutation, while the separate same-state mechanism witness owns the zero-gradient falsifier. The review cap is reached with no accepted material finding remaining and that scope distinction preserved as the residual review smell.
