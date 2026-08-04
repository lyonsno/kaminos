# Current-graph K4 endpoint-taper mechanism assay

Endpoint taper is a useful precursor, not a packing solution.

The authenticated constant-radius K4 source is infeasible before iteration because four fixed attachment cross-sections overlap. A smooth arc-length taper with requested endpoint multiplier `0.26`, transition fraction `0.2`, and per-muscle global-radius volume compensation opens that preflight without moving attachments, changing construction identity, or changing target volume. Its effective endpoint multiplier is `0.294517814091` after volume compensation.

The native 640-iteration projection then reduces pairwise penetration from `5.660462595456` to `0.008182726482` and skeletal penetration from `1.012273272329` to `6.276e-9`. Those are real route-local improvements, but the solve still terminates `continuous-clearance-failed`. More importantly, it reaches the small residual by introducing 20 source-curvature reversals, a minimum source-curvature cosine of `-0.985986701573`, maximum source displacement of `1.945691256023`, and minimum pairwise-relation cosine of `0.582182119734`.

The visual witness makes the failure legible. The taper removes the endpoint blocker cages and the packed output creates distinct lanes, but the carriers become faceted blades; the purple construction hooks near its lower attachment; teal and yellow kink; and the cluster reads as a geometric fan rather than plausible compartment anatomy. This candidate is rejected for anatomical admission.

The next assay should preserve this exact source identity, taper, attachment coordinates, target volumes, obstacle, and compartment while changing only centerline allocation. The first choice is the already implemented source-frame or curvature-preserving projection. Its fail condition is explicit: if materially reduced overlap cannot coexist with zero curvature reversals and removal of the visible attachment hook, endpoint taper plus current carrier resolution is insufficient and the redirect moves to a richer centerline or cross-section representation.
