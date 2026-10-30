# Link workshop

Open `?workspace=workbench&experiment=link-workshop`.
Select the workshop and press Tab to edit its joints. In Build / Draw links,
click the construction plane to place a fixed anchor, then click again for each
rigid link. Click any existing joint to extend or branch from it; Shift-click
places another fixed anchor. Switch to Select / move for native G/R/S edits.
Build changes geometry; Pose A and Pose B turn links while retaining lengths.
Moving a joint rotates its link and carries its descendants. The construction
plane is the object's local XY plane; whole-object placement uses native Object
Mode. This first build constructs rooted forests, not closed loops.

Connect piston takes two joint clicks. The piston follows their distance during
posed motion; it does not drive a force or constraint solver. Pose A/B ghosts
show the endpoints of the cycle. Play interpolates relative joint angles with
cosine timing; Stop returns to the selected authored pose for further editing. All numeric tuning uses Kaminos number-drag controls.

Save mechanism / Open mechanism retain the construction, both poses and piston
connections in a `kaminos.links.v1` JSON recipe. The experiment accepts that same
recipe as `inputs.recipe`. It is an experiment-owned setup; this slice does not
install a reconstructible whole-scene source domain. Keep the recipe to continue
editing after closing the experiment. Agent operations are the same domain
operations as the controls: append, select, move, piston, mode, tool, play,
pause, period, restore, snapshot and frame. There is no fixed link-count limit.

The first handoff tests construction usability. It does not establish physical
collision, actuator stroke clearance, closed-loop constraint solution or a
successful generated-shell pipeline. Analytical geometry is constructed from
user choices, with one incoming rigid link per non-anchor joint and explicit
parent identities; no model inference is needed for a new arrangement.

## Constructed bodies and appearance return

The workshop now derives rigid bodies from that recipe: bored link plates,
anchor blocks, axle pins, hollow barrels, and sliding rods. Incident links use
distinct depth layers around their shared joint axis; unrelated joints reuse
layers. Pins span the layers they connect. These are construction rules for the
planar forest, not fixture-specific arm roles. Link plate bores and axle radii
are derived together, including short links.

Piston barrel and rod lengths are fixed during playback. An adaptive distance
enclosure over the authored cycle chooses their lengths, including interior
extrema. A warning identifies travel that would push the rod through the rear
of its barrel. This is a visible limitation of a single-stage telescope; the
construction does not solve collisions or manufacture a multistage cylinder.

**Export body geometry** writes `mechanism.bodies.json`: the recipe plus identified
body-local Three object geometry. **Replace body geometry** accepts that package
or a subset of its bodies. The same operations are `exportBodies` and
`importBodies(packet)`. Import participates in native Undo/Redo. Body IDs are
recipe node/piston indices scoped to the open workshop. A geometry key checks
construction dimensions, and a returned root must retain the exported local
frame. A malformed or mismatched package leaves existing geometry intact.
Build edits retire replacements whose dimensions changed; pose edits retain
compatible bodies. This first port is JSON geometry, not a GLB/TRELLIS importer.

Save mechanism retains the authored recipe; retain the body package separately
for returned geometry and import it after opening that recipe. Closing/reopening
only a recipe reconstructs its analytical bodies. The round-trip test establishes
that geometry can return to authored motion; it does not establish generated
shape correspondence. The next generation stage can consume these local bodies
and their construction parameters without bespoke carrier scripting.
