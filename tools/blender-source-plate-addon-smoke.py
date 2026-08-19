from __future__ import annotations

import json
from pathlib import Path
import sys
import traceback

import bpy


def main() -> int:
    if "--" not in sys.argv:
        raise RuntimeError("expected output directory after --")
    output_dir = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "source-plate-addon-smoke.json"
    source_root = Path(__file__).resolve().parents[1] / "blender_addons"
    sys.path.insert(0, str(source_root))

    report = {
        "schema": "kaminos.source-plate-addon-smoke.v0",
        "status": "running",
        "blenderVersion": bpy.app.version_string,
        "sourceRoot": str(source_root),
    }
    addon = None
    try:
        import kaminos_source_plate as addon

        addon.register()
        scene = bpy.context.scene
        mesh = bpy.data.meshes.new("MorphSmokeMesh")
        mesh.from_pydata(
            ((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)),
            ((0, 1), (1, 2), (2, 0)),
            ((0, 1, 2),),
        )
        mesh.update()
        target = bpy.data.objects.new("MorphSmokeTarget", mesh)
        scene.collection.objects.link(target)
        bpy.context.view_layer.objects.active = target
        target.select_set(True)
        target["morph_canine"] = 0.2
        target["morph_zygomatic"] = 0.8
        target["morph_enabled"] = True
        target["unrelated"] = 4.0
        expected_morphs = {"morph_canine": 0.2, "morph_zygomatic": 0.8}
        expected_applied_morphs = {"morph_canine": 1.0, "morph_zygomatic": 0.0}
        discovered = addon.discover_morph_properties(target)
        try:
            with addon.applied_morph_values(
                target, {"morph_canine": 1.0, "morph_zygomatic": 0.0}
            ):
                report["appliedMorphs"] = addon.discover_morph_properties(target)
                raise RuntimeError("intentional restoration witness")
        except RuntimeError as error:
            if str(error) != "intentional restoration witness":
                raise
        restored = addon.discover_morph_properties(target)
        bpy.context.view_layer.update()
        depsgraph = bpy.context.evaluated_depsgraph_get()
        baseline_geometry = addon._evaluated_mesh_geometry(target, depsgraph)
        mesh.vertices[1].co.x = 1.125
        mesh.update()
        bpy.context.view_layer.update()
        altered_geometry = addon._evaluated_mesh_geometry(target, depsgraph)
        mesh.vertices[1].co.x = 1.0
        mesh.update()
        basis = target.shape_key_add(name="Basis")
        shape_key = target.shape_key_add(name="EvaluatedMorph")
        shape_key.data[1].co.x = 1.25
        shape_key.value = 0.0
        bpy.context.view_layer.update()
        shape_key_baseline = addon._evaluated_mesh_geometry(target, depsgraph)
        source_vertex_before = tuple(mesh.vertices[1].co)
        shape_key.value = 1.0
        bpy.context.view_layer.update()
        shape_key_altered = addon._evaluated_mesh_geometry(target, depsgraph)
        source_vertex_after = tuple(mesh.vertices[1].co)
        visible_target = next(
            record
            for record in addon._visible_object_records(bpy.context)
            if record["name"] == target.name
        )
        report["effective"] = {
            "operatorRegistered": hasattr(bpy.types, "KAMINOS_OT_export_assay_plate"),
            "panelRegistered": hasattr(bpy.types, "KAMINOS_PT_source_plate"),
            "morphOperatorRegistered": hasattr(bpy.types, "KAMINOS_OT_export_morph_sweep"),
            "morphPanelRegistered": hasattr(
                bpy.types, "KAMINOS_PT_source_plate_morph_sweep"
            ),
            "outputRootProperty": scene.kaminos_source_plate_output_root,
            "resolutionProperty": scene.kaminos_source_plate_resolution,
            "labelProperty": scene.kaminos_source_plate_label,
            "morphSamplesProperty": scene.kaminos_source_plate_morph_samples,
            "morphModeProperty": scene.kaminos_source_plate_morph_mode,
            "expectedMorphs": expected_morphs,
            "expectedAppliedMorphs": expected_applied_morphs,
            "discoveredMorphs": discovered,
            "restoredMorphs": restored,
            "oneVertexPositionChanged": (
                baseline_geometry["positionSha256"]
                != altered_geometry["positionSha256"]
            ),
            "oneVertexTopologyUnchanged": (
                baseline_geometry["topologySha256"]
                == altered_geometry["topologySha256"]
            ),
            "oneVertexGeometryChanged": (
                baseline_geometry["geometrySha256"]
                != altered_geometry["geometrySha256"]
            ),
            "shapeKeySourceMeshUnchanged": (
                source_vertex_before == source_vertex_after == (1.0, 0.0, 0.0)
            ),
            "shapeKeyEvaluatedGeometryChanged": (
                shape_key_baseline["geometrySha256"]
                != shape_key_altered["geometrySha256"]
            ),
            "visibleRecordCarriesEvaluatedGeometry": (
                visible_target["evaluatedLocalMeshGeometry"]["geometrySha256"]
                == shape_key_altered["geometrySha256"]
            ),
        }
        if not all(
            (
                report["effective"]["operatorRegistered"],
                report["effective"]["panelRegistered"],
                report["effective"]["morphOperatorRegistered"],
                report["effective"]["morphPanelRegistered"],
                report["effective"]["resolutionProperty"] == 1024,
                report["effective"]["morphModeProperty"] == "ONE_AXIS",
                discovered == expected_morphs,
                report["appliedMorphs"] == expected_applied_morphs,
                restored == expected_morphs,
                report["effective"]["oneVertexPositionChanged"],
                report["effective"]["oneVertexTopologyUnchanged"],
                report["effective"]["oneVertexGeometryChanged"],
                report["effective"]["shapeKeySourceMeshUnchanged"],
                report["effective"]["shapeKeyEvaluatedGeometryChanged"],
                report["effective"]["visibleRecordCarriesEvaluatedGeometry"],
            )
        ):
            raise RuntimeError("registered add-on does not expose its complete runtime contract")
        report["status"] = "completed"
    except Exception as error:
        report["status"] = "failed"
        report["failure"] = {
            "phase": "addon-registration",
            "errorType": type(error).__name__,
            "message": str(error),
            "traceback": traceback.format_exc(),
        }
        return_code = 1
    else:
        return_code = 0
    finally:
        if addon is not None:
            try:
                addon.unregister()
            except Exception:
                report["unregisterFailure"] = traceback.format_exc()
                return_code = 1
        report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
        print(json.dumps(report, sort_keys=True))
    return return_code


raise SystemExit(main())
