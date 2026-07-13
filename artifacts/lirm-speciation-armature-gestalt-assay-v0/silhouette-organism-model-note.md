# Silhouette-Space Organism Model Note

Date: 2026-07-13

## Claim

Training or fitting a small model to emit organism-ish silhouettes is not crazy. It is probably one of the cleanest ways to create upstream morphology diversity for the LIRM/speciation armature flow.

The target should not be finished creature images. It should be a low-dimensional body-plan distribution that creates selectable silhouettes and semantic handles. Image generators, Trellis, Sharp, and later motion systems can elaborate after the body-plan choice exists.

## Why This Is Attractive

The current flow already shows that Flux2 responds strongly to crude armature shape. The main missing upstream ingredient is gestalt variation: wide scuttlers, fat larvae, curled grubs, shield-backed crawlers, pouch-bodied tadpoles, asymmetric shell freaks, etc.

A silhouette generator would let Kaminos explore creature families before expensive firings. It turns "make a LIRM" from a prompt problem into a selection problem.

## First Practical Target

Start with binary or soft alpha silhouettes at `128x128` or `256x256`.

Each sample should carry a small semantic packet:

- body axis curve
- head/front point
- belly/contact region
- limb/contact nubs
- shell/plate zones
- mouth/front cap
- rough locomotion affordance
- lineage/seed parameters

The output does not need to be pretty. It needs to create silhouettes that make the operator say "that one has a creature in it."

## Possible Model Families

### Procedural-first

Generate silhouettes from SDF/metaball/capsule/ribbon primitives and mutate parameters. This is the fastest path and should remain the baseline.

Pros: inspectable, controllable, no dataset needed, semantic handles are native.

Cons: may feel samey until the mutation grammar gets richer.

### Tiny VAE / latent autoencoder

Train on synthetic silhouettes from the procedural generator, plus curated external masks later. Use the latent space for interpolation and novelty search.

Pros: gives smooth latent traversal and can regularize ugly procedural discontinuities.

Cons: only as rich as the synthetic corpus unless fed real masks.

### Diffusion over silhouettes

Train a very small conditional diffusion model on binary/soft masks. Condition on a compact morphology token packet: crawler, larva, plated, pouch, flat, curled, number of contact points, symmetry pressure.

Pros: can produce diverse plausible silhouettes and fill gaps between procedural families.

Cons: needs more data and more training care; overkill before procedural-first proves the contract.

### Evolutionary search without neural training

Use the procedural generator as a genome and score silhouettes with hand-built metrics or a learned aesthetic/gestalt classifier.

Pros: fits the speciation ontology directly; keeps lineage receipts.

Cons: scoring is the hard part unless the operator stays in the loop or we train a discriminator.

## Recommended First Experiment

Do not start with neural training. Start with a silhouette corpus and a scorer.

1. Generate 2,000 to 10,000 procedural silhouettes from the current SDF armature machinery.
2. Save alpha mask, clay render, normal/depth render, params, and semantic packet.
3. Build a contact-sheet browser for fast human selection.
4. Tag maybe 100 to 300 masks as "has juice", "too blob", "too symbol", "too eye-coded", "good crawler", "good larva", "good shell".
5. Fit a tiny classifier or embedding model to predict selection pressure.
6. Use that scorer to drive evolutionary mutation and produce better next contact sheets.

That gives us useful leverage before we train a generator. If the classifier begins to predict "has juice" even weakly, then a VAE or diffusion model becomes justified.

## Fit In The Kaminos Ontology

This is a speciation armature primitive.

- silhouette = earliest body-plan handle
- semantic packet = armature receipt
- selected mask = handle-set chosen for firing
- generated image = cast candidate
- Trellis/Sharp output = spatial cast
- lineage = editable creature family

The practical mantra:

> Grow silhouettes until a creature becomes selectable, then fire the selected body plan into richer generators.

## Decision Boundary

Proceed with procedural silhouette corpus and human/agent scoring now.

Defer neural generator training until one of these happens:

- procedural variation feels too narrow after a real corpus pass;
- the selected masks cluster in a way a learned latent model could exploit;
- we have at least a few hundred labeled silhouettes;
- imagegen/Trellis results show strong sensitivity to silhouette families.

Current read: promising enough to build the corpus/scorer path, too early to train the generator itself.
