# Kaminos Image Assets

Kaminos treats reference, test, and generated raster images as declared assets. Agents should not search the whole machine for an Evil Orb test image, and operators should not have to remember an ad hoc download folder.

## Roots

The image asset index scans only declared roots:

- `image-inbox`: experimental image inbox. Default path: `~/.local/state/kaminos/assets/images/inbox`.
- `image-production`: curated production image assets. Default path: `~/.local/state/kaminos/assets/images/production`.

Runtime overrides:

- `KAMINOS_IMAGE_INBOX_DIR`: replaces the `image-inbox` path.
- `KAMINOS_IMAGE_PRODUCTION_DIR`: replaces the `image-production` path.
- `KAMINOS_IMAGE_ASSET_ROOTS`: os-path-separated additional experimental image roots.
- `KAMINOS_ASSETS_DIR`: moves the shared Kaminos asset tree when a more specific image override is not set.

For the common smoke layout using `KAMINOS_ASSETS_DIR=~/.local/state/kaminos-smoke`, an Evil Orb reference image belongs at:

```text
~/.local/state/kaminos-smoke/images/inbox/evil-orb-test.png
```

For the default local layout, put it at:

```text
~/.local/state/kaminos/assets/images/inbox/evil-orb-test.png
```

After it is promoted or curated, duplicate the pointer or copy the asset into:

```text
~/.local/state/kaminos/assets/images/production/evil-orb-test.png
```

## API

Agents can discover images through the declared index:

```text
/api/assets?kind=image
```

Entries include `root_id`, `stage`, `path`, `source`, `size`, `mtime`, and display metadata. Load an image through its `source`, for example:

```text
/api/read?root=image-inbox&path=evil-orb-test.png
```

Loose or generated images should be ingested through:

```text
/api/ingest-image?name=evil-orb-test.png
```

The request body is the image bytes. Supported file extensions are `.png`, `.jpg`, `.jpeg`, and `.webp`. The server sanitizes the filename and writes to `image-inbox`.

## UI

Open `Library` to view indexed image roots as thumbnails. Selecting a thumbnail opens an in-app preview/detail panel with the asset root, stage, and `source` route. `Copy Source` copies the route for a witness or another agent; `Open File` is a utility action, not the primary browsing flow.

Generated images use `Add to Library`, which writes through `/api/ingest-image` instead of downloading into an operator-specific browser folder. Dropped loose raster files also ingest into `image-inbox`. The Library tab can also capture the current Kaminos viewport into `image-inbox` through `Capture View`.
