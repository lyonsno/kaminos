# Authored muscle coordinate export v0

This artifact is the first read-only, byte-bound source-coordinate pass from the operator-owned `cat_armature_001.blend` into Packer's real intake boundary. It deliberately emits no coordinate carrier because the selected M31/M47 subset is not authority-complete.

## Assessment

M31 and M47 have a coherent source-world endpoint measurement: helper transforms, native curve endpoints, visible-surface cap centroids, and the reviewed routing fixture agree within extraction precision. The fixture therefore supplies field-local endpoint authority. The source curve and visible surface also supply deterministic centerline and volume candidates, but neither derivation is an authority grant.

The remaining admission gap is not “find coordinates.” It is source authority for the measured centerline/radii and target volumes, real-world units, compartment bounds, and skeletal-obstacle membership. The current operator-path source graph also differs from the older fixture graph because requested/effective source path and newly preserved measurement payload participate in graph/file identity. That discrepancy is preserved as two binding conflicts; it is not repaired by substituting the older graph.

Packer consumed `m31-m47/packer-authority-probe.json`, which is explicitly marked `notAnAdmittedCoordinateCarrier`, and returned `authority-incomplete` with `packingSource: null`. No `coordinate-carrier.json` exists.

## Source and replay identity

- Requested and effective source: `/Users/noahlyons/dev/operator-scratch/blender-scenes/cat_armature_001.blend`
- Source SHA-256: `a6a4650f0114f7bb56ffcc6a336b6fd6f2db756e3a137857d92ff6571f9568e3`
- Blender: `5.1.2`
- Read-only GPU Greenroom replay job: `ae349734e542`
- Extraction file SHA-256: `8f9f915c99b15ff4dbd71687b0aac6f3eb2a5f64b67cd0541468cd1beade6678`
- Source graph id: `3f4c65867a776edfbf87bc59ca7a882b078b350078491f1822ccc9da0e426272`
- Source graph file SHA-256: `a447fe1fffcba513e3a716e56b725a9f2e511681923c6f81540f4932405a6785`
- Parent atlas id SHA-256: `b9a857559f7d20e1efe18e0a29103ba7cb2347dc3e0b20ac0df409929af6b77b`
- Authority receipt id SHA-256: `64d586c0831d48868ac51f4b1d519df0dac37073c95ad96047c352542907a490`
- Packer receipt id SHA-256: `196195295ffd64f6a0e2c54a4c412b512c6acb00518b9fa6b6435fa91c80144b`

Two executions of the current Blender extractor produced byte-identical `source-extraction.json`. Recompiling the graph, atlas, receipt, Packer probe, and Packer receipt reproduced the same file SHA-256 values.

## Parent atlas

The parent atlas enumerates all 68 source graph routes. It contains 57 candidate rows, 7 missing rows, and 4 conflict rows. Those unrelated unresolved rows remain part of the parent hash, so changing any of them invalidates the M31/M47 receipt's declared parent binding.

The four conflict rows are M58, M59, M62, and M64, where helper/curve/surface endpoint candidates disagree without a selecting authority. The seven missing rows are M17, M36, M49, M54, M55, M56, and M57, with exact component/field omissions in `m31-m47/parent-atlas.json`.

## Selected M31/M47 facts

| Field | M31 | M47 | Authority |
| --- | ---: | ---: | --- |
| Native centerline arc length | `17.663189650471388` | `18.169997366666085` | candidate |
| Visible surface volume | `60.63820937` | `65.716771464` | candidate |
| Origin position | `[5.748570919, -2.159705162, 11.065047264]` | `[8.709335327, -2.64685154, 11.094644547]` | admitted by reviewed fixture |
| Insertion position | `[5.658816338, 10.926404953, 22.928180695]` | `[7.339146137, 10.242835999, 23.827568054]` | admitted by reviewed fixture |

Curve point `radius` is preserved as a native Blender curve attribute but is not promoted to physical muscle radius; both selected paths currently carry the default value `1`. Surface-derived radius authority remains unresolved.

## Files

- `source-extraction.greenroom-command.json`: exact guarded read-only command request.
- `source-extraction.greenroom-receipt.json`: replay worker/effective-route receipt.
- `source-extraction.json`: raw source evidence with native curve samples and mesh measurements.
- `source-graph.json`: deterministic complete source graph.
- `m31-m47/parent-atlas.json`: 68-route hash-bound parent atlas.
- `m31-m47/authority-receipt.json`: exact selected-row candidate/authority classification.
- `m31-m47/packer-authority-probe.json`: diagnostic-only consumer input, explicitly not a carrier.
- `m31-m47/packer-intake-receipt.json`: Packer's refusal and exact missing-field list.

## Next authority action

The shortest path is a source-author decision naming whether the saved native path samples and visible-surface volume measurements are the admitted M31/M47 centerline/volume facts, plus explicit authority for physical radii, units, local compartment bounds, and obstacle membership. The older fixture graph identity must either be superseded by a source-authorized operator-path graph/fixture binding or retained as a declared cross-path correspondence; the exporter must not choose between those policies.

Packer's replayed authority-incomplete receipt now keeps `acceptedFields` empty because selection-authority validation exits before comparing the probe's source graph identity. The refusal therefore preserves the candidate-authority blocker without implying that the later graph-binding comparison passed.
