# Contrasting Construction Workpieces

Native Workbench experiment: `stockroom-workpieces`. Three prepared analytical
fixtures compare construction decisions with the same click-through rhythm as
the separate fold/receive study. No image generation, mesh fitting, camera input
or hand inference is needed.

The attached stairs offer a rigid flight swing or a reconstructed run whose
level treads and landing retain dock-aligned edges. The
forked trough distinguishes moving an outlet, carrying the junction and
reshaping one route while retaining the inlet, opposite outlet and the held
outlet bearing. Converting route dimensions back to angular posing uses the
displayed endpoint, not a metres-to-radians reinterpretation. The kitchen
corner distinguishes carrying its vertical return, leaving that return behind,
and continuing a split from the counter up the return. Its canopy stays fixed.
Materials and members are proxies; they do not claim generated-stock fitting,
flush trough joins, physical support or swept clearance.

All three workpieces are available from the start. Clicking geometry or its
coral endpoint takes up a change; unheld pointer motion shapes it. The next
click holds the situation. Nearby choices preview different consequences on
hover. Choosing opens the choice-specific pair of parameters; another click
enters the result. Right-click or Escape backs one decision and restores that
context. Right/middle dragging navigates, suspending authoring and reanchoring
on return. The endpoint labels frame their workpieces. The reset arrow restores
all three fixtures. These authoring decisions are private fixture history, not
native document Undo or persistent construction topology.

The host retains scene, camera, renderer and frame ownership. Shared operations
are `begin({piece})`, `shape({u,v})`, `hold`, `highlight({choice})`, `choose`,
`tune({u,v})`, `enter`, `back`, `reset` and `frame({piece})`. Omit `piece` from
`frame` for the whole comparison. Readback includes committed and displayed
models, prepared geometric plans, projected targets and actual host camera.
GI resolution scale is requested at0.2 and restored on close if unchanged.

This tests whether the decisions and their different affected extents are
intelligible in use. It is not a general stair constructor, branching passage
solver, arbitrary corner cutter or recursive articulation engine. Future
connections and inter-workpiece encounters are not implemented. Reset/reopen
reconstructs the fixture; edits are not saved as an authored document.
