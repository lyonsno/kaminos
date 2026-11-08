# Budgeted physical ash hierarchy

The native ash inspector offers **Budgeted hierarchy · collider detail** under
Adaptive detail. This is a new physical runtime option alongside saved fixed
and two/three-level fields. Existing saves keep their previous interpretation.

**Cell width** requests local receiving precision. **Background cell width**
independently determines covering storage. Local widths halve from that
background until they meet or exceed the requested precision. The inspector
reports the resulting effective finest pitch. A request outside float32 field
coordinate capacity is refused explicitly. There is no three-level ceiling.

**Material storage budget (MiB)** reserves one shared brick pool across all
depths, plus the covering grid and its material/flux/surface/metadata buffers.
**Airborne storage budget (MiB)** independently bounds parcel, live-list and topology-copy storage. Parcels use finest-cell mass units; one impact coats only supported neighboring cells and keeps remaining mass airborne at the contact. Transport capacity exhaustion keeps emission pending instead of dropping it. Smaller air budgets can therefore limit deposition throughput. Old saves without this setting retain their original slot count.
Object-local collision caches have separate allocations;
the runtime reports them. A finer target does not reserve a finer covering grid
or a full-world page map. Parent-relative child links cost storage only for
covering tiles and pool capacity. These controls apply through the clearing
reset, preserving placement and connected sources. Reset clears prior material.

Cached collider occupancy requests refinement. Minimum/maximum occupancy mip levels
preserve thin-feature discovery between coarse point samples and distinguish mixed boundary support from fully occupied interiors. Newly allocated
children receive their own collision stamps and can request further children.
Receiving space accompanies geometry. Projected cell size prioritizes current
visible demand; **Projected parent cell target (pixels)** sets that threshold.
Balancing support can extend outside the view. There is no live CPU readback.

Each 8³ child brick replaces a 4³ block of parent cells. Prolongation preserves
material and column fill height; staged child links become visible only after
that transfer. One physical owner supplies contact, transport, conservative
exchange and surface drawing. Neighbors remain at most one level apart.
Occupied history and supporting parents retain storage after geometry or camera
motion. Empty unneeded bricks can be reused. Under geometry pressure, empty lower priority halo/receiving leaves may yield capacity; occupied history and balancing support cannot. Capacity refusal leaves existing
material and its current resolution intact. There is no lossy history demotion.

**Show fine bricks** draws live residency, colored by depth. Empty receiving
space appears too. **Inspect fine residency** reads an explicit snapshot of
depth counts, retained history, capacity refusals and missing balancing support.
The counters describe the latest planning episode; repeated refusals need not
represent distinct locations. Ordinary unchanged evolution sleeps topology planning. An emptied-material wake releases unneeded leaves without re-running full admission. New geometry, camera projection or remaining actionable demand can wake full planning. Prolongation uses GPU indirect dispatch and launches no cell work when there are no staged children. Existing receivers keep parent-octant demand when other colliders refresh; changed topology rechecks nearby cached geometry.

`kaminos.hierarchical-ash.v1` checkpoints retain child links, node descriptors,
material, pending work, parcels and the volume ledger. Restore validates unique
parent ownership, roots, reachable nodes, balancing support and retained volume
before uploading state. Derived collision/surfaces are rebuilt without allocating
or releasing the saved topology during restoration. Old checkpoint schemas keep
their existing routes. Their restore likewise preserves authoritative topology.

The collider producer's existing cache/LOD precision still limits available
geometry. These occupancy bounds preserve what the cache contains; they do
not recover triangles already discarded by simplification. No total frame-cost
or production affordability claim follows from this implementation.

Focused checks: `tests/ash-hierarchy.mjs`, `tests/ash-hierarchy-gpu.mjs`, `tests/ash-hierarchy-impact-gpu.mjs`.
The production GPU check covers deep receiving support, actual fallout on an
elevated rail, conserved material through motion, and checkpoint restoration.
`tools/ash-hierarchy-native-witness.mjs` supplies the native pipe comparison at
fixed background/storage ceilings, captures and saved continuation. It fences each production step through explicit offline diagnostics; these readbacks are evidence work, not the live simulation path. Caller parameters choose emission/settling step counts without an upper cap. Caller-owned
output paths retain source identity, failures and console diagnostics.

## Controlling work and visibility

The native field inspector separates **Show airborne ash**, **Show accumulated
ash**, **Advance airborne ash**, and **Settle accumulated ash**. Drawing switches
leave physical state intact. Pausing airborne advancement also pauses source
admission; it does not silently bank additional source material. Disabling
settling freezes exchanges while enabled airborne transport may still deposit
new material. The global Pause ash switch stops both update paths.

**Maximum refinements** is a live admission ceiling within the Cell width grid
limit. **Depth target (MiB)** limits admission of new non-balancing bricks at
that depth within the shared material pool. Blank targets share the whole pool.
Occupied history and required balancing support remain resident, so a target
is not an eviction instruction. Lowering a target or the maximum depth preserves
existing material. **Refinement rounds / tick** controls how many waves of new
receiving detail are processed per live tick. Startup/rebuild convergence is
separate; motion can acquire deeper detail progressively. The projected parent
cell threshold also updates live. Changes to storage, covering pitch, physical
grid width or transport parcel width still require the explicit clearing reset.

A hierarchy field captures **Transport parcel width** independently of its
receiving grid. Subsequent changes to receiving precision do not shrink that
chosen physical parcel quantity. Larger parcels can remain at a contact longer
while transferring their material into fine supported cells. The volume ledger
retains both airborne and deposited material. The transport walk crosses actual
hierarchy cell boundaries through empty space instead of sampling every flight
at the globally finest pitch. This remains ballistic parcel transport, separate
from the flame raymarch.

Finest receiving cells cache four corner lighting states after dirty/active
surface updates. The cache reuses flux scratch between simulation steps and adds
no field-sized GPU buffer. Physical vertex positions retain their existing
calculation; compact corner directions use 8-bit octahedral coordinates and
8-bit coverage. Coarser cells retain the reference per-vertex reconstruction.
The simulation refreshes derived data after overwriting its scratch, including
awake cells whose material did not change. Cached lighting is derived state,
not authoritative saved material.
