# Fold / Receive Interface Study

Open the native Workbench experiment `stockroom-fold-flow`. It uses prepared
timber geometry, the retained woven-clay asset and three manually posed joint
directions. It is an interface study, not an arbitrary geometry cutter,
physical simulation or automatic mechanism designer. Water is a fixed proxy.

The span can be creased and folded directly. Its encounter with the receiving
screen exposes a local receiving proposal. Accepting creates the prepared
perpendicular articulation; the receiver's upper section provides another
crease and fold. Retreat withdraws the opportunity. Reset returns the fixture.
Ordinary native camera navigation remains available. Earlier crease revision
and scene save/reconstruction are not the study's contract.

The feature uses the shared scene/camera and a private instance of the existing
scene-edit transaction helper for transient gesture cancellation. It does not
put prototype state into the document Undo history. Closing disposes its
registrations and transient history. The study requests GI scale0.2, restoring
the preceding scale on close unless the user has changed it in the meantime.

Human controls and agent operations share `crease`, `fold`, `acceptReceiver`,
`reset` and `frame`. Readback labels prepared geometry, the actual ceramic
source, observed encounter and current poses. The OBB encounter tests analytical
slabs, not full decorative-geometry collision or continuous motion clearance.

The direct browser witness is `tools/stockroom-fold-flow-witness.mjs` with
arguments `origin expected-repo-root output-directory`. It records actual
pointer input, source identity, WebGPU/GI state, desktop/mobile canvas samples,
frames and a terminal report. `FOLD_FLOW_SUPPRESS_INPUT=1` checks that suppressed
native interaction is rejected rather than accepted as a functioning demo.
