# Two connected material regions

This first Grist specimen composes the existing GPU yielding-element mechanics,
analytical two-sphere grit, local grain contact and particulate rendering. Two
local deforming lattices retain plastic edge metrics; a band of axial/diagonal
connections can lose strength irreversibly. The left edge is held; the right
native grip pulls its outer material nodes. The translucent native forming tool
presses and drags. Material samples have their own contact response and compliant
reciprocal attachments to their continuum support. Half the matrix mass belongs
to the support and half to the particulate bodies; they do not each represent a
full duplicate mass. Their initial optical geometry is still spherical.

Open `/?workspace=workbench&experiment=grist-regions` in the normal Workbench.
Select the right grip and move it with the native gizmo to pull. Select the
translucent tool to press. Connection strength updates live; existing damage
is not healed by raising strength. Start again reconstructs the initial specimen.
No left-panel controls are needed. Agent operations use the same experiment:
`grip([dx,dy,dz])`, `tool({position,radius})`, `connection(fraction)`,
`pause(boolean)`, `advance({steps})`, `snapshot()` and `frame()`.

This is a fixed-articulation mechanical specimen, not a PB-MPM implementation,
phase-field evolution or automatic regional repartition. The local material
lattices are the earlier yielding tetrahedral surrogate. Contact keeps its
existing world-space broadphase; this first composition does not establish the
proposed moving-grid architecture's scalability. Fine samples are physical
bodies, not extra mechanical refinement of the continuum law. Matrix self-contact
is approximated by their contacts; no calibrated clay or finished-earth claim.
The physical clock advances two 1/480-second steps per accepted display batch,
independently of the wall clock. No runtime performance result is claimed.
