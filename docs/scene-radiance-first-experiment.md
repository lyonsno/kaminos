# Shared scene lighting: design for the first experiment

Status: September 30 distributed-source implementation experiment. The September 27 point-source experiment is rejected as an approximation of this flame following the operator's gain sweep. The accepted direct fire appearance and authored kiln remain the baseline. This file describes the current experiment, not a claim of visual success or affordability.

## Purpose

Make authored scene light reach both kiln surfaces and participating smoke through the actual geometry. Extend that mechanism to environment illumination, distributed flame emission, and a first diffuse surface bounce after its shared transport semantics are exercised.

The consumer is the operator's Cheap Blast Furnace kiln, including changes across the basin's flow range. The existing clean simple kiln is available for geometric isolation, but is not a substitute for that consumer.

## Findings that affect the design

- Branch base is Kaminos main `09bd5641611eaf58fba9dc1e71787f49b802f724`, unchanged at the September 27 fetch. Four owned tall-light dependency commits precede the two new CPU visibility/transfer commits. The latter have no live rendering integration.
- The authored refractory GLB has 287,407 triangles. A Node run of the initial object-heavy BVH took 516.36 ms to extract triangle records, 13,391.09 ms to build, and 153.69 ms for 10,000 rays in one upward ray pattern. Heap was 401.17 MiB and process RSS 627.38 MiB. These include input/intermediate allocations; the ray pattern does not establish general query performance. Mesh: `/Users/noahlyons/.local/share/kaminos/dark-side-kiln-0925/generated-meshes/f8e6ce918e3e5cf234d186724dc21b40b3f9cf7cbc9e776000cf55f24801c91b.glb`.
- Solid visibility is static for fixed geometry and source/sample positions. Smoke extinction is dynamic. Cached geometric coefficients alone cannot represent the full light path.
- The current fire-to-mesh atlas applies white balance and exposure before averaging. The smoke material coefficients precede those operations and use internally relative radiometric units. They are not interchangeable source buffers.
- Main's smoke transport is the six-direction solve. Handy has a separate 24-direction candidate and owns its internal transport. This experiment should consume a narrow external-light seam without choosing or replacing that solver.
- Mesh environment light already exists through Three. A later geometry-visible environment contribution must replace the corresponding diffuse component, rather than silently add another copy. Specular environment reflection is a separate consumer.

## Proposed architecture

Share source definitions, coordinate/length conventions, solid visibility, and medium transmittance. Retain consumer-specific reduction: surface irradiance includes the receiver cosine and enters its material response; current isotropic smoke uses angular-mean incident radiance in the scattering term. Keep display exposure and white balance at explicit consumer display boundaries.

Preparation stores geometry visibility; live GPU work updates source values and medium transmittance. A surface's first reflected radiance subsequently becomes another area source with its represented area, normal, reflectance and direction. This preserves the same path contract without requiring mesh and smoke to share one interpolated RGB field.

The initial BVH is a reference for selected geometry queries. Its current build cost does not justify either optimizing it immediately or committing the interactive architecture to it.

### Current experiment: distributed emission, two real consumers

Use the live raw flame-material emission/extinction lattice, before display exposure, as the source. Integrate incident radiance along receiver rays until the first actual solid surface, accumulating emission and dynamic medium transmittance along the way. Surface receivers reduce the directions with the cosine and solid-angle weights; isotropic smoke receivers use their angular mean. This replaces, rather than adds to, the geometry-blind internal flame scattering contribution on the opt-in experiment route.

Cache first-solid distances for fixed mesh vertices and smoke-grid receivers using the existing double-sided triangle visibility reference packed for GPU traversal. Geometry or sampling changes rebuild that cache. A 24-direction antipodal set is the starting approximation; 48 and 96 directions are explicit comparison settings, not established adequate budgets. The source lattice remains 32×64×32; the initial smoke receiving lattice is 16×32×16. Surface lighting is computed at mesh vertices and interpolated. These are consequential approximations: angular misses, undersampled source features, coarse receiving samples near walls, and large low-poly faces may limit quality. A matched held-state comparison must judge them, not simply a nonblank image.

The authored kiln is the assay. Compare distributed transport on/off at the same simulation state; inspect inside and outside, including smoke above the kiln roof. Then choose whether more angular/spatial samples earn their runtime cost. Measure static preparation separately from live work. No point-source fitting, global gain reduction, or mesh edits may substitute for source/visibility fidelity.

Shared raw inputs do not unify mesh and volume display transforms. First reflected surface light, environment integration, skinning, general emitter registration and efficient rigid-motion support are incomplete. Movement currently invalidates a full static cache; it is not a moving-creature capability. Motion remains subordinate to the volume-source problem.

### Previous point-source experiment (historical mechanism, not current flame design)

Proposed source: a fixed point emitter with explicit RGB radiant intensity in the renderer's relative linear convention. Its color/intensity can change live. One point removes area-source sampling from this first decision; it does not establish area-emitter quality. The next source test expands to a finite panel with explicit sample-count comparisons.

Use the existing GPU radial shadow-cube mechanism for the first implementation, cached while source pose and casting geometry remain unchanged. Share its geometric comparison between mesh and smoke. Retain the CPU triangle query as an independent check at selected positions. Resolution/bias remain measured approximation choices, including the known grazing-surface acne risk.

Proposed medium representation: a scalar optical-depth lattice per source over the full tall fluid domain. Each GPU update integrates current extinction from the source to each lattice cell. The mesh and smoke then evaluate `exp(-tau)` from the same lattice. For an outside-volume receiver, intersect the actual source-to-receiver segment with the fluid domain and sample optical depth at its exit. A segment that misses the domain has unit transmittance. Integration uses volume-local length for the current inverse-local-length extinction law; source distance attenuation uses a declared scene coordinate convention. Compare the initial coefficient-cell sampling interval with a halved interval on a held state before choosing runtime resolution. Cube shadow sampling supplies solid occlusion independently of the smooth optical-depth interpolation.

The full tall domain matters: main's existing internal smoke incident grid still describes the lower cube, while the Beaming dependency extends the mesh fire lattice to the tall volume. The new external-light path must report and use the actual full fluid bounds. It does not silently claim to repair Handy's internal transport domain.

Mesh consumption should enter the material lighting calculation. The current post-AO base-color heuristic cannot establish a material-correct shared-light experiment. Smoke consumption adds external incident light to scattering and preserves its existing emission and internal transport. Both paths carry source identity and generation.

Display remains a consequential boundary: the mesh scene exposure and basin smoke exposure/white balance are currently independent. The experiment can establish shared linear input and transport before display, plus visible response in both consumers. Equal displayed brightness or a unified camera response requires a separate explicit display-composition decision; do not conceal this with separately fitted source gains. Record both effective display transforms in the comparison.

### Observations that decide continuation

1. Source off/on and a large color change visibly affect the wall and smoke in the expected places, at a held flame state.
2. Real kiln occluders suppress the corresponding source contribution for both consumers. Selected CPU triangle queries check the cube-map visibility result.
3. With the same geometry cache, changing the live medium changes transmittance. Zero extinction reduces to the unattenuated path; increasing extinction cannot increase direct transmitted light. Do not alter the saved basin for these isolated controls.
4. Traverse the authored flow range and inspect the result in motion. Measure cache preparation separately from live GPU/frame cost.
5. After the direct shared path is useful, evaluate finite-source sampling and one reflected patch using that same path. Environment integration then has a tested receiving mechanism, while its angular sampling and replacement of existing diffuse lighting remain explicit decisions.

This experiment can establish a usable common direct-light path and expose its cost and artifacts. It cannot establish complete environment integration, generalized emitters, full one-bounce quality, or production admission.

## Decision before implementation

Noah approved proceeding after the flame-sidecar and rigid-motion discussions. The primary object is volume-source complexity: live emission/extinction sampling, spatial extent, source approximation, frame identity, and explicit display boundaries. Reuse the flame sidecar's source preparation and lifecycle, not its display-biased, geometry-blind propagated RGB as universal incident light. Exercise its live source reduction through the shared path as well as the controlled source. Preserve the accepted rendering as the comparison.

Rigid motion is subordinate and must consume no more than 20% of representational complexity, per the operator's explicit allocation. This is not a code-line or elapsed-time quota: its only additions are existing rigid transforms, visibility invalidation, and one combined rotation/translation exercise. Re-render the existing shadow cube when required. No hinge representation, joint UI, pose-response cache, static/dynamic cube split, or fluid-boundary implementation is part of this slice. If motion requires another representation or substantial machinery, return the concrete tradeoff to Noah instead of silently expanding scope. Geometry-local motion may change distant shadows; do not assume only nearby receivers need updating.

Recommend the existing GPU shadow mechanism for the first shared-source experiment, with the CPU cache retained as a reference. This revises the earlier preference to improve CPU cache preparation first: the immediate uncertainty is whether both live consumers can use coherent visible/transmitted source light, and the existing GPU mechanism buys that observation sooner. No renderer switch or cache optimization has been implemented under this proposal.

Loop reminder approved by the operator: “Follow the light from its source through real geometry to both surface and smoke.” It applies through this slice and expires at its end.
