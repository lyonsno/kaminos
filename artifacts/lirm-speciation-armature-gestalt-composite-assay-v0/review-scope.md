# Gestalt Composite Assay Review Scope

This review covers the authored implementation and contract tests for the silhouette-bounded creature-armature composite, image-generation plan validation, Trellis promotion validation, and durable timing receipts. Generated images, meshes, SVG witnesses, and bulk JSON evidence remain outside the code-review surface; their visual inspection and route/hash validation are recorded in the assay report.

Load-bearing predicates:

- silhouette pressure modifies a three-dimensional implicit body while retaining the procedural armature as an independently measurable contributor;
- depth, normal, mask, semantic, and Trellis-source outputs derive from the same bounded composite field rather than unrelated projections;
- plan and completion validators reject route drift, input drift, output substitution, missing files, hash mismatch, partial completion, and missing timing data;
- effective route identity remains distinct from requested route identity wherever fallback or stale registration could alter execution;
- generated reports preserve enough exact evidence to reproduce and audit image-generation and Trellis promotion decisions;
- tests assert stable contracts rather than merely accepting nonblank artifacts.

Primary risks are silent false closure, stale-route acceptance, malformed evidence being reported as complete, semantic drift between the 3D composite and its control maps, and accidental coupling between internal morphology terminology and generator-facing prompt vocabulary.
