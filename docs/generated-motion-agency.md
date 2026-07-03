# Generated Motion Agency

Kaminos is beginning to treat generated motion as behavioral material for world-making, not as a finished animation clip that simply plays back on a rig. The Motion panel can already generate motion, decompose it into source-backed cliplets and phrases, transpose it onto simple actors, expose a reference skeleton, preserve contact sheets, and let Path World episodes interrupt or reshape motion around obstacles.

The important shift is from animation playback to behavioral motion composition. A generated clip is useful because it contains timing, attention, compression, recoil, recovery, hesitation, commitment, and directional intent. Kaminos can steal those properties, route them through body adapters, and let them interact with world context.

The first target body is intentionally forgiving: an orb with a nose, rings, path marks, and visible behavior labels. That body lets the system test agency, attention, and path-world behavior before humanoid anatomy makes every foot, knee, wrist, and contact point load-bearing.

This is not final creature intelligence. It is an early substrate for making arbitrary generated or imported objects read as if they notice, decide, approach, avoid, inspect, recover, and return inside a world.

## The Old Ground

Classic real-time character and crowd systems split this problem across several mature disciplines:

- Character animation systems own clips, retargeting, root motion, blend trees, additive layers, phase matching, motion warping, inverse kinematics, and contact repair.
- Game AI owns state machines, behavior selection, target appraisal, interrupt rules, and longer-lived intent.
- Navigation and steering own seek, flee, arrive, wander, obstacle avoidance, path smoothing, local avoidance, and group motion.
- Crowd systems own many-agent variation, density, local collision, level of detail, and aggregate believability.
- Physics and constraints own collision truth, floors, walls, slopes, penetration, contacts, and external forces.
- Authoring tools own the human loop: trim, tag, preview, rename, promote, compare, and debug.

The old production bottleneck is not only math. It is coverage. Good motion libraries are expensive to build, hard to tag, hard to extend, and often too sparse for the weird behavior the operator actually wants. A phrase like "small creature backs away suspiciously, then startles" would traditionally require bespoke animation, cleanup, retargeting, naming, state-machine integration, and visual review.

## The New Ground

Generated motion changes the shape of the work. Kaminos can ask a model for specific expressive material, then decompose and reuse the parts that carry useful behavior. The source motion does not have to be anatomically sacred. For abstract actors, lerms, splats, props, masks, or other hallucinated assets, the system can preserve timing and intent while discarding the original body.

The useful pipeline is:

```text
motion source
-> motion features
-> cliplets
-> phrases
-> actor body adapter
-> steering intent
-> encounter semantics
-> world constraints
-> behavior state
-> witness
```

This is why contact sheets matter. They are not only shareable pictures; they are an evidence surface for agents and humans. Each frame can carry source frame, cliplet, phrase, behavior state, route authority, encounter semantics, active constraint, and effective route identity. The witness is part of the system, not a decorative export.

## Shoulders

Kaminos should stand on known work where it still fits:

- Reynolds-style steering remains the right primitive layer for simple actors: seek, flee, arrive, wander, avoid, pursue, separate, and orbit.
- Motion graphs remain the right mental model for cliplets and phrases becoming reusable nodes with transition costs and semantic affordances.
- Motion matching remains relevant as an aspiration: choose motion by desired future trajectory, pose continuity, and semantic intent rather than by a hand-authored state alone.
- Animation warping remains relevant when source motion must bend toward a target, contact, heading, slope, obstacle, or route.
- Behavior-state systems remain relevant for readable states like wandering, noticed target, approaching, hesitating, performing flourish, avoiding collision, and returning to anchor.

The point is not to rebuild a full commercial animation stack first. The point is to use these shoulders selectively while the generated-motion loop opens a different route through the space.

## New Leverage

The new leverage comes from three combined affordances.

First, Kaminos can generate semantically specific motion on demand. Instead of waiting for a curated library, the operator can ask for a source phrase and immediately inspect whether the generated timing has useful behavioral texture.

Second, Kaminos can decompose the source into reusable cliplets and phrases. A generated motion can produce an approach, a hesitation, a startle, a recoil, and a recovery. Those fragments can then become material for other actors and other situations.

Third, Kaminos can use agents and witnesses as part of the authoring loop. Contact sheets, debug labels, route authority, and source-frame evidence make a motion artifact inspectable by humans and artificial collaborators. A bad smoke can become a better classifier, a clearer witness, or a new promoted take instead of disappearing into a downloads folder.

This changes the authoring question. The old question was often "which animation clip should play?" The Kaminos question is becoming "what behavioral material is present, what body can carry it, what world situation is asking for it, and what evidence proves the result does not look broken?"

## Ontology

### Motion Source

A raw generated, imported, procedural, captured, or hand-authored motion artifact. A source may come from Komodo, mocap, a browser-side procedural routine, a future robotics policy, or a manually curated fixture. Source truth includes frame count, source frame indices, route identity, prompt, model/backend, and any generated metadata.

### Motion Features

Extracted measurements from the source: root position, center of gravity, heading, head or attention proxy, vertical energy, compression, extension, velocity, acceleration, direction change, phase changes, and contact-like events. These are the bridge between raw pose sequences and behavior.

### Cliplet

A contiguous source-backed fragment. Cliplets preserve frame ranges and raw evidence. A cliplet can be small and mechanical, such as a brake/compression segment, or coalesced into a more operator-facing phrase layer.

### Phrase

A meaningful composition of cliplets that reads as a behavioral unit: approach, hesitate, startle-recoil, recover-settle, inspect, flee, return. Phrases are closer to the operator's mental model than raw segmentation.

### Actor Body Adapter

The mapping layer from source features onto a target body. For an orb, the adapter can map source root, attention, vertical energy, compression, and heading into sphere translation, scale, nose direction, ring orientation, ghost skeleton, and behavior labels. For a future lerm or rigged creature, the adapter will need a different fidelity boundary.

### Steering Intent

The local movement desire before or during world interaction: seek, arrive, avoid, inspect, bump, recoil, orbit, return, hold, flee. Steering intent should start before hard contact when the world gives enough evidence.

### Encounter Semantics

The actor's appraisal of an object or event: obstacle, target, curiosity object, threat, wall, anchor, lure, other actor, or irrelevant scenery. V0 Path World semantics currently classify simple encounters as avoid, inspect, bump, or recoil.

### World Constraint

The part of the world that refuses impossible motion: floor, wall, slope, bounds, obstacle penetration, and future collision or fluid constraints. World Constraint is not the same thing as intent. If constraint correction is doing all the work, the behavior layer is late.

### Behavior State

The longer-lived readable state of the actor: wandering, noticed target, approaching, hesitating, performing flourish, avoiding collision, returning to anchor. Behavior state is the public/debug grammar that explains what the actor appears to be doing.

### Composition Policy

The chooser that combines source phrase, actor adapter, steering intent, encounter semantics, behavior state, and world constraints. This policy should be explicit enough to debug and flexible enough to accept generated material.

### Witness

The evidence surface. A witness should preserve effective route/config identity, source frame, cliplet or phrase, behavior state, route authority, encounter semantics, constraint activity, and visual output. The witness is how humans and agents decide whether the behavior is plausible, broken, or merely young.

## Current Shape

The current Motion panel already has the first pieces:

- Generated motion can be requested from a local sidecar.
- Source skeletons can be shown as sidecar or overlay references.
- Source orientation can be remapped.
- Cliplets and phrases can be selected, previewed, exported, and promoted.
- Contact sheets can be exported from the current view with source frame evidence.
- Simple orb actors can carry root motion, attention, behavior labels, and visual rings.
- Path World can trigger local encounter episodes around an obstacle.
- Path World episodes now carry route authority, local trajectory, resume handoff, and encounter semantics evidence.

The most important smoke result so far is that simple orb actors can read as approaching, retreating, inspecting, or recovering without looking broken. That is the first win condition for abstract world agency.

## Next Target: Path World Steering Intent V0

The next structural slice should stop waiting until hard contact to improvise. Path World should look ahead along the route, detect nearby obstacles in a soft radius, classify the likely encounter, and bias attention and route motion before impact.

The V0 shape:

1. Detect pre-contact obstacle proximity along the route.
2. Choose a Steering Intent from encounter semantics: avoid, inspect, bump, or recoil.
3. Bias route and attention before collision.
4. Preserve explicit evidence: `steeringIntent`, `precontact`, `routeBias`, `encounterArchetype`, and whether hard contact still happened.
5. Compare interrupt-off, reactive-interrupt, and steering-intent contact sheets.

The win condition is fewer hard-contact repairs and more plausible pre-contact relation to objects. The actor should begin to look like it is deciding around the world, not only recovering from the world.

## README Boundary

The README should tease this work without becoming the whole technical chamber. It can say that Kaminos is exploring generated motion as a behavioral material for world-embedded agents and link here. It should not open with a full taxonomy of steering, motion graphs, witness evidence, and internal route authority. That belongs in this document and in tests/witnesses.

The public promise is:

> Generated assets should not only appear in a world; they should begin to behave inside it.

The internal obligation is stricter:

> Every behavior claim needs source, route, semantic, and visual witness evidence strong enough that a human or agent can tell what happened.
