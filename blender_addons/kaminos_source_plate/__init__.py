from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import traceback

import bpy
from bpy.props import IntProperty, StringProperty

from .capture_core import (
    SCHEMA,
    SourcePlateCaptureError,
    atomic_write_json,
    capture_paths,
    inspect_png,
    validate_fixed_raster,
)


bl_info = {
    "name": "Kaminos Source Plate",
    "author": "Kaminos",
    "version": (0, 1, 0),
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


def _visible_object_records(context):
    records = []
    for obj in sorted(context.visible_objects, key=lambda item: item.name):
        records.append(
            {
                "name": obj.name,
                "type": obj.type,
                "hideRender": bool(obj.hide_render),
                "matrixWorld": _matrix_rows(obj.matrix_world),
            }
        )
    return records


def _capture_context(context):
    region = context.space_data.region_3d
    shading = context.space_data.shading
    scene = context.scene
    view_settings = scene.view_settings
    display_settings = scene.display_settings
    sequencer_settings = scene.sequencer_colorspace_settings
    camera = scene.camera if region.view_perspective == "CAMERA" else None
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
        "visibleObjects": _visible_object_records(context),
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
        scene = context.scene
        source = _source_record()
        source_stem = Path(source["path"]).stem if source["path"] else "unsaved"
        captured_at = datetime.now(timezone.utc).isoformat(timespec="microseconds").replace(
            "+00:00", "Z"
        )
        try:
            width, height = validate_fixed_raster(
                scene.kaminos_source_plate_resolution,
                scene.kaminos_source_plate_resolution,
            )
            paths = capture_paths(
                output_root=scene.kaminos_source_plate_output_root,
                source_stem=source_stem,
                label=scene.kaminos_source_plate_label,
                captured_at=captured_at,
            )
        except Exception as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}

        requested = {
            "outputRoot": str(Path(scene.kaminos_source_plate_output_root).expanduser()),
            "width": width,
            "height": height,
            "label": scene.kaminos_source_plate_label,
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
            self.report({"ERROR"}, f"Source Plate failed during {document['failure']['phase']}")
            return {"CANCELLED"}

        self.report({"INFO"}, f"Assay plate: {paths['image']}")
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
        layout.operator(KAMINOS_OT_export_assay_plate.bl_idname, icon="RENDER_STILL")
        layout.prop(scene, "kaminos_source_plate_label", text="Label")
        layout.prop(scene, "kaminos_source_plate_resolution", text="Raster")
        layout.prop(scene, "kaminos_source_plate_output_root", text="Output")


CLASSES = (KAMINOS_OT_export_assay_plate, KAMINOS_PT_source_plate)


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


def unregister():
    del bpy.types.Scene.kaminos_source_plate_label
    del bpy.types.Scene.kaminos_source_plate_resolution
    del bpy.types.Scene.kaminos_source_plate_output_root
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
