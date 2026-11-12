# Fold / Receive Interface Study

Open the native Workbench experiment `stockroom-fold-flow`. It uses prepared
timber geometry, the retained woven-clay asset and three manually posed joint
directions. It is an interface study, not an arbitrary geometry cutter,
physical simulation or automatic mechanism designer. Water is a fixed proxy.

Clicking the span takes up its prepared bend; subsequent unheld pointer motion
controls its angle. Clicking again holds the situation. At an encounter, two
stable choices offer a side-opening or dropping flap. Hover previews their
different hinge geometry without accepting either. Clicking a choice starts
paired tuning: horizontal motion changes the participating span and vertical
motion changes the articulation angle. The next click enters that configured
result without automatically starting another motion. The receiver's upper
section provides a subsequent prepared crease/fold. Reset returns the fixture.

Right-click backs out one decision, retaining the context of its parent.
Right-drag and middle-drag remain native camera navigation; authoring pauses
during navigation and reanchors the pointer on return. Escape and the local
back arrow provide the same contextual return. Tab over the active viewport
does not enter unrelated polygon editing. Earlier arbitrary crease revision,
precise cross-part selection and scene save/reconstruction are not contracts
of this interface study.

The feature uses the shared scene/camera/navigation services and a private
prepared decision sequence, not the document Undo history or a construction
topology model. The native navigation cancel operation is used only to return
an observed short secondary click, not to replace camera dragging. Closing
disposes feature listeners and scene registrations. The study requests GI scale0.2, restoring
the preceding scale on close unless the user has changed it in the meantime.

Human controls and agent operations share `begin`, `bend`, `hold`, `highlight`,
`choose`, `tune`, `enter`, `back`, `reset` and `frame`. `begin` takes a part,
`bend` an angle, `highlight` a choice, and `tune` extent/angle. Readback includes
stage, decision depth, provisional and committed geometry, parameters, the
actual ceramic source, encounter and current poses. The OBB encounter tests analytical
slabs, not full decorative-geometry collision or continuous motion clearance.
The flap is a prepared local band with adjustable width and surrounding fixed
infill, not arbitrary surface subdivision. Parameter ranges reflect this
receiver's actual width; angle remains freely posed. Generated stock remains
small retained ceramic detail rather than structural stock fitting.

The direct browser witness is `tools/stockroom-fold-flow-witness.mjs` with
arguments `origin expected-repo-root output-directory`. It records actual
pointer input, source identity, WebGPU/GI state, desktop/mobile canvas samples,
frames and a terminal report. `FOLD_FLOW_SUPPRESS_INPUT=1` checks that suppressed
native interaction is rejected rather than accepted as a functioning demo.
