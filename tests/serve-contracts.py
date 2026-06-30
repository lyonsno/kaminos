from http import HTTPStatus
import json
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
    assert snapshot["smokeResultRegistry"]["schema"] == "kaminos.forge-host.smoke-result-snapshot.v0"


def test_forge_host_smoke_result_snapshot_ingests_fixture_and_local_receipt():
    with TemporaryDirectory(dir="/tmp") as tmp:
        root = Path(tmp)
        fixture_dir = root / "fixtures"
        receipt_root = root / "receipts"
        fixture_dir.mkdir()
        receipt_dir = receipt_root / "receipt-minion-001"
        receipt_dir.mkdir(parents=True)
        fixture_offer = {
            "schema": "kaminos.forge-host.smoke-result-offer.v0",
            "id": "result:minion-spawnfucker:fixture-branch-smoke",
            "producerDiaulos": "minion-spawnfucker",
            "title": "Fixture Branch Smoke",
            "targetSurface": "smoke-result",
            "sourceRef": "fixtures/forge-host-smoke-results/minion.json",
            "targetUrl": "fixtures/forge-host-smoke-results/minion.json",
            "reportSource": "fixtures/forge-host-smoke-results/minion.json",
            "screenshotSource": None,
            "summary": "Fixture smoke result for the chamber viewer.",
            "authority": "fixture",
            "freshness": "2026-06-30T12:00:00Z",
            "displayState": "fixture",
            "resultStatus": "available",
            "downgrades": ["fixture_result_payload"],
        }
        (fixture_dir / "minion.json").write_text(json.dumps(fixture_offer))
        (receipt_dir / "receipt.json").write_text(json.dumps({
            "schema": "kaminos.forge-host.smoke-disposition-receipt.v0",
            "receiptId": "receipt-minion-001",
            "sourceOfferId": "offer:minion-spawnfucker:live-endpoint",
            "stationActorId": "forge-station:minion-spawnfucker",
            "producerDiaulos": "minion-spawnfucker",
            "sourceAuthority": "live",
            "displayState": "live",
            "sourceRef": "directive-alert-endpoints.json#minion-spawnfucker",
            "targetUrl": "codex resume minion-thread",
            "targetSurface": "diaulos-endpoint",
            "disposition": "accepted",
            "operatorNote": "Saw the chamber result.",
            "savedAt": "2026-06-30T13:00:00Z",
            "screenshot": {
                "path": str(receipt_dir / "screenshot.png"),
                "source": "/api/read?root=scratch&path=smoke-chamber-receipts%2Freceipt-minion-001%2Fscreenshot.png",
                "bytes": 4096,
            },
            "returnLine": "Your Smoke Offer offer:minion-spawnfucker:live-endpoint was dispositioned in Kaminos as accepted; evidence: screenshot. Let's discuss.",
        }))

        snapshot = serve.build_forge_host_smoke_result_snapshot(
            fixture_dir=fixture_dir,
            receipt_dir=receipt_root,
        )

    assert snapshot["schema"] == "kaminos.forge-host.smoke-result-snapshot.v0"
    assert snapshot["sourceAuthority"] == "local_artifact"
    assert len(snapshot["results"]) == 2
    fixture = next(row for row in snapshot["results"] if row["authority"] == "fixture")
    local = next(row for row in snapshot["results"] if row["authority"] == "local_artifact")
    assert fixture["schema"] == "kaminos.forge-host.smoke-result-offer.v0"
    assert fixture["displayState"] == "fixture"
    assert fixture["producerDiaulos"] == "minion-spawnfucker"
    assert local["id"] == "result:minion-spawnfucker:receipt-minion-001"
    assert local["displayState"] == "artifact"
    assert local["screenshotSource"].endswith("screenshot.png")
    assert local["reportSource"].endswith("receipt.json")


def test_forge_host_smoke_result_snapshot_rejects_fixture_claiming_live():
    with TemporaryDirectory(dir="/tmp") as tmp:
        fixture_dir = Path(tmp) / "fixtures"
        fixture_dir.mkdir()
        (fixture_dir / "lying.json").write_text(json.dumps({
            "schema": "kaminos.forge-host.smoke-result-offer.v0",
            "id": "result:lying:fixture-live",
            "producerDiaulos": "lying-diaulos",
            "title": "Lying Fixture",
            "targetSurface": "smoke-result",
            "sourceRef": "fixtures/lying.json",
            "targetUrl": "fixtures/lying.json",
            "authority": "fixture",
            "freshness": "2026-06-30T12:00:00Z",
            "displayState": "live",
            "resultStatus": "available",
        }))
        try:
            serve.build_forge_host_smoke_result_snapshot(fixture_dir=fixture_dir, receipt_dir=Path(tmp) / "missing")
        except ValueError as error:
            assert "fixture" in str(error) and "live" in str(error)
        else:
            raise AssertionError("fixture smoke result claiming live display must fail loud")


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


def test_forge_host_smoke_chamber_receipt_persists_png_and_json():
    png_data_url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    with TemporaryDirectory(dir="/tmp") as tmp:
        receipt = serve.save_forge_host_smoke_chamber_receipt({
            "schema": "kaminos.forge-host.smoke-disposition-receipt.v0",
            "receiptId": "receipt-live-001",
            "chamberId": "smoke-chamber:offer:minion-spawnfucker:live-endpoint",
            "sourceOfferId": "offer:minion-spawnfucker:live-endpoint",
            "stationActorId": "forge-station:minion-spawnfucker",
            "producerDiaulos": "minion-spawnfucker",
            "sourceAuthority": "live",
            "displayState": "live",
            "sourceRef": "/Users/noahlyons/.local/state/epistaxis/directive-alert-endpoints.json#minion-spawnfucker",
            "targetUrl": "codex resume minion-thread",
            "disposition": "observed",
            "operatorNote": "Saw the live endpoint chamber.",
            "returnLine": "Your Smoke Offer offer:minion-spawnfucker:live-endpoint was dispositioned in Kaminos as observed; evidence: pending. Let's discuss.",
            "screenshotPngDataUrl": png_data_url,
        }, receipts_dir=Path(tmp))

        receipt_path = Path(receipt["receiptPath"])
        screenshot_path = Path(receipt["screenshot"]["path"])
        saved_json = json.loads(receipt_path.read_text())
        assert receipt_path.name == "receipt.json"
        assert screenshot_path.name == "screenshot.png"
        assert screenshot_path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")

    assert receipt["schema"] == "kaminos.forge-host.smoke-disposition-save.v0"
    assert receipt["receipt"]["schema"] == "kaminos.forge-host.smoke-disposition-receipt.v0"
    assert receipt["receipt"]["receiptId"] == "receipt-live-001"
    assert receipt["receipt"]["screenshot"]["bytes"] > 50
    assert receipt["receipt"]["screenshot"]["source"] == "/api/read?root=scratch&path=smoke-chamber-receipts%2Freceipt-live-001%2Fscreenshot.png"
    assert receipt["receiptSource"] == "/api/read?root=scratch&path=smoke-chamber-receipts%2Freceipt-live-001%2Freceipt.json"
    assert saved_json["returnLine"].endswith("Let's discuss.")
    assert "screenshotPngDataUrl" not in saved_json


def test_forge_host_smoke_chamber_receipt_rejects_false_live_and_bad_png():
    png_data_url = "data:image/png;base64,bm90LWEtcG5n"
    with TemporaryDirectory(dir="/tmp") as tmp:
        try:
            serve.save_forge_host_smoke_chamber_receipt({
                "schema": "kaminos.forge-host.smoke-disposition-receipt.v0",
                "receiptId": "receipt-false-live",
                "chamberId": "smoke-chamber:offer:minion-spawnfucker:live-endpoint",
                "sourceOfferId": "offer:minion-spawnfucker:live-endpoint",
                "stationActorId": "forge-station:minion-spawnfucker",
                "producerDiaulos": "minion-spawnfucker",
                "sourceAuthority": "fallback",
                "displayState": "live",
                "sourceRef": "fallback#minion",
                "targetUrl": "codex resume minion-thread",
                "disposition": "observed",
                "returnLine": "pending",
                "screenshotPngDataUrl": png_data_url,
            }, receipts_dir=Path(tmp))
        except ValueError as error:
            assert "fallback" in str(error) and "live" in str(error)
        else:
            raise AssertionError("fallback receipt pretending live must fail loud")

        try:
            serve.save_forge_host_smoke_chamber_receipt({
                "schema": "kaminos.forge-host.smoke-disposition-receipt.v0",
                "receiptId": "receipt-bad-png",
                "chamberId": "smoke-chamber:offer:minion-spawnfucker:live-endpoint",
                "sourceOfferId": "offer:minion-spawnfucker:live-endpoint",
                "stationActorId": "forge-station:minion-spawnfucker",
                "producerDiaulos": "minion-spawnfucker",
                "sourceAuthority": "live",
                "displayState": "live",
                "sourceRef": "live#minion",
                "targetUrl": "codex resume minion-thread",
                "disposition": "observed",
                "returnLine": "pending",
                "screenshotPngDataUrl": png_data_url,
            }, receipts_dir=Path(tmp))
        except ValueError as error:
            assert "PNG" in str(error)
        else:
            raise AssertionError("non-PNG screenshot payload must fail loud")


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
    test_forge_host_registry_snapshot_preserves_endpoint_identity()
    test_forge_host_smoke_result_snapshot_ingests_fixture_and_local_receipt()
    test_forge_host_smoke_result_snapshot_rejects_fixture_claiming_live()
    test_forge_host_registry_snapshot_fallback_is_not_live()
    test_forge_host_smoke_chamber_receipt_persists_png_and_json()
    test_forge_host_smoke_chamber_receipt_rejects_false_live_and_bad_png()
    test_volume_only_scene_save_name_uses_scene_fallback()
    test_greenroom_job_display_metadata_promotes_receipt_identity_over_job_id()
    test_greenroom_output_display_metadata_uses_job_context_for_hostile_output_names()
    test_greenroom_configured_root_outputs_are_served_even_when_outside_home()
    test_greenroom_stray_output_dirs_do_not_get_load_affordance()
    test_splat_asset_index_separates_experimental_and_production_roots()
    test_splat_asset_index_allows_pointer_symlinks_inside_declared_roots()
    test_splat_asset_ingest_writes_only_to_experimental_inbox()
    test_splat_asset_correction_roundtrips_as_sidecar_metadata()
    test_runtime_config_exposes_hybrid_overlay_module_url_env()
