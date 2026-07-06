# World Cartridges

A **world cartridge** is a portable world seed for Kaminos. It gathers the
ingredients a world needs to become inspectable, playable, extensible, and
smokeable inside the spatial forge.

A cartridge can carry:

- world identity, title, lineage, and intended audience;
- terrains, chambers, stations, actors, creature defaults, and scene recipes;
- behavior presets, motion habits, interaction rules, and ecological loops;
- generation basins for images, splats, meshes, materials, motion, and
  creatures;
- source-law bridges to project repos that own domain semantics;
- Kaminos affordance bindings for viewers, benches, fire, camera, capture,
  actors, stations, and smoke offers;
- example scenes and fixture states for quick entry;
- crucibles that preserve armatures, handles, firings, shards, casts, receipts,
  and smoke-apparition hooks for active making work;
- witness scenarios, screenshots, filmstrips, and route receipts;
- graduation accounting that records where successful work moves next.

The cartridge is the unit a person can open as a world and the unit an agent can
extend as a composition surface. It supports both taste-first interaction and
technical maker work.

## Terrarium Surface

A cartridge can present a **terrarium**: a living, bounded world surface where a
person can observe, play, select, mutate, grow, farm, feed, route, or disturb
world inhabitants. The terrarium presents gentle handles first:

- choose or grow a creature family;
- select visual and behavioral variants;
- introduce terrain, props, weather, material, or light;
- watch creatures move, gather, avoid, desire, fight, idle, or nest;
- capture a moment as a smoke, seed, or deeper edit;
- open maker controls when curiosity becomes technical.

Taste is a creative tool in this surface. A user can steer by preference,
curiosity, recognition, and selection while Kaminos keeps route lineage,
generation identity, and interaction state available for deeper work.

## Agent Composition Surface

For agent coding lanes, a cartridge is a composition target inside a Kaminos
worktree. A lane can open the Kaminos repo, create a branch for the cartridge,
and compose existing affordances into a smokeable route.

An agent composition can:

- use a world cartridge as the visible working surface;
- consume source-owned law from a game or world repo;
- reuse Kaminos affordances for actors, stations, cameras, benches, fire,
  capture, and witnesses;
- add cartridge-local scene recipes, fixture states, or interaction hooks;
- run the same route the operator will smoke;
- produce graduation accounting after the smoke proves a useful shape.

This makes Kaminos a spatial pre-production forge. Agent work happens in the
same browser world that the operator smokes, while source repos keep their own
domain laws and product loops.

## Crucibles

A **crucible** is a named making zone inside a cartridge. It gathers the working
memory for one world feature, creature family, interaction, or adapter route.
The cartridge gives the world its outer package; a crucible gives active work a
place to accumulate shape.

A crucible records:

- **armatures:** the structural supports the work mounts onto;
- **handles:** the operator and agent controls used to touch it;
- **firings:** attempts, runs, and smokes that changed the shape;
- **shards:** useful fragments that survived a firing;
- **casts:** promoted takes that can be reused;
- **receipts:** observations and route records;
- **smoke apparitions:** planned or implemented spatial renderings of smoke
  evidence, screenshots, filmstrips, or depth/normal captures.

Crucibles make cartridge work easier to pass between agents. A lane can start
inside the Kaminos worktree, choose the relevant crucible, reuse existing
armatures and handles, add a firing, and leave a cast or receipt for the next
lane.

## LERMS Terrarium

The first worked cartridge direction is a **LERMS terrarium**. It is a
Kaminos-hosted world pack for little bodies, terrain, motion, hand surfaces,
props, goins, finger-fluid experiments, and creature interaction basins.

The LERMS terrarium can use Kaminos affordances such as:

- world chambers and terrain benches;
- Mushfinger actor/body/station affordances;
- Palm hand-surface and WiLoR runtime affordances;
- Gutterglass direct asset routes and host routes;
- Molten generated assets and material candidates;
- Beaming and pyro fire/route-activity surfaces;
- Pipeline generated-output stacks;
- Minion forge-host smoke offers and capture.

The LERMS game can develop its own runtime, game loop, renderer, save model,
body grammar, and domain-native creature systems. The Kaminos LERMS terrarium
acts as a forge-side world cartridge and worked example. Shared discoveries
can move between the two through explicit graduation modes.

## Graduation Modes

Every serious cartridge composition should record a graduation mode. Graduation
is the decision about where a proven piece of work belongs after the smoke.

Common modes:

- **Remain in Kaminos terrarium:** the result becomes a cartridge feature,
  example scene, maker affordance, or taste-first interaction inside Kaminos.
- **Port domain-native:** the source project implements the discovered behavior,
  state stream, interaction, or body law in its own product repo.
- **Extract shared runtime:** repeated needs across Kaminos and project repos
  become a shared package or sidecar with multiple real consumers.
- **Ship Kaminos-backed shell:** a project intentionally packages a Kaminos
  chamber, renderer, or cartridge host as part of its product surface.
- **Archive prototype:** the smoke remains useful evidence and design memory
  while active implementation moves elsewhere.

Graduation accounting should name:

- source-owned dependencies;
- Kaminos-owned affordances;
- shared runtime candidates;
- game/project repo patches;
- cartridge features retained in Kaminos;
- witness routes and artifacts that justify the decision.

## Minimal Cartridge Shape

A first cartridge scaffold can stay small:

```text
worlds/<cartridge-id>/
  README.md
  world.json
  composition.js
  graduation.md
  witnesses/
```

`world.json` names the cartridge, audience, default chamber, starting scenes,
asset roots, source bridges, affordance bindings, and crucibles.
`composition.js` mounts the first scene or route and can expose compact
crucible seeds. `graduation.md` records the current graduation mode and the
custody split discovered by smokes. `witnesses/` stores route evidence for
operator and agent review.

The scaffold can grow as the cartridge proves its shape.
