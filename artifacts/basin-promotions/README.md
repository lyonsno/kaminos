# Basin Promotions

For an agent setting up fire alongside model inference, start with [Load an exported basin for a cooperative inference smoke](../../docs/basin-presets-for-inference-smokes.md). It covers both plain preset JSON and the promotion mount below, including effective-renderer and shared-device checks.

This directory is the repository-visible exchange surface for authored Kaminos
fire basins. Each stable handle owns immutable revision packages and one movable
current channel:

```text
<handle>/
  current.json
  revisions/
    <basinrev-sha256>/
      package.json
```

Packages embed the complete settings-preset artifact and schema accepted by the
real Kaminos loader, the normalized effective simulator and renderer state, the
source commit, portable route templates, and exact revision identity. Package
and channel documents contain no author-checkout paths. `current.json` names its
package with a path relative to the handle directory, so the whole promotion
root can move between clones without rewriting identity.

## Headless Promotion

```sh
node volume-basin-promotion-package.mjs promote \
  --handle <stable-handle> \
  --label <human-label> \
  --root artifacts/basin-promotions \
  --settings-preset <preset-artifact.json> \
  --settings-schema volume-settings-preset-schema-v2.json \
  --effective-state <effective-state.json> \
  --source-commit <40-hex-kaminos-commit>
```

The cockpit Export action invokes this same core with
`artifacts/basin-promotions` as its editable default root.

## Consumer Mount

The consumer chooses its own settings store, runtime origin, and mount receipt
path while pinning the expected handle and revision:

```sh
node volume-basin-promotion-package.mjs mount \
  --channel <promotion-root>/<handle>/current.json \
  --handle <stable-handle> \
  --revision <basinrev-sha256> \
  --settings-store <consumer-settings-store> \
  --origin <consumer-kaminos-origin> \
  --out <consumer-mount.json>
```

Mount validates the channel, package hash, exact revision, embedded preset, and
source identity; installs the preset into the caller-selected store; and emits
consumer-origin loader and visual URLs. Moving the current channel to a later
immutable revision is the replacement operation.

New packages use `kaminos.volume.basin-route-templates.v2` and route through the immutable-preset loader. Historical packages retain their original bytes, route templates, revision and hashes. Mount validates those original templates for identity, then generates current consumer URLs independently. Its `loader.retiredVisualViews` records removed historical views; their old splat renderers are unavailable. The consumer server applies the current settings migration and reports retired controls. Historical authoring snapshots describe their source revision, not the current runtime renderer.
