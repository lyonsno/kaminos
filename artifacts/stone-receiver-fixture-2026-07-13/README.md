# Stone Receiver Fixture - 2026-07-13

Purpose: positive asset-side receiver fixture for Beaming's receiver-buffer work. This is intended to replace hardcoded wall/floor receiver planes with asset-authored receiver geometry, node roles, bounds, proxy identity, and explicit material/view boundaries.

## Result

This folder contains a procedural matte stone corner GLB, a low-poly receiver proxy GLB, and a `receiverDescriptor` receipt. Both visual and proxy GLBs load through Kaminos and register as scene objects with two-angle witness captures.

The fixture is deliberately simple. It is not a photoreal wall set, and it does not prove Beaming receiver-buffer consumption. It is a clean positive target for Beaming to render opted-in receiver surfaces and reject non-receiver geometry.

## Files

- Visual GLB: `visual/matte-stone-corner-receiver.glb`
- Proxy GLB: `proxy/matte-stone-corner-receiver-proxy.glb`
- Descriptor: `receiver-descriptor.json`
- Build receipt: `receipt.json`
- Manifest: `manifest.json`
- Builder: `tools/build_receiver_fixture.py`

Promoted files:

- `promoted/matte-stone-corner-receiver.glb`
- `promoted/matte-stone-corner-receiver-proxy.glb`
- `promoted/receiver-descriptor.json`
- `promoted/stone-receiver-visual-oblique.png`
- `promoted/stone-receiver-proxy-front.png`

## Geometry Contract

Visual GLB nodes:

- `receiver_floor`: receiver floor slab, role `floor`.
- `receiver_back_wall`: receiver wall slab, role `kiln_wall`.
- `receiver_side_wall`: receiver wall slab, role `kiln_wall`.
- `stone_seam_floor_left`, `stone_seam_floor_right`, `stone_seam_back_mid`: visual seam accents.
- `non_receiver_rubble_block_a`, `non_receiver_rubble_block_b`: small prop blocks that should stay out of the receiver mask.

Proxy GLB nodes:

- `proxy_receiver_floor`
- `proxy_receiver_back_wall`
- `proxy_receiver_side_wall`

The descriptor selects the proxy as the preferred `maskSource` for the receiver floor/walls and marks the rubble nodes as `receiver=false`.

## Viewer Witness

Visual witness:

- Receipt: `witnesses/stone-receiver-visual-kaminos-witness.json`
- Front capture: `witnesses/stone-receiver-visual-front.png`
- Oblique capture: `witnesses/stone-receiver-visual-oblique.png`

Visual inspection: the oblique capture shows a clean wall/floor/side-wall corner with non-receiver rubble blocks off to the side. This is suitable as a positive receiver fixture and rejection target.

Proxy witness:

- Receipt: `witnesses/stone-receiver-proxy-kaminos-witness.json`
- Front capture: `witnesses/stone-receiver-proxy-front.png`
- Oblique capture: `witnesses/stone-receiver-proxy-oblique.png`

Visual inspection: the front capture clearly shows the warm receiver-mask proxy plane; the oblique capture shows the proxy corner, though one face remains darker under the generic viewer lighting. The warm proxy material is a witness/mask visualization, not the final stone material response.

## Preserved Misses

The first proxy witness used single-sided matte stone planes and rendered too dark for operator-facing evidence:

- `witnesses/stone-receiver-proxy-dark-single-sided-front.png`
- `witnesses/stone-receiver-proxy-dark-single-sided-oblique.png`
- `witnesses/stone-receiver-proxy-dark-single-sided-kaminos-witness.json`

The second proxy witness used two-sided matte stone planes and remained too dark:

- `witnesses/stone-receiver-proxy-dark-two-sided-front.png`
- `witnesses/stone-receiver-proxy-dark-two-sided-oblique.png`
- `witnesses/stone-receiver-proxy-dark-two-sided-kaminos-witness.json`

The third proxy witness used low emissive warm material and still did not read loudly enough:

- `witnesses/stone-receiver-proxy-low-emissive-front.png`
- `witnesses/stone-receiver-proxy-low-emissive-oblique.png`
- `witnesses/stone-receiver-proxy-low-emissive-kaminos-witness.json`

These misses are useful evidence for why the final proxy GLB uses an unmistakable warm mask witness material while the descriptor keeps matte-stone material-response hints separate.

## Receiver Descriptor Summary

The descriptor is `kaminos.receiver-descriptor.v0` and defaults to `non_receiver`. Only the named receiver floor/wall nodes participate. Missing descriptor, missing proxy, unknown bounds/transforms, or accidental direct-mask use of disabled nodes should fail loud rather than fall back to hardcoded receiver planes.

This is the fixture Beaming can use to validate:

- warm pixels only where opted-in asset surfaces/proxy render;
- camera/orbit keeps illumination attached to asset silhouettes;
- non-receiver rubble and background stay black;
- effective receiver source and descriptor/proxy identity are recorded.

## Next Boundary

Handy has produced the asset-side fixture. Beaming owns receiver-buffer consumption and should render the proxy or opted-in receiver nodes into coverage/depth/normal buffers using the live camera. Any fallback to old hardcoded wall/floor planes should fail loud in Beaming's witness.
