# Surface articulation experiment

Select the mechanism, enter component editing with Tab, and click the door body.
**Place two seams** creates two ordinary selectable scene planes across that body.
Move them with native G, or use their shared number-drag fields. The first cutter
supports parallel seams across the body's local X axis, hinging around local Z.
The preset starts with unequal sections. Plane rotation that changes the seam
normal is refused rather than silently ignored.

**Divide surface · hinge seams** clips the actual meshes, retains UVs/materials,
and closes planar cut boundaries with the existing polygon tools. The original
body and lever need not have the same extent. Existing joint-end pistons become
body-local mounts at the same physical location. Named mount frames and direct
payload attachment origins follow the panel containing their position. A point
exactly on a seam, a tagged bracket straddling it, or a body already carrying
child links requires an explicit edit before division. Other untagged geometry
crossing a seam is intentionally cut. Source state is retained on refusal.

New hinges start straight in both existing poses. Choose a panel and use R in
Pose A or B to pose it; G turns it around its parent hinge. No fold destination
or obstacle avoidance is inferred. The anatomy overlay highlights the selected
body and displays joint axes and piston spans; Hospital's mount controls remain
available. Save uses the ordinary scene mechanism record, geometry and history.
Seam planes are disposable authoring guides; finish/cancel them before saving.

**Add hinge cylinders & horns** explicitly adds candidates to new interior
hinges. Repeating the command does not duplicate them. The original cylinder is
retained. Pins bridge from each panel's layer to its cylinder. The diagnostic
samples 101 poses and reports length range and minimum turning arm, including a
sign reversal or near-zero arm. This sampling does not establish continuous
clearance, collision freedom, a force-driven mechanism, or guaranteed feasibility.
The generated cylinders follow authored joint poses. Changing the motion may
invalidate a candidate and should be judged through the diagnostic and viewport.

The experiment is stacked on Hospital Prop Department's object-local mount and
hinged-attachment work; it shares that model and ordinary mechanism service.
