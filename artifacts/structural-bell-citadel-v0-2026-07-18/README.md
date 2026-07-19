# citadel-bell-v0 Structural Asset Package

Source directive: internal operator-signed structural bell asset request, 2026-07-19.

Required brief: internal structural bell asset brief, 2026-07-18.

## Promoted Outputs

- Visual GLB: `visual/citadel-bell-v0.glb`
- Proxy GLB: `proxy/citadel-bell-v0-proxy.glb`
- Descriptor: `structuralAssetDescriptor.json`
- Promoted convenience copies: `promoted/`

## Direct Smoke URLs

Visual:

`http://127.0.0.1:8097/index.html?mesh_root=lerms-preview&mesh_path=kaminos-handy-candyman-structural-bell-0718%2Fartifacts%2Fstructural-bell-citadel-v0-2026-07-18%2Fvisual%2Fcitadel-bell-v0.glb`

Proxy:

`http://127.0.0.1:8097/index.html?mesh_root=lerms-preview&mesh_path=kaminos-handy-candyman-structural-bell-0718%2Fartifacts%2Fstructural-bell-citadel-v0-2026-07-18%2Fproxy%2Fcitadel-bell-v0-proxy.glb`

The running local server for this receipt was `127.0.0.1:8097`, rooted at `/private/tmp/kaminos-handy-candyman-structural-bell-0718`; `lerms-preview` resolved to `/private/tmp`.

## Contract

- Asset id: `citadel-bell-v0`
- Coordinate frame: right-handed, `+Y` up, `+Z` forward, meter unit.
- Crown socket: node `bell-crown-v0` at origin with identity rotation.
- Visual node: `BellVisual`
- Proxy node: `BellProxy`
- Bell body direction: extends primarily along local `-Y`.
- Visual bounds: min `[-0.72, -1.36, -0.72]`, max `[0.72, 0.04377641290737883, 0.72]`.
- Proxy bounds: min `[-0.72, -1.34, -0.72]`, max `[0.72, 0.03, 0.72]`.
- Triangle counts: visual `2180`, proxy `84`.
- Material profile: `weathered-cast-bronze-v0`.
- Collision status: `proxy-unverified`.
- Structural authority: `false`.

## Visual Verdict

Inspected screenshots show a coherent old bronze/dark-brass bell body with strong mouth, shoulder, crown hardware, visible clapper, dark rim, and patina flecks. The proxy is deliberately simpler and legible as a named picking/collision experiment shape.

This is a bounded bell asset only. It does not include or fuse a tower, roof, masonry, castle, graph topology, ring timing, detached-body dynamics, binding, or production collision quality.

## Witnesses

- Visual direct route: `witnesses/citadel-bell-v0-visual-direct.json`, `witnesses/citadel-bell-v0-visual-direct.png`
- Proxy direct route: `witnesses/citadel-bell-v0-proxy-direct.json`, `witnesses/citadel-bell-v0-proxy-direct.png`
- Angle witness report: `witnesses/citadel-bell-v0-angle-witness.json`
- Angle captures: `witnesses/citadel-bell-v0-front.png`, `witnesses/citadel-bell-v0-oblique.png`, `witnesses/citadel-bell-v0-crown.png`, `witnesses/citadel-bell-v0-underside.png`

## Useful Misses

- First direct witness used `/private/tmp` as `--expected-server-root`, but the witness contract checks the app server root derived from `scenes/..`; corrected expected root to `/private/tmp/kaminos-handy-candyman-structural-bell-0718` while preserving `lerms-preview` as `/private/tmp`.
- First generated GLB omitted `bufferView.buffer`; Kaminos/Three GLTFLoader failed before registration. `tests/structural-bell-asset-contracts.mjs` now rejects that false-pass path.
- Initial crown loop rose above the socket and weakened the pivot/top contract; generator moved the loop down so max local Y is `0.04377641290737883`.

## Verification

- `node tests/structural-bell-asset-contracts.mjs`
- `node tests/scene-contracts.mjs`
- `node tests/scene-object-witness-contracts.mjs`
- `node scene-object-witness.mjs --scenario mesh-asset-link ...visual...`
- `node scene-object-witness.mjs --scenario mesh-asset-link ...proxy...`
- `node scripts/capture-citadel-bell-v0-angles.mjs ...visual...`
- `git diff --check`
