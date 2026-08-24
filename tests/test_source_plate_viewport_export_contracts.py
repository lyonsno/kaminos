from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path
import struct
import sys
from tempfile import TemporaryDirectory
import zlib


ROOT = Path(__file__).resolve().parents[1]
CORE_PATH = ROOT / "blender_addons" / "kaminos_source_plate" / "capture_core.py"
ADDON_PATH = ROOT / "blender_addons" / "kaminos_source_plate" / "__init__.py"
SMOKE_PATH = ROOT / "tools" / "blender-source-plate-addon-smoke.py"


def _load_core():
    assert CORE_PATH.is_file(), "viewport capture core is missing"
    spec = importlib.util.spec_from_file_location("kaminos_source_plate_capture_core", CORE_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _png_bytes(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        body = kind + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    row = bytes([0]) + bytes(rgb) * width
    raw = row * height
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def _nonuniform_png_bytes(width: int, height: int) -> bytes:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        body = kind + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    raw = b"".join(
        bytes([0])
        + b"".join(
            bytes(((x * 37 + y * 11) % 256, (x * 13 + y * 53) % 256, (x * 71 + y * 7) % 256))
            for x in range(width)
        )
        for y in range(height)
    )
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def test_viewport_capture_addon_exists_as_an_installable_package():
    assert CORE_PATH.is_file(), "viewport capture core is missing"
    assert ADDON_PATH.is_file(), "Blender add-on entrypoint is missing"


def test_capture_paths_are_caller_addressed_unique_and_adjacent():
    core = _load_core()
    with TemporaryDirectory() as tmp:
        root = Path(tmp).resolve()
        first = core.capture_paths(
            output_root=root,
            source_stem="cat bauplan",
            label="long muzzle",
            captured_at="2026-08-17T12:34:56.123456Z",
        )
        second = core.capture_paths(
            output_root=root,
            source_stem="cat bauplan",
            label="long muzzle",
            captured_at="2026-08-17T12:34:56.123457Z",
        )

        assert first["image"].parent == root / "cat-bauplan"
        assert first["sidecar"].parent == first["image"].parent
        assert first["image"].suffix == ".png"
        assert first["sidecar"] == first["image"].with_suffix(".json")
        assert first != second
        assert "long-muzzle" in first["image"].name


def test_fixed_raster_rejects_non_integer_non_positive_and_mismatched_effective_dimensions():
    core = _load_core()
    for width, height in [(0, 1024), (1024, -1), (1.5, 1024), (1024, "1024")]:
        try:
            core.validate_fixed_raster(width, height)
        except core.SourcePlateCaptureError as error:
            assert error.phase == "capture-request"
        else:
            raise AssertionError(f"accepted invalid raster {width!r} x {height!r}")

    assert core.validate_fixed_raster(1024, 1024) == (1024, 1024)


def test_png_inspection_binds_dimensions_hash_bytes_and_nonblank_signal():
    core = _load_core()
    with TemporaryDirectory() as tmp:
        image = Path(tmp) / "plate.png"
        image.write_bytes(_png_bytes(2, 3, (20, 40, 60)))

        record = core.inspect_png(image, expected_width=2, expected_height=3)

        assert record["width"] == 2
        assert record["height"] == 3
        assert record["byteLength"] == image.stat().st_size
        assert len(record["sha256"]) == 64
        assert record["nonblank"] is True

        try:
            core.inspect_png(image, expected_width=3, expected_height=2)
        except core.SourcePlateCaptureError as error:
            assert error.phase == "output-validation"
            assert "dimensions" in str(error)
        else:
            raise AssertionError("wrong-dimension PNG was admitted")


def test_conditioning_geometry_reports_anisotropic_resize_instead_of_hiding_it():
    core = _load_core()

    square = core.conditioning_geometry(
        source_width=1024,
        source_height=1024,
        target_width=512,
        target_height=512,
    )
    historical = core.conditioning_geometry(
        source_width=1978,
        source_height=1738,
        target_width=512,
        target_height=512,
    )

    assert square["geometryPreserved"] is True
    assert square["anisotropyRatio"] == 1.0
    assert historical["geometryPreserved"] is False
    assert historical["anisotropyRatio"] != 1.0
    assert historical["sourceAspectRatio"] != historical["targetAspectRatio"]


def test_camera_frame_plan_preserves_render_border_aspect_inside_square_output():
    core = _load_core()

    plan = core.camera_frame_capture_plan(
        source_width=1920,
        source_height=1080,
        pixel_aspect_x=1.0,
        pixel_aspect_y=1.0,
        target_width=1024,
        target_height=1024,
        use_border=True,
        use_crop_to_border=True,
        border_min_x=0.16093750298023224,
        border_max_x=0.8708333373069763,
        border_min_y=0.13518518209457397,
        border_max_y=0.7731481194496155,
    )

    assert plan["frame"] == "render-border"
    assert plan["cropToBorder"] is True
    assert plan["renderWidth"] > 1024
    assert plan["renderHeight"] < 1024
    assert plan["expectedContentWidth"] <= 1024
    assert plan["expectedContentHeight"] <= 1024
    assert plan["expectedContentWidth"] > plan["expectedContentHeight"]
    assert math.isclose(
        plan["sourceFrameAspectRatio"],
        (1920 * (0.8708333373069763 - 0.16093750298023224))
        / (1080 * (0.7731481194496155 - 0.13518518209457397)),
    )


def test_camera_frame_plan_uses_the_whole_camera_when_no_render_border_is_active():
    core = _load_core()

    plan = core.camera_frame_capture_plan(
        source_width=1920,
        source_height=1080,
        pixel_aspect_x=1.0,
        pixel_aspect_y=1.0,
        target_width=1024,
        target_height=1024,
        use_border=False,
        use_crop_to_border=False,
        border_min_x=0.0,
        border_max_x=1.0,
        border_min_y=0.0,
        border_max_y=1.0,
    )

    assert plan["frame"] == "camera-frame"
    assert plan["cropToBorder"] is False
    assert plan["renderWidth"] == 1024
    assert plan["renderHeight"] == 576
    assert plan["expectedContentWidth"] == 1024
    assert plan["expectedContentHeight"] == 576


def test_camera_frame_plan_preserves_full_frame_when_border_is_not_cropped():
    core = _load_core()

    plan = core.camera_frame_capture_plan(
        source_width=1920,
        source_height=1080,
        pixel_aspect_x=1.0,
        pixel_aspect_y=1.0,
        target_width=1024,
        target_height=1024,
        use_border=True,
        use_crop_to_border=False,
        border_min_x=0.2,
        border_max_x=0.8,
        border_min_y=0.25,
        border_max_y=0.75,
    )

    assert plan["frame"] == "camera-frame-with-render-border"
    assert plan["useBorder"] is True
    assert plan["cropToBorder"] is False
    assert plan["renderWidth"] == 1024
    assert plan["renderHeight"] == 576
    assert plan["expectedContentWidth"] == 1024
    assert plan["expectedContentHeight"] == 576
    assert math.isclose(plan["sourceFrameAspectRatio"], 1920 / 1080)


def test_letterbox_png_preserves_wide_pixels_without_stretch_or_crop():
    core = _load_core()
    with TemporaryDirectory() as tmp:
        source = Path(tmp) / "wide.png"
        target = Path(tmp) / "square.png"
        source.write_bytes(_png_bytes(4, 2, (20, 40, 60)))

        placement = core.letterbox_png(
            source,
            target,
            target_width=4,
            target_height=4,
        )
        width, height, channels, pixels = core._read_png_pixels(target)

        assert placement == {
            "sourceWidth": 4,
            "sourceHeight": 2,
            "targetWidth": 4,
            "targetHeight": 4,
            "offsetX": 0,
            "offsetY": 1,
            "padding": "opaque-black",
        }
        assert (width, height, channels) == (4, 4, 3)
        rows = [pixels[index : index + 12] for index in range(0, len(pixels), 12)]
        assert rows[0] == bytes(12)
        assert rows[1] == bytes((20, 40, 60)) * 4
        assert rows[2] == bytes((20, 40, 60)) * 4
        assert rows[3] == bytes(12)


def test_letterbox_png_preserves_nonuniform_wide_and_tall_pixels_without_crop():
    core = _load_core()
    with TemporaryDirectory() as tmp:
        for source_width, source_height in ((5, 2), (2, 5)):
            source = Path(tmp) / f"source-{source_width}x{source_height}.png"
            target = Path(tmp) / f"target-{source_width}x{source_height}.png"
            source.write_bytes(_nonuniform_png_bytes(source_width, source_height))
            _, _, source_channels, source_pixels = core._read_png_pixels(source)

            placement = core.letterbox_png(
                source,
                target,
                target_width=5,
                target_height=5,
            )
            width, height, channels, target_pixels = core._read_png_pixels(target)

            assert (width, height, channels) == (5, 5, source_channels)
            row_stride = 5 * channels
            copied = bytearray()
            for y in range(source_height):
                start = (placement["offsetY"] + y) * row_stride + placement["offsetX"] * channels
                copied.extend(target_pixels[start : start + source_width * channels])
            assert bytes(copied) == source_pixels
            assert placement["sourceWidth"] == source_width
            assert placement["sourceHeight"] == source_height


def test_atomic_sidecar_round_trip_preserves_requested_and_effective_state():
    core = _load_core()
    with TemporaryDirectory() as tmp:
        path = Path(tmp) / "plate.json"
        document = {
            "schema": "kaminos.source-plate-viewport-capture.v0",
            "status": "completed",
            "requested": {"width": 1024, "height": 1024},
            "effective": {"width": 1024, "height": 1024},
        }

        core.atomic_write_json(path, document)

        assert json.loads(path.read_text()) == document
        assert not list(path.parent.glob(f".{path.name}.*.tmp"))


def test_evaluated_geometry_digest_detects_one_float32_vertex_step():
    core = _load_core()
    one_float32_step_above_one = struct.unpack(
        "<f", struct.pack("<I", 0x3F800001)
    )[0]
    topology = {
        "edges": ((0, 1), (1, 2), (2, 0)),
        "polygons": ((0, 1, 2),),
    }

    baseline = core.evaluated_mesh_geometry_record(
        vertices=((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)),
        **topology,
    )
    altered = core.evaluated_mesh_geometry_record(
        vertices=(
            (0.0, 0.0, 0.0),
            (one_float32_step_above_one, 0.0, 0.0),
            (0.0, 1.0, 0.0),
        ),
        **topology,
    )

    assert baseline["positionSha256"] != altered["positionSha256"]
    assert baseline["geometrySha256"] != altered["geometrySha256"]
    assert baseline["topologySha256"] == altered["topologySha256"]


def test_evaluated_geometry_digest_separates_topology_from_positions():
    core = _load_core()
    vertices = ((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0))

    triangle = core.evaluated_mesh_geometry_record(
        vertices=vertices,
        edges=((0, 1), (1, 2), (2, 0)),
        polygons=((0, 1, 2),),
    )
    open_path = core.evaluated_mesh_geometry_record(
        vertices=vertices,
        edges=((0, 1), (1, 2)),
        polygons=(),
    )

    assert triangle["positionSha256"] == open_path["positionSha256"]
    assert triangle["topologySha256"] != open_path["topologySha256"]
    assert triangle["geometrySha256"] != open_path["geometrySha256"]


def test_visible_object_mesh_digest_binds_evaluated_transform_and_is_order_stable():
    core = _load_core()
    cat = core.evaluated_mesh_geometry_record(
        vertices=((0.0, 0.0, 0.0),), edges=(), polygons=()
    )
    skull = core.evaluated_mesh_geometry_record(
        vertices=((1.0, 0.0, 0.0),), edges=(), polygons=()
    )

    identity = (
        (1.0, 0.0, 0.0, 0.0),
        (0.0, 1.0, 0.0, 0.0),
        (0.0, 0.0, 1.0, 0.0),
        (0.0, 0.0, 0.0, 1.0),
    )
    translated = (
        (1.0, 0.0, 0.0, 2.0),
        (0.0, 1.0, 0.0, 0.0),
        (0.0, 0.0, 1.0, 0.0),
        (0.0, 0.0, 0.0, 1.0),
    )

    forward = core.evaluated_visible_object_mesh_geometry_record(
        (("Cat", cat, identity), ("Skull", skull, identity))
    )
    reverse = core.evaluated_visible_object_mesh_geometry_record(
        (("Skull", skull, identity), ("Cat", cat, identity))
    )
    moved = core.evaluated_visible_object_mesh_geometry_record(
        (("Cat", cat, translated), ("Skull", skull, identity))
    )

    assert forward == reverse
    assert forward["objectCount"] == 2
    assert forward["aggregateSha256"] == (
        "f414e679d5b94e315fb4f474eafc48829d9813bddf9922f2c2916c960f3ed98b"
    )
    assert forward["aggregateSha256"] != moved["aggregateSha256"]
    assert forward["schema"] == "kaminos.evaluated-visible-object-mesh-geometry.v0"


def test_evaluated_geometry_v0_compatibility_vectors_are_fixed():
    core = _load_core()
    empty = core.evaluated_mesh_geometry_record(vertices=(), edges=(), polygons=())
    triangle = core.evaluated_mesh_geometry_record(
        vertices=((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)),
        edges=((0, 1), (1, 2), (2, 0)),
        polygons=((0, 1, 2),),
    )

    assert triangle["positionSha256"] == (
        "947b929f2154755cd04f31ba00b60c2d5c29e8399ea59d36f51c0645cde29deb"
    )
    assert triangle["topologySha256"] == (
        "77aff16e90ae4b096246bc1d554dc6d5b0fd9ac9d1645477aa94c93ff3f49f35"
    )
    assert triangle["geometrySha256"] == (
        "3c9aa46871cdd1af68962655f490f77b5a601a17bc956fa8828f25edfbd14a22"
    )
    assert empty == {
        "schema": "kaminos.evaluated-mesh-geometry.v0",
        "vertexCount": 0,
        "edgeCount": 0,
        "polygonCount": 0,
        "loopCount": 0,
        "positionSha256": "cc74196a5441dcaf465ad766fec0e278f53e577dcc93cc25a0cfba51b1339456",
        "topologySha256": "d0ea3f3fcec649f8c2599965fe4e7f63ff3a58abc9271e026674e4f45eef1d7b",
        "geometrySha256": "c779b842256f394b9121a791459b8bc9318e76a74038c817dde38c77246fc03c",
    }


def test_addon_exposes_one_action_without_saving_or_resizing_the_blend_source():
    assert ADDON_PATH.is_file(), "Blender add-on entrypoint is missing"
    source = ADDON_PATH.read_text()

    assert 'bl_idname = "kaminos.export_assay_plate"' in source
    assert 'bl_label = "Export Assay Plate"' in source
    assert "bpy.ops.render.opengl" in source
    assert "view_context=True" in source
    assert "save_mainfile" not in source
    assert "save_as_mainfile" not in source
    assert "Image.resize" not in source
    assert "scene.render.resolution_percentage = 100" in source
    assert "finally:" in source


def test_camera_view_uses_camera_render_and_letterbox_while_free_view_keeps_viewport_capture():
    source = ADDON_PATH.read_text()

    assert 'capture_mode = "camera-render"' in source
    assert 'capture_mode = "viewport-render"' in source
    assert "bpy.ops.render.render(write_still=True)" in source
    assert "bpy.ops.render.opengl(write_still=True, view_context=True)" in source
    assert "camera_frame_capture_plan(" in source
    assert "letterbox_png(" in source
    assert 'document["effective"]["captureMode"] = capture_mode' in source
    assert '"cameraFrame"' in source
    assert '"pixel_aspect_x"' in source
    assert '"use_crop_to_border"' in source
    camera_branch = source[source.index('capture_mode = "camera-render"') :]
    assert camera_branch.index('if "FINISHED" not in result') < camera_branch.index(
        "placement = letterbox_png("
    )


def test_addon_sidecar_names_effective_view_shading_visibility_and_source_state():
    assert ADDON_PATH.is_file(), "Blender add-on entrypoint is missing"
    source = ADDON_PATH.read_text()

    for contract_key in (
        '"viewMatrix"',
        '"viewPerspective"',
        '"shading"',
        '"visibleObjects"',
        '"sourceBlend"',
        '"sourceDirty"',
        '"sourceDirtyAfter"',
        '"renderSettingsRestored"',
        '"viewportRegion"',
        '"colorManagement"',
        '"evaluatedLocalMeshGeometry"',
        '"evaluatedVisibleObjectMeshGeometry"',
        '"output"',
    ):
        assert contract_key in source
    assert '"camera": camera.name if camera else None' in source
    assert '"cameraState"' in source


def test_addon_keeps_the_repeated_export_loop_legible_in_a_narrow_sidebar():
    assert ADDON_PATH.is_file(), "Blender add-on entrypoint is missing"
    source = ADDON_PATH.read_text()

    assert 'layout.label(text="Plate Label")' in source
    assert 'layout.prop(scene, "kaminos_source_plate_label", text="")' in source
    assert 'bl_idname = "KAMINOS_PT_source_plate_settings"' in source
    assert 'bl_parent_id = "KAMINOS_PT_source_plate"' in source
    assert 'bl_options = {"DEFAULT_CLOSED"}' in source
    assert 'layout.label(text="Output Folder")' in source
    assert 'layout.prop(scene, "kaminos_source_plate_output_root", text="")' in source


def test_morph_discovery_admits_only_finite_numeric_prefixed_properties():
    core = _load_core()

    discovered = core.discover_morph_properties(
        {
            "morph_canine": 0.72,
            "morph_face_mass": 1,
            "morph_enabled": True,
            "morph_label": "wide",
            "morph_nan": float("nan"),
            "morph_inf": float("inf"),
            "unrelated": 0.25,
        }
    )

    assert discovered == {"morph_canine": 0.72, "morph_face_mass": 1.0}


def test_morph_sample_parser_preserves_order_deduplicates_and_fails_loud():
    core = _load_core()

    assert core.parse_morph_sample_values("0, .25, 1, .25") == (0.0, 0.25, 1.0)

    for value in ("", "0, nope, 1", "0, nan", "0, inf"):
        try:
            core.parse_morph_sample_values(value)
        except core.SourcePlateCaptureError as error:
            assert error.phase == "capture-request"
        else:
            raise AssertionError(f"accepted invalid morph sample list {value!r}")


def test_one_axis_plan_emits_one_baseline_and_each_nonbaseline_intervention():
    core = _load_core()

    plan = core.build_morph_sample_plan(
        {"morph_canine": 0.0, "morph_zygomatic": 0.5},
        (0.0, 0.5, 1.0),
        mode="one-axis",
    )

    assert plan[0] == {
        "kind": "baseline",
        "axis": None,
        "sample": None,
        "values": {"morph_canine": 0.0, "morph_zygomatic": 0.5},
    }
    assert plan[1:] == [
        {
            "kind": "axis",
            "axis": "morph_canine",
            "sample": 0.5,
            "values": {"morph_canine": 0.5, "morph_zygomatic": 0.5},
        },
        {
            "kind": "axis",
            "axis": "morph_canine",
            "sample": 1.0,
            "values": {"morph_canine": 1.0, "morph_zygomatic": 0.5},
        },
        {
            "kind": "axis",
            "axis": "morph_zygomatic",
            "sample": 0.0,
            "values": {"morph_canine": 0.0, "morph_zygomatic": 0.0},
        },
        {
            "kind": "axis",
            "axis": "morph_zygomatic",
            "sample": 1.0,
            "values": {"morph_canine": 0.0, "morph_zygomatic": 1.0},
        },
    ]


def test_cartesian_plan_emits_the_full_uncapped_product():
    core = _load_core()

    plan = core.build_morph_sample_plan(
        {"morph_canine": 0.2, "morph_zygomatic": 0.8},
        (0.0, 0.5, 1.0),
        mode="cartesian",
    )

    assert len(plan) == 9
    assert plan[0]["values"] == {"morph_canine": 0.0, "morph_zygomatic": 0.0}
    assert plan[-1]["values"] == {"morph_canine": 1.0, "morph_zygomatic": 1.0}
    assert all(row["kind"] == "cartesian" for row in plan)


def test_applied_morph_values_restore_exact_state_after_success_and_failure():
    core = _load_core()
    target = {"morph_canine": 0.2, "morph_zygomatic": 0.8, "other": 4.0}

    with core.applied_morph_values(
        target, {"morph_canine": 1.0, "morph_zygomatic": 0.0}
    ):
        assert target == {"morph_canine": 1.0, "morph_zygomatic": 0.0, "other": 4.0}
    assert target == {"morph_canine": 0.2, "morph_zygomatic": 0.8, "other": 4.0}

    try:
        with core.applied_morph_values(target, {"morph_canine": 0.5}):
            raise RuntimeError("capture failed")
    except RuntimeError:
        pass
    assert target == {"morph_canine": 0.2, "morph_zygomatic": 0.8, "other": 4.0}


def test_addon_exposes_morph_sweep_action_and_sidecar_identity():
    source = ADDON_PATH.read_text()

    assert 'bl_idname = "kaminos.export_morph_sweep"' in source
    assert 'bl_label = "Export Morph Sweep"' in source
    assert '"morphParameters"' in source
    assert '"targetObject"' in source
    assert '"values"' in source
    assert 'layout.label(text="Sample Values")' in source
    assert 'layout.prop(scene, "kaminos_source_plate_morph_samples", text="")' in source


def test_blender_runtime_smoke_exercises_morph_registration_and_restoration():
    source = SMOKE_PATH.read_text()

    for contract_key in (
        '"morphOperatorRegistered"',
        '"morphPanelRegistered"',
        '"morphSamplesProperty"',
        '"morphModeProperty"',
        '"expectedMorphs"',
        '"expectedAppliedMorphs"',
        '"discoveredMorphs"',
        '"restoredMorphs"',
        '"oneVertexPositionChanged"',
        '"oneVertexTopologyUnchanged"',
        '"oneVertexGeometryChanged"',
        '"shapeKeySourceMeshUnchanged"',
        '"shapeKeyEvaluatedGeometryChanged"',
        '"visibleRecordCarriesEvaluatedGeometry"',
    ):
        assert contract_key in source
