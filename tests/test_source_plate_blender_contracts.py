from __future__ import annotations

from pathlib import Path
import sys
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from source_plate_blender import channel_paths, failure_document  # noqa: E402


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


def test_blender_51_uses_the_scene_compositing_node_group():
    adapter = (Path(__file__).resolve().parents[1] / "source_plate_blender.py").read_text()

    assert "scene.compositing_node_group" in adapter


def test_blender_51_uses_supported_compositor_node_types():
    adapter = (Path(__file__).resolve().parents[1] / "source_plate_blender.py").read_text()

    assert 'render_layers.outputs["Alpha"]' in adapter
    assert 'nodes.new("CompositorNodeIDMask")' not in adapter
    assert 'nodes.new("CompositorNodeComposite")' not in adapter
    assert 'nodes.new("CompositorNodeMath")' not in adapter


if __name__ == "__main__":
    test_four_channel_paths_are_unique_and_caller_addressed()
    test_failure_report_preserves_phase_and_last_trustworthy_identity()
    test_blender_adapter_never_saves_the_loaded_source()
    test_blender_bootstraps_its_script_directory_before_importing_the_core()
    test_blender_51_uses_the_scene_compositing_node_group()
    test_blender_51_uses_supported_compositor_node_types()
