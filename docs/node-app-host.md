# Node application host: serving and authoring persistence

Run the Node host from the owning checkout with explicit application and state roots:

```sh
node serve.mjs --repo-root /path/to/kaminos --state-root /path/to/consumer-state --port 8100 --startup-report /path/to/startup.json
```

`npm start -- --state-root /path/to/consumer-state` supplies the current checkout as `--repo-root`. The default state directory is `~/.local/state/kaminos/node-app`; supplying a directory keeps concurrent consumers independent. The default bind address is `127.0.0.1`. Port `0` chooses an available port and records the actual URL in the startup report. Startup failures also write the selected report. SIGINT/SIGTERM stops the server without deleting persistent state.

This profile serves the application and its installed dependencies, images, generated mesh origins and basic scene documents. It is an implementation stage of the ordinary application service, rather than a complete replacement for every `serve.py` service. Calls outside the implemented profile return an explicit error. In particular, basin/preset and cockpit-layout services, image preparation, pipeline execution, other model mounts and the shared scene library are still outside this profile. The existing page requests some of those services at startup; its corresponding warnings are real outstanding integration work.

The implemented routes are:

- Static files from `--repo-root`, and `/node_modules/` from the actual dependency directory reached through that checkout. Runtime config reports that resolved dependency directory. Other static and asset symlinks cannot leave their mounted roots.
- `/api/runtime-config`, `/api/roots` and `/api/browse` for the named caller roots.
- `/api/ingest-image`, `/api/assets?kind=image`, `/api/authoring-assets?collection=image-inbox` and `/api/read`. PNG, JPEG and WebP bytes retain their complete original display names and content digests. Uploading the same image is idempotent; changed bytes create a different asset.
- `/api/ingest-mesh` and the `generated-meshes` authoring collection. GLB container version, length, first JSON chunk and chunk boundaries are validated; the existing browser loader owns semantic mesh validation. Stored bytes are published atomically by their digest.
- `/api/mesh-generation-origin` stores the existing `kaminos.asset-generation.v1` producer metadata for an ingested GLB and returns `kaminos.mesh-generation-origin.v1`. Digest, canonical source and byte count must match the stored artifact; a run id, input digest, route and successful producer receipt validation are required. The service stores that producer assertion; it does not itself verify model execution. Additive producer fields are retained. Browse and the authoring catalog expose the authored name and generation data after restart. Invalid or corrupt origins produce visible catalog warnings rather than inferred provenance.
- `/api/save-scene` and reading/browsing `scenes`. Scene data, including additive fields, is preserved. Named Save As returns 409 when a file exists until the caller explicitly confirms overwrite. Save can use its existing filename.

The private state directory contains `assets/images/inbox`, `assets/generated-meshes`, `scenes` and `scratch`. `--root id=/path/to/directory` replaces or adds a browse root. The host reports the effective roots; it does not discover other stores or silently fall back to a nearby checkout.

Each Node generation run is published as one complete, immutable record in `.<mesh-sha256>.glb.origins/<run-id-sha256>.json`. Concurrent hosts can retain different runs for the same mesh without replacing an aggregate file. Identical retries are idempotent; conflicting reuse of a run id returns409. The most recently published Node record supplies the catalog name/provenance, with a deterministic digest tie-break for equal file times. Repeating an identical request does not change which run was most recently published. The Node host also reads existing `kaminos.mesh-generation-origins.v1` Python aggregates. New Node records are not readable by the Python server; simultaneous Python/Node writers to one store are outside this profile. Choose a Node-owned store or transfer an existing store to Node. Mesh bytes remain available after an origin error, supporting the existing callback's persistence retry without repeating inference.

An existing prepared SAM packet can be mounted explicitly:

```sh
node serve.mjs --repo-root /path/to/kaminos --state-root /path/to/consumer-state --sam3-packet-root /path/to/packet
```

The manifest and packet files are served beneath `/sam3-packet/`, with HEAD and single byte-range requests. `runtime-config.sam3` names the mount and whether its manifest exists; the model loader still validates the model itself. This mount performs no preparation or model computation and starts no Python process. Browser JS/Wasm retains model ownership.

Focused verification uses `npm test -- --only tests/node-app-host.mjs,tests/node-app-host-cli.mjs,tests/node-mesh-origins.mjs`. The Node source and CLI tests need no Python runtime. Whole-application or native model acceptance still needs the actual consumer through this service; static/API tests alone do not establish it.
