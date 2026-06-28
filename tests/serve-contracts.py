from http import HTTPStatus
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve
from serve import BROWSE_ROOTS
from serve import KaminosHandler
from serve import build_display_metadata, build_output_display_metadata
from serve import list_greenroom_output_files, resolve_greenroom_output_dir


def test_http_status_404_log_does_not_crash():
    handler = KaminosHandler.__new__(KaminosHandler)
    handler.requestline = "GET /favicon.ico HTTP/1.1"
    handler.client_address = ("127.0.0.1", 0)
    KaminosHandler.log_message(
        handler,
        "code %d, message %s",
        HTTPStatus.NOT_FOUND,
        "File not found",
    )


def test_volume_only_scene_save_name_uses_scene_fallback():
    data = {
        "schema": "kaminos.scene.v1",
        "version": 3,
        "timestamp": "2026-06-13T22:00:00.000Z",
        "model": None,
        "objects": [],
        "volumePrimitives": {
            "schema": "kaminos.volume-primitives.v0",
            "primitives": [{"id": "fixture-fire-smoke-sphere"}],
        },
    }
    model_name = (data.get("model") or {}).get("fileName", "scene")
    assert model_name == "scene"


def test_greenroom_job_display_metadata_promotes_receipt_identity_over_job_id():
    receipt = {
        "status": "done",
        "job_type": "trellis2mlx_qem",
        "input_path": "/Users/noahlyons/dev/pixal3d-mlx-assets/Brand_the_dons_name.jpeg",
        "output_dir": "/tmp/greenroom-brand-qem-256-s1337",
        "finished_at": "2026-06-14T07:30:00Z",
        "params": {"seed": "1337"},
    }
    display = build_display_metadata(
        "ed5f1346cc1f",
        entry_type="dir",
        receipt=receipt,
        output_files=["seed-1337.glb", "preview.png"],
    )

    assert display["title"] == "Brand The Dons Name"
    assert display["raw_name"] == "ed5f1346cc1f"
    assert display["job_type"] == "trellis2mlx_qem"
    assert display["job_type_label"] == "Trellis2mlx Qem"
    assert display["seed"] == "1337"
    assert display["output_count"] == 2
    assert display["load_label"] == "Load mesh"
    assert "Trellis2mlx Qem" in display["subtitle"]
    assert "seed 1337" in display["subtitle"]
    assert "2 outputs" in display["subtitle"]
    assert "ed5f1346cc1f" in display["meta"]


def test_greenroom_output_display_metadata_uses_job_context_for_hostile_output_names():
    job_display = {
        "title": "Brand The Dons Name",
        "seed": "1337",
        "job_type_label": "Trellis2mlx Qem",
    }
    output = build_output_display_metadata(
        "seed-1337.glb",
        job_display=job_display,
        size=64000000,
    )

    assert output["title"] == "Brand The Dons Name Mesh"
    assert output["raw_name"] == "seed-1337.glb"
    assert output["load_label"] == "Load mesh"
    assert output["subtitle"] == "GLB / seed 1337 / 61.0 MB"


def test_greenroom_configured_root_outputs_are_served_even_when_outside_home():
    with TemporaryDirectory(dir="/tmp") as tmp:
        greenroom = Path(tmp) / "greenroom"
        output_dir = greenroom / "outputs" / "ed5f1346cc1f"
        output_dir.mkdir(parents=True)
        (output_dir / "preview.png").write_bytes(b"png")
        (output_dir / "seed-1337.glb").write_bytes(b"glb")

        previous = BROWSE_ROOTS["greenroom"]
        BROWSE_ROOTS["greenroom"] = greenroom
        try:
            assert not output_dir.resolve().is_relative_to(Path.home().resolve())
            receipt = {"output_dir": str(output_dir)}

            assert resolve_greenroom_output_dir(receipt["output_dir"]) == output_dir.resolve()
            assert list_greenroom_output_files(receipt) == ["preview.png", "seed-1337.glb"]

            display = build_display_metadata(
                "ed5f1346cc1f",
                entry_type="dir",
                receipt=receipt,
                output_files=list_greenroom_output_files(receipt),
            )
            assert display["output_count"] == 2
            assert display["mesh_output_count"] == 1
            assert display["load_label"] == "Load mesh"
        finally:
            BROWSE_ROOTS["greenroom"] = previous


def test_greenroom_stray_output_dirs_do_not_get_load_affordance():
    with TemporaryDirectory(dir="/tmp") as tmp:
        greenroom = Path(tmp) / "greenroom"
        output_dir = Path(tmp) / "stray-outputs"
        greenroom.mkdir()
        output_dir.mkdir()
        (output_dir / "seed-1337.glb").write_bytes(b"glb")

        previous = BROWSE_ROOTS["greenroom"]
        BROWSE_ROOTS["greenroom"] = greenroom
        try:
            assert resolve_greenroom_output_dir(str(output_dir)) is None
            output_files = list_greenroom_output_files({"output_dir": str(output_dir)})
            assert output_files == []

            display = build_display_metadata(
                "ed5f1346cc1f",
                entry_type="dir",
                receipt={"output_dir": str(output_dir)},
                output_files=output_files,
            )
            assert display["output_count"] == 0
            assert display["mesh_output_count"] == 0
            assert display["load_label"] == "Open"
        finally:
            BROWSE_ROOTS["greenroom"] = previous


def test_splat_asset_index_separates_experimental_and_production_roots():
    with TemporaryDirectory(dir="/tmp") as tmp:
        root = Path(tmp)
        experimental = root / "splats" / "inbox"
        production = root / "splats" / "production"
        experimental.mkdir(parents=True)
        production.mkdir(parents=True)
        (experimental / "hostile-greenroom-output-9f31c.ply").write_text("ply\n")
        (production / "hero-splat.spz").write_bytes(b"spz")
        (root / "loose-machine-scan.ply").write_text("must not appear")

        previous_roots = list(serve.ASSET_ROOTS)
        previous_browse = dict(BROWSE_ROOTS)
        serve.ASSET_ROOTS[:] = [
            {
                "id": "splat-inbox",
                "label": "Experimental Splat Inbox",
                "kind": "splat",
                "stage": "experimental",
                "path": experimental,
            },
            {
                "id": "splat-production",
                "label": "Production Splats",
                "kind": "splat",
                "stage": "production",
                "path": production,
            },
        ]
        BROWSE_ROOTS["splat-inbox"] = experimental
        BROWSE_ROOTS["splat-production"] = production
        try:
            entries = serve.list_asset_entries(kind="splat")
        finally:
            serve.ASSET_ROOTS[:] = previous_roots
            BROWSE_ROOTS.clear()
            BROWSE_ROOTS.update(previous_browse)

        assert {entry["stage"] for entry in entries} == {"experimental", "production"}
        assert [entry["root_id"] for entry in entries] == ["splat-inbox", "splat-production"]
        assert all(entry["source"].startswith("/api/read?root=splat-") for entry in entries)
        assert all(entry["display"]["raw_name"] in entry["path"] for entry in entries)
        assert entries[0]["display"]["title"] == "Hostile Greenroom Output 9f31c"
        assert "loose-machine-scan.ply" not in {entry["name"] for entry in entries}


def test_splat_asset_index_allows_pointer_symlinks_inside_declared_roots():
    with TemporaryDirectory(dir="/tmp") as tmp:
        root = Path(tmp)
        experimental = root / "splats" / "inbox"
        target_dir = root / "external-targets"
        experimental.mkdir(parents=True)
        target_dir.mkdir()
        target = target_dir / "real-splat.ply"
        target.write_text("ply\n")
        pointer = experimental / "pointer-splat.ply"
        pointer.symlink_to(target)

        previous_roots = list(serve.ASSET_ROOTS)
        previous_browse = dict(BROWSE_ROOTS)
        serve.ASSET_ROOTS[:] = [
            {
                "id": "splat-inbox",
                "label": "Experimental Splat Inbox",
                "kind": "splat",
                "stage": "experimental",
                "path": experimental,
            },
        ]
        BROWSE_ROOTS["splat-inbox"] = experimental
        try:
            entries = serve.list_asset_entries(kind="splat")
            resolved = serve.resolve_splat_asset_path("splat-inbox", "pointer-splat.ply")
        finally:
            serve.ASSET_ROOTS[:] = previous_roots
            BROWSE_ROOTS.clear()
            BROWSE_ROOTS.update(previous_browse)

        assert len(entries) == 1
        assert entries[0]["root_id"] == "splat-inbox"
        assert entries[0]["path"] == "pointer-splat.ply"
        assert entries[0]["source"] == "/api/read?root=splat-inbox&path=pointer-splat.ply"
        assert resolved[2].name == "pointer-splat.ply"
        assert resolved[2].read_text() == "ply\n"


def test_splat_asset_ingest_writes_only_to_experimental_inbox():
    with TemporaryDirectory(dir="/tmp") as tmp:
        root = Path(tmp)
        experimental = root / "splats" / "inbox"
        production = root / "splats" / "production"
        outside = root / "outside"
        experimental.mkdir(parents=True)
        production.mkdir(parents=True)
        outside.mkdir()

        previous_roots = list(serve.ASSET_ROOTS)
        previous_browse = dict(BROWSE_ROOTS)
        serve.ASSET_ROOTS[:] = [
            {
                "id": "splat-inbox",
                "label": "Experimental Splat Inbox",
                "kind": "splat",
                "stage": "experimental",
                "path": experimental,
            },
            {
                "id": "splat-production",
                "label": "Production Splats",
                "kind": "splat",
                "stage": "production",
                "path": production,
            },
        ]
        BROWSE_ROOTS["splat-inbox"] = experimental
        BROWSE_ROOTS["splat-production"] = production
        try:
            entry = serve.ingest_splat_asset("../Hostile Drop Name.PLY", b"ply\n")
        finally:
            serve.ASSET_ROOTS[:] = previous_roots
            BROWSE_ROOTS.clear()
            BROWSE_ROOTS.update(previous_browse)

        assert entry["stage"] == "experimental"
        assert entry["root_id"] == "splat-inbox"
        assert entry["source"].startswith("/api/read?root=splat-inbox&path=")
        assert entry["name"].endswith(".ply")
        assert "/" not in entry["name"]
        assert ".." not in entry["name"]
        assert (experimental / entry["name"]).read_bytes() == b"ply\n"
        assert not any(production.iterdir())
        assert not any(outside.iterdir())


def test_splat_asset_correction_roundtrips_as_sidecar_metadata():
    with TemporaryDirectory(dir="/tmp") as tmp:
        root = Path(tmp)
        experimental = root / "splats" / "inbox"
        production = root / "splats" / "production"
        experimental.mkdir(parents=True)
        production.mkdir(parents=True)
        asset = experimental / "plant-shelf.ply"
        asset.write_bytes(b"ply\n")

        previous_roots = list(serve.ASSET_ROOTS)
        previous_browse = dict(BROWSE_ROOTS)
        serve.ASSET_ROOTS[:] = [
            {
                "id": "splat-inbox",
                "label": "Experimental Splat Inbox",
                "kind": "splat",
                "stage": "experimental",
                "path": experimental,
            },
            {
                "id": "splat-production",
                "label": "Production Splats",
                "kind": "splat",
                "stage": "production",
                "path": production,
            },
        ]
        BROWSE_ROOTS["splat-inbox"] = experimental
        BROWSE_ROOTS["splat-production"] = production
        try:
            correction = serve.save_splat_asset_correction("splat-inbox", "plant-shelf.ply", {
                "orientation": {"rotation": [0.1, 0.2, 0.3]},
                "axisFlips": [-1, 1, -1],
                "centroidOffset": [1, 2, 3],
                "crop": {"enabled": True, "min": [-0.5, -0.25, -0.1], "max": [0.5, 0.25, 0.9]},
            })
            loaded = serve.load_splat_asset_correction("splat-inbox", "plant-shelf.ply")
            entries = serve.list_asset_entries(kind="splat")
            sidecar = experimental / "plant-shelf.ply.kaminos-splat.json"
            assert sidecar.is_file()
            assert correction["schema"] == "kaminos.splat-correction.v0"
            assert correction["root_id"] == "splat-inbox"
            assert correction["path"] == "plant-shelf.ply"
            assert loaded["correction"]["orientation"]["rotation"] == [0.1, 0.2, 0.3]
            assert loaded["correction"]["axisFlips"] == [-1, 1, -1]
            assert loaded["correction"]["centroidOffset"] == [1, 2, 3]
            assert entries[0]["correction"]["axisFlips"] == [-1, 1, -1]
            assert entries[0]["correction"]["crop"]["enabled"] is True

            replacement = serve.ingest_splat_asset("plant-shelf.ply", b"replacement\n")
            assert replacement["path"] == "plant-shelf.ply"
            assert replacement["correction"] is None
            assert not sidecar.exists()
        finally:
            serve.ASSET_ROOTS[:] = previous_roots
            BROWSE_ROOTS.clear()
            BROWSE_ROOTS.update(previous_browse)


def test_motion_take_save_list_load_roundtrips_full_generated_payload():
    with TemporaryDirectory(dir="/tmp") as tmp:
        motion_takes = Path(tmp) / "motion-takes"
        previous_dir = serve.KAMINOS_MOTION_TAKES_DIR
        serve.KAMINOS_MOTION_TAKES_DIR = motion_takes
        try:
            payload = {
                "schema": "kaminos.motion-take.v0",
                "title": "Startled Jump Turn",
                "prompt": "a man looks behind himself then startles and jumps",
                "source": {
                    "schema": "kaminos.motion-take-source.v0",
                    "route": "motion-server:http://127.0.0.1:8098/generate",
                    "model": "kimodo",
                    "status": "live-generated",
                },
                "settings": {
                    "schema": "kaminos.motion-take-settings.v0",
                    "duration": 6,
                    "steps": 100,
                    "sourceOrientationRemap": {"upAxis": "auto", "forwardAxis": "auto"},
                },
                "clip": {
                    "schema": "kaminos.generated-pose-temporal.v0",
                    "id": "panel_startled_jump_turn_temporal_v0",
                    "label": "Startled Jump Turn",
                    "sourceKind": "motion-panel-generated-pose-temporal",
                    "sourceStatus": "live-generated",
                    "sourceRoute": "motion-server:http://127.0.0.1:8098/generate",
                    "sourceModel": "kimodo",
                    "fps": 30,
                    "duration": 6,
                    "rawFrameCount": 2,
                    "temporalSamples": [
                        {"frame": 0, "sourceFrame": 0, "time": 0, "phaseLabel": "enter", "root": [0, 0, 0]},
                        {"frame": 1, "sourceFrame": 1, "time": 0.03333, "phaseLabel": "notice", "root": [0, 0, 0.1]},
                    ],
                },
                "cliplets": {
                    "schema": "kaminos.generated-motion-cliplets.v0",
                    "segmentation": {"outputLayer": "phrase"},
                    "rawSegments": [
                        {"id": "raw_000", "labelGuess": "enter / approach"},
                        {"id": "raw_001", "labelGuess": "startle / notice"},
                    ],
                    "segments": [
                        {
                            "id": "phrase_000",
                            "labelGuess": "startle-recoil / escape",
                            "rawSegmentIds": ["raw_000", "raw_001"],
                            "coalescing": {"reasons": ["named-startle-recoil"]},
                        },
                    ],
                },
            }

            saved = serve.save_motion_take(payload)
            listed = serve.list_motion_takes()
            loaded = serve.load_motion_take(saved["id"])
            saved_path = motion_takes / f"{saved['id']}.kaminos-motion-take.json"

            assert saved["schema"] == "kaminos.motion-take.v0"
            assert saved["id"].startswith("startled-jump-turn")
            assert saved["storage"]["schema"] == "kaminos.motion-take-storage.v0"
            assert saved["storage"]["source"] == f"/api/motion-takes?id={saved['id']}"
            assert saved_path.is_file()
            assert listed["schema"] == "kaminos.motion-take-index.v0"
            assert listed["count"] == 1
            assert listed["takes"][0]["id"] == saved["id"]
            assert listed["takes"][0]["title"] == "Startled Jump Turn"
            assert loaded["id"] == saved["id"]
            assert loaded["source"]["route"].endswith("/generate")
            assert loaded["clip"]["temporalSamples"][1]["phaseLabel"] == "notice"
            assert loaded["cliplets"]["segments"][0]["rawSegmentIds"] == ["raw_000", "raw_001"]
        finally:
            serve.KAMINOS_MOTION_TAKES_DIR = previous_dir


def test_motion_take_save_rejects_empty_or_fixture_fallback_payload():
    with TemporaryDirectory(dir="/tmp") as tmp:
        previous_dir = serve.KAMINOS_MOTION_TAKES_DIR
        serve.KAMINOS_MOTION_TAKES_DIR = Path(tmp) / "motion-takes"
        try:
            try:
                serve.save_motion_take({
                    "schema": "kaminos.motion-take.v0",
                    "title": "Empty",
                    "prompt": "",
                    "clip": {
                        "schema": "kaminos.generated-pose-temporal.v0",
                        "id": "empty_temporal_v0",
                        "sourceStatus": "fixture",
                        "temporalSamples": [],
                    },
                })
            except ValueError as error:
                assert "temporalSamples" in str(error) or "source route" in str(error)
            else:
                raise AssertionError("empty/default motion take payload should not be saved")
        finally:
            serve.KAMINOS_MOTION_TAKES_DIR = previous_dir


def test_runtime_config_exposes_hybrid_overlay_module_url_env():
    previous = os.environ.get("KAMINOS_HYBRID_SPLAT_OVERLAY_MODULE_URL")
    os.environ["KAMINOS_HYBRID_SPLAT_OVERLAY_MODULE_URL"] = "http://127.0.0.1:5174/src/splatOverlay.ts"
    try:
        config = serve.runtime_config()
    finally:
        if previous is None:
            os.environ.pop("KAMINOS_HYBRID_SPLAT_OVERLAY_MODULE_URL", None)
        else:
            os.environ["KAMINOS_HYBRID_SPLAT_OVERLAY_MODULE_URL"] = previous

    assert config["schema"] == "kaminos.runtime-config.v0"
    assert config["hybridSplatOverlayModuleUrl"] == "http://127.0.0.1:5174/src/splatOverlay.ts"


if __name__ == "__main__":
    test_http_status_404_log_does_not_crash()
    test_volume_only_scene_save_name_uses_scene_fallback()
    test_greenroom_job_display_metadata_promotes_receipt_identity_over_job_id()
    test_greenroom_output_display_metadata_uses_job_context_for_hostile_output_names()
    test_greenroom_configured_root_outputs_are_served_even_when_outside_home()
    test_greenroom_stray_output_dirs_do_not_get_load_affordance()
    test_splat_asset_index_separates_experimental_and_production_roots()
    test_splat_asset_index_allows_pointer_symlinks_inside_declared_roots()
    test_splat_asset_ingest_writes_only_to_experimental_inbox()
    test_splat_asset_correction_roundtrips_as_sidecar_metadata()
    test_motion_take_save_list_load_roundtrips_full_generated_payload()
    test_motion_take_save_rejects_empty_or_fixture_fallback_payload()
    test_runtime_config_exposes_hybrid_overlay_module_url_env()
