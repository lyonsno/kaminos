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
cosine timing; Pause holds the displayed position. Editing a pose chooses that
pose explicitly. All numeric tuning uses Kaminos number-drag controls.

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
