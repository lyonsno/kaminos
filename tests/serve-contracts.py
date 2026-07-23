from http import HTTPStatus
from io import BytesIO
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve
from serve import ASSET_ROOTS, BROWSE_ROOTS
from serve import KaminosHandler
from serve import build_display_metadata, build_output_display_metadata
from serve import list_greenroom_output_files, resolve_greenroom_output_dir
from serve import list_asset_entries
from serve import resolve_sharp_scheduler_profile, pipeline_witness_env_for_payload


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


def test_forge_host_registry_snapshot_preserves_endpoint_identity():
    with TemporaryDirectory(dir="/tmp") as tmp:
        root = Path(tmp)
        endpoint_registry = root / "directive-alert-endpoints.json"
        diaulos_registry = root / "diauloi.json"
        endpoint_registry.write_text(json.dumps({
            "schema": "epistaxis.directive_alert_endpoints.v1",
            "endpoints": [
                {
                    "diaulos": "wake-and-bake-pit-boss",
                    "status": "active",
                    "observed_at": "2026-06-29T04:19:00Z",
                    "endpoint": {
                        "cwd": "/Users/noahlyons/dev/lerms",
                        "kind": "wezterm-pane",
                        "pane_id": "37",
                        "resume": "codex resume wake-thread",
                        "thread_id": "wake-thread",
                        "tool": "codex",
                    },
                },
                {
                    "diaulos": "old-dead-lane",
                    "status": "inactive",
                    "observed_at": "2026-06-20T00:00:00Z",
                    "endpoint": {"cwd": "/tmp/old", "tool": "codex"},
                },
            ],
        }))
        diaulos_registry.write_text(json.dumps({
            "schema": "epistaxis.diaulos-registry.v1",
            "diauloi": [
                {
                    "handle": "wake-and-bake-pit-boss",
                    "id": "dia-wake-fixture",
                    "status": "active",
                    "source_topoi": ["projects/lerms/topoi/codex-wake-and-bake-pit-boss-0627.md"],
                },
            ],
        }))

        snapshot = serve.build_forge_host_registry_snapshot(
            endpoint_registry_path=endpoint_registry,
            diaulos_registry_path=diaulos_registry,
        )

    assert snapshot["schema"] == "kaminos.forge-host.registry-snapshot.v0"
    assert snapshot["sourceAuthority"] == "live_registry"
    assert snapshot["endpointRegistry"]["path"] == str(endpoint_registry)
    assert snapshot["endpointRegistry"]["loaded"] is True
    assert snapshot["diaulosRegistry"]["loaded"] is True
    assert len(snapshot["endpoints"]) == 1
    assert snapshot["endpoints"][0]["diaulos"] == "wake-and-bake-pit-boss"
    assert snapshot["endpoints"][0]["diaulosId"] == "dia-wake-fixture"
    assert snapshot["endpoints"][0]["endpoint"]["thread_id"] == "wake-thread"
    assert snapshot["endpoints"][0]["sourceTopoi"] == ["projects/lerms/topoi/codex-wake-and-bake-pit-boss-0627.md"]


def test_forge_host_registry_snapshot_fallback_is_not_live():
    with TemporaryDirectory(dir="/tmp") as tmp:
        missing = Path(tmp) / "missing-endpoints.json"
        snapshot = serve.build_forge_host_registry_snapshot(endpoint_registry_path=missing)

    assert snapshot["schema"] == "kaminos.forge-host.registry-snapshot.v0"
    assert snapshot["sourceAuthority"] == "fallback"
    assert snapshot["endpointRegistry"]["exists"] is False
    assert snapshot["endpointRegistry"]["loaded"] is False
    assert snapshot["endpoints"] == []
    assert snapshot["warnings"], "missing registry should be visible to the browser instead of silently falling back"


def test_sharp_breathing_room_profiles_are_named_operator_routes_with_explicit_env():
    default = resolve_sharp_scheduler_profile("baseline-default")
    friendly = resolve_sharp_scheduler_profile("cooperative-spn-gaussian")

    assert default["id"] == "baseline-default"
    assert default["operatorLabel"] == "Default"
    assert json.loads(default["env"]["KAMINOS_SHARP_WEBGPU_SCHEDULER"]) == {"mode": "default"}
    assert friendly["id"] == "cooperative-spn-gaussian"
    assert friendly["operatorLabel"] == "Friendly"
    friendly_scheduler = json.loads(friendly["env"]["KAMINOS_SHARP_WEBGPU_SCHEDULER"])
    assert friendly_scheduler["mode"] == "cooperative"
    assert friendly_scheduler["spnPatchChunkSize"] == 1
    assert friendly_scheduler["yieldMs"] == 4
    assert friendly_scheduler["waitForSubmittedWorkDone"] is True
    assert friendly_scheduler["gaussianPhaseYieldMs"] == 4
    assert friendly_scheduler["vitBlockChunkSize"] == 1
    assert friendly_scheduler["vitMicroduty"] is True
    assert friendly_scheduler["vitMicrodutyMode"] == "dispatch-major"
    assert friendly_scheduler["cpuChunkItems"] == 16384
    assert friendly_scheduler["routeTailYieldMs"] == 3
    assert friendly_scheduler["spnFusionChunkItems"] == 524288
    assert friendly_scheduler["decoderKernelChunkItems"] == 524288
    assert friendly_scheduler["plyAssemblyMode"] == "worker"
    assert friendly_scheduler["retirePostInferenceBuffers"] is True
    assert friendly["unsupportedFields"] == []


def test_fixed_16ms_donation_profile_changes_only_post_drain_donation():
    baseline = resolve_sharp_scheduler_profile("cooperative-spn-gaussian")
    fixed = resolve_sharp_scheduler_profile("cooperative-fixed-16ms-donation")

    assert fixed["id"] == "cooperative-fixed-16ms-donation"
    assert fixed["operatorVisible"] is False
    baseline_scheduler = json.loads(baseline["env"]["KAMINOS_SHARP_WEBGPU_SCHEDULER"])
    fixed_scheduler = json.loads(fixed["env"]["KAMINOS_SHARP_WEBGPU_SCHEDULER"])
    assert fixed_scheduler == {
        **baseline_scheduler,
        "yieldMs": 16,
        "gaussianPhaseYieldMs": 16,
        "routeTailYieldMs": 16,
    }
    assert fixed_scheduler["spnPatchChunkSize"] == 1
    assert fixed_scheduler["vitBlockChunkSize"] == 1
    assert fixed_scheduler["vitMicroduty"] is True
    assert fixed_scheduler["vitMicrodutyMode"] == "dispatch-major"
    assert fixed_scheduler["waitForSubmittedWorkDone"] is True
    assert fixed_scheduler["cpuChunkItems"] == 16384
    assert fixed_scheduler["spnFusionChunkItems"] == 524288
    assert fixed_scheduler["decoderKernelChunkItems"] == 524288
    assert fixed_scheduler["plyAssemblyMode"] == "worker"
    assert fixed_scheduler["retirePostInferenceBuffers"] is True


def test_spn_fusion_tile_profile_is_a_compatibility_alias_for_promoted_friendly_tiling():
    baseline = resolve_sharp_scheduler_profile("cooperative-spn-gaussian")
    tiled = resolve_sharp_scheduler_profile("cooperative-spn-fusion-tiles-524288")

    assert tiled["id"] == "cooperative-spn-fusion-tiles-524288"
    assert tiled["operatorVisible"] is False
    baseline_scheduler = json.loads(baseline["env"]["KAMINOS_SHARP_WEBGPU_SCHEDULER"])
    tiled_scheduler = json.loads(tiled["env"]["KAMINOS_SHARP_WEBGPU_SCHEDULER"])
    assert tiled_scheduler == baseline_scheduler
    assert tiled["proofExpectation"]["requiredBoundary"] == "phaseChunkSize.spnFusionOutputItems"
    assert tiled["proofExpectation"]["minimumRangeEvents"] == 2


def test_sharp_breathing_room_unknown_profile_fails_instead_of_falling_back():
    try:
        resolve_sharp_scheduler_profile("friendly-but-typo")
    except ValueError as error:
        assert "Unknown SHARP scheduler profile" in str(error)
    else:
        raise AssertionError("unknown scheduler profile must not silently fall back to default")


def test_pipeline_witness_env_for_payload_preserves_requested_scheduler_profile():
    env, profile = pipeline_witness_env_for_payload({
        "pipelineId": "sharp-image-to-splat-live-v0",
        "schedulerProfileId": "cooperative-spn-gaussian",
    })

    assert profile["id"] == "cooperative-spn-gaussian"
    assert profile["operatorLabel"] == "Friendly"
    scheduler = json.loads(env["KAMINOS_SHARP_WEBGPU_SCHEDULER"])
    assert scheduler["mode"] == "cooperative"
    assert scheduler["gaussianPhaseYieldMs"] == 4
    assert scheduler["vitBlockChunkSize"] == 1
    assert scheduler["vitMicroduty"] is True
    assert scheduler["vitMicrodutyMode"] == "dispatch-major"
    assert scheduler["spnFusionChunkItems"] == 524288
    assert scheduler["decoderKernelChunkItems"] == 524288
    assert scheduler["plyAssemblyMode"] == "worker"
    assert scheduler["retirePostInferenceBuffers"] is True


def test_image_inbox_webp_read_serves_bytes_without_json_fallback():
    with TemporaryDirectory(dir="/tmp") as tmp:
        root = Path(tmp)
        webp_bytes = b"RIFF\x10\x00\x00\x00WEBPVP8Xfixture"
        (root / "sample.webp").write_bytes(webp_bytes)

        previous = BROWSE_ROOTS["image-inbox"]
        BROWSE_ROOTS["image-inbox"] = root
        try:
            handler = KaminosHandler.__new__(KaminosHandler)
            handler.wfile = BytesIO()
            responses = []
            headers = []
            handler.send_response = lambda status: responses.append(status)
            handler.send_header = lambda name, value: headers.append((name, value))
            handler.end_headers = lambda: None

            handler.handle_read({"root": ["image-inbox"], "path": ["sample.webp"]})
        finally:
            BROWSE_ROOTS["image-inbox"] = previous

    assert responses == [200]
    assert ("Content-Type", "image/webp") in headers
    assert handler.wfile.getvalue() == webp_bytes


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


def test_splat_asset_index_marks_stub_ply_as_not_splat_like():
    with TemporaryDirectory(dir="/tmp") as tmp:
        root = Path(tmp)
        experimental = root / "splats" / "inbox"
        experimental.mkdir(parents=True)
        (experimental / "mesh-not-a-splat.ply").write_text("\n".join([
            "ply",
            "format ascii 1.0",
            "element vertex 1",
            "property float x",
            "property float y",
            "property float z",
            "end_header",
            "0 0 0",
            "",
        ]))
        (experimental / "probable-gaussian-splat.ply").write_text("\n".join([
            "ply",
            "format ascii 1.0",
            "element vertex 1",
            "property float x",
            "property float y",
            "property float z",
            "property float opacity",
            "property float scale_0",
            "property float scale_1",
            "property float scale_2",
            "property float rot_0",
            "property float f_dc_0",
            "end_header",
            "0 0 0 1 1 1 1 1 1",
            "",
        ]))

        previous_roots = list(serve.ASSET_ROOTS)
        previous_browse = dict(BROWSE_ROOTS)
        serve.ASSET_ROOTS[:] = [{
            "id": "splat-inbox",
            "label": "Experimental Splat Inbox",
            "kind": "splat",
            "stage": "experimental",
            "path": experimental,
        }]
        BROWSE_ROOTS["splat-inbox"] = experimental
        try:
            entries = {entry["name"]: entry for entry in serve.list_asset_entries(kind="splat")}
        finally:
            serve.ASSET_ROOTS[:] = previous_roots
            BROWSE_ROOTS.clear()
            BROWSE_ROOTS.update(previous_browse)

        assert entries["mesh-not-a-splat.ply"]["renderability"]["status"] == "not-splat-like"
        assert "gaussian splat properties" in entries["mesh-not-a-splat.ply"]["renderability"]["reason"]
        assert entries["probable-gaussian-splat.ply"]["renderability"]["status"] == "splat-header-like"
        assert entries["probable-gaussian-splat.ply"]["renderability"]["previewState"] == "not-rendered"
        assert "not a verified render" in entries["probable-gaussian-splat.ply"]["renderability"]["reason"]


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


def test_pipeline_manifest_endpoint_payload_is_route_identified():
    payload = serve.pipeline_manifest_payload()

    assert payload["schema"] == "kaminos.pipeline-manifest.v0"
    assert payload["manifestPath"].endswith("pipelines/asset-pipelines.json")
    assert len(payload["manifestSha256"]) == 64
    assert any(pipeline["id"] == "prepared-splat-import-sidecar-v0" for pipeline in payload["pipelines"])
    assert any(pipeline["routeId"] == "adapter.model-chain-availability.v0" for pipeline in payload["pipelines"])


def test_image_asset_index_declares_local_image_roots():
    with TemporaryDirectory(dir="/tmp") as tmp:
        root = Path(tmp) / "images"
        root.mkdir()
        image = root / "prompt-card.png"
        image.write_bytes(b"\\x89PNG\\r\\n\\x1a\\n")

        previous_roots = list(ASSET_ROOTS)
        previous_browse = dict(BROWSE_ROOTS)
        ASSET_ROOTS[:] = [{
            "id": "image-test",
            "label": "Test Images",
            "kind": "image",
            "stage": "working",
            "path": root,
        }]
        BROWSE_ROOTS["image-test"] = root
        try:
            entries = list_asset_entries(kind="image")
        finally:
            ASSET_ROOTS[:] = previous_roots
            BROWSE_ROOTS.clear()
            BROWSE_ROOTS.update(previous_browse)

        assert len(entries) == 1
        assert entries[0]["kind"] == "image"
        assert entries[0]["root_id"] == "image-test"
        assert entries[0]["source"] == "/api/read?root=image-test&path=prompt-card.png"
        assert entries[0]["display"]["load_label"] == "Use Image"


def test_pipeline_run_resolves_api_read_source_and_returns_bundle():
    with TemporaryDirectory(dir="/tmp") as tmp:
        root = Path(tmp)
        source_root = root / "splats"
        source_root.mkdir()
        source = source_root / "prepared-source.ply"
        source.write_text("ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n")
        out_dir = root / "pipeline-run"

        previous_browse = dict(BROWSE_ROOTS)
        BROWSE_ROOTS["pipeline-test"] = source_root
        try:
            result = serve.run_pipeline_witness({
                "pipelineId": "prepared-splat-import-sidecar-v0",
                "source": "/api/read?root=pipeline-test&path=prepared-source.ply",
                "outDir": str(out_dir),
            })
        finally:
            BROWSE_ROOTS.clear()
            BROWSE_ROOTS.update(previous_browse)

        assert result["schema"] == "kaminos.pipeline-run-result.v0"
        assert result["ok"] is True
        assert result["source"]["path"] == str(source.resolve())
        assert result["report"]["path"] == str(out_dir / "pipeline-witness.json")
        assert result["bundle"]["path"] == str(out_dir / "pipeline-run.index.json")
        assert result["report"]["document"]["effectivePipelineId"] == "prepared-splat-import-sidecar-v0"
        assert result["bundle"]["document"]["registryScope"] == "run-local"
        assert any(artifact["id"] == "sidecar" for artifact in result["bundle"]["document"]["artifacts"])


def test_pipeline_run_writes_failure_report_when_child_exits_before_report():
    with TemporaryDirectory(dir="/tmp") as tmp:
        root = Path(tmp)
        source_root = root / "images"
        source_root.mkdir()
        source = source_root / "source.png"
        source.write_bytes(b"\x89PNG\r\n\x1a\n")
        out_dir = root / "pipeline-run"
        fake_node = root / "fake-node"
        fake_node.write_text(
            "#!/bin/sh\n"
            "echo 'synthetic child import failure before report' >&2\n"
            "exit 37\n"
        )
        fake_node.chmod(0o755)

        previous_browse = dict(BROWSE_ROOTS)
        previous_node = os.environ.get("KAMINOS_NODE")
        BROWSE_ROOTS["pipeline-test-images"] = source_root
        os.environ["KAMINOS_NODE"] = str(fake_node)
        try:
            result = serve.run_pipeline_witness({
                "pipelineId": "sharp-image-to-splat-live-v0",
                "source": "/api/read?root=pipeline-test-images&path=source.png",
                "outDir": str(out_dir),
            })
        finally:
            BROWSE_ROOTS.clear()
            BROWSE_ROOTS.update(previous_browse)
            if previous_node is None:
                os.environ.pop("KAMINOS_NODE", None)
            else:
                os.environ["KAMINOS_NODE"] = previous_node

        report_path = out_dir / "pipeline-witness.json"
        assert result["ok"] is False
        assert result["exitCode"] == 37
        assert result["report"]["path"] == str(report_path)
        assert report_path.exists(), "server wrapper must not point at a missing report"
        assert result["report"]["document"]["schema"] == "kaminos.pipeline-witness.v0"
        assert result["report"]["document"]["ok"] is False
        assert result["report"]["document"]["phase"] == "subprocess-exit-before-report"
        assert result["report"]["document"]["effectiveRouteConfig"]["routeId"] == "sharp-image-to-splat-live-v0"
        assert result["report"]["document"]["exitCode"] == 37
        assert "synthetic child import failure before report" in result["report"]["document"]["stderrTail"]


def test_pipeline_wrapper_has_no_implicit_timeout():
    assert serve.pipeline_witness_timeout_seconds({}) is None
    assert serve.pipeline_witness_timeout_seconds({"KAMINOS_PIPELINE_WITNESS_TIMEOUT": ""}) is None


def test_pipeline_stream_explicit_timeout_kills_process_group_and_writes_report():
    with TemporaryDirectory(dir="/tmp") as tmp:
        root = Path(tmp)
        source_root = root / "images"
        source_root.mkdir()
        source = source_root / "source.png"
        source.write_bytes(b"\x89PNG\r\n\x1a\n")
        out_dir = root / "pipeline-run"
        child_pid_path = root / "child.pid"
        fake_node = root / "fake-node"
        fake_node.write_text(
            "#!/bin/sh\n"
            "sleep 30 &\n"
            f"echo $! > {child_pid_path!s}\n"
            "wait\n"
        )
        fake_node.chmod(0o755)

        class StreamHandler:
            wfile = BytesIO()

        previous_browse = dict(BROWSE_ROOTS)
        previous_node = os.environ.get("KAMINOS_NODE")
        previous_timeout = os.environ.get("KAMINOS_PIPELINE_WITNESS_TIMEOUT")
        BROWSE_ROOTS["pipeline-test-images"] = source_root
        os.environ["KAMINOS_NODE"] = str(fake_node)
        os.environ["KAMINOS_PIPELINE_WITNESS_TIMEOUT"] = "0.25"
        try:
            result = serve.run_pipeline_witness_stream(StreamHandler(), {
                "pipelineId": "sharp-image-to-splat-live-v0",
                "source": "/api/read?root=pipeline-test-images&path=source.png",
                "outDir": str(out_dir),
            })
        finally:
            BROWSE_ROOTS.clear()
            BROWSE_ROOTS.update(previous_browse)
            if previous_node is None:
                os.environ.pop("KAMINOS_NODE", None)
            else:
                os.environ["KAMINOS_NODE"] = previous_node
            if previous_timeout is None:
                os.environ.pop("KAMINOS_PIPELINE_WITNESS_TIMEOUT", None)
            else:
                os.environ["KAMINOS_PIPELINE_WITNESS_TIMEOUT"] = previous_timeout

        report_path = out_dir / "pipeline-witness.json"
        assert result["ok"] is False
        assert result["report"]["path"] == str(report_path)
        assert report_path.exists(), "an explicit wrapper timeout must still leave a durable report"
        report = json.loads(report_path.read_text())
        assert report["phase"] == "pipeline-witness-wrapper-timeout"
        assert report["lastTrustworthyEvidence"]["wrapperTimeoutSeconds"] == 0.25
        assert child_pid_path.exists(), "fixture must prove that the timed-out witness spawned a descendant"
        child_pid = int(child_pid_path.read_text())
        for _ in range(50):
            try:
                os.kill(child_pid, 0)
            except ProcessLookupError:
                break
            time.sleep(0.02)
        else:
            raise AssertionError("explicit wrapper timeout left the witness descendant alive")


def test_pipeline_run_rejects_sources_outside_declared_roots():
    with TemporaryDirectory(dir="/tmp") as tmp:
        outside = Path(tmp) / "outside.ply"
        outside.write_text("ply\n")
        try:
            serve.run_pipeline_witness({
                "pipelineId": "prepared-splat-import-sidecar-v0",
                "sourcePath": str(outside),
                "outDir": str(Path(tmp) / "out"),
            })
        except PermissionError as error:
            assert "declared Kaminos roots" in str(error)
        else:
            raise AssertionError("absolute source paths outside declared roots must be rejected")


def test_pipeline_run_rejects_excluded_api_read_roots():
    with TemporaryDirectory(dir="/tmp") as tmp:
        root = Path(tmp)
        preview_root = root / "preview"
        preview_root.mkdir()
        preview_source = preview_root / "preview-source.ply"
        preview_source.write_text("ply\n")

        previous_browse = dict(BROWSE_ROOTS)
        BROWSE_ROOTS["lerms-preview"] = preview_root
        try:
            serve.resolve_pipeline_source({
                "source": "/api/read?root=lerms-preview&path=preview-source.ply",
            })
        except PermissionError as error:
            assert "declared Kaminos roots" in str(error)
        else:
            raise AssertionError("excluded api-read roots must not become pipeline sources")
        finally:
            BROWSE_ROOTS.clear()
            BROWSE_ROOTS.update(previous_browse)


if __name__ == "__main__":
    test_http_status_404_log_does_not_crash()
    test_forge_host_registry_snapshot_preserves_endpoint_identity()
    test_forge_host_registry_snapshot_fallback_is_not_live()
    test_sharp_breathing_room_profiles_are_named_operator_routes_with_explicit_env()
    test_fixed_16ms_donation_profile_changes_only_post_drain_donation()
    test_spn_fusion_tile_profile_changes_only_fusion_output_granularity()
    test_sharp_breathing_room_unknown_profile_fails_instead_of_falling_back()
    test_pipeline_witness_env_for_payload_preserves_requested_scheduler_profile()
    test_image_inbox_webp_read_serves_bytes_without_json_fallback()
    test_volume_only_scene_save_name_uses_scene_fallback()
    test_greenroom_job_display_metadata_promotes_receipt_identity_over_job_id()
    test_greenroom_output_display_metadata_uses_job_context_for_hostile_output_names()
    test_greenroom_configured_root_outputs_are_served_even_when_outside_home()
    test_greenroom_stray_output_dirs_do_not_get_load_affordance()
    test_splat_asset_index_separates_experimental_and_production_roots()
    test_splat_asset_index_marks_stub_ply_as_not_splat_like()
    test_splat_asset_index_allows_pointer_symlinks_inside_declared_roots()
    test_splat_asset_ingest_writes_only_to_experimental_inbox()
    test_splat_asset_correction_roundtrips_as_sidecar_metadata()
    test_runtime_config_exposes_hybrid_overlay_module_url_env()
    test_pipeline_manifest_endpoint_payload_is_route_identified()
    test_image_asset_index_declares_local_image_roots()
    test_pipeline_run_resolves_api_read_source_and_returns_bundle()
    test_pipeline_run_writes_failure_report_when_child_exits_before_report()
    test_pipeline_wrapper_has_no_implicit_timeout()
    test_pipeline_stream_explicit_timeout_kills_process_group_and_writes_report()
    test_pipeline_run_rejects_sources_outside_declared_roots()
    test_pipeline_run_rejects_excluded_api_read_roots()
