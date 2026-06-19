# Splat Assets

Kaminos treats splat files as declared assets with editor-side correction metadata. A corrected splat is not a new `.ply` or `.spz` file. It is the original splat asset plus a Kaminos correction sidecar stored beside that asset.

## Asset Roots

Kaminos scans declared splat roots, not the whole machine.

- `splat-inbox`: experimental splat assets. This is where direct `.ply` or `.spz` drops are copied before import.
- `splat-production`: explicitly promoted or curated splat assets.

The default roots are under the local Kaminos asset state directory. Smoke and operator runs may override them with:

- `KAMINOS_SPLAT_INBOX_DIR`
- `KAMINOS_SPLAT_PRODUCTION_DIR`
- `KAMINOS_SPLAT_ASSET_ROOTS`

Rows from these roots appear in Kaminos at `Greenroom -> Splat Assets`.

## Corrected Splat Files

Saving a splat correction writes a sidecar next to the source asset:

```text
<asset>.kaminos-splat.json
```

Examples:

```text
plant-shelf.ply
plant-shelf.ply.kaminos-splat.json

scan.spz
scan.spz.kaminos-splat.json
```

The source `.ply` or `.spz` is left unchanged. The sidecar is the durable correction record.

If the current smoke server uses the persistent smoke roots, corrected experimental splats are usually under:

```text
/Users/noahlyons/.local/state/kaminos-smoke/splats/inbox/
```

Production splats use the same sidecar convention under:

```text
/Users/noahlyons/.local/state/kaminos-smoke/splats/production/
```

## Kaminos Discovery

To find a corrected splat in Kaminos:

1. Open `Greenroom -> Splat Assets`.
2. Find the original splat asset row.
3. Import it.
4. Select the imported splat object.
5. Open the selected-object `Splat Correction panel` in the transform inspector.

Kaminos reloads an asset correction sidecar when the splat is imported from `Splat Assets`. The scene object still has its own scene placement; the correction belongs to the source asset sidecar.

The `Splat Correction panel` exposes Pivot/Crop controls while correction mode is active. Pivot editing moves the asset-local centroid and orientation correction. Crop editing shows a visible crop bounds box in the viewport and retargets the transform gizmo to that box; translating or scaling it updates `crop.min` and `crop.max`, while the numeric crop fields remain available for exact values.

In normal scene viewing, the point-cloud splat preview hides points outside the enabled crop. While Splat Correction Mode is active for that splat, the same preview shows those excluded points as faint crop context so the operator can still see what the crop is removing. Crop membership is evaluated in axis-flipped asset coordinates: source point positions are tested after `axisFlips` and before `centroidOffset`, so pivot/centroid corrections move the marker without translating crop membership.

The current UI does not yet show a dedicated `CORRECTED` chip, reveal-sidecar action, or reveal-asset action. Those should be added as a follow-up because the sidecar convention is otherwise too easy to miss.

## Correction Schema

The correction sidecar currently uses schema `kaminos.splat-correction.v0`.

The correction payload has these fields:

- `orientation.rotation`: asset-local Euler rotation correction as `[x, y, z]`.
- `axisFlips`: asset-local axis signs as `[1|-1, 1|-1, 1|-1]`.
- `centroidOffset`: asset-local centroid or pivot offset as `[x, y, z]`.
- `crop`: crop metadata with `enabled`, `min`, and `max`.

Example:

```json
{
  "schema": "kaminos.splat-correction.v0",
  "root_id": "splat-inbox",
  "path": "plant-shelf.ply",
  "correction": {
    "orientation": { "rotation": [0.1, 0.2, 0.3] },
    "axisFlips": [-1, 1, 1],
    "centroidOffset": [0.25, -0.1, 0.4],
    "crop": {
      "enabled": true,
      "min": [-0.2, -0.3, -0.4],
      "max": [0.7, 0.8, 0.9]
    }
  }
}
```

## Reingest Behavior

Direct reingest of the same sanitized asset filename replaces the splat asset and clears the stale correction sidecar. That prevents a new dropped asset from silently inheriting correction metadata written for an older file with the same name.

Importing an existing asset from `Greenroom -> Splat Assets` does not clear its sidecar. It applies the saved correction to the preview and render handoff.

## Scene Placement Versus Asset Correction

Kaminos keeps scene placement separate from splat correction metadata.

- Scene placement answers: where is this object in the current scene?
- Asset correction answers: how should this source splat be oriented, flipped, centered, and cropped whenever it is imported?

Pivot correction is a visible marker edit, not a scene translation edit. Moving the Pivot target updates `centroidOffset` and moves the pivot marker relative to the splat, but the splat preview position stays anchored at the scene placement.

The preview and render handoff compose both without using `centroidOffset` as scene translation:

```text
visual position = sceneTransform.position
pivot marker = sceneTransform.position + centroidOffset
visual rotation = sceneTransform.rotation + orientation.rotation
visual scale = sceneTransform.scale * axisFlips
```

This lets a correction move the pivot marker or flip an asset preview without dirtying the scene object's authored placement.

## Render-Handoff Boundary

Splat correction metadata is editor and asset metadata. It is also input to `kaminos.render-handoff.v0` so a downstream renderer can consume the same corrected source asset.

It is not a real Gaussian renderer, not a real mesh depth occlusion claim, and not an active AO integration claim. Until the hybrid renderer route implements those paths, Kaminos capabilities must continue to report:

- `realSplatRendering: false`
- `meshDepthOcclusion: false`
- `sharedCanvasComposite: false`

The correction sidecar tells downstream code how to interpret the asset. It does not by itself prove that the asset is rendered with final splat fidelity.
