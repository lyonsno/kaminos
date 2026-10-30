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
cosine timing; Pause holds; Return to pose restores the selected authored endpoint. All numeric tuning uses Kaminos number-drag controls.

Mechanisms are ordinary authored scene objects with source `kaminos:link-mechanism`.
Save / Load use the existing server scene library. Recipes, poses, phase, root
transforms and attachment frames reconstruct on reopen, without an experiment.
Closing the workshop leaves the construction in the scene. JSON import/export
remains available under the inspector's Recipe section.

Select a joint, choose a mesh in Object to attach, and Attach object. Placement
is preserved. Select the payload and use native G/R/S to edit its offset.
Detach releases it at its displayed pose. GLB, PBR and procedural meshes are
supported; simulation emitters and nested mechanisms require another binding.
Missing payloads remain visible as unresolved references.

Construction/pose tools occupy the viewport header. Play/Pause holds and resumes;
Return to pose restores the authored endpoint. Cycle position and phase offset
use native number-drag fields; one unit is one cycle. Shift-Space toggles playback
when these controls are visible. Space remains command search. Delete branch
removes descendants and releases their attachments through Undo. Add another
mechanism creates an independent construction. Command search also has Add Mechanism.

Attachments retain a scene object ID, joint and a rigid local mounting frame.
Scaling the assembly moves its joints while payload dimensions stay independently
authored; scale the payload itself to resize it. Native Undo/Redo restores offsets
at the current playback position. Construction history survives deletion and
reconstruction of the mechanism. Assembly roots remain movable. Parent-null nodes are fixed relative to the assembly. Current
playback directly places objects; contact, forces and propulsion are future work.

The first handoff tests construction usability. It does not establish physical
collision, actuator stroke clearance, closed-loop constraint solution or a
successful generated-shell pipeline. Analytical geometry is constructed from
user choices, with one incoming rigid link per non-anchor joint and explicit
parent identities; no model inference is needed for a new arrangement.


## Mounts and compound construction

Place mount in the viewport adds a construction-frame mount on a link or an object-local mount on an ordinary mesh surface. Select the mechanism and enter component editing with Tab first. Mounts have visible rings and axes; G/R and the native transform inspector edit their position/orientation. Add mount in the inspector places a mount at the chosen object's origin or selected joint. A mechanism in that chooser means its assembly root; select that mechanism itself to author mounts on its moving links.

Snap mounts uses two clicks, source then destination, and moves the source object once. Fasten mounts retains that relationship. Choose an object-owned source mount first; a link's own joint mount is a destination. The inspector offers the same source/destination operations. Existing binding owners must be detached before snapping or fastening again; cyclic fastening requires a constraint solver and is rejected without changing the construction.

Piston mounts connects any two mounts in this mechanism's mounting list. Its barrel length is fixed at creation and its extension follows the separation. Preview piston travel shows a sampled sweep over this construction's A/B interpolation, with externally driven objects held at their current placement. This is a visual preview, not a certified extrema calculation or force solver. A warning identifies when a requested pose puts the endpoint inside the barrel.

A second mechanism can be fastened by an assembly-root mount and run its own period/phase. The scene service advances all mechanism clocks, places connected objects in dependency order, and then presents them. Mounts, connections and mounted pistons save with the ordinary mechanism scene record. Undo of fastening restores the object's placement as well as the relationship. Generated-body appearance remains a separate consumer; mounts refer to construction frames rather than mesh vertex identities.
