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

In normal scene viewing, the point-cloud splat preview hides points outside the enabled crop. While Splat Correction Mode is active for that splat, the same preview shows those excluded points as faint crop context so the operator can still see what the crop is removing. Crop membership has an explicit frame:

- `axis-flipped-asset`: canonical axis-flipped asset coordinates, meaning normalized preview coordinates after `axisFlips` and before `centroidOffset`, so pivot/centroid corrections move the marker without translating crop membership.
- `visual-root-local`: the visible viewport crop-box frame under the selected splat's `splat-visual-root`. New viewport crop edits can land here because the box is parented to the same visual root as the point-cloud preview.
- `pivot-local-minus-centroid`: legacy compatibility frame for earlier saved sidecars.

For compatibility with earlier saved sidecars, Kaminos may fall back from `axis-flipped-asset` to `visual-root-local`, then to `pivot-local-minus-centroid`, when the canonical frame would include zero points and the later frame includes points. That fallback is a loader/preview compatibility path for existing sidecars, not a license for downstream renderers to guess. Saved corrections and render handoff metadata should carry `crop.frame` and `crop.sourceToCropMatrix`.

The current UI does not yet show a dedicated `CORRECTED` chip, reveal-sidecar action, or reveal-asset action. Those should be added as a follow-up because the sidecar convention is otherwise too easy to miss.

## Correction Schema

The correction sidecar currently uses schema `kaminos.splat-correction.v0`.

The correction payload has these fields:

- `orientation.rotation`: asset-local Euler rotation correction as `[x, y, z]`.
- `axisFlips`: asset-local axis signs as `[1|-1, 1|-1, 1|-1]`.
- `centroidOffset`: asset-local centroid or pivot offset as `[x, y, z]`.
- `crop`: crop metadata with `enabled`, `min`, `max`, optional `frame`, and optional `sourceToCropMatrix`.
- `crop.frame`: one of `axis-flipped-asset`, `visual-root-local`, or `pivot-local-minus-centroid`.
- `crop.sourceToCropMatrix`: 16 numeric `THREE.Matrix4.elements` values. Renderer consumers multiply raw PLY positions by this matrix, then test the resulting coordinates against `crop.min` and `crop.max`.

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
      "max": [0.7, 0.8, 0.9],
      "frame": "visual-root-local",
      "sourceToCropMatrix": [
        0.22, 0, 0, 0,
        0, 0.22, 0, 0,
        0, 0, 0.22, 0,
        -0.1, 0.04, 0.3, 1
      ]
    }
  }
}
```

## Crop Coordinate Contract

Renderer consumers should not infer the crop coordinate frame from `crop.min`, `crop.max`, `axisFlips`, and `centroidOffset` alone. Kaminos persists the effective crop predicate as:

```text
cropPoint = crop.sourceToCropMatrix * rawPlyPosition
inside = crop.min <= cropPoint <= crop.max
```

`rawPlyPosition` means the source `.ply` vertex position before Kaminos preview normalization. For PLY point-cloud previews, Kaminos first normalizes raw positions into the visible preview frame, then composes the chosen crop frame:

- `visual-root-local`: `raw PLY -> normalized preview`.
- `axis-flipped-asset`: `raw PLY -> normalized preview -> axisFlips`.
- `pivot-local-minus-centroid`: `raw PLY -> normalized preview -> axisFlips -> -centroidOffset`.

The same decorated crop metadata is exposed in `kaminos.render-handoff.v0` as `object.splatCorrection.crop` and in the Hybrid Renderer correction identity as `cropCoordinateFrame` plus `cropCoordinateMatrix`.

## Reingest Behavior

Direct reingest of the same sanitized asset filename replaces the splat asset and clears the stale correction sidecar. That prevents a new dropped asset from silently inheriting correction metadata written for an older file with the same name.

Importing an existing asset from `Greenroom -> Splat Assets` does not clear its sidecar. It applies the saved correction to the preview and render handoff.

## Scene Placement Versus Asset Correction

Kaminos keeps scene placement separate from splat correction metadata.

- Scene placement answers: where is this object in the current scene?
- Asset correction answers: how should this source splat be oriented, flipped, centered, and cropped whenever it is imported?

Pivot correction is a visible marker edit, not a scene translation edit. Moving the Pivot target updates `centroidOffset` and moves the working object pivot relative to the splat, but the splat preview position stays anchored at the scene placement. When a corrected splat is imported, the `THREE.Object3D` pivot is placed at the saved pivot so transform controls rotate and scale around the corrected pivot immediately.

The preview and render handoff compose both without using `centroidOffset` as scene translation:

```text
visible splat anchor = sceneTransform.position
object pivot = sceneTransform.position + centroidOffset
visual root local offset = inverse(object pivot transform) * sceneTransform.position
visual rotation = sceneTransform.rotation + orientation.rotation
visual scale = sceneTransform.scale * axisFlips
```

This lets a correction move the pivot or flip an asset preview without dirtying the scene object's authored placement or making the visible splat jump when it is imported.

## Material Baking Interaction

Human Splatipede consumes the same sidecar before material baking. The intended flow is:

```text
SHARP -> trim_splats -> Kaminos sidecar correction -> bake normals/materials
```

The baking scripts `bake_normals.py` and `bake_materials.py` read `<asset>.kaminos-splat.json` when it is present. They apply `orientation.rotation`, `axisFlips`, `centroidOffset`, and `crop` before projecting splats to the source image, so baked normals and materials are relative to the sidecar-corrected orientation rather than the raw SHARP orientation.

The scripts add per-vertex PBR attributes to the PLY:

- `nx, ny, nz`: baked normal. Cropped-out or unprojected splats keep the default `(0, -1, 0)`.
- `roughness`: baked roughness. Cropped-out or unprojected splats keep the default `0.5`.
- `metallic`: baked metallic value. Cropped-out or unprojected splats keep the default `0.0`.

Crop remains reversible sidecar state. `trim_splats.py` may destructively remove low-confidence fog before Kaminos, but Kaminos `crop.enabled`, `crop.min`, and `crop.max` should not rewrite or delete the PLY. Consumers either skip cropped-out splats at load/projection time or mark them inactive while preserving the source asset as the complete record.

## Render-Handoff Boundary

Splat correction metadata is editor and asset metadata. It is also input to `kaminos.render-handoff.v0` so a downstream renderer can consume the same corrected source asset.

It is not a real Gaussian renderer, not a real mesh depth occlusion claim, and not an active AO integration claim. Until the hybrid renderer route implements those paths, Kaminos capabilities must continue to report:

- `realSplatRendering: false`
- `meshDepthOcclusion: false`
- `sharedCanvasComposite: false`

The correction sidecar tells downstream code how to interpret the asset. It does not by itself prove that the asset is rendered with final splat fidelity.
