# Analytical Elbow Positive-Volume C(P0)

`c-p0.json` is the exact matched solver receipt for the frozen smallest P0
cage. It runs one objective, solver, budget, line-search policy, hard-veto
evaluator, source, topology, embedding, and boundary contract from two exact
initializations: the admitted Row W projection and neutral rest nodes with the
authored boundary transforms applied.

The objective contains no Row W target coordinates. It minimizes mean squared
rest-edge log strain plus a signed-cell-volume barrier using deterministic
central-difference descent and backtracking for `80` iterations.

Both final states are structurally lawful. The W-derived run improves q95
absolute log edge strain from the scalar control's `0.1348103998679601` to
`0.10567458674815311`, so it is a numerical candidate. The neutral run repairs
two initially inverted cells but ends at `0.23095745605266535`, so it is lawful
without clearing the improvement predicate. This is basin sensitivity, not a
general solver or mechanism closure.

Exact artifact SHA-256:

```text
4facc5ba2d018fce24d749966f46c4041ee95279cd5d31e642024a0ad90f4005
```

Two independent CLI executions were byte-identical.

Regenerate with:

```bash
node analytical-elbow-positive-volume-c-p0.mjs \
  --output artifacts/analytical-elbow-positive-volume-c-p0-v0/c-p0.json
```

## Claim Ceiling

This receipt establishes matched P0 solver basin evidence on one synthetic
`35`-degree sleeve. It does not establish visual improvement, neutral-basin
discovery, P1 behavior, `80`-degree behavior, generated transfer, anatomy,
whole-object motion, Track M, production deformation, or product admission.
