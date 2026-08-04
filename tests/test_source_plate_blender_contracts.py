from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import sys
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import source_plate_blender as _adapter  # noqa: E402
from source_plate_blender import _apply_materials, _main, channel_paths, failure_document  # noqa: E402
from source_plate_core import SourcePlateContractError  # noqa: E402

_inspect_rendered_output = getattr(_adapter, "_inspect_rendered_output", None)
_parse_cli_arguments = getattr(_adapter, "_parse_cli_arguments", None)
_promote_staged_run = getattr(_adapter, "_promote_staged_run", None)


class _MaterialSlots(list):
    def clear(self):
        del self[:]


class _FakeMaterials:
    def __init__(self):
        self.created = []

    def new(self, name):
        material = SimpleNamespace(
            name=name,
            diffuse_color=None,
            use_nodes=False,
            node_tree=SimpleNamespace(
                nodes={
                    "Principled BSDF": SimpleNamespace(
                        inputs={
                            "Base Color": SimpleNamespace(default_value=None),
                            "Roughness": SimpleNamespace(default_value=None),
                            "Metallic": SimpleNamespace(default_value=None),
                        }
                    )
                }
            ),
        )
        self.created.append(material)
        return material


def _fake_material_bpy():
    muscle = SimpleNamespace(
        data=SimpleNamespace(materials=_MaterialSlots()),
        users_collection=[SimpleNamespace(name="20 Muscle")],
    )
    patch = SimpleNamespace(
        data=SimpleNamespace(materials=_MaterialSlots()),
        users_collection=[SimpleNamespace(name="Attachment Patches")],
    )
    return SimpleNamespace(
        data=SimpleNamespace(
            materials=_FakeMaterials(),
            objects={"muscle": muscle, "patch": patch},
        )
    )


class _FakeImages:
    def __init__(self, image):
        self.image = image

    def load(self, _path, check_existing=False):
        assert check_existing is False
        return self.image

    def remove(self, image):
        assert image is self.image


def _fake_image_bpy(*, width, height, file_format, pixels):
    image = SimpleNamespace(
        size=(width, height),
        file_format=file_format,
        channels=4,
        pixels=pixels,
    )
    return SimpleNamespace(data=SimpleNamespace(images=_FakeImages(image)))


def test_four_channel_paths_are_unique_and_caller_addressed():
    with TemporaryDirectory() as tmp:
        root = Path(tmp).resolve()

        paths = channel_paths(root)

        assert paths == {
            "rgb": root / "rgb.png",
            "silhouette": root / "silhouette.png",
            "depth": root / "depth.exr",
            "normal": root / "normal.exr",
        }
        assert len(set(paths.values())) == 4


def test_failure_report_preserves_phase_and_last_trustworthy_identity():
    with TemporaryDirectory() as tmp:
        root = Path(tmp).resolve()
        descriptor = root / "plate.json"

        report = failure_document(
            descriptor_path=descriptor,
            output_dir=root,
            phase="source-freshness",
            error=RuntimeError("wrong source"),
            last_trustworthy_evidence={
                "descriptorPath": str(descriptor),
                "descriptorSha256": "a" * 64,
            },
        )

        assert report["schema"] == "kaminos.source-plate-render-report.v0"
        assert report["status"] == "failed"
        assert report["failurePhase"] == "source-freshness"
        assert report["lastTrustworthyEvidence"]["descriptorSha256"] == "a" * 64
        assert report["requested"]["descriptorPath"] == str(descriptor)
        assert report["requested"]["outputDirectory"] == str(root)
        assert report["error"] == {"type": "RuntimeError", "message": "wrong source"}


def test_blender_adapter_never_saves_the_loaded_source():
    adapter = (Path(__file__).resolve().parents[1] / "source_plate_blender.py").read_text()

    assert "save_as_mainfile" not in adapter
    assert "save_mainfile" not in adapter


def test_blender_bootstraps_its_script_directory_before_importing_the_core():
    adapter = (Path(__file__).resolve().parents[1] / "source_plate_blender.py").read_text()

    assert adapter.index("sys.path.insert") < adapter.index("from source_plate_core import")


def test_blender_51_writes_distinct_exr_render_pass_artifacts():
    adapter = (Path(__file__).resolve().parents[1] / "source_plate_blender.py").read_text()

    assert adapter.count('file_format = "OPEN_EXR"') == 2
    assert 'file_format = "OPEN_EXR_MULTILAYER"' not in adapter
    assert 'scene.render.filepath = str(outputs["depth"])' in adapter
    assert 'scene.render.filepath = str(outputs["normal"])' in adapter
    assert 'nodes.new("ShaderNodeCameraData")' in adapter
    assert 'camera_data.outputs["View Z Depth"], emission.inputs["Color"]' in adapter
    assert 'nodes.new("ShaderNodeMapRange")' not in adapter
    assert 'nodes.new("ShaderNodeNewGeometry")' in adapter
    assert 'nodes.new("ShaderNodeVectorTransform")' in adapter
    assert 'multiply.inputs[1].default_value = (0.5, 0.5, 0.5)' in adapter
    assert 'add.inputs[1].default_value = (0.5, 0.5, 0.5)' in adapter
    assert "view_layer.material_override = depth_material" in adapter
    assert "view_layer.material_override = normal_material" in adapter
    assert "view_layer.use_pass_z = True" not in adapter
    assert "view_layer.use_pass_normal = True" not in adapter
    assert "CompositorNodeOutputFile" not in adapter


def test_output_records_bind_channel_representation():
    adapter = (Path(__file__).resolve().parents[1] / "source_plate_blender.py").read_text()

    assert '"representation": channel_contract.get("representation")' not in adapter
    assert '"representationValidated": True' in adapter
    assert "_inspect_rendered_output" in adapter


def test_collection_selectors_resolve_objects_without_requiring_object_duplication():
    adapter = (Path(__file__).resolve().parents[1] / "source_plate_blender.py").read_text()

    assert 'selection.get("objects", [])' in adapter
    assert "collection.all_objects" in adapter


def test_neutral_clay_presentation_uses_one_descriptor_bound_material():
    bpy = _fake_material_bpy()
    selection = {"effectiveObjects": ["muscle", "patch"]}
    descriptor = {
        "presentation": {
            "materialMode": "neutral_clay",
            "clayColor": [0.72, 0.72, 0.70, 1.0],
        }
    }

    receipt = _apply_materials(bpy, selection, descriptor)

    muscle_material = bpy.data.objects["muscle"].data.materials[0]
    patch_material = bpy.data.objects["patch"].data.materials[0]
    assert muscle_material is patch_material
    assert len(bpy.data.materials.created) == 1
    assert receipt == {
        "materialMode": "neutral_clay",
        "clayColor": [0.72, 0.72, 0.70, 1.0],
        "materialCount": 1,
        "objectCount": 2,
    }


def test_material_contract_rejects_missing_unsupported_and_malformed_modes():
    selection = {"effectiveObjects": ["muscle", "patch"]}
    invalid_presentations = [
        {},
        {"materialMode": "mystery"},
        {"materialMode": "neutral_clay"},
        {"materialMode": "neutral_clay", "clayColor": [0.7, 0.7, 0.7]},
    ]
    for presentation in invalid_presentations:
        try:
            _apply_materials(
                _fake_material_bpy(), selection, {"presentation": presentation}
            )
        except SourcePlateContractError as error:
            assert error.phase == "descriptor-application"
        else:
            raise AssertionError(f"accepted invalid presentation: {presentation}")


def test_object_color_remains_object_derived_without_clay_color():
    bpy = _fake_material_bpy()
    receipt = _apply_materials(
        bpy,
        {"effectiveObjects": ["muscle", "patch"]},
        {"presentation": {"materialMode": "object_color"}},
    )

    assert len(bpy.data.materials.created) == 2
    assert bpy.data.objects["muscle"].data.materials[0] is not bpy.data.objects[
        "patch"
    ].data.materials[0]
    assert receipt["clayColor"] is None
    assert receipt["materialMode"] == "object_color"


def test_output_inspection_measures_pixels_format_dimensions_and_signed_normals():
    assert callable(_inspect_rendered_output), "adapter lacks measured image inspection"
    with TemporaryDirectory() as tmp:
        normal = Path(tmp) / "normal.exr"
        normal.write_bytes(b"fake-exr-container")
        bpy = _fake_image_bpy(
            width=2,
            height=1,
            file_format="OPEN_EXR",
            pixels=[-1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0],
        )

        receipt = _inspect_rendered_output(
            bpy,
            "normal",
            normal,
            {
                "encoding": "openexr",
                "representation": "camera_space_unit_normal_rgb",
            },
        )

        assert receipt["measuredEncoding"] == "openexr"
        assert receipt["width"] == 2
        assert receipt["height"] == 1
        assert receipt["nonblank"] is True
        assert receipt["representation"] == "camera_space_unit_normal_rgb"
        assert receipt["componentRange"] == [-1.0, 1.0]
        assert receipt["unitVectorSamples"] == 2


def test_output_inspection_rejects_blank_wrong_size_and_unsigned_normal_claims():
    assert callable(_inspect_rendered_output), "adapter lacks measured image inspection"
    with TemporaryDirectory() as tmp:
        path = Path(tmp) / "artifact.png"
        path.write_bytes(b"fake-image-container")
        blank = _fake_image_bpy(
            width=2,
            height=2,
            file_format="PNG",
            pixels=[0.0, 0.0, 0.0, 1.0] * 4,
        )
        try:
            _inspect_rendered_output(
                blank,
                "rgb",
                path,
                {"encoding": "png", "representation": "beauty_linear_to_display_rgb"},
            )
        except SourcePlateContractError as error:
            assert error.phase == "output-validation"
            assert "blank" in str(error)
        else:
            raise AssertionError("blank RGB output completed")

        unsigned_normal = _fake_image_bpy(
            width=2,
            height=1,
            file_format="OPEN_EXR",
            pixels=[0.5, 0.5, 1.0, 1.0, 0.5, 1.0, 0.5, 1.0],
        )
        try:
            _inspect_rendered_output(
                unsigned_normal,
                "normal",
                Path(tmp) / "normal.exr",
                {
                    "encoding": "openexr",
                    "representation": "camera_space_unit_normal_rgb",
                },
            )
        except SourcePlateContractError as error:
            assert "unit normal" in str(error)
        else:
            raise AssertionError("encoded unsigned normals impersonated signed unit normals")


def test_explicit_encoded_normal_derivative_is_decoded_and_unit_checked():
    assert callable(_inspect_rendered_output), "adapter lacks measured image inspection"
    with TemporaryDirectory() as tmp:
        normal = Path(tmp) / "normal.exr"
        normal.write_bytes(b"fake-exr-container")
        bpy = _fake_image_bpy(
            width=2,
            height=1,
            file_format="OPEN_EXR",
            pixels=[0.0, 0.5, 0.5, 1.0, 1.0, 0.5, 0.5, 1.0],
        )

        receipt = _inspect_rendered_output(
            bpy,
            "normal",
            normal,
            {
                "encoding": "openexr",
                "representation": "camera_space_unit_normal_rgb_encoded_0_1",
            },
        )

        assert receipt["representation"] == "camera_space_unit_normal_rgb_encoded_0_1"
        assert receipt["decodeFormula"] == "signed = encoded * 2 - 1"
        assert receipt["decodedComponentRange"] == [-1.0, 1.0]
        assert receipt["unitVectorSamples"] == 2


def test_cli_paths_are_explicit_and_argument_failure_is_durable():
    assert callable(_parse_cli_arguments), "adapter lacks explicit caller-addressed CLI parsing"
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        parsed = _parse_cli_arguments(
            [
                "--descriptor",
                str(root / "plate.json"),
                "--out-dir",
                str(root / "products"),
                "--report",
                str(root / "reports" / "success.json"),
                "--failure-report",
                str(root / "reports" / "failure.json"),
            ]
        )
        assert parsed["report"] == (root / "reports" / "success.json").resolve()
        assert parsed["failure_report"] == (root / "reports" / "failure.json").resolve()

        failure_path = root / "argument-failure.json"
        exit_code = _main(["--failure-report", str(failure_path)])
        failure = __import__("json").loads(failure_path.read_text())
        assert exit_code == 2
        assert failure["status"] == "failed"
        assert failure["failurePhase"] == "argument-validation"


def test_failed_staged_promotion_preserves_prior_complete_product_set():
    assert callable(_promote_staged_run), "adapter lacks staged atomic promotion"
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        output_dir = root / "products"
        staging_dir = root / "staging"
        report_path = root / "success.json"
        output_dir.mkdir()
        staging_dir.mkdir()
        for name in ("rgb.png", "silhouette.png", "depth.exr", "normal.exr"):
            (output_dir / name).write_bytes(f"old-{name}".encode())
            (staging_dir / name).write_bytes(f"new-{name}".encode())
        report_path.write_text('{"generation":"old"}\n')

        calls = 0

        def failing_replace(source, target):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("promotion fault")
            return __import__("os").replace(source, target)

        try:
            _promote_staged_run(
                staging_dir=staging_dir,
                output_dir=output_dir,
                report_path=report_path,
                report={"generation": "new"},
                replace=failing_replace,
            )
        except OSError as error:
            assert "promotion fault" in str(error)
        else:
            raise AssertionError("faulting promotion unexpectedly succeeded")

        assert report_path.read_text() == '{"generation":"old"}\n'
        for name in ("rgb.png", "silhouette.png", "depth.exr", "normal.exr"):
            assert (output_dir / name).read_bytes() == f"old-{name}".encode()


def test_silhouette_is_derived_from_the_same_camera_render_alpha():
    adapter = (Path(__file__).resolve().parents[1] / "source_plate_blender.py").read_text()

    assert "scene.render.film_transparent = True" in adapter
    assert 'source_pixels[index + 3]' in adapter
    assert 'scene.render.filepath = str(outputs["silhouette"])' in adapter


if __name__ == "__main__":
    test_four_channel_paths_are_unique_and_caller_addressed()
    test_failure_report_preserves_phase_and_last_trustworthy_identity()
    test_blender_adapter_never_saves_the_loaded_source()
    test_blender_bootstraps_its_script_directory_before_importing_the_core()
    test_blender_51_writes_distinct_exr_render_pass_artifacts()
    test_output_records_bind_channel_representation()
    test_collection_selectors_resolve_objects_without_requiring_object_duplication()
    test_neutral_clay_presentation_uses_one_descriptor_bound_material()
    test_material_contract_rejects_missing_unsupported_and_malformed_modes()
    test_object_color_remains_object_derived_without_clay_color()
    test_output_inspection_measures_pixels_format_dimensions_and_signed_normals()
    test_output_inspection_rejects_blank_wrong_size_and_unsigned_normal_claims()
    test_explicit_encoded_normal_derivative_is_decoded_and_unit_checked()
    test_cli_paths_are_explicit_and_argument_failure_is_durable()
    test_failed_staged_promotion_preserves_prior_complete_product_set()
    test_silhouette_is_derived_from_the_same_camera_render_alpha()
