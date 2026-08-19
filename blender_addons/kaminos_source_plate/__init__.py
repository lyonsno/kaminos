from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import traceback

import bpy
from bpy.props import EnumProperty, IntProperty, StringProperty

from .capture_core import (
    SCHEMA,
    SourcePlateCaptureError,
    applied_morph_values,
    atomic_write_json,
    build_morph_sample_plan,
    capture_paths,
    discover_morph_properties,
    evaluated_mesh_geometry_record,
    evaluated_visible_object_mesh_geometry_record,
    inspect_png,
    parse_morph_sample_values,
    validate_fixed_raster,
)


bl_info = {
    "name": "Kaminos Source Plate",
    "author": "Kaminos",
    "version": (0, 2, 0),
    "blender": (4, 3, 0),
    "location": "View3D > Sidebar > Kaminos",
    "description": "Export the current viewport as a fixed-raster assay conditioning plate",
    "category": "3D View",
}


DEFAULT_OUTPUT_ROOT = "/Users/noahlyons/dev/operator-scratch/source-plates"


def _matrix_rows(matrix):
    return [[float(value) for value in row] for row in matrix]


def _vector_values(value):
    return [float(component) for component in value]


def _enum_or_value(value):
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    try:
        return list(value)
    except TypeError:
        return str(value)


def _attributes(source, names):
    return {
        name: _enum_or_value(getattr(source, name))
        for name in names
        if hasattr(source, name)
    }


def _source_record():
    source_path = Path(bpy.data.filepath).resolve() if bpy.data.filepath else None
    source_stat = source_path.stat() if source_path and source_path.is_file() else None
    return {
        "path": str(source_path) if source_path else None,
        "exists": source_stat is not None,
        "byteLength": source_stat.st_size if source_stat else None,
        "modifiedAtNs": source_stat.st_mtime_ns if source_stat else None,
    }


def _evaluated_mesh_geometry(obj, depsgraph):
    evaluated = obj.evaluated_get(depsgraph)
    return _evaluated_mesh_geometry_from_evaluated(evaluated, depsgraph)


def _evaluated_mesh_geometry_from_evaluated(evaluated, depsgraph):
    mesh = evaluated.to_mesh(
        preserve_all_data_layers=False,
        depsgraph=depsgraph,
    )
    if mesh is None:
        raise SourcePlateCaptureError(
            "context-capture", f"could not evaluate visible mesh {evaluated.name!r}"
        )
    try:
        return evaluated_mesh_geometry_record(
            vertices=(tuple(vertex.co) for vertex in mesh.vertices),
            edges=(tuple(edge.vertices) for edge in mesh.edges),
            polygons=(tuple(polygon.vertices) for polygon in mesh.polygons),
        )
    finally:
        evaluated.to_mesh_clear()


def _visible_object_records(context):
    depsgraph = context.evaluated_depsgraph_get()
    records = []
    for obj in sorted(context.visible_objects, key=lambda item: item.name):
        evaluated = obj.evaluated_get(depsgraph)
        record = {
            "name": obj.name,
            "type": obj.type,
            "hideRender": bool(obj.hide_render),
            "matrixWorld": _matrix_rows(evaluated.matrix_world),
        }
        if obj.type == "MESH":
            record["evaluatedLocalMeshGeometry"] = (
                _evaluated_mesh_geometry_from_evaluated(evaluated, depsgraph)
            )
        records.append(record)
    return records


def _capture_context(context):
    region = context.space_data.region_3d
    shading = context.space_data.shading
    scene = context.scene
    view_settings = scene.view_settings
    display_settings = scene.display_settings
    sequencer_settings = scene.sequencer_colorspace_settings
    camera = scene.camera if region.view_perspective == "CAMERA" else None
    visible_objects = _visible_object_records(context)
    visible_object_mesh_geometry = (
        (
            record["name"],
            record["evaluatedLocalMeshGeometry"],
            record["matrixWorld"],
        )
        for record in visible_objects
        if "evaluatedLocalMeshGeometry" in record
    )
    return {
        "scene": scene.name,
        "viewLayer": context.view_layer.name,
        "viewMatrix": _matrix_rows(region.view_matrix),
        "viewPerspective": region.view_perspective,
        "viewLocation": _vector_values(region.view_location),
        "viewRotation": _vector_values(region.view_rotation),
        "viewDistance": float(region.view_distance),
        "viewLens": float(context.space_data.lens),
        "viewCameraZoom": float(region.view_camera_zoom),
        "viewCameraOffset": _vector_values(region.view_camera_offset),
        "clipStart": float(context.space_data.clip_start),
        "clipEnd": float(context.space_data.clip_end),
        "viewportRegion": {
            "width": int(context.region.width),
            "height": int(context.region.height),
        },
        "camera": camera.name if camera else None,
        "shading": _attributes(
            shading,
            (
                "type",
                "light",
                "color_type",
                "single_color",
                "studio_light",
                "show_shadows",
                "show_cavity",
                "cavity_type",
                "show_specular_highlight",
                "background_type",
                "background_color",
                "show_xray",
                "xray_alpha",
            ),
        ),
        "visibleObjects": visible_objects,
        "evaluatedVisibleObjectMeshGeometry": (
            evaluated_visible_object_mesh_geometry_record(
                visible_object_mesh_geometry
            )
        ),
        "colorManagement": {
            "displayDevice": display_settings.display_device,
            "viewTransform": view_settings.view_transform,
            "look": view_settings.look,
            "exposure": float(view_settings.exposure),
            "gamma": float(view_settings.gamma),
            "sequencerColorSpace": sequencer_settings.name,
        },
    }


def _snapshot_render_settings(scene):
    image_settings = scene.render.image_settings
    return {
        "filepath": scene.render.filepath,
        "resolution_x": scene.render.resolution_x,
        "resolution_y": scene.render.resolution_y,
        "resolution_percentage": scene.render.resolution_percentage,
        "file_format": image_settings.file_format,
        "color_mode": image_settings.color_mode,
        "color_depth": image_settings.color_depth,
        "compression": image_settings.compression,
    }


def _restore_render_settings(scene, snapshot):
    image_settings = scene.render.image_settings
    scene.render.filepath = snapshot["filepath"]
    scene.render.resolution_x = snapshot["resolution_x"]
    scene.render.resolution_y = snapshot["resolution_y"]
    scene.render.resolution_percentage = snapshot["resolution_percentage"]
    image_settings.file_format = snapshot["file_format"]
    image_settings.color_mode = snapshot["color_mode"]
    image_settings.color_depth = snapshot["color_depth"]
    image_settings.compression = snapshot["compression"]


def _active_morph_parameters(context, *, mode="single", row=None):
    target = context.active_object
    if target is None:
        return None
    values = discover_morph_properties(target)
    if not values:
        return None
    record = {
        "targetObject": target.name,
        "mode": mode,
        "kind": "current",
        "axis": None,
        "sample": None,
        "values": values,
    }
    if row is not None:
        record.update(
            {
                "kind": row["kind"],
                "axis": row["axis"],
                "sample": row["sample"],
            }
        )
    return record


def _capture_assay_plate(context, *, label, morph_parameters=None):
    scene = context.scene
    source = _source_record()
    source_stem = Path(source["path"]).stem if source["path"] else "unsaved"
    captured_at = datetime.now(timezone.utc).isoformat(timespec="microseconds").replace(
        "+00:00", "Z"
    )
    width, height = validate_fixed_raster(
        scene.kaminos_source_plate_resolution,
        scene.kaminos_source_plate_resolution,
    )
    paths = capture_paths(
        output_root=scene.kaminos_source_plate_output_root,
        source_stem=source_stem,
        label=label,
        captured_at=captured_at,
    )
    requested = {
        "outputRoot": str(Path(scene.kaminos_source_plate_output_root).expanduser()),
        "width": width,
        "height": height,
        "label": label,
    }
    document = {
        "schema": SCHEMA,
        "status": "running",
        "capturedAt": captured_at,
        "requested": requested,
        "effective": {},
        "sourceBlend": source,
        "sourceDirty": bool(bpy.data.is_dirty),
        "output": {
            "image": str(paths["image"]),
            "sidecar": str(paths["sidecar"]),
        },
    }
    if morph_parameters is not None:
        document["morphParameters"] = morph_parameters
    snapshot = _snapshot_render_settings(scene)
    phase = "context-capture"
    succeeded = False
    try:
        document["effective"] = _capture_context(context)
        phase = "viewport-render"
        scene.render.filepath = str(paths["image"])
        scene.render.resolution_x = width
        scene.render.resolution_y = height
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"
        scene.render.image_settings.color_depth = "8"
        scene.render.image_settings.compression = 15
        result = bpy.ops.render.opengl(write_still=True, view_context=True)
        if "FINISHED" not in result:
            raise SourcePlateCaptureError(
                "viewport-render", f"Blender viewport render returned {sorted(result)}"
            )

        phase = "output-validation"
        output_record = inspect_png(
            paths["image"], expected_width=width, expected_height=height
        )
        if not output_record["nonblank"]:
            raise SourcePlateCaptureError(
                "output-validation", "viewport render contains no visible pixel signal"
            )
        if output_record["uniform"]:
            raise SourcePlateCaptureError(
                "output-validation", "viewport render is a uniform image"
            )
        document["status"] = "completed"
        document["effective"]["width"] = output_record["width"]
        document["effective"]["height"] = output_record["height"]
        document["output"].update(output_record)
        succeeded = True
    except Exception as error:
        document["status"] = "failed"
        document["failure"] = {
            "phase": getattr(error, "phase", phase),
            "errorType": type(error).__name__,
            "message": str(error),
            "traceback": traceback.format_exc(),
            "lastTrustworthyEvidence": {
                "contextCaptured": bool(document["effective"]),
                "imageExists": paths["image"].is_file(),
            },
        }
    finally:
        _restore_render_settings(scene, snapshot)
        document["sourceBlendAfter"] = _source_record()
        document["sourceDirtyAfter"] = bool(bpy.data.is_dirty)
        document["renderSettingsRestored"] = _snapshot_render_settings(scene) == snapshot
        atomic_write_json(paths["sidecar"], document)

    if not succeeded:
        raise SourcePlateCaptureError(
            document["failure"]["phase"],
            f"Source Plate failed during {document['failure']['phase']}: "
            f"{document['failure']['message']}",
        )
    return paths["image"]


def _morph_row_label(prefix, row, index):
    if row["kind"] == "baseline":
        suffix = "baseline"
    elif row["kind"] == "axis":
        axis = row["axis"].removeprefix("morph_")
        sample = f"{row['sample']:.6g}".replace("-", "neg-").replace(".", "p")
        suffix = f"{axis}-{sample}"
    else:
        suffix = f"grid-{index:03d}"
    return f"{prefix}-{index:03d}-{suffix}"


class KAMINOS_OT_export_assay_plate(bpy.types.Operator):
    bl_idname = "kaminos.export_assay_plate"
    bl_label = "Export Assay Plate"
    bl_description = "Write this exact viewport to Operator Scratch with a provenance sidecar"
    bl_options = {"REGISTER"}

    @classmethod
    def poll(cls, context):
        return bool(
            context.area
            and context.area.type == "VIEW_3D"
            and context.space_data
            and getattr(context.space_data, "region_3d", None)
        )

    def execute(self, context):
        try:
            path = _capture_assay_plate(
                context,
                label=context.scene.kaminos_source_plate_label,
                morph_parameters=_active_morph_parameters(context),
            )
        except Exception as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        self.report({"INFO"}, f"Assay plate: {path}")
        return {"FINISHED"}


class KAMINOS_OT_export_morph_sweep(bpy.types.Operator):
    bl_idname = "kaminos.export_morph_sweep"
    bl_label = "Export Morph Sweep"
    bl_description = "Render the active object's numeric morph properties through this exact viewport"
    bl_options = {"REGISTER"}

    @classmethod
    def poll(cls, context):
        return bool(
            KAMINOS_OT_export_assay_plate.poll(context)
            and context.active_object
            and discover_morph_properties(context.active_object)
        )

    def execute(self, context):
        scene = context.scene
        target = context.active_object
        try:
            baseline = discover_morph_properties(target)
            samples = parse_morph_sample_values(scene.kaminos_source_plate_morph_samples)
            mode = (
                "one-axis"
                if scene.kaminos_source_plate_morph_mode == "ONE_AXIS"
                else "cartesian"
            )
            plan = build_morph_sample_plan(baseline, samples, mode=mode)
        except Exception as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}

        captured = []
        try:
            for index, row in enumerate(plan):
                with applied_morph_values(target, row["values"]):
                    context.view_layer.update()
                    label = _morph_row_label(
                        scene.kaminos_source_plate_label, row, index
                    )
                    captured.append(
                        _capture_assay_plate(
                            context,
                            label=label,
                            morph_parameters=_active_morph_parameters(
                                context, mode=mode, row=row
                            ),
                        )
                    )
        except Exception as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        finally:
            context.view_layer.update()

        self.report({"INFO"}, f"Morph sweep: {len(captured)} assay plates")
        return {"FINISHED"}


class KAMINOS_PT_source_plate(bpy.types.Panel):
    bl_label = "Source Plate"
    bl_idname = "KAMINOS_PT_source_plate"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Kaminos"

    def draw(self, context):
        layout = self.layout
        scene = context.scene
        layout.label(text="Plate Label")
        layout.prop(scene, "kaminos_source_plate_label", text="")
        layout.operator(KAMINOS_OT_export_assay_plate.bl_idname, icon="RENDER_STILL")


class KAMINOS_PT_source_plate_settings(bpy.types.Panel):
    bl_label = "Capture Settings"
    bl_idname = "KAMINOS_PT_source_plate_settings"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Kaminos"
    bl_parent_id = "KAMINOS_PT_source_plate"
    bl_options = {"DEFAULT_CLOSED"}

    def draw(self, context):
        layout = self.layout
        scene = context.scene
        layout.prop(scene, "kaminos_source_plate_resolution", text="Raster")
        layout.label(text="Output Folder")
        layout.prop(scene, "kaminos_source_plate_output_root", text="")


class KAMINOS_PT_source_plate_morph_sweep(bpy.types.Panel):
    bl_label = "Morph Sweep"
    bl_idname = "KAMINOS_PT_source_plate_morph_sweep"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Kaminos"
    bl_parent_id = "KAMINOS_PT_source_plate"

    def draw(self, context):
        layout = self.layout
        scene = context.scene
        target = context.active_object
        morphs = discover_morph_properties(target) if target else {}
        if target is None:
            layout.label(text="Select a morph carrier", icon="INFO")
            return
        layout.label(text=target.name, icon="OBJECT_DATA")
        if not morphs:
            layout.label(text="No numeric morph_* properties", icon="INFO")
            return
        for name, value in morphs.items():
            row = layout.row(align=True)
            row.label(text=name.removeprefix("morph_").replace("_", " ").title())
            row.label(text=f"{value:.3f}")
        layout.label(text="Sample Values")
        layout.prop(scene, "kaminos_source_plate_morph_samples", text="")
        layout.prop(scene, "kaminos_source_plate_morph_mode", expand=True)
        try:
            samples = parse_morph_sample_values(scene.kaminos_source_plate_morph_samples)
            mode = (
                "one-axis"
                if scene.kaminos_source_plate_morph_mode == "ONE_AXIS"
                else "cartesian"
            )
            count = len(build_morph_sample_plan(morphs, samples, mode=mode))
            layout.label(text=f"{count} plates")
        except SourcePlateCaptureError as error:
            layout.label(text=str(error), icon="ERROR")
        layout.operator(KAMINOS_OT_export_morph_sweep.bl_idname, icon="RENDER_ANIMATION")


CLASSES = (
    KAMINOS_OT_export_assay_plate,
    KAMINOS_OT_export_morph_sweep,
    KAMINOS_PT_source_plate,
    KAMINOS_PT_source_plate_settings,
    KAMINOS_PT_source_plate_morph_sweep,
)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Scene.kaminos_source_plate_output_root = StringProperty(
        name="Output Root",
        subtype="DIR_PATH",
        default=DEFAULT_OUTPUT_ROOT,
    )
    bpy.types.Scene.kaminos_source_plate_resolution = IntProperty(
        name="Fixed Raster",
        description="Square output width and height in pixels",
        default=1024,
        min=1,
    )
    bpy.types.Scene.kaminos_source_plate_label = StringProperty(
        name="Plate Label",
        description="Optional short label included in the output filename",
        default="view",
    )
    bpy.types.Scene.kaminos_source_plate_morph_samples = StringProperty(
        name="Morph Samples",
        description="Comma-separated finite values applied to every numeric morph_* property",
        default="0, 0.25, 0.5, 0.75, 1",
    )
    bpy.types.Scene.kaminos_source_plate_morph_mode = EnumProperty(
        name="Sweep Mode",
        items=(
            ("ONE_AXIS", "One Axis", "Vary one property at a time around the current vector"),
            ("CARTESIAN", "Cartesian", "Render the complete property-value product"),
        ),
        default="ONE_AXIS",
    )


def unregister():
    del bpy.types.Scene.kaminos_source_plate_morph_mode
    del bpy.types.Scene.kaminos_source_plate_morph_samples
    del bpy.types.Scene.kaminos_source_plate_label
    del bpy.types.Scene.kaminos_source_plate_resolution
    del bpy.types.Scene.kaminos_source_plate_output_root
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
