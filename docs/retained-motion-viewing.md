# Retained motion in the Workbench

`marionette/skeleton-motion` displays authenticated UniMate joint-position clips
as ordinary selectable scene objects. All supplied clips use one app clock.
The selected object's common playback strip supports pause, seek, frame steps,
speed and replay. Its properties choose a derived in-place loop or the raw,
unblended source once. Camera and object placement use ordinary scene controls.
The viewer renders every source joint; it performs no skin solve or inference.
This is a skeleton inspection surface, not retargeting or gait acceptance.

`tools/marionette-motion-batch.mjs` writes `view.json` and
`view-publication.json` automatically after every successful complete batch.
The generation implementation is retained from the matched Marionette runner;
the additional finalization step publishes its outputs, without regenerating
or changing them. Failed batches do not publish a successful viewing result.

Supply `--view-origin http://127.0.0.1:<port>` (or `KAMINOS_VIEW_ORIGIN`) when
the Workbench is running with the batch output under an advertised `/api/roots`
mount. The publisher locates that mount, checks the recipe and every motion
over the actual `/api/read` route, checks discovery of the viewer module, and
records a normal experiment URL. It does not open or navigate operator tabs.
HTTP link verification is distinct from visual browser inspection. The browse
route reserializes JSON: every served value must equal the retained source,
while separate file and observed HTTP hashes preserve both identities.

Without a running origin the recipe remains usable and status is `files-only`.
With an unavailable server, missing mount/viewer, wrong digest, rejected or
partial output, status is `unavailable`, `url` is null, and the phase/error are
durable. A generation result remains distinct from its viewing publication.

Existing output needs no new inference:

```sh
node tools/marionette-motion-view.mjs --report /caller/batch/report.json --origin http://127.0.0.1:18423
```

`--out` may choose a different caller-owned recipe directory. Relative motion
paths resolve both through normal static URLs and the shared `/api/read` mount.
Opening uses `experiment=marionette/skeleton-motion` with `experiment_inputs`
containing `recipe` and `recipe_sha256`; edited inline setups can be recovered
through the same `open(id, setup)` API. `invoke('setup')` retains source URLs,
digests, placements, rate, total elapsed time, play state, presentation and view.
This does not claim whole-scene Save/Load or animation export integration.
