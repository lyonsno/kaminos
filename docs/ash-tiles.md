# Connected retained ash

Open the **Ash — retained landscape** Workbench experiment (`ash-tiled-landscape`).
It uses the same kiln, editable source and ordinary draggable contact as the
prior GPU ash experiment, with a connected tiled density field and cached faces.
The default fixture is 3.84 × .96 × 3.84 world units, .03 cells and 16³-cell
bricks. An explicit .35 world-volume settled deposit seeds the bed; pass
`initialVolume:0` in experiment inputs to start empty. It is controlled fixture
material, not combustion yield. The broad visual flakes and haze remain the
separate atmospheric approximation described in [ash-atmosphere.md](ash-atmosphere.md).

Material occupies one bounded 3D field. Brick edges impose no physical wall.
The six checkerboard exchange phases use global cell parity and one owner per
pair, including pairs spanning bricks. A GPU header scan admits pending tiles
and a conservative phase-dependency neighbourhood; moved contacts admit their
swept region. Separate admission and wake clearing preserve incoming events.
Changed pairs and landed parcels mark future work and dirty affected surfaces.
An unchanged field sleeps after pending work drains. There is no active-tile
quota, camera-based material deletion or hidden step catch-up.

The first implementation allocates its declared field and face-cache capacity
up front. Memory still follows retained extent. Small header scans and a face
count prefix remain proportional to allocated tile count even during sleep;
physical exchange follows admitted tiles. Each brick has room for all six faces
of every local cell, so no surface is dropped under a capacity heuristic.
Effective WebGPU buffer/dispatch limits reject unsupported requests visibly.
This is local scheduling over resident storage, not a dynamic sparse allocator.

Only dirty bricks and affected boundary neighbours rebuild their face cache.
Faces hidden by adjacent material or support are omitted; partial-cell side
strips retain their heights. The renderer uses one prefix-indexed indirect face
draw with the existing material, illumination and shadow paths. Sleeping bricks
keep their geometry. Camera movement does not remesh or wake them. The prefix
lookup adds vertex work and the worst-case cache is larger than the earlier
single-record cube list; these are explicit tradeoffs, not a measured speedup.

Falling material uses the existing ballistic parcel law. A small occupancy-mask
scan admits only occupied or needed spawning groups of64slots. An indirect
transport dispatch handles those groups and an indirect draw contains only live
parcels. Pending volume remains when slots or landing columns cannot accept it.
Group masks and visible IDs are derived from retained parcel mass on restore.
Density/support, transport and surfaces share the existing application device;
the ordinary live path has no readback. Explicit diagnostics, checkpointing and
settled-fixture loading perform readback/CPU work.

`diagnostics` returns actual GPU active/rebuilt tile counts, exchange cell visits,
changed pairs, visible face count, per-tile updates/revisions and dispatched
transport groups. `{fields:true}` additionally returns density and the actual
static support mask for offline conformance. These counters measure work shape;
they are not milliseconds. `snapshot`/`restore` preserve density, pending wake,
contact continuation, airborne parcels and pending source volume. Restore checks the
introduced-material ledger against physical retained volume before uploading. The
Contact affects ash checkbox can remove the sphere from the physical interaction;
its former region wakes so held material can settle. Surface caches
and airborne scheduling rebuild from that physical state. The outer patch is
closed. Kiln support remains a fixed64³voxelization and moving the kiln or ground
requires rebuilding the fixture. Ordinary scene Save still does not retain this
experiment; use Save ash/Load ash.

This slice does not introduce pile momentum, reactive rigid bodies, arbitrary
moving collision geometry, dynamic allocation, Sinter yield coupling or a proven
1ms total cost. It preserves the simple conservative redistribution law while
changing its scheduling and display representation.
