# Flow-carried distributed illumination for flame — design draft

Status: provisional reconstruction of Noah's November 16–17 design discussion, awaiting his edits and explicit confirmation that those edits are complete. This records an intended architecture and open decisions; it does not authorize implementation of every component or replace the existing owners' contracts. The [particle-fetched prequel source audit](particle-fetched-prequel-source-audit_2026-11-17.md) distinguishes implemented mechanisms from this proposal.

The objective is affordable distributed illumination that stays in phase with the reactive Lagrangian flame, especially the glow on nearby material. Dense visible material, source discovery, receiver density, fresh transport work, and output reconstruction resolution are independently controlled. Shared motion should make an observation useful to several predictions over several updates. A successful result must show that evolving illumination, not merely reduce an isolated numerical error.

## 1. The representations and their relationship

The proposed system carries five related objects:

1. **Source discovery:** a sparse inventory of current luminous neighborhoods, with a power-related ranking and coverage information.
2. **Rich source packets:** local cohorts of actual material contributors, retaining independent emission and extinction through combustion and motion.
3. **Ordered optical observations:** fresh straight-path measurements with transverse support and longitudinal sections; their transported versions locate reusable evidence.
4. **Shared coarse extinction hypotheses:** positive spatial primitives fitted from observations crossing the same material from different directions, with evidence of where predictions are usable.
5. **Moving receivers and reconstruction:** flow-carried probes with persistent illumination histories, coverage-driven succession, and spatial reconstruction onto the visible material.

The shared extinction model joins information across observations without requiring every observation to notify every other observation. Ordered observations retain the information needed to interpret a correction and recognize which local model version a current prediction depended on. Neither object replaces the other.

Current source state, acquired evidence, and predicted illumination remain distinguishable. Updating the model changes a prediction associated with a path; it does not rewrite what the original acquisition measured.

## 2. Discovering sources without requiring discovery samples to cover the image

A discovery point locates a region worth acquiring. It does not need enough neighbors to render that region by itself. Once a promising point is found, acquisition accesses the denser underlying material population locally. Sparse discovery and reducing the simulation's actual population are different operations.

Discovery should search the dimensions in which the initial proposals leave gaps. Birth time and subsequent flow/stretch can explain spatial gaps, but this does not mean tracing only forward along one particle trajectory. Follow-up offsets should search current material near the missing portions. The result is a current local source neighborhood, not an emitter stretched through multiple historical times.

The source inventory is based on intrinsic emission and represented support. It remains independent of a particular receiver's latest blocked result. A bright emitter hidden by a blocker stays eligible when the blocker becomes uncertain. Coverage/exploration must admit new sources and sources absent from the retained inventory; weighting cannot recover a contribution with no acquisition route.

The existing area-times-interval power proxy is a starting ranking, not a settled physical volume measure. Before treating a sparse cohort as a replacement integral, specify what each representative represents, its selection rule, and its weight. Enlarging support and multiplying density without that declaration can change total brightness as well as spatial smoothing.

## 3. Rich source packets through partial burnout

A packet has an addressable identity, finite spatial support, an anchor/reference frame, member identities and weights, and current optical state. An anchor gives the packet continuity and a coordinate frame; its chemistry does not stand in for all members.

The first contender retains a small cohort of real contributors and reads their current positions, independent reaction states, intrinsic emission, and extinction. Counts such as 10, 25, or 50 are tuning candidates, not established sufficient budgets. The desired modal reuse of roughly 5–15 simulation updates is also a hypothesis.

Use actual member positions expressed relative to a current packet frame. This accounts for common motion once and preserves relative motion. A fitted local deformation may guide support and lifecycle, but applying it again to already-advected world positions would be a separate geometric distortion. Deliberate smoothing remains possible if declared and judged by its effect on illumination.

Emission and extinction evolve together. During burnout, one part can remain bright while another becomes predominantly extinctive. A single chemistry multiplier on a collapsed old RGB/transmission pair cannot generally express this redistribution. Retaining a small spatial cohort permits a current directional evaluation without reconstructing the whole source neighborhood every frame.

All receivers query the same packet state and version. Their directional integrals can differ. The source packet is shared material, not one universal receiver-facing transfer value.

Retirement depends on meaningful remaining contribution, contributor turnover, spread/deformation, and the usefulness of the approximation. One luminous straggler need not preserve an otherwise useless packet indefinitely. A retired emitting packet can identify a region worth acquiring for the blocker model; it does not automatically become an authoritative extinction primitive.

### Source and exterior attenuation ownership

Packet extinction must compose with exterior material exactly once. Two candidate contracts remain open:

- Retain ordered packet contributions and combine them with the exterior observation in depth order.
- Give a packet ownership of a complete finite interval for that query and exclude that interval from the exterior evaluation.

The second contract is insufficient if exterior and packet material interpenetrate in ways it cannot represent. Source-local self-attenuation cannot be multiplied by an exterior transfer that already contains the same self-attenuation. Selecting the first implementation requires a concrete overlap/depth example.

## 4. Fresh acquisition and transported evidence

Fresh acquisition must support arbitrary source–receiver directions. Six globally shared directions are an earlier diagnostic and do not meet this requirement. Angular count, transverse samples, longitudinal sections, receiver count, source count, and refresh count remain independently adjustable.

A fresh observation identifies its receiver, source or source support, straight path, transverse footprint, ordered depth intervals, simulation/material version, and any world visibility. It measures current optical coefficients or segment transfers with a declared measure. The acquisition backend remains open: culled particle bundles, a current optical grid march, or a hybrid. The grid-driving simulation does not necessarily contain the independently evolved particle reaction detail.

The observation's carried centerline can curve and fold. It records how material evidence moved. The current physical light connection remains straight. Reuse compares the carried evidence/support with that current connection and judges whether enough correspondence remains. No exact angular correction or blend between old and current reference frames has been selected.

Relative source, receiver, and blocker motion matters more directly than distance alone. A nearby shearing relationship may deteriorate faster than a long rigidly translating one. Reaction changes optical state even without geometric drift; world-fixed solids can change visibility even under coherent fluid translation.

Ordered segment transfers compose near to far: the nearer segment contributes its own emitted radiance and transmits a fraction of what follows; transmissions multiply. This supports replacing a prediction for one segment without reacquiring every other segment. A collapsed whole-path transmission cannot identify which fraction belonged to an invalidated region.

### Intervening emission

Every query must declare whether it estimates one selected source's contribution or all emission along a directional footprint. For a selected source, intervening material can supply attenuation while its emission is accounted for by other source samples. A complete directional integral includes that emission itself. Mixing these meanings loses or double-counts light.

Sampling a far source must not automatically terminate at the first bright tongue and permanently omit what lies behind it. Source discovery and the estimator must preserve the chosen contribution domain. Keeping multiple rich sections along a path remains an extension if a source-only scheme cannot do this affordably.

## 5. Coarse extinction model and fitting

Begin with roughly fixed-scale spherical or ovoid positive extinction primitives. Scale is a live control. Their purpose is a useful coarse prediction, not inference of detailed material topology. A finite family of such primitives gives observations from different angles a common field to constrain.

For extinction-only measurements, each crossing constrains the sum of primitive optical-depth contributions along its observed support. The known crossing geometry supplies each primitive's influence. Fitting seeks nonnegative strengths consistent with several crossings. A path discrepancy is not automatically assigned to the nearest primitive, and repeating observations from nearly the same geometry does not add the same independence as a new crossing.

The local fitting procedure, regularization, weighting, association radius and synchronization schedule remain open. Original footprint/depth information must survive pooling sufficiently to keep measurements comparable. A finite transverse bundle measures an average of optical responses; converting its average transmission to one optical depth does not make it identical to the average of individual optical depths. The fit must declare which quantity it explains.

Use three evidence states, potentially expressed through fields rather than three object types:

- **Supported prediction:** observations support an optical estimate at a stated scale and range of crossings. This includes evidence of small attenuation.
- **Observed but inadequately represented:** observations exist, but the chosen primitive cannot reliably predict their optical response.
- **Unknown or invalidated:** the current local model lacks usable evidence.

Unknown is not transparent. Evidence of weak attenuation can be stored sparsely along observed supports; this does not require allocating a fine dense representation of empty space. Missing evidence and a supported near-zero prediction must remain distinguishable.

## 6. Motion, reliability and lifecycle

Material prediction, transported correspondence and learned usability belong to the same local model version. Basic motion/deformation checks are part of lifecycle in the first contender. Retire or reduce trust when the local approximation can no longer describe its transported support. Resetting a primitive resets its inherited confidence; its location or surviving anchors may still be useful for reacquisition.

Later extensions can track anisotropic unreliability: how prediction errors vary with crossing direction, position within support, footprint scale, connection extent, and age. These features describe where the model is useful. They need not invent missing sheets or detailed negative-space geometry. A persistent directional mismatch and unpredictable variation should have different consequences.

Do not learn angular structure from evidence already explained by bad motion correspondence without first accounting for that motion. Strong deformation can destroy the relevance of old reliability features along with the material fit.

Receivers check model dependencies lazily when using a prediction. Invalidating a region need not push notifications to every affected receiver. Ordered observations allow unaffected portions to remain useful. The explicit policy for displaying/using an unsupported remainder—retained estimate, coarse fallback, or sampled correction—still needs selection; absence of a fresh sample must not silently mean zero transmission or zero light.

## 7. Allocation and statistical accounting

There are distinct reasons to spend work: discover a source, estimate its received contribution, improve a reusable model, or repair an important stale prediction. A blocker has no universal importance independent of source–receiver relationships. A regional priority can aggregate consequential affected relationships and expected reuse, while retaining the possibility that different directions matter differently.

Refresh priority considers potential unblocked source contribution, uncertainty in transmission/source state, expected improvement and reuse, and acquisition cost. A reliable dense blocker can require little work; an uncertain blocker hiding a bright source can require much more. A complex region is not automatically worth extra samples merely because it is complex, nor automatically negligible because the model cannot represent it.

The following statistical choices are not settled implementation details:

1. The contribution domain and measure sampled by each ray and source packet.
2. Selection probabilities, overlapping source ownership and weights.
3. Accounting for correlated reused observations and inherited receiver histories.
4. Whether the shared model supplies a direct approximate answer, a baseline with sampled residual corrections, or only sampling guidance in each regime.
5. A coverage mechanism for contributions absent from the current inventory.

Adaptive proposals can produce useful fresh evidence. Record the prediction before incorporating that evidence; do not validate a fit solely against the observations it just fitted. A separate universal testing-only ray budget has not been selected. Sampling corrections require their own probability/weight accounting; importance weighting alone does not remove errors from stale geometry or a biased optical surrogate.

## 8. Moving receivers, support and succession

Choose receiver anchors from existing live material near desired coverage locations. A coarse spatial scaffold organizes coverage; it need not be a connected deforming grid. Probe identities persist with material, while coverage is maintained across the current occupied region.

Identify a successor before the outgoing probe leaves useful support or expires. Local velocity and deformation can predict who will occupy the needed neighborhood; the accuracy/cost of prospective selection remains to be evaluated. Gaps can open anywhere through stretch, not only at the bottom where material enters.

During handover retain both positions, histories and spatial supports. Each lookup weights probes according to its actual position and the probes' lifecycle participation, then normalizes. Smooth lifecycle weights prevent sudden membership changes; normalization prevents extra donors from multiplying brightness. However, normalizing all probes does not by itself prevent a successor pair from gaining disproportionate influence relative to other probes: the pair must share the intended coverage responsibility. The detailed rule is an open first-build choice.

This is compatible with averaging. Collapsing two probes into one value at a nominal cell center before reconstruction discards their spatial information. Using their two locations does not require sophisticated edge preservation or a claim of resolving detail beyond available samples. If the supported field should be coarse, ordinary averaging is appropriate. When both probes acquire independently, retain that information; copying one history into its successor does not create a second independent observation.

A fine lookup/deposition grid is an optional acceleration structure, distinct from the coarse coverage scaffold. Deposit weighted illumination and support weight separately; normalize at lookup and represent unsupported cells explicitly. Fine lookup resolution preserves the selected reconstruction but cannot create missing illumination observations. Current direct indexed gather is a valid initial comparison and may avoid building another grid.

A very coarse Eulerian fallback remains a contender until moving receiver coverage is demonstrated. Removing it is an evidence-based choice, not implied by the existence of many particles. Sparse optical material can still occupy large support or produce meaningful extinction.

## 9. External illumination and diffuse attenuation

Use source–receiver correspondence to decide reuse. Internal flame light often benefits from co-motion. External sources remain in their proper world frame; the in-volume evidence can still be transported. Static sources do not remove changes in world visibility or in the material crossing their current straight connections.

Intrinsic flame light, external incident light and already-scattered light remain separate quantities. Fine material scatters the reconstructed incident term once. Approximate external lighting may use a different spatial/angular budget, but no universal coarse-resolution guarantee follows from it being external.

Fresh queries see diffuse attenuation as well as dense blockers. Retained observations must preserve the measured total effect even when the explicit model omits it. Direct tracing of only the blocker model can omit broad attenuation, so that mode must be visibly compared. A separate diffuse residual field is deferred; the design does not require inventing its neighborhoods or causal attribution before seeing whether it is useful.

## 10. First candidate and deferred work

The first candidate should expose arbitrary-direction fresh queries, sparse source discovery with local acquisition, small current-state source cohorts, ordered observations, positive coarse blocker fitting with unknown/weak-attenuation states, basic flow/deformation lifecycle, and moving receiver coverage with succession. Reuse the existing reconstruction first; measure the need for finer deposition. Preserve fixed receivers, fresh-only transport, held history and coarse fallback as comparisons.

Source-internal/exterior extinction ownership and estimator weights must be made concrete before the complete build. The source audit identifies supporting infrastructure; it does not settle these choices.

Deferred: learned directional residual/usability features; more elaborate deformation and support inference; multiple rich path regions; adaptive source hierarchies; sheet fitting; negative correction kernels; an explicit diffuse attenuation model; prediction of source chemistry independent of actual members. These have different status: directional reliability is a planned extension, while sheets/negative kernels/independent chemistry are unselected alternatives.

## 11. What would establish progress

Use recorded evolving states and identical inputs across comparisons. Show the illumination on the actual flame/smoke, with an explicit view of the shared model's predicted attenuation and resulting glow. Phase consistency, biased streaks, source dropout, self-shadow evolution and handover flicker are primary observations.

An expensive reference using the same coarse representation separates representation limits from budget limits. Separately, a more resolved optical calculation assesses fidelity to the admitted material. More angular samples alone do not certify convergence. Keep the emitter and receiver material identical when comparing extinction models.

Measure acquisition, current-member gathering, packet evaluation, model fitting, receiver maintenance, reconstruction, memory and synchronization separately, then together. A small cohort's cheap storage does not establish cheap directional evaluation across every receiver. Performance runs use the shared Greenroom admission route.

The next bounded design decision is the source packet's concrete optical measure and depth-composition contract. The source audit is intended to let Noah refine this draft before a new implementation is selected.
