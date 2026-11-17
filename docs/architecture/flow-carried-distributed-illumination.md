# Flow-carried distributed illumination for flame — design draft

Status: design draft updated on November 17 with Noah's subsequent decisions, including material-derived blocker construction and core/shell receiver succession. Noah has requested implementation decomposition while retaining representative selection and the combination of direct material information with ray evidence as live design work. Sections 10–12 distinguish the first integrated experiment, extensions and independently implementable prerequisites. These are proposed handoff boundaries, not launched assignments or claims of implemented behavior. The [particle-fetched prequel source audit](particle-fetched-prequel-source-audit_2026-11-17.md) distinguishes existing mechanisms from this proposal.

The objective is affordable distributed illumination that stays in phase with the reactive Lagrangian flame, especially the glow on nearby material. Dense visible material, source discovery, receiver density, fresh transport work, and output reconstruction resolution are independently controlled. Shared motion should make an observation useful to several predictions over several updates. A successful result must show that evolving illumination, not merely reduce an isolated numerical error.

## 1. The representations and their relationship

The proposed system carries five related objects:

1. **Source discovery:** a sparse inventory of current luminous neighborhoods, with a power-related ranking and coverage information.
2. **Rich source packets:** local cohorts of actual material contributors, retaining independent emission and extinction through combustion and motion.
3. **Ordered optical observations:** fresh straight-path measurements with transverse support and longitudinal sections; their transported versions locate reusable evidence.
4. **Shared coarse extinction hypotheses:** coarse material representations initially derived from retained cohorts where available, then tested, corrected or supplemented by observations crossing the material from different directions, with evidence of where predictions are usable.
5. **Moving receivers and reconstruction:** flow-carried probes with persistent illumination histories, coverage-driven succession, and spatial reconstruction onto the visible material.

The shared extinction model joins information across observations without requiring every observation to notify every other observation. Ordered observations retain the information needed to interpret a correction and recognize which local model version a current prediction depended on. Neither object replaces the other.

Current source state, acquired evidence, and predicted illumination remain distinguishable. Updating the model changes a prediction associated with a path; it does not rewrite what the original acquisition measured.

The principal new construction hypothesis is continuity from emitting to predominantly extinctive material. We already paid to acquire and follow a source neighborhood, including its non-emitting contributors. Its changing optical state can seed the blocker model without first rediscovering its location by inverse fitting. This makes material compression the preferred starting route where cohorts exist. It preserves the cross-direction ray model's purpose: learning beyond the cohorts, checking compression error, and sharing improvements between receivers. Cohort coverage of useful blockers is an experimental question, not an assumption that every blocker was once one of our selected emitters.

## 2. Discovering sources without requiring discovery samples to cover the image

A discovery point locates a region worth acquiring. It does not need enough neighbors to render that region by itself. Once a promising point is found, acquisition accesses the denser underlying material population locally. Sparse discovery and reducing the simulation's actual population are different operations.

Discovery should search the dimensions in which the initial proposals leave gaps. Birth time and subsequent flow/stretch can explain spatial gaps, but this does not mean tracing only forward along one particle trajectory. Follow-up offsets should search current material near the missing portions. The result is a current local source neighborhood, not an emitter stretched through multiple historical times.

The source inventory is based on intrinsic emission and represented support. It remains independent of a particular receiver's latest blocked result. A bright emitter hidden by a blocker stays eligible when the blocker becomes uncertain. Coverage/exploration must admit new sources and sources absent from the retained inventory; weighting cannot recover a contribution with no acquisition route.

The existing area-times-interval power proxy is a starting ranking, not a settled physical volume measure. Before treating a sparse cohort as a replacement integral, specify what each representative represents, its selection rule, and its weight. Enlarging support and multiplying density without that declaration can change total brightness as well as spatial smoothing.

The intended discovery target is spatial coverage of the flamebody at a chosen implicit resolution: broad luminous regions reliably represented, medium features represented coarsely, and fine-feature omissions made observable. This is distinct from allocating more queries to a powerful source. A broad acquisition neighborhood may recover material that a sparse seed did not itself represent; inflating the seed's display footprint cannot do so. The phase classifier can identify candidate burning/afterglow material, but does not supply a coverage distribution or weights. Do not assume stretch alone explains root-heavy sampling: acquisition policy, birth/overwrite age and reaction also affect it.

## 3. Rich source packets through partial burnout

A packet has an addressable identity, finite spatial support, an anchor/reference frame, member identities and weights, and current optical state. An anchor gives the packet continuity and a coordinate frame; its chemistry does not stand in for all members.

The first contender retains a small cohort of real contributors and reads their current positions, independent reaction states, intrinsic emission, and extinction. Counts such as 10, 25, or 50 are tuning candidates, not established sufficient budgets. The desired modal reuse of roughly 5–15 simulation updates is also a hypothesis.

Use actual member positions expressed relative to a current packet frame. This accounts for common motion once and preserves relative motion. A fitted local deformation may guide support and lifecycle, but applying it again to already-advected world positions would be a separate geometric distortion. Deliberate smoothing remains possible if declared and judged by its effect on illumination.

Emission and extinction evolve together. During burnout, one part can remain bright while another becomes predominantly extinctive. A single chemistry multiplier on a collapsed old RGB/transmission pair cannot generally express this redistribution. Retaining a small spatial cohort permits a current directional evaluation without reconstructing the whole source neighborhood every frame.

All receivers query the same packet state and version. Their directional integrals can differ. The source packet is shared material, not one universal receiver-facing transfer value.

Retirement depends on meaningful remaining contribution, contributor turnover, spread/deformation, and the usefulness of the approximation. One luminous straggler need not preserve an otherwise useless packet indefinitely. Track emission and extinction participation separately. Useful emission can end while useful extinction persists, and both roles coexist during burning. Membership counts establish participation; weighted optical strengths and support establish whether the role matters. Two counters alone are not a power estimate or a blocker fit.

The preferred contender compresses retained material into blocker candidates during this changeover. It uses current measured extinction, rather than treating burnout as proof that material becomes opaque. A source packet can cease receiving source-sampling budget while its material continues to support a useful extinction estimate. This avoids a forced delete-and-rediscover cycle. Missing members, bad optical measure or loss of spatial coherence can still require reacquisition or a reset to unknown.

Packet identity is acquisition and reuse bookkeeping. It is not a promise that the members remain one compact physical object. A cohort that stretches into separate clumps may need several blocker primitives, or may cease to be a useful approximation. Source grouping and blocker grouping need not be identical. The first experiment must expose this transition rather than silently keeping an increasingly huge ellipsoid alive.

### Overlapping acquisitions

Packets can acquire the same live member or overlapping represented material. Stable-ID deduplication identifies repeated members; it does not by itself remove overlapping representative weights or overlapping supports. Before adding packet contributions as material, define ownership or a partition of represented contribution so that overlapping discoveries do not multiply emission or extinction. Overlapping sampling proposals are also possible, but require explicit probability/weight accounting for the same underlying contribution; they do not justify summing duplicate physical density. A packet may reference shared contributors without owning a duplicate physical quantity. The selection/weighting rule and how ownership changes remain live design questions here.

The population under rich tracking is the acquired subset. A working range discussed is roughly 50–300 source packets with 10–50 members each, or 500–15,000 references before sharing. These are experiment settings, not established sufficiency or hard limits. They do not imply inspecting or copying the full simulation population for every source query.

### Source and exterior attenuation ownership

Packet extinction must compose with exterior material exactly once. Two candidate contracts remain open:

- Retain ordered packet contributions and combine them with the exterior observation in depth order.
- Give a packet ownership of a complete finite interval for that query and exclude that interval from the exterior evaluation.

The second contract is insufficient if exterior and packet material interpenetrate in ways it cannot represent. Source-local self-attenuation cannot be multiplied by an exterior transfer that already contains the same self-attenuation. Selecting the first implementation requires a concrete overlap/depth example.

## 4. Fresh acquisition and transported evidence

Fresh acquisition must support arbitrary source–receiver directions. Six globally shared directions are an earlier diagnostic and do not meet this requirement. Angular count, transverse samples, longitudinal sections, receiver count, source count, and refresh count remain independently adjustable.

A fresh observation identifies its receiver, source or source support, straight path, transverse footprint, ordered depth intervals, simulation/material version, and any world visibility. It measures current optical coefficients or segment transfers with a declared measure. The acquisition backend remains open: culled particle bundles, a current optical grid march, or a hybrid. The grid-driving simulation does not necessarily contain the independently evolved particle reaction detail.

**The agreed evidence discretization is uniform world-space interval length.** The primitive/evidence scale is a live control; the number of intervals grows with observed ray length, with a clipped final interval. It is not a fixed number of intervals stretched across every connection. This keeps clear and attenuating stretches comparable and gives pooled crossings a common spatial scale. Acquisition quadrature and evidence intervals are separate: an interval may require several fine contributions to measure, even though it stores one coarse constraint.

Record actual interval endpoints and transverse support. An optical-depth measurement constrains an integral over that support; it does not assert that material sits at the midpoint. Preserve meaningful transverse variation instead of collapsing it before the fit can interpret it. The precise stored statistics must match the acquisition backend and fitting loss; per-transverse-sample transmission is a useful reference representation, not a decision that every production path stores every sample forever.

The observation's carried centerline can curve and fold. It records how material evidence moved. The current physical light connection remains straight. Reuse compares the carried evidence/support with that current connection and judges whether enough correspondence remains. No exact angular correction or blend between old and current reference frames has been selected.

Relative source, receiver, and blocker motion matters more directly than distance alone. A nearby shearing relationship may deteriorate faster than a long rigidly translating one. Reaction changes optical state even without geometric drift; world-fixed solids can change visibility even under coherent fluid translation.

Ordered segment transfers compose near to far: the nearer segment contributes its own emitted radiance and transmits a fraction of what follows; transmissions multiply. This supports replacing a prediction for one segment without reacquiring every other segment. A collapsed whole-path transmission cannot identify which fraction belonged to an invalidated region.

### Intervening emission

Every query must declare whether it estimates one selected source's contribution or all emission along a directional footprint. For a selected source, intervening material can supply attenuation while its emission is accounted for by other source samples. A complete directional integral includes that emission itself. Mixing these meanings loses or double-counts light.

Sampling a far source must not automatically terminate at the first bright tongue and permanently omit what lies behind it. Source discovery and the estimator must preserve the chosen contribution domain. Keeping multiple rich sections along a path remains an extension if a source-only scheme cannot do this affordably.

## 5. Coarse extinction model and fitting

The model's purpose is a useful coarse prediction, not recovery of detailed material topology. Roughly fixed-scale spherical or ovoid positive kernels remain the simplest contender, with scale exposed live. Direct access to cohort material opens alternatives that were less plausible when only crossing integrals were available. The primitive family and number per material group are not yet selected.

There are three different fits to keep distinct:

1. **Material compression:** given selected contributors, their current geometry, optical coefficients and declared weights, produce a cheaper representation of their extinction and possibly emission.
2. **Motion correspondence:** compare a cohort's acquired and current configurations to estimate common translation, rotation/deformation and unexplained residual motion. This supports reuse and lifecycle; it does not simulate chemistry or restore particles toward their acquired shape.
3. **Optical correction:** compare fresh interval measurements against predictions from the shared approximation and revise supported parameters or usability. This must account for omitted material, overlap and measurement footprints.

### Candidate material approximations

| Representation | Construction and useful property | Main question for this experiment |
| --- | --- | --- |
| Direct retained cohort | Fetch selected members' current states and evaluate their admitted supports. | Reference for compression of this cohort, not ground truth for material omitted at acquisition. Query cost grows with members and connections. |
| One positive ellipsoidal kernel | Accumulate weighted strength, center and covariance, including members' own support. | Fast moments, but a smooth body can fill holes or connect separated clumps and change transmission substantially. |
| A small mixture of positive kernels | Partition contributors, maintain moments within groups, and reconsider grouping when geometry or optical mismatch demands it. | Can preserve separation; grouping, overlap weights and membership changes remain design work. |
| A packet-local optical grid | Deposit selected material in a local frame and query that field. | Flexible, but building, deformation and sampling may erase expected savings. An alternative, not the first default. |

Moment accumulation is a concrete inexpensive-looking fitting family to examine first. It requires a declared optical weight: an acquired depth interval and projected footprint are not already a proven direction-independent volume measure. Separate emission and extinction strengths and, when needed, centers/spreads. Their distributions can differ sharply during burnout. Neither covariance nor an ellipsoid's visual fit establishes preservation of directional transmission.

A small mixture need not run a general iterative clustering solve every frame. Acquisition-time groups with current moments and a measured reason to regroup are a contender. Fixed scale can serve as a target for grouping rather than a demand that every distorted acquisition remain one primitive. The tradeoff between a compact model and handling separated material remains ours to work out.

Analytically integrable extinction kernels can supply optical depth without rasterizing every primitive for every connection. Emission plus self-extinction additionally depends on depth order and overlap; an analytic extinction query does not solve that integral. Shared preparation of geometry, coefficients and bounds is straightforward to propose. Reusing an already resolved raster footprint across receivers needs a declared angular/spatial validity rule, which has not been chosen. Fetching current members once per update and evaluating the prepared state for many receivers must remain separate cost categories.

### Combining material and ray evidence

Use current retained material to propose initial strengths and support where it exists. Fresh crossing observations test the optical prediction over their actual intervals, including material absent from the retained subset. Regions without useful cohorts can still be proposed or learned from crossing evidence. **How these information sources are weighted, associated and corrected remains live design work.** We have not selected a global optimizer, guaranteed a unique inversion, or decided that every residual is a material-strength error.

For extinction-only measurements, each crossing constrains the sum of primitive optical-depth contributions along its observed support. The known crossing geometry supplies each primitive's influence. Fitting seeks nonnegative strengths consistent with several crossings. A path discrepancy is not automatically assigned to the nearest primitive, and repeating observations from nearly the same geometry does not add the same independence as a new crossing.

The local fitting procedure, regularization, weighting, association radius and synchronization schedule remain open. Original footprint/depth information must survive pooling sufficiently to keep measurements comparable. A finite transverse bundle measures an average of optical responses; converting its average transmission to one optical depth does not make it identical to the average of individual optical depths. The fit must declare which quantity it explains.

Direct material state and observations reconstructed from the same state are related evidence, not independent confirmations that can multiply confidence. Low attenuation observed along a crossing supports that crossing at its footprint and scale; it does not certify the whole surrounding region as empty.

Use three evidence states, potentially expressed through fields rather than three object types:

- **Supported prediction:** observations support an optical estimate at a stated scale and range of crossings. This includes evidence of small attenuation.
- **Observed but inadequately represented:** observations exist, but the chosen primitive cannot reliably predict their optical response.
- **Unknown or invalidated:** the current local model lacks usable evidence.

Unknown is not transparent. Evidence of weak attenuation can be stored sparsely along observed supports; this does not require allocating a fine dense representation of empty space. Missing evidence and a supported near-zero prediction must remain distinguishable.

## 6. Motion, reliability and lifecycle

Material prediction, transported correspondence and learned usability belong to the same local model version. Basic motion/deformation checks are part of lifecycle in the first contender. Retire or reduce trust when the local approximation can no longer describe its transported support. Resetting a primitive resets its inherited confidence; its location or surviving anchors may still be useful for reacquisition.

The audit found instantaneous velocity-gradient/stretch diagnostics, not stored deformation history. A compact motion representation therefore remains new work. A local fit from retained member positions or sampled velocity gradients is plausible. It must expose degenerate geometry and residual motion rather than asserting a well-determined deformation from too few or nearly collinear members. The first use is lifecycle and correspondence. Detailed propagation of anisotropic optical residuals is deferred. Stretch along one axis is not by itself a volume change or a rule for increasing optical weight.

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

Use an inner core and outer shell around each Eulerian coverage site. The core marks good local support. As the current carrier leaves it, enters the outer shell or approaches loss of validity, the site advertises a successor vacancy. Nearby eligible material can offer itself using current proximity, velocity and survival information. A candidate moving toward the site can reserve the vacancy; actual subsequent location confirms useful coverage. This is local forward recruitment, replacing the earlier proposal to search backward through turbulent trajectories for a predicted future occupant.

Recruitment should reuse a suitable existing nearby-particle pass where practical: a particle queries nearby coverage sites that need a representative, rather than every site searching the whole simulation. A single claimant wins a vacancy. Define release when it dies, misses the support region or otherwise loses eligibility, and allow current in-core candidates to fill an uncovered site immediately. Motion estimates guide offers; they do not guarantee arrival. Gaps can open anywhere through stretch, not only near the inlet.

Core/shell radii, recruitment lead and handover duration are tunable. Geometry and measured support drive lifecycle. Adding a local check to an existing full-population pass still adds cost, including memory access and claim contention; it is not free because the pass already exists. The implementation must avoid a particle-by-site cross product and report incremental work.

During handover retain both positions, histories and spatial supports. Each lookup weights probes according to its actual position and the probes' lifecycle participation, then normalizes. Smooth lifecycle weights prevent sudden membership changes; normalization prevents extra donors from multiplying brightness. However, normalizing all probes does not by itself prevent a successor pair from gaining disproportionate influence relative to other probes: the pair must share the intended coverage responsibility. The detailed rule is an open first-build choice.

This is compatible with averaging. Collapsing two probes into one value at a nominal cell center before reconstruction discards their spatial information. Using their two locations does not require sophisticated edge preservation or a claim of resolving detail beyond available samples. If the supported field should be coarse, ordinary averaging is appropriate. When both probes acquire independently, retain that information; copying one history into its successor does not create a second independent observation.

A fine lookup/deposition grid is an optional acceleration structure, distinct from the coarse coverage scaffold. Deposit weighted illumination and support weight separately; normalize at lookup and represent unsupported cells explicitly. Fine lookup resolution preserves the selected reconstruction but cannot create missing illumination observations. Current direct indexed gather is a valid initial comparison and may avoid building another grid.

A very coarse Eulerian fallback remains a contender until moving receiver coverage is demonstrated. Removing it is an evidence-based choice, not implied by the existence of many particles. Sparse optical material can still occupy large support or produce meaningful extinction.

## 9. External illumination and diffuse attenuation

Use source–receiver correspondence to decide reuse. Internal flame light often benefits from co-motion. External sources remain in their proper world frame; the in-volume evidence can still be transported. Static sources do not remove changes in world visibility or in the material crossing their current straight connections.

Intrinsic flame light, external incident light and already-scattered light remain separate quantities. Fine material scatters the reconstructed incident term once. Approximate external lighting may use a different spatial/angular budget, but no universal coarse-resolution guarantee follows from it being external.

Fresh queries see diffuse attenuation as well as dense blockers. Retained observations must preserve the measured total effect even when the explicit model omits it. Direct tracing of only the blocker model can omit broad attenuation, so that mode must be visibly compared. A separate diffuse residual field is deferred; the design does not require inventing its neighborhoods or causal attribution before seeing whether it is useful.

## 10. First candidate and deferred work

The intended first integrated experiment combines arbitrary-direction fresh queries, sparse discovery with local acquisition, small current-state cohorts, uniform-world-length observations, material-derived coarse blocker candidates tested against ray evidence, basic flow/deformation lifecycle, and moving receiver coverage with succession. Reuse the existing reconstruction first; measure the need for finer deposition. Preserve fixed receivers, fresh-only transport, held history and coarse fallback as comparisons.

Build this in increments that answer different questions:

1. **Reusable prerequisites:** current cohort gathering, current spatial candidates, receiver succession, and interval/evidence plumbing. These can consume supplied memberships, weights and optical values without choosing the unresolved estimation policy. Exercise each with its actual downstream module, using controlled inputs where the material model is still absent.
2. **Current source and blocker experiment:** choose an explicit representative/weight contract, retain source-local extinction, and compare direct cohorts with candidate compressed material through motion and burnout. Include overlapping acquired neighborhoods. This is where packet optical ownership and the first material fit must become concrete. We retain these decisions in the current design conversation.
3. **Integrated reuse experiment:** connect fresh observations, shared model updates, lazy history validation and allocation to receivers across the field. Compare visible phase, coverage and self-shadow evolution at equal total work. A locally plausible packet is insufficient evidence for this stage.

The core-and-shell succession, separate emission/extinction participation, and uniform-world-length evidence intervals are selected directions. The primitive family, representative weights, optical overlap ownership, fitting/correction rule and estimator are still proposals to settle while the prerequisites are built. None of these remaining choices requires postponing independent plumbing, but all are material to claiming an integrated lighting result.

Planned later work: learned directional usability/residual features, improved deformation/support inference, more sophisticated proposal allocation, and optional finer lookup deposition if reconstruction cost warrants it. They should consume the same material/observation identity and validity distinctions.

Unselected alternatives: multiple rich source sections per query, adaptive source hierarchies, packet-local optical grids, sheet fitting, negative correction kernels, a separate diffuse attenuation model, or chemistry evolved independently of actual members. They are not silently included in the first build. Direct model answers, model baselines with sampled corrections, and guidance-only use remain comparison modes; choosing one estimator and its probability accounting is still necessary before making statistical accuracy claims.

## 11. What would establish progress

Use recorded evolving states and identical inputs across comparisons. Show the illumination on the actual flame/smoke, with an explicit view of the shared model's predicted attenuation and resulting glow. Phase consistency, biased streaks, source dropout, self-shadow evolution and handover flicker are primary observations.

An expensive reference using the same coarse representation separates representation limits from budget limits. Separately, a more resolved optical calculation assesses fidelity to the admitted material. More angular samples alone do not certify convergence. Keep the emitter and receiver material identical when comparing extinction models.

Measure acquisition, current-member gathering, packet evaluation, model fitting, receiver maintenance, reconstruction, memory and synchronization separately, then together. A small cohort's cheap storage does not establish cheap directional evaluation across every receiver. Performance runs use the shared Greenroom admission route.

The unresolved central experiment is whether a small current cohort, compressed with declared weights and overlap ownership, remains a useful source and then a useful blocker long enough to pay for acquisition. The separate shared-model experiment asks whether fresh observations improve other current predictions cheaply enough. Both must be visible in the evolving field, not inferred from a good fit on the very observations used to construct it.

## 12. Implementation decomposition and proposed handoffs

This section names outcomes and consumers so Noah can assign work. No lane has been launched by this document. The existing source audit supplies the implementation starting points; it is revision-specific and each owner must check the code on its chosen base before editing. Module names locate responsibility, not an instruction to seize another lane's active edits.

### A. Receiver coverage and core/shell succession — strongest independent handoff

**Outcome:** persist useful moving receivers while maintaining coverage near stationary sites, with smooth spatial handover and explicit uncovered regions. The consumer is the incident-light reconstruction used by visible material.

**Starting mechanisms:** `volume-packet-network.mjs` already retains receiver keys; `volume-particle-packet-incident.mjs` already reconstructs at actual receiver positions with normalized support. New work is coverage ownership, local candidate offers, vacancy claims/releases and lifecycle weights.

**Inputs:** current candidate identity/position/velocity/eligibility, coverage sites and radii, and illumination histories supplied by the current transport path or a controlled field. This outcome does not depend on choosing source representatives or a blocker fitting family.

**Composition:** exercise outgoing and incoming probes together through the existing reconstruction. Preserve both spatial locations and share the site's intended support responsibility. Candidate velocity is a recruitment hint; observed location determines participation. A candidate turning away or a recycled slot cannot retain the vacancy indefinitely or inherit an unrelated history.

**Evidence:** translation, shear and divergent flow must expose the coverage behavior, not just successful claims. Show constant supplied illumination remaining constant through handover, a varying supplied field using both actual positions, explicit gaps, and recovery after candidate loss. Then inspect the same mechanism with live material and the existing lighting route. Report incremental candidate checks, contention and reconstruction work; a synthetic field tests succession and does not establish optical accuracy.

**Mutation responsibility:** receiver selection/coverage and reconstruction participation, including the smallest producer hook needed for local offers. Optical payload semantics remain owned by transport. This is a genuine new feature over existing machinery.

### B. Current cohort gathering and dual optical participation — narrow, low-dependency handoff

**Outcome:** once a caller supplies cohort membership, fetch its surviving current material reliably and expose emission and extinction participation independently. Consumers are rich source evaluation, material compression and lifecycle diagnostics.

**Starting mechanism:** the GPU material handoff already exposes current state and validates material epoch, slot and birth generation. Extend or adapt that mechanism rather than create another particle simulation or a full-population copy.

**Inputs:** explicit member keys and caller-declared weights/support interpretation. The first implementation can use controlled membership lists. Output current positions, independent optical state, available support descriptors, validity and source version. Keep weight provenance with the record. Selection, replacement policy and inferred representative weights remain here.

**Composition:** one update prepares reusable current cohort state for several consumers. A non-emitting member with nonzero extinction remains available. Recycled or dead members become missing evidence rather than silently replaced material. If prepared data is already available, establish the consumer contract without duplicating it.

**Evidence:** actual GPU consumers see current states after advance/birth, distinguish slot reuse, retain extinction through emission loss, and handle partial cohort loss. A controlled cohort suffices to validate these mechanisms; it cannot prove representative quality. Report reads/bytes for selected references separately from repeated query evaluation.

**Mutation responsibility:** the small adapter/storage and associated producer version/lifetime contract needed by selected-cohort consumers. No new population census is implied. This may be a short integration task rather than a full lane.

### C. Current support-aware spatial candidates — valuable prerequisite with a timing decision

**Outcome:** local acquisition and arbitrary ray bundles obtain conservative current candidates without submitting the entire particle population separately for each query. Consumers are cohort acquisition and the existing arbitrary-direction bundle evaluator.

**Starting mechanisms:** exchange has center-cell counts/offsets/IDs, but the audited grouping predates advance and births. `volume-packet-bundle.mjs` admits arbitrary directions yet submits every particle per bundle. The index cannot simply be relabeled current or support-aware.

**First decision owned by this implementer:** establish a lawful current index timing or conservative movement/birth accounting from the existing index, and quantify the added work. Supports crossing cell boundaries must remain candidates. If the route needs another full-population pass, expose its cost and reason before adopting it as the assumed cheap path.

**Composition:** indexed candidates must feed one actual local acquisition and one existing bundle evaluation, preserving admitted optical supports. The caller still chooses packet membership and optical weights. The spatial layer cannot discard a contribution because a future fitting model is expected to ignore it.

**Evidence:** compare admitted candidate sets and resulting bundle contributions with the unculled route on controlled inputs containing cell-edge supports, large supports, motion, new births and arbitrary directions. Overinclusion is a cost; missed supports are a correctness error. Measure index maintenance, candidate selection and downstream submission together before claiming a speedup. Use the existing rendering/support interpretation until an explicitly chosen change replaces it.

**Mutation responsibility:** index timing/export, conservative spatial queries and integration with acquisition/bundle submission. The owner must understand the full query path, while leaving source selection and optical fitting policy with their owners.

### D. Ordered interval observations — factorable after a small interface agreement

**Outcome:** acquire and retain measurements over fixed world-space intervals, with true endpoints, transverse footprint, freshness and material identity, then distinguish their transported predictions. Consumers are the shared model and history reuse.

**Starting mechanism:** the bundle route already accumulates transverse/depth sections. New work is world-length interval mapping, observation custody and an explicit selected-source versus full-emission domain.

**Interface to settle before handoff:** which existing backend's segment statistics are preserved, how source emission membership is identified, and how transverse measurements are exposed. This is a compact producer/consumer agreement; it does not require choosing the blocker optimizer. Extinction-only interval plumbing can precede source-local emission composition, provided its narrower result is explicit.

**Evidence:** changing connection length changes interval count; splitting/concatenating intervals preserves the chosen transfer on controlled material; unsupported intervals are distinct from measured transparency; transported geometry never overwrites acquisition geometry; overlapping source/exterior ownership is explicit. The lane integrates an actual producer and consumer, not just a schema with no acquisition route.

**Mutation responsibility:** observation data and conversion/composition alongside the existing bundle producer. Full estimator weighting and material fitting remain here. This is lower priority than A–C until the small interface agreement is made.

### Work retained in this conversation

- Source discovery coverage; representative selection, weights and source responsibility when neighborhoods overlap.
- The optical measure of acquired supports, and how source-internal extinction composes exactly once with exterior material.
- The first material compression family and how current material information combines with ray constraints, including unknown/low-attenuation states and rejection of bad fits.
- The integrated estimator, refresh allocation and chosen behavior during unsupported intervals; basic history/version plumbing may proceed independently.
- The validity rule connecting a bent transported observation to a current straight path, and when source-local directional evaluation can be reused.

Basic motion reductions are potentially a small helper to B, with caller-supplied members/weights and explicit degeneracy. They should not become a separate lane charged with deciding optical reliability before the material model exists. Visual overlays and recorded comparisons belong with the relevant feature in the shared Workbench; a separate framework-building lane is not a prerequisite.

### Whole-population cost boundary

The simulation already advances its population. The proposal does not require every optical query, every packet or every receiver to investigate most particles. Selected cohorts use direct fetching; connection work traverses selected packets/primitives and conservative local candidates. Global discovery or index maintenance may still need broad access. Existing material-packet moment builders already scan/reduce the population; they are candidates to reuse and measure, not evidence that our sparse approach is already free.

Keep five costs visible: any incremental work in existing full-population passes, any added full-population pass, local acquisition, selected-cohort updates, and per-connection evaluation. For example, 200 cohorts of 25 members imply 5,000 member references per update; 2,000 receivers each evaluating four such cohorts imply 200,000 member-connection evaluations before any further reuse. That arithmetic explains the distinction and establishes no frame-time prediction. Avoid calling a per-particle check free merely because it is fused into an existing pass.

## 13. Revision and evidence custody

Canonical architecture: this document in Kaminos. Original durable draft and audit: `ae9d974ba40439fa7332f47cac986e27ff4c9c4c`, ParticleFetchTrickle's `cc/particle-fetched-prequel-1117`, on the particle source-history implementation stack. This revision records the operator's subsequent convergence and the requested decomposition; it changes no runtime code and claims no new performance or visual result. The audit remains a historical account of its inspected source, not a live certification of later changes.

Editing branch: `cc/flow-light-spec-1117`, explicitly based on that document commit. The inspected cached `origin/main` merge base is `e16a7ac55d52a492fca11ed37831b6f28829dcc0`; at creation the chosen base was 75 commits ahead and zero behind that cached ref. Fetching current main failed with `Could not resolve host: github.com`. The branch therefore carries the named unmerged source-history/document dependency; it is not a fresh-main implementation branch. Any implementing lane must choose and record its current source base separately.

This is a documentation handoff; implementation assignment and main-branch landing remain separate operator actions. Session recovery and working-copy location remain in the local worktree creation receipt.

Author verification: read the original draft and complete source audit; reconciled the architecture and phase split against the supplied discussion; checked the local document link, three named source-module paths and sequential section numbering; `git diff --check` passed. No runtime tests or visual/performance runs were needed or performed for this documentation-only change. Routine documentation review exemption applies; no independent model review was run.
