# LIRM Gestalt Adherence Assay v0

## Question

When one learned silhouette basin is held fixed, do visibly different procedural
3D armatures survive Flux2 completion as distinct gross creature structures, or
does the model prior collapse them into one favored body plan?

## Fixed controls

- silhouette lineage: `basin-10-s3p00-n00`
- SDF silhouette pressure: `0.46`
- image route: `gpu-greenroom/mflux_flux2_edit_promptfile`
- model: Flux2 Klein 9B, 4-bit
- output: `512x512`, eight steps, guidance `1.0`
- seed: `717046`
- prompt stance: `design-seed-completion`

## Varied control

Procedural armatures `08`, `16`, `22`, and `24`, selected because their p0.46
composites visibly differ in arch, body length, dorsal interruption, and mass
distribution while sharing the same learned silhouette lineage.

## Evidence predicate

The assay is informative when the generated results remain coherent and
materially preserve between-row gross-structure differences. Exact surface
matching is not required; hallucinated anatomy is the intended completion
behavior. Convergence onto one shared silhouette is a model-prior takeover.

## Baseline result

All four jobs completed through the requested Greenroom route with exact input,
prompt, parameter, timing, and output evidence. Runtime was `30.2-32.3s` per
cell. Pixel inspection of `gestalt-adherence-contact-sheet.png` found four
coherent creature concepts and no blank, duplicated, or diagrammatic result.

The fixed basin and prompt impose a strong shared prior: low quadruped anatomy,
a left-facing head, neutral clay material, and dorsal armor. The procedural
armature still changes the completed body materially:

- `08` remains compact and deeply hunched with two large dorsal masses;
- `16` remains the broadest, squattest body with a blunt front and separated rear;
- `22` preserves the deepest lifted arch and develops the longest forelimbs;
- `24` remains the longest and lowest body, with the strongest plating and
  additional silhouette breaks.

This is positive adherence with useful model-prior completion. The next assay
holds seed, basin, route, and armatures fixed while crossing strict blockout
preservation against loose prior-led invention.

## Prompt-pressure result

The crossed assay completed all eight cells through the requested Greenroom
route with exact input, prompt, parameter, timing, and output evidence. Runtime
was `30.6-37.6s` per cell, averaging `32.9s`. Pixel inspection of
`prompt-pressure/gestalt-adherence-prompt-pressure-contact-sheet.png` found no
blank, duplicate, diagrammatic, or incoherent output.

Prompt pressure is a strong and legible control. The strict stance leaves the
four bodies close to their coarse blockouts, adding only restrained limbs and
surface organization. The prior-led stance resolves all four as coherent
armored quadrupeds with heads, feet, plating, joints, and materially richer
anatomy. That added prior does not erase the armature:

- `08` remains compact, deeply arched, and fore-heavy;
- `16` remains broad, squat, and blunt with the shortest stance;
- `22` retains its deep lifted arch and heavier central mass;
- `24` remains the longest body and gains the clearest extended locomotor line.

The model can therefore be driven between blockout adherence and anatomical
invention without losing gross structure at this pressure. Seed replication on
the extremal `08` and `24` armatures is the next discriminator: it tests whether
that useful relationship is a basin property or one favorable seed.

## Seed-replication result

Three additional seeds crossed both prompt pressures on extremal armatures `08`
and `24`. All twelve jobs completed through the requested route and passed exact
route, parameter, timing, hash, and primary-output validation. Runtime was
`30.3-40.0s`, averaging `34.7s`. Pixel inspection of
`seed-replication/gestalt-adherence-seed-replication-contact-sheet.png` accepted
all twelve outputs.

The useful control relationship survives the seed sweep. Seed materially changes
head design, plating, limb proportion, and species character. Prompt pressure
changes the amount of anatomical completion: strict outputs range from nearly
raw mass to restrained unarmored bodies, while prior-led outputs consistently
resolve coherent armored quadrupeds. Armature identity remains visible beneath
both sources of variation: `08` stays compact, high-arched, and fore-heavy;
`24` stays longer, lower, and more extended.

The five Trellis promotions form a compact factorial witness at seed `717048`:
both armatures crossed with both prompt pressures, plus prior-led `08` at seed
`717047` as a seed-variation probe. This separates 3D survival of armature,
prompt pressure, and seed without spending the five-run budget on redundant
surface variants.

## Trellis factorial result

All five promoted images completed through `gpu-greenroom/trellis2mlx_fast`
with the requested input, seed, resolution, step count, cascade state, face
budget, texture size, and simplify order. Exact route, timing, input hash, and
GLB hash evidence was accepted for every cast. Trellis runtime was
`53.6-79.8s`, averaging `60.5s`. Twenty Blender witnesses then completed through
the requested Greenroom route in `0.8-1.8s` each, averaging `0.9s`.

Pixel inspection of
`seed-replication/trellis/gestalt-factorial-trellis-witness-contact-sheet.png`
accepted all five casts and all twenty views as spatially coherent. The 3D
factorial reveals a sharper control decomposition:

- under strict pressure, `08` remains compact, high-arched, and fore-heavy,
  while `24` remains longer, lower, and more extended;
- under prior-led pressure, both armatures converge toward one richly resolved
  armored-quadruped species basin; residual proportion differences remain, but
  the learned prior dominates gross identity;
- changing only the image seed from `717048` to `717047` yields a materially
  different green, long-snouted species while retaining a low armored-quadruped
  gestalt.

The route therefore works in the load-bearing sense: procedural armature,
prompt pressure, and image seed all produce legible downstream effects, and the
outputs survive Trellis as real spatial casts. Strict pressure is the stronger
armature-preservation regime. Prior-led pressure is a powerful anatomical and
species-completion lever that can partially erase armature differences. The
next discriminators are intermediate prompt pressure and broader silhouette
archetypes, not more seeds in this already confirmed basin.
