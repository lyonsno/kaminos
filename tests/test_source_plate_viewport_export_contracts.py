from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import struct
import sys
from tempfile import TemporaryDirectory
import zlib


ROOT = Path(__file__).resolve().parents[1]
CORE_PATH = ROOT / "blender_addons" / "kaminos_source_plate" / "capture_core.py"
ADDON_PATH = ROOT / "blender_addons" / "kaminos_source_plate" / "__init__.py"


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
        '"output"',
    ):
        assert contract_key in source


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
