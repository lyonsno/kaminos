# Source-shaped K4 packing perturbation — experimental interpretation

## Campaign question

Does the current M34/M13/M12/M45 candidate formation respond in an ordered,
mechanically intelligible way when only interior crowding increases, and is the
existing packing mechanism capable of resolving that pressure without moving
attachments or losing target volume?

This is an experimental-track result. The selected centerlines, endpoint
identities, and target volumes remain measured candidates. The compartment,
central obstacle, unit treatment, and perturbation are agent-authored
provisional assumptions. The result does not claim operator authorship,
anatomical truth, production admission, or final source fidelity.

## Assay

The exact ordered routes are M34, M13, M12, and M45. All three conditions use
the same candidate geometry, candidate target volumes, data-derived enclosing
box, central centroid capsule, solver configuration, and fixed endpoints. Only
interior centerline samples move toward their per-knot cohort centroid:

- baseline: 0% inward movement;
- mild: 12%;
- moderate: 24%.

The primary result is deterministic and byte-identical on replay. Editing any
parent-atlas row after hashing, even outside the selected subset, invalidates
the run. Changing the requested routes preserves the caller's exact order and
does not fall back to this K4 selection.

## Result

The input pressure is ordered. Pairwise penetration rises from 5.582 at
baseline to 5.772 at mild and 6.459 at moderate. The solver's response is also
ordered: mean interior displacement rises from 0.679 to 0.775 to 0.875, while
maximum displacement rises from 1.263 to 1.328 to 1.381.

The invariant handling is strong. Every condition preserves fixed endpoints,
restores target volume exactly, remains inside the provisional compartment,
and produces no non-finite positions or non-positive radii. Skeletal-obstacle
penetration falls by roughly 79%, 81%, and 82% respectively.

The formation does not pack. Every condition reaches the 640-iteration limit.
Pairwise penetration falls by only about 20%, 23%, and 31%, leaving residuals
of 4.445, 4.448, and 4.462. The three outputs nearly collapse to the same high
residual despite their different initial pressures.

## Budget discrimination

This is not an arbitrary 640-iteration cutoff. Doubling the budget to 1,280
iterations leaves residual pairwise penetration at 4.465, 4.462, and 4.469.
Increasing the relaxation step from 0.18 to 0.30 at 640 iterations leaves it at
4.444, 4.448, and 4.463. Neither change materially improves or differentiates
the packed state.

## Interpretation

The assay answers the first campaign question partially and usefully:

- the fixture produces ordered pressure;
- the solver produces ordered displacement and preserves the hard invariants;
- the solver can relieve the synthetic skeletal obstacle;
- the current source-shaped four-muscle formation is not pairwise feasible for
  this mechanism at the measured candidate volumes and fixed attachment
  geometry.

The strongest supported reading is a limit of this formation under the current
projection mechanism, not a source-authority blocker and not a hidden
iteration-budget limit. It does not yet distinguish an infeasible volume/pose
combination from a missing per-construction allocation degree of freedom.

The immediate consumer experiment is therefore Packer's independently selected
per-construction axial/azimuthal occupancy allocation on this exact fixture,
followed by Golden's measured and pixel-level shape-retention classification.
That comparison can decide whether the synthetic mechanism ranking transfers
to current K4. If allocation also collapses to the same high residual, the next
probe is the feasibility separatrix: scale only candidate target volumes or
test pair subsets while keeping attachment geometry fixed. No branch predicate
is promoted before that consumer exercise.
