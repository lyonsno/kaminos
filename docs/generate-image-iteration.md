# Iterating on generated images

## Experiment browser

**Assets → Browse → Experiments** opens saved experiments inside Kaminos. Agent-authored experiments also appear under their author in **Agent work**, alongside ordinary generated assets. Open a collection to see its grouped images, select a result to inspect its original request and expanded/submitted prompts, or compare two members. **Edit recipe & rerun** opens the existing Generate controls with that image’s recorded settings. Results automatically join **Iterations** in the originating experiment, even if you browse another collection while generation finishes. **Back to experiment** returns to the collection. The collection and its images persist across reloads and browser origins.

**New experiment** creates a named collection, optionally including the selected image. **New recipe** starts a first run in that collection; existing images can be added from Browse with **Add to experiment**. **Edit details** changes the title and description without replacing members. A stale edit asks you to refresh. Saved-image failures remain visible; failed result registration retains the generated pixels for delivery retry. Images without a recorded supported recipe can be collected and compared, but cannot promise recipe recall.

**Edit this image** uses the selected experiment member as the reference for a fresh instruction and retains the experiment destination. It also works for conditioning plates without generation metadata and for older early-decoded images whose exact recipe cannot be restored. **Edit recipe & rerun** continues to require a supported recorded recipe; it does not silently replace an unsupported sampler with current defaults.

New saved images explicitly record adapter presence, including no adapter. An older FLUX.3 image lacking that record remains usable for comparison and fresh image edits, but exact recipe replay asks for a fresh recipe rather than assuming the currently mounted adapter is the original.

Direct links use `?workspace=authoring&asset_collection=image-experiments` for the library and `?workspace=authoring&image_experiment=<id>` for a collection. They open native Browse without adding image planes to the scene.

The UI and agents use the same `/api/image-experiments` endpoint: GET lists collections, GET with `id` reads one, and POST accepts `create`, `update`, or `add`. Each collection is one `kaminos.image-experiment.v1` JSON document under `KAMINOS_IMAGE_EXPERIMENTS_DIR` (default: the shared assets directory’s `image-experiments` subdirectory). Writes merge membership under a lock and replace the document atomically. Metadata updates carry its `revision`. Members retain local asset sources, names, groups and `reference`/`result` roles; display metadata is read from the actual saved PNG, with the existing asset visibility holds applied. A missing image keeps its membership and shows as unavailable.

For an agent-authored collection, include `agent: {id, label}`. A file-driven import uses `python3 tools/image-experiment.py --origin http://127.0.0.1:PORT --manifest operation.json --out receipt.json`. Example operation:

```json
{
  "action": "create",
  "id": "glove-flight",
  "title": "Living glove",
  "description": "Direct and expanded prompts across seeds",
  "agent": {"id": "example-agent", "label": "Example agent"},
  "members": [{
    "source": "/api/read?root=image-inbox&path=example.png",
    "name": "Seed 7006",
    "group": "Direct request",
    "role": "result"
  }]
}
```

Use `add` with `id` and `members` to append idempotently. Use `update` with `id`, current `revision`, and changed title/description. Native JavaScript consumers can use `window.kaminosAssets.experiments` for the same operations. No inference starts on collection open.

## Generate and recipe history

Generate keeps an image history strip beneath its existing controls. New results retain their input identity, original request, expanded text, final submitted prompt, model, seed and dimensions. Selecting an existing saved image in Browse also brings it into history; PNG generation metadata is read when available. Images stay in the asset store; the journal and viewing/reference choices persist in this browser origin's local storage without a retention cap. Missing storage or a failed save is reported in the history panel.

Click a thumbnail to inspect it. This changes the viewed image and mesh input, while leaving the pinned image reference for the next image edit unchanged. **Use as reference** pins the viewed image and enables image conditioning. **Edit this image** also clears the prompt for a fresh instruction. **Reopen recipe** restores the submitted prompt, model, seed, size, shape, weight precision and original conditioning reference. The seed stays fixed on recall; enable **New seed after each run** or use the reseed button when exploring variation. The expandable instruction record shows all three text stages. **Undo expansion** also works after recall, returning the unchanged expanded prompt to its original request. **Clear recipe** clears the helper provenance while retaining the editable text and settings. Within a saved collection this action is **Leave experiment**, which also detaches future results from that collection.

**Compare images** expands the existing panel into two image views. Choose another history image from the comparison menu. Zoom and pan work on either image and move both together. Hold **Show input** to blink the comparison image over the viewed image. Original/segmented display uses the same mode for both images; if either cutout is unavailable, both originals are shown.

A reopened recipe remains the parent of reruns until you reopen another recipe or choose **Clear recipe** or **Leave experiment**. Browsing another result does not change it. The panel shows which settings differ; saved PNG metadata includes the parent and each changed value. Comparison defaults to the recipe parent, independently of the conditioning image. **Edit this image** starts a fresh instruction using the selected result as conditioning while retaining its experiment membership. Entering Generate from a collection, including through comparison, keeps new results in that collection; browsing alone does not retarget an in-flight run.

Saved local images can open directly with `?workspace=authoring&image_root=<asset-root>&image_path=<path>&image_action=iterate&image_name=<label>`. This mounts the image in the scene and opens Generate. The same operations are available through `window.kaminosAssets.openImageRecipe(entry)`, `imageRequest()`, and `generateImage()`. Existing Browse/history also provides **Reopen recipe**.

Recall requires supported PNG generation metadata. Missing or unsupported settings and early-decoded results show an error instead of silently choosing defaults. Where recorded, model source revision, sampler and adapter identity are checked against the package actually loaded before inference. Reopening preserves recorded settings; it does not promise identical pixels across runtime or kernel versions. Older FLUX.2 UI recipes without a prompt-padding field use their original `fit16` behavior; FLUX.3 owns its padding.

**Keep prompt helper loaded** retains the helper's model after a successful expansion. Its execution lease is released between requests. **Unload**, Cancel, disabling retention or closing the tab retires the worker. Retention begins after first use and keeps model memory allocated; it does not preload models on page open. A browser preference overrides the server's `KAMINOS_PUP_KEEP_LOADED` initial default.

Prompt expansion joins the configured Greenroom execution queue by default. The pending entry appears in Greenroom and the page displays its current position and GPU holder. Cancel removes that entry. When first, the page exchanges its ticket for an execution lease; the ticket’s completion receipt records admission only, while the external lease records the active page. Resident weights release that lease between requests.

**Run outside queue** starts a request without waiting or claiming a lease. While waiting, **Run outside queue now** first withdraws the pending entry, then starts the helper. This explicit choice can overlap other work and share its GPU and memory; the result records that execution occurred outside Greenroom. The choice starts unchecked on each page load. A failed withdrawal is reported and prevents starting, so a stale ticket cannot silently remain at the front. The server needs a Greenroom CLI with `lease queued-claim` and `lease withdraw-queued`; older CLIs fail visibly rather than polling forever.

Local model packages are registered once for ordinary startup across working copies. See [installed models](local-model-installations.md) for registration, explicit invocation overrides, and availability diagnoses.


Selecting recipes in an experiment and choosing **Variations…** opens a saved-run composer. **Model** and **Image size** can keep each recipe's recorded setting or apply an explicit choice to the whole run. Size is the output's long side; each recipe keeps its aspect. The preview shows each effective model, size and weight precision. Changing to a model that does not support the recorded precision selects that model's supported full precision. Prompts and original conditioning references stay with their recipes. **Save plan** persists these choices; **Save & run**, Continue and Retry execute the same saved choices, and result admission checks them. Changing model uses the currently installed selected model package rather than demanding the prior model's source/sampler/adapter identity; unchanged-model recipes retain their recorded identity checks.

Variations require supported saved generation recipes. A raw image or a saved shape-conditioning image can instead enter **Edit this image** for a fresh prompt using it as a reference; it cannot replay a generation recipe it does not contain. Shape conditioning itself can start from an available raw PNG, JPEG or WebP without generation metadata.
