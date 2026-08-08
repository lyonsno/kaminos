# K4 envelope frame sensitivity

The existing frame-link receipt stopped at its 120-iteration budget with
`converged:false`, even though it already placed 99.15% of sampled authored
skeleton surface inside the envelope. This assay continues that exact solver,
with the same scale lock, same 2,000 samples, same source and envelope bytes,
and a 360-iteration allowance.

The solver converges at iteration 189. The result is not a meaningfully
different frame: translation moves by only `3.43e-7` envelope units and the
largest rotation-matrix entry changes by `1.38e-8`. Skeleton containment stays
at 99.15% with the same 17 outside samples.

Applying the converged frame to Packer's exact reference carrier and exact
envelope-fit metric changes none of the four per-construction inside fractions.
The largest mean signed-distance change is `5.05e-8`; the largest outside-
excursion change is `1.66e-7`, or `3.48e-7` relative to the affected base
excursion.

Disposition:

`FORMAL_NONCONVERGENCE_NOT_MATERIAL / SHAPE_DOMINATED_UNDER_EXACT_SOLVER_CONTINUATION`

This closes only the live question of whether the existing solver's formal
nonconvergence could plausibly explain the current K4 residual. It does not
prove the anatomically correct frame, equivalence to an alternate registration
objective, body-interior envelope fit, authored muscle shape, or production
admission.

Replay custody is content-addressed in `frame-sensitivity.json`: the exact
Bytebound frame receipt and envelope, Mushfinger skeleton and frame-link solver,
Packer carrier and signed-distance metric, effective branch revisions, and all
file identities are recorded. The raw extended solver transform and every
per-construction before/after metric row are preserved there.
