# Particle-fetched prequel — acquisition, current-state packets and receiver support

This audit answers the implementation questions behind the [flow-carried illumination draft](flow-carried-distributed-illumination.md). It is a source inspection of Kaminos `b99b763919029475415959a64765e72c21f3e135`, the previously offered particle source-history stack. No simulation, shader, benchmark or visual behavior was changed or executed for this audit. Source findings establish mechanisms at that revision; the supplied screenshots do not establish which acquisition settings were active or prove a cause of sparse coverage.

## Findings that change the design

### Tracking jitter proposes a new observation

[`volume-particle-follow.mjs`](../../volume-particle-follow.mjs), `propose`, picks uniformly from the indexed live IDs, then accepts using fuel/heat/soot activity weights. It predicts the selected carrier's next center using Fine flow and the authored rise term, adds a three-dimensional box jitter measured in Fine-cell widths, and requires that point to remain inside Fine and the acquisition camera's view. Zero jitter samples the predicted center.

[`volume-particle-acquisition.mjs`](../../volume-particle-acquisition.mjs), `splitAcquisitionUv`, projects this target into the acquisition camera. [`volume-split-integral.mjs`](../../volume-split-integral.mjs), `splitSampleDepth`, selects the target's depth along that ray. The material is freshly evaluated there. This is neither random motion of the retained particle nor an independent chemistry measurement of the selected particle: acquisition still reads the grid-backed source and Fine composition.

The other acquisition proposals stratify the camera projection of Fine, broad coverage, or a source envelope. The source envelope derives from admitted inlet support, specified travel/history and margin; it is not measured luminous occupancy. Thus “emitter-relative sampling” describes only part of the policy. Camera coverage and source-region choice both matter.

### The acquired interval is not a complete reconstructed ray

`splitObserve` stores local optical coefficients, position, intrinsic emission and a depth support. In the one-sample route it clips support to a pitch-scaled interval around the observation. `particleBirth` retains that interval length in `shape.w`, pitch in `shape.x`, independent Fine fuel/heat/soot/oxidizer, and intrinsic versus captured scattered terms.

`particleMaterial` multiplies current coefficients by retained interval length. Rendering spreads this contribution over a projected footprint. This is an explicit local optical approximation. Neither its good appearance nor the stored interval establishes unbiased quadrature over the entire ray, a sampling PDF, or a unique direction-independent bulk density field.

### Stretch is currently measured, not integrated into material support

[`volume-optical-particles.mjs`](../../volume-optical-particles.mjs), `particleFineVelocityGradient` and `particleLargestStretch`, derive the current maximum strain rate from the trilinear Fine velocity field. The calculation runs for debug view 9 and writes `motion.z`. It is not accumulated deformation history.

`particleLightBaseRadius` uses birth pitch/support floor, authored radius and stretch, and fuel-dependent expansion. Optional flow alignment updates an axis from current velocity. There is no transported deformation tensor or Jacobian in the 96-byte particle record. Coverage curves and emitter-born smoke spreading are additional authored controls, not compensation for the evolving proposal density.

Consequently a “flow/stretch sampling coordinate system” is a new representation choice. Instantaneous velocity/strain is available to guide exploration, but a scalar maximum strain cannot recover past three-dimensional sample spacing. Stretch can separate particles without increasing volume; one scalar multiplier would conflate those effects.

### Lowering capacity changes more than display density

Independent-batch births use a rotating pool. Fresh observations can overwrite active slots. Lower capacity shortens retention under the same accepted birth rate. Grouping and composition exchange operate on that population, so reducing it changes the neighborhood exchange and subsequent chemistry as well.

The camera-stratified route instead assigns samples to slots and refreshes them probabilistically. Direct emitter supply is a third route: [`volume-particle-emitter.mjs`](../../volume-particle-emitter.mjs) samples a supply CDF over admitted emitter cells, uses free slots, and assigns a created-volume share. It seeds composition from the local grid. Source-step mismatch and lack of free slots can limit births; these are inspection targets, not an established diagnosis of the reported emitter-spawn failure.

The operator's sparse visual experiment is evidence that recognizable burning structure can survive a lower-population regime. It does not measure what retaining 1%, 5% or 10% of an unchanged dense population would preserve. Root concentration could involve acquisition, overwrite age, phase filtering and subsequent reaction as well as stretch.

### The phase filter is a useful classifier, not a power distribution

`particleMatchesPhase` classifies measured burn above threshold as actively burning; otherwise intrinsic luminance above threshold as afterglow; otherwise positive soot as quiet soot. Zero in the burn-measurement sentinel is “Burn not measured,” not “burnt measured.” The filter controls rendering; it does not construct an emitter inventory or alter source cohort membership.

Both actively burning and afterglow material can have meaningful extinction. Quiet soot is a natural location for the smoke-coverage investigation, but phase alone does not establish its optical importance or the right representation scale.

### Current-state source cohorts are supported by the existing GPU contract

`createParticleMaterialHandoff` exposes current particle storage, options, Fine state and birth generations through synchronous GPU encoding. Identity is material epoch plus slot plus birth generation, with alive/generation validation. A recycled slot must not silently replace a cohort member. The handoff supplies a current source version; callers retain keys, not a permanent claim on a borrowed snapshot.

A representative can directly read current position, intrinsic emission, soot extinction, support parameters and independent reaction state. Ten to fifty such members therefore do not require fifty independent chemistry simulations or a full-pool search on every reuse. This supports the proposed packet particularly strongly through partial burnout. Membership selection, missing-member replacement, optical weighting and evaluation cost remain work.

For illustration, 100 packets with 50 members have 5,000 references. An 8-byte slot/generation pair plus one 4-byte weight is 60,000 bytes before alignment and packet metadata; reading a full 96-byte record per reference is 480,000 logical bytes per update before cache effects. These are storage/traffic arithmetic, not measured GPU performance or the cost of evaluating all receiver connections.

### A neighborhood index exists, but its timing matters

[`volume-particle-exchange.mjs`](../../volume-particle-exchange.mjs) builds counts, prefix offsets and compact IDs by center-containing cell. [`volume-particle-field.mjs`](../../volume-particle-field.mjs) uses these for overlapping trilinear composition exchange. Grouping occurs before carrier advance and fresh births in the inspected update sequence. The material handoff is later and does not export that grouping as a certified current spatial index.

A new current-neighborhood acquisition must either rebuild/index current positions or explicitly account for that displacement and new births. Once a cohort exists, direct stable-ID gathering bypasses this search. For ray culling, center occupancy alone is insufficient: include supports extending out of their center's cell. This distinction prevents an attractive existing index from silently becoming an incorrect current ray index.

### Existing power and packet builders answer narrower questions

[`volume-packet-network.mjs`](../../volume-packet-network.mjs), `packetPower`, ranks intrinsic luminance times base support area times retained interval and lifetime fade. Source seeds initially select high-ranking particles from slot ranges and then persist while their identity survives. Current luminous members are assigned to the nearest seed and refitted. This is not the proposed coverage-aware discovery process in flow coordinates.

[`volume-material-packets.mjs`](../../volume-material-packets.mjs) already constructs spatially binned current emission and extinction moments and normalized kernel candidates. It scans/reduces the current population using an explicit support-area-times-interval volume proxy. Its construction bins are not stable source-cohort identities. Reuse this as a comparison or discovery substrate if its cost and measure fit; do not describe it as the proposed persistent small cohort already implemented.

### Arbitrary fresh directions exist; submission efficiency is unfinished

[`volume-packet-bundle.mjs`](../../volume-packet-bundle.mjs) takes explicit bundle forward/right/up vectors. Its direction is not intrinsically restricted to six axes. The vertex route indexes every particle for every submitted bundle, rejects inactivity and axial exclusion, projects support, and deposits into transverse/depth sections. Off-bundle fragments are rejected later. This explains why narrower tubes alone do not eliminate the full particle-instance submission work.

The source membership mask suppresses unselected emission while retaining extinction from the full admitted population. Ordered sections therefore include the source's own extinction on this route. A source-local rich integral added later must not apply that extinction twice. Same-section material is mixed and composed as a slab; increasing section count addresses a different approximation than increasing transverse or angular samples.

### Receiver reconstruction already uses both locations

[`volume-particle-packet-incident.mjs`](../../volume-particle-packet-incident.mjs), `packetContribution` and `gatherPackets`, reconstructs from actual receiver centers and finite radial supports, summing weighted incoming values and dividing by total weight. A center-bin index accelerates lookup; this is not a baked illumination grid. Missing support has a distinct output validity component.

`volume-packet-network.mjs` retains receiver carrier keys and reseeds on loss, but selection is by importance within slot ranges. It does not implement grid-like coverage ownership, predicted arrival, paired succession or smooth lifecycle handover. Those are the new pieces. Keeping both donor locations during succession fits the current gather mechanism; a finer deposition grid is optional until needed for cost or reconstruction behavior.

## Recommended next decisions

1. Use stable-ID current-state gathering as the source-packet starting point. Keep the anchor as a frame/address and retain independent member emission/extinction.
2. Define representatives relative to a declared current source neighborhood before attempting a global deformation-corrected particle measure. Full material acquisition bias is real, but solving it completely is not required to compare reductions of the same admitted population.
3. Specify source-internal/exterior extinction ownership with an interpenetrating luminous/sooty example. This determines the minimal ordered data a rich packet must retain.
4. Keep source discovery coverage and receiver support coverage separate. Their primitives can share indexing and motion information, but luminous ranking alone cannot maintain receiver coverage.
5. Compare reconstruction with current indexed gather before introducing deposition. Succession should keep two actual locations, a shared coverage responsibility and explicit validity.

The next useful observation, after operator composition, is a dense held population with a separately thinned optical/discovery view. That would distinguish reduction error from the altered chemistry/retention caused by changing actual capacity. It is a proposed manipulation, not an assay launched by this audit. Its dynamic continuation should examine source power and self-attenuation through partial burnout, using the same underlying trajectories for every contender.

## Source and verification

Inspected source: `b99b763919029475415959a64765e72c21f3e135`, branch `cc/particle-source-history-1116`. Documentation branch: `cc/particle-fetched-prequel-1117`, based on that explicit local source revision. The cached main/merge base was `e16a7ac55d52a492fca11ed37831b6f28829dcc0`; source was 74 commits ahead of that cached ref. Remote freshness could not be verified because GitHub DNS resolution failed.

Document discovery checked available local design notes, relevant working copies and local documentation history. No expanded draft containing receiver succession was found. Reconcile this provisional draft with the operator's edited version when available.

Verification was source inspection plus local Markdown link and whitespace checks. No performance result, new image, runtime diagnosis or live shader pass is claimed. No simulation or rendering code changed.
