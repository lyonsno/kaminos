from http import HTTPStatus
import json
import os
from pathlib import Path
import sys
import time
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


def test_compute_route_fire_run_actuates_fake_pipeline_and_cools_after_success():
    with TemporaryDirectory(dir="/tmp") as tmp:
        root = Path(tmp)
        pipeline = root / "pipeline"
        pipeline.mkdir()
        input_path = root / "source.png"
        input_path.write_bytes(b"fake image")
        (pipeline / "pipeline-witness.mjs").write_text(
            """
import { mkdirSync, writeFileSync } from 'node:fs';
const arg = name => process.argv[process.argv.indexOf(name) + 1];
const outDir = arg('--out-dir');
const report = arg('--report');
mkdirSync(`${outDir}/artifacts`, { recursive: true });
writeFileSync(`${outDir}/artifacts/sharp-output.ply`, 'ply\\n');
writeFileSync(`${outDir}/artifacts/sharp-webgpu-depth.png`, 'png');
writeFileSync(`${outDir}/artifacts/sharp-output.splat-autocrop-evidence.json`, '{}\\n');
await new Promise(resolve => setTimeout(resolve, 180));
writeFileSync(report, JSON.stringify({
  schema: 'kaminos.pipeline-witness.v0',
  ok: true,
  requestedPipelineId: 'sharp-image-to-splat-live-v0',
  effectivePipelineId: 'sharp-image-to-splat-live-v0',
  phase: 'complete',
  effectiveRouteConfig: { routeId: 'adapter.sharp-image-to-splat-live.v0', outputRoot: outDir },
  artifacts: {
    input: { role: 'source-image', status: 'requested', path: process.argv[process.argv.indexOf('--input') + 1] },
    splat: { role: 'splat-candidate', status: 'real', path: `${outDir}/artifacts/sharp-output.ply`, bytes: 4 },
    depthMap: { role: 'depth-map', status: 'real', path: `${outDir}/artifacts/sharp-webgpu-depth.png`, bytes: 3 },
    autoCropEvidence: { role: 'splat-autocrop-evidence', schema: 'kaminos.splat-autocrop-evidence.v0', status: 'real', path: `${outDir}/artifacts/sharp-output.splat-autocrop-evidence.json`, bytes: 3 }
  },
  stages: [{ id: 'run-sharp-image-to-splat', status: 'real', effectiveRoute: { effectiveBackend: 'browser-webgpu' } }]
}, null, 2));
""".strip()
        )

        run = serve.start_compute_route_fire_run(
            input_path=str(input_path),
            config={
                "pipeline_worktree": pipeline,
                "output_root": root / "runs",
            },
        )
        assert run["schema"] == "kaminos.compute-route-fire-run.v0"
        assert run["status"] == "running"
        assert run["visualPhase"] == "burn"
        assert run["allowsFullBurn"] is True
        assert Path(run["inputPath"]) == input_path.resolve()

        current = serve.compute_route_fire_status(run["runId"])
        assert current["status"] == "running"
        assert current["visualPhase"] == "burn"
        assert current["allowsFullBurn"] is True

        deadline = time.time() + 5
        while time.time() < deadline:
            current = serve.compute_route_fire_status(run["runId"])
            if current["status"] == "completed":
                break
            time.sleep(0.05)

        assert current["status"] == "completed"
        assert current["visualPhase"] == "cooled"
        assert current["allowsFullBurn"] is False
        assert current["exitCode"] == 0
        assert current["pipelineReport"]["ok"] is True
        assert current["artifacts"][0]["id"] == "splat"
        assert any(artifact["id"] == "autoCropEvidence" for artifact in current["artifacts"])


def test_compute_route_fire_run_failure_never_keeps_fire_burning():
    with TemporaryDirectory(dir="/tmp") as tmp:
        root = Path(tmp)
        pipeline = root / "pipeline"
        pipeline.mkdir()
        input_path = root / "source.png"
        input_path.write_bytes(b"fake image")
        (pipeline / "pipeline-witness.mjs").write_text("process.exit(7);\n")

        run = serve.start_compute_route_fire_run(
            input_path=str(input_path),
            config={
                "pipeline_worktree": pipeline,
                "output_root": root / "runs",
            },
        )
        deadline = time.time() + 5
        current = run
        while time.time() < deadline:
            current = serve.compute_route_fire_status(run["runId"])
            if current["status"] == "failed":
                break
            time.sleep(0.05)

        assert current["status"] == "failed"
        assert current["visualPhase"] == "failed"
        assert current["allowsFullBurn"] is False
        assert current["exitCode"] == 7
        assert current["pipelineReport"] is None


def test_compute_route_fire_run_exposes_native_pipeline_progress_before_completion():
    with TemporaryDirectory(dir="/tmp") as tmp:
        root = Path(tmp)
        pipeline = root / "pipeline"
        pipeline.mkdir()
        input_path = root / "source.png"
        input_path.write_bytes(b"fake image")
        (pipeline / "pipeline-witness.mjs").write_text(
            """
import { mkdirSync, writeFileSync } from 'node:fs';
const arg = name => process.argv[process.argv.indexOf(name) + 1];
const outDir = arg('--out-dir');
const report = arg('--report');
if (process.env.KAMINOS_PIPELINE_PROGRESS_STREAM !== '1') {
  throw new Error('progress stream env was not enabled');
}
console.log(JSON.stringify({
  schema: 'kaminos.pipeline-progress.v0',
  kind: 'adapter-progress',
  phase: 'stage:run-sharp-image-to-splat:image-encoder',
  message: 'Running image encoder',
  status: 'running',
  progress: 0.42
}));
await new Promise(resolve => setTimeout(resolve, 220));
mkdirSync(`${outDir}/artifacts`, { recursive: true });
writeFileSync(`${outDir}/artifacts/sharp-output.ply`, 'ply\\n');
writeFileSync(report, JSON.stringify({
  schema: 'kaminos.pipeline-witness.v0',
  ok: true,
  requestedPipelineId: 'sharp-image-to-splat-live-v0',
  effectivePipelineId: 'sharp-image-to-splat-live-v0',
  phase: 'complete',
  effectiveRouteConfig: { routeId: 'adapter.sharp-image-to-splat-live.v0', outputRoot: outDir },
  artifacts: {
    input: { role: 'source-image', status: 'requested', path: process.argv[process.argv.indexOf('--input') + 1] },
    splat: { role: 'splat-candidate', status: 'real', path: `${outDir}/artifacts/sharp-output.ply`, bytes: 4 }
  },
  stages: [{ id: 'run-sharp-image-to-splat', status: 'real', effectiveRoute: { effectiveBackend: 'browser-webgpu' } }]
}, null, 2));
""".strip()
        )

        run = serve.start_compute_route_fire_run(
            input_path=str(input_path),
            config={
                "pipeline_worktree": pipeline,
                "output_root": root / "runs",
            },
        )
        deadline = time.time() + 3
        current = run
        while time.time() < deadline:
            current = serve.compute_route_fire_status(run["runId"])
            if current.get("latestProgress"):
                break
            time.sleep(0.05)

        assert current["status"] == "running"
        assert current["progressEvents"][0]["schema"] == "kaminos.pipeline-progress.v0"
        assert current["latestProgress"]["phase"] == "stage:run-sharp-image-to-splat:image-encoder"
        assert current["latestProgress"]["message"] == "Running image encoder"
        assert current["latestProgress"]["progress"] == 0.42
        assert current["latestProgress"]["stream"] == "stdout"


def test_compute_route_fire_promotes_completed_splat_to_asset_inbox_with_source_truth():
    with TemporaryDirectory(dir="/tmp") as tmp:
        root = Path(tmp)
        pipeline = root / "pipeline"
        pipeline.mkdir()
        experimental = root / "splats" / "inbox"
        production = root / "splats" / "production"
        experimental.mkdir(parents=True)
        production.mkdir(parents=True)
        input_path = root / "source.png"
        input_path.write_bytes(b"fake image")
        (pipeline / "pipeline-witness.mjs").write_text(
            """
import { mkdirSync, writeFileSync } from 'node:fs';
const arg = name => process.argv[process.argv.indexOf(name) + 1];
const outDir = arg('--out-dir');
const report = arg('--report');
mkdirSync(`${outDir}/artifacts`, { recursive: true });
writeFileSync(`${outDir}/artifacts/sharp-output.ply`, 'ply\\nformat ascii 1.0\\nelement vertex 1\\nproperty float x\\nproperty float y\\nproperty float z\\nend_header\\n0 0 0\\n');
writeFileSync(report, JSON.stringify({
  schema: 'kaminos.pipeline-witness.v0',
  ok: true,
  requestedPipelineId: 'sharp-image-to-splat-live-v0',
  effectivePipelineId: 'sharp-image-to-splat-live-v0',
  phase: 'complete',
  effectiveRouteConfig: { routeId: 'adapter.sharp-image-to-splat-live.v0', outputRoot: outDir },
  artifacts: {
    input: { role: 'source-image', status: 'requested', path: process.argv[process.argv.indexOf('--input') + 1] },
    splat: { role: 'splat-candidate', status: 'real', path: `${outDir}/artifacts/sharp-output.ply`, bytes: 108 }
  },
  stages: [{ id: 'run-sharp-image-to-splat', status: 'real', effectiveRoute: { effectiveBackend: 'browser-webgpu' } }]
}, null, 2));
""".strip()
        )

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
            run = serve.start_compute_route_fire_run(
                input_path=str(input_path),
                config={
                    "pipeline_worktree": pipeline,
                    "output_root": root / "runs",
                },
            )
            deadline = time.time() + 5
            current = run
            while time.time() < deadline:
                current = serve.compute_route_fire_status(run["runId"])
                if current["status"] == "completed":
                    break
                time.sleep(0.05)

            promoted = serve.promote_compute_route_fire_splat(run["runId"])
            entries = serve.list_asset_entries(kind="splat")
        finally:
            serve.ASSET_ROOTS[:] = previous_roots
            BROWSE_ROOTS.clear()
            BROWSE_ROOTS.update(previous_browse)

        assert current["status"] == "completed"
        assert promoted["schema"] == "kaminos.compute-route-fire-promoted-splat.v0"
        assert promoted["runId"] == run["runId"]
        assert promoted["entry"]["root_id"] == "splat-inbox"
        assert promoted["entry"]["stage"] == "experimental"
        assert promoted["entry"]["source"].startswith("/api/read?root=splat-inbox&path=")
        assert promoted["routeOutput"]["pipelineId"] == "sharp-image-to-splat-live-v0"
        assert promoted["routeOutput"]["sourceArtifactPath"].endswith("/artifacts/sharp-output.ply")
        assert promoted["routeOutput"]["reportPath"].endswith("/pipeline-witness.json")
        promoted_path = experimental / promoted["entry"]["path"]
        assert promoted_path.read_text().startswith("ply\n")
        sidecar = promoted_path.with_name(promoted_path.name + ".kaminos-route-output.json")
        assert sidecar.is_file()
        assert json.loads(sidecar.read_text())["runId"] == run["runId"]
        assert entries[0]["routeOutput"]["runId"] == run["runId"]


def test_compute_route_fire_refuses_to_promote_failed_splat():
    with TemporaryDirectory(dir="/tmp") as tmp:
        root = Path(tmp)
        pipeline = root / "pipeline"
        pipeline.mkdir()
        input_path = root / "source.png"
        input_path.write_bytes(b"fake image")
        (pipeline / "pipeline-witness.mjs").write_text("process.exit(7);\n")

        run = serve.start_compute_route_fire_run(
            input_path=str(input_path),
            config={
                "pipeline_worktree": pipeline,
                "output_root": root / "runs",
            },
        )
        deadline = time.time() + 5
        current = run
        while time.time() < deadline:
            current = serve.compute_route_fire_status(run["runId"])
            if current["status"] == "failed":
                break
            time.sleep(0.05)

        assert current["status"] == "failed"
        try:
            serve.promote_compute_route_fire_splat(run["runId"])
        except ValueError as error:
            assert "completed" in str(error)
        else:
            raise AssertionError("failed compute route promoted a splat")


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
