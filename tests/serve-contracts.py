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
from serve import build_browser_webgpu_route_provider_index
from serve import build_greenroom_route_provider_index
from serve import build_route_provider_index
from serve import list_greenroom_output_files, resolve_greenroom_output_dir
from serve import request_greenroom_checkpoint_pause


MOGE_WEBGPU_ROUTE_ID = "moge.depth-normal.webgpu-local.v0"


def browser_webgpu_route_result(*, status="real", output_status="real"):
    scheduler = {
        "schema": "kaminos.webgpu-route-scheduler.v0",
        "requestedScheduler": {
            "mode": "cooperative",
            "yieldMs": 5,
            "waitForSubmittedWorkDone": True,
            "phaseChunkSize": {"decoder-heads": 1},
        },
        "effectiveScheduler": {
            "mode": "cooperative",
            "yieldMs": 5,
            "waitForSubmittedWorkDone": True,
            "phaseChunkSize": {"decoder-heads": 1},
            "unsupportedFields": [],
        },
        "verificationState": "verified",
    }
    backpressure = {
        "schema": "kaminos.webgpu-route-backpressure.v0",
        "requestedBudget": "visible-wait",
        "effectiveBudget": "visible-wait",
        "memoryExclusivity": "shared",
        "warmCacheState": "warm",
        "frameTail": {
            "sampleWindowMs": 5000,
            "longFrameCount": 1,
            "maxFrameGapMs": 37.5,
            "p95FrameGapMs": 18.2,
            "p99FrameGapMs": 37.5,
        },
    }
    runtime_profile = {
        "schema": "kaminos.webgpu-runtime-profile.v0",
        "routeId": MOGE_WEBGPU_ROUTE_ID,
        "runtimeLabel": "chrome-webgpu-apple-metal",
        "backend": {
            "kind": "webgpu-local",
            "runtime": "browser",
            "adapterName": "apple metal-3",
            "browser": "Chrome Headless",
            "features": ["timestamp-query"],
            "requestedFeatures": ["timestamp-query"],
            "limits": {"maxBufferSize": 4294967296},
            "timestampQuery": "requested",
        },
        "kernel": {
            "kitVersion": "0.0.0",
            "profile": "conv-transpose2d-stride2",
            "commit": "00ec8d7",
        },
        "profile": {
            "schema": "kaminos.webgpu-staged-profile.v0",
            "route": "staged-submits",
            "timingSource": "queue-submit-wait",
            "requiredStages": ["backbone", "decoder-heads", "output-readback"],
            "stages": [
                {"name": "backbone", "ms": 997.6},
                {"name": "decoder-heads", "ms": 854.3},
                {"name": "output-readback", "ms": 1.9},
            ],
            "stageNames": ["backbone", "decoder-heads", "output-readback"],
            "totalMs": 1853.8,
        },
        "evidence": {
            "mode": "fallback" if status == "fallback" else "live",
            "source": "moge-webgpu-route-worker",
            "fallbackReason": "WebGPU unavailable" if status == "fallback" else None,
            "classification": "fallback" if status == "fallback" else "authoritative-live-webgpu",
        },
        "requiredStages": ["backbone", "decoder-heads", "output-readback"],
        "timingSource": "queue-submit-wait",
        "createdAt": "2026-07-01T01:00:00Z",
    }
    outputs = [
        {
            "role": "depth",
            "artifactId": "depth:bunnycake",
            "sha256": "sha256:depth",
            "shape": [592, 592],
            "status": output_status,
            "previewDataUrl": "data:image/png;base64,ZGVwdGg=",
            "mediaType": "image/png",
        },
        {
            "role": "normal",
            "artifactId": "normal:bunnycake",
            "sha256": "sha256:normal",
            "shape": [3, 592, 592],
            "status": output_status,
            "previewDataUrl": "data:image/png;base64,bm9ybWFs",
            "mediaType": "image/png",
        },
        {
            "role": "pointmap",
            "artifactId": "pointmap:bunnycake",
            "sha256": "sha256:pointmap",
            "shape": [3, 592, 592],
            "status": output_status,
            "previewDataUrl": "data:image/png;base64,cG9pbnRtYXA=",
            "mediaType": "image/png",
        },
    ]
    if output_status == "missing-hash":
        outputs[0]["status"] = "real"
        outputs[0]["sha256"] = ""
    receipt_status = status
    fallback_reason = "WebGPU unavailable" if status == "fallback" else None
    receipt = {
        "schema": "kaminos.webgpu-route-receipt.v0",
        "requestedRouteId": MOGE_WEBGPU_ROUTE_ID,
        "effectiveRouteId": MOGE_WEBGPU_ROUTE_ID,
        "status": receipt_status,
        "fallbackReason": fallback_reason,
        "backend": runtime_profile["backend"],
        "model": {
            "id": "Ruicheng/moge-2-vitl-normal",
            "revision": "local-vitl-normal",
            "weightsHash": "sha256:weights",
            "dtype": "fp16",
        },
        "kernel": runtime_profile["kernel"],
        "inputs": [
            {"role": "source-image", "artifactId": "image:bunnycake", "sha256": "sha256:input", "shape": [518, 518, 3]},
        ],
        "outputs": outputs,
        "timings": {
            "source": "queue-submit-wait",
            "totalMs": 1853.8,
            "stages": runtime_profile["profile"]["stages"],
        },
        "runtime": {
            "runtimeProfile": runtime_profile,
            "scheduler": scheduler,
            "backpressure": backpressure,
        },
        "createdAt": "2026-07-01T01:00:00Z",
    }
    return {
        "schema": "kaminos.webgpu-route-result.v0",
        "requestId": "req:moge-bunnycake",
        "routeId": MOGE_WEBGPU_ROUTE_ID,
        "status": status,
        "request": {
            "schema": "kaminos.webgpu-route-request.v0",
            "requestId": "req:moge-bunnycake",
            "routeId": MOGE_WEBGPU_ROUTE_ID,
            "backendKind": "webgpu-local",
            "inputs": receipt["inputs"],
            "outputs": [{"role": output["role"], "artifactId": output["artifactId"], "shape": output["shape"]} for output in outputs],
            "routeConfig": {"source": "kaminos.greenroom.route-tray-smoke"},
            "model": {"id": "Ruicheng/moge-2-vitl-normal", "revision": "local-vitl-normal", "dtype": "fp16"},
            "kernel": runtime_profile["kernel"],
            "createdAt": "2026-07-01T01:00:00Z",
        },
        "receipt": receipt,
        "backend": runtime_profile["backend"],
        "outputs": outputs,
        "timings": receipt["timings"],
        "createdAt": "2026-07-01T01:00:01Z",
    }


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


def test_native_greenroom_route_provider_projects_route_job_rows():
    with TemporaryDirectory(dir="/tmp") as tmp:
        greenroom = Path(tmp) / "greenroom"
        job_dir = greenroom / "done" / "hero123"
        output_dir = greenroom / "outputs" / "hero123"
        job_dir.mkdir(parents=True)
        output_dir.mkdir(parents=True)
        (output_dir / "seed-42.glb").write_bytes(b"glb")
        (job_dir / "schedule.json").write_text("""{
          "schema": "gpu-greenroom.schedule.v1",
          "priority_class": "preview",
          "submitted_at": 10
        }""")
        (job_dir / "status.json").write_text("""{
          "job_id": "hero123",
          "status": "done",
          "job_type": "trellis2mlx.hero-checkpoint",
          "input_path": "/tmp/source.png",
          "output_dir": "",
          "submitted_at": 10,
          "started_at": 20,
          "finished_at": 30,
          "worker_pid": 111,
          "child_pid": 222,
          "process_group_id": 222
        }""".replace('"output_dir": ""', f'"output_dir": "{output_dir}"'))
        (job_dir / "receipt.json").write_text("""{
          "job_id": "hero123",
          "job_type": "trellis2mlx.hero-checkpoint",
          "status": "done",
          "input_path": "/tmp/source.png",
          "output_dir": "",
          "effective_route": "python generate.py --image /tmp/source.png",
          "effective_cwd": "/Users/noahlyons/dev/trellis2mlx",
          "started_at": 20,
          "finished_at": 30
        }""".replace('"output_dir": ""', f'"output_dir": "{output_dir}"'))

        previous = BROWSE_ROOTS["greenroom"]
        BROWSE_ROOTS["greenroom"] = greenroom
        try:
            index = build_greenroom_route_provider_index()
        finally:
            BROWSE_ROOTS["greenroom"] = previous

    assert index["schema"] == "kaminos.route-provider-index.v0"
    assert index["provider"]["kind"] == "native-greenroom"
    assert index["provider"]["source"] == "filesystem"
    assert index["summary"]["done"] == 1
    [row] = index["rows"]
    assert row["status_dir"] == "done"
    assert row["route_job"]["schema"] == "kaminos.route-job.v0"
    assert row["route_job"]["id"] == "hero123"
    assert row["route_job"]["routeId"] == "trellis2mlx.hero-checkpoint"
    assert row["route_job"]["executor"]["kind"] == "native-greenroom"
    assert row["route_job"]["intent"] == "preview"
    assert row["route_job"]["priorityClass"] == "preview"
    assert row["route_job"]["status"] == "done"
    assert row["route_job"]["resumability"]["kind"] == "unknown"
    assert row["route_job"]["capabilities"]["memoryExclusive"] is True
    assert row["route_job"]["capabilities"]["checkpointable"] is True
    assert row["route_job"]["capabilities"]["resumable"] is False
    assert row["route_job"]["controls"] == []
    assert row["controls"] == []
    assert row["receipt_link"] == "/api/read?root=greenroom&path=done%2Fhero123%2Freceipt.json"
    assert row["output_links"][0]["path"] == "/api/job-output?job_id=hero123&file=seed-42.glb"
    assert row["process"]["worker_pid"] == 111
    assert row["process"]["child_pid"] == 222


def test_native_greenroom_route_provider_projects_checkpoint_paused_rows():
    with TemporaryDirectory(dir="/tmp") as tmp:
        greenroom = Path(tmp) / "greenroom"
        job_dir = greenroom / "checkpoint_paused" / "yield123"
        output_dir = greenroom / "outputs" / "yield123"
        checkpoint_dir = output_dir / "checkpoints"
        checkpoint_receipt = checkpoint_dir / "_control" / "checkpoint_yield.json"
        stop_file = output_dir / "_control" / "checkpoint-stop"
        job_dir.mkdir(parents=True)
        checkpoint_receipt.parent.mkdir(parents=True)
        output_dir.mkdir(parents=True, exist_ok=True)
        checkpoint_yield = {
            "schema": "trellis2mlx.checkpoint_yield.v1",
            "status": "paused_at_checkpoint",
            "completed_stage": "texture",
            "next_stage": "texture_bake",
            "checkpoint_dir": str(checkpoint_dir),
            "receipt_path": str(checkpoint_receipt),
            "exit_code": 75,
            "resume_supported": True,
            "resume_command_hint": ["python", "generate.py", "--resume", str(checkpoint_dir)],
        }
        checkpoint_receipt.write_text(json.dumps(checkpoint_yield))
        status = {
            "job_id": "yield123",
            "status": "checkpoint_paused",
            "job_type": "trellis2mlx",
            "input_path": "/tmp/source.png",
            "output_dir": str(output_dir),
            "submitted_at": 10,
            "started_at": 20,
            "finished_at": 30,
            "exit_code": 75,
            "checkpoint_dir": str(checkpoint_dir),
            "checkpoint_stop_file": str(stop_file),
            "checkpoint_yield": checkpoint_yield,
        }
        (job_dir / "status.json").write_text(json.dumps(status))
        (job_dir / "receipt.json").write_text(json.dumps({
            **status,
            "effective_route": "python generate.py --checkpoint-stop-file",
        }))

        previous = BROWSE_ROOTS["greenroom"]
        BROWSE_ROOTS["greenroom"] = greenroom
        try:
            index = build_greenroom_route_provider_index()
        finally:
            BROWSE_ROOTS["greenroom"] = previous

    assert index["summary"]["checkpoint_paused"] == 1
    [row] = index["rows"]
    assert row["status_dir"] == "checkpoint_paused"
    assert row["route_job"]["status"] == "checkpoint_paused"
    assert row["route_job"]["intent"] == "checkpoint"
    assert row["route_job"]["resumability"]["kind"] == "cooperative-checkpoint"
    assert row["route_job"]["resumability"]["completedStage"] == "texture"
    assert row["route_job"]["resumability"]["resumeSupported"] is True
    assert row["route_job"]["native"]["checkpoint_yield_receipt"] == str(checkpoint_receipt)
    assert row["route_job"]["capabilities"]["resumable"] is False
    assert any(warning["kind"] == "resume_unverified" for warning in row["warnings"])
    assert row["checkpoint_receipt_link"].endswith(
        "outputs%2Fyield123%2Fcheckpoints%2F_control%2Fcheckpoint_yield.json"
    )
    assert row["controls"] == []


def test_native_greenroom_route_provider_projects_pause_request_controls():
    with TemporaryDirectory(dir="/tmp") as tmp:
        greenroom = Path(tmp) / "greenroom"
        job_dir = greenroom / "pending" / "run123"
        output_dir = greenroom / "outputs" / "run123"
        job_dir.mkdir(parents=True)
        output_dir.mkdir(parents=True)
        state = {
            "job_id": "run123",
            "status": "pending",
            "job_type": "trellis2mlx",
            "input_path": "/tmp/source.png",
            "output_dir": str(output_dir),
            "params": {},
            "submitted_at": 10,
            "checkpoint_dir": str(output_dir / "checkpoints"),
            "checkpoint_stop_file": str(output_dir / "_control" / "checkpoint-stop"),
        }
        (job_dir / "request.json").write_text(json.dumps({
            "job_id": "run123",
            "job_type": "trellis2mlx",
            "input_path": "/tmp/source.png",
            "output_dir": str(output_dir),
            "params": {},
            "submitted_at": 10,
        }))
        (job_dir / "status.json").write_text(json.dumps(state))

        previous = BROWSE_ROOTS["greenroom"]
        BROWSE_ROOTS["greenroom"] = greenroom
        try:
            before = build_greenroom_route_provider_index()
            receipt = request_greenroom_checkpoint_pause("run123")
            after = build_greenroom_route_provider_index()
            stop_file = output_dir / "_control" / "checkpoint-stop"
            request_receipt = job_dir / "_control" / "checkpoint_pause_request.json"
            stop_file_exists = stop_file.exists()
            request_receipt_exists = request_receipt.exists()
            expected_stop_file = str(stop_file.resolve())
            expected_request_receipt = str(request_receipt.resolve())
        finally:
            BROWSE_ROOTS["greenroom"] = previous

    [before_row] = before["rows"]
    assert before_row["controls"] == [{
        "kind": "request-checkpoint-pause",
        "label": "Stop after checkpoint",
    }]
    assert before_row["route_job"]["controls"] == before_row["controls"]
    assert before_row["route_job"]["capabilities"]["checkpointPauseRequestable"] is True

    assert stop_file_exists
    assert request_receipt_exists
    assert receipt["schema"] == "gpu-greenroom.checkpoint-pause-request.v1"
    assert receipt["status"] == "requested"
    assert receipt["checkpoint_stop_file"] == expected_stop_file

    [after_row] = after["rows"]
    assert after_row["controls"] == []
    assert after_row["route_job"]["controls"] == []
    assert after_row["route_job"]["capabilities"]["checkpointPauseRequestable"] is False
    assert after_row["checkpoint_pause_request"]["status"] == "requested"
    assert after_row["route_job"]["resumability"]["kind"] == "cooperative-checkpoint"
    assert after_row["route_job"]["resumability"]["pauseRequested"] is True
    assert after_row["route_job"]["native"]["checkpoint_pause_request_receipt"] == expected_request_receipt


def test_native_greenroom_checkpoint_pause_request_refuses_non_trellis_rows():
    with TemporaryDirectory(dir="/tmp") as tmp:
        greenroom = Path(tmp) / "greenroom"
        job_dir = greenroom / "pending" / "echo123"
        output_dir = greenroom / "outputs" / "echo123"
        job_dir.mkdir(parents=True)
        output_dir.mkdir(parents=True)
        (job_dir / "status.json").write_text(json.dumps({
            "job_id": "echo123",
            "status": "pending",
            "job_type": "echo",
            "input_path": "/tmp/source.png",
            "output_dir": str(output_dir),
        }))

        previous = BROWSE_ROOTS["greenroom"]
        BROWSE_ROOTS["greenroom"] = greenroom
        try:
            index = build_greenroom_route_provider_index()
            try:
                request_greenroom_checkpoint_pause("echo123")
            except ValueError as exc:
                error = str(exc)
            else:
                error = ""
        finally:
            BROWSE_ROOTS["greenroom"] = previous

    [row] = index["rows"]
    assert row["controls"] == []
    assert "does not advertise cooperative checkpoint pause" in error
    assert not (output_dir / "_control" / "checkpoint-stop").exists()


def test_browser_webgpu_route_provider_projects_fixture_route_identity():
    index = build_browser_webgpu_route_provider_index()

    assert index["schema"] == "kaminos.route-provider-index.v0"
    assert index["provider"]["kind"] == "browser-webgpu"
    assert index["provider"]["source"] == "fixture"
    assert index["summary"]["reserved"] == 1
    [row] = index["rows"]
    assert row["provider"] == "browser-webgpu"
    assert row["controls"] == []
    assert row["route_job"]["schema"] == "kaminos.route-job.v0"
    assert row["route_job"]["id"] == "browser-webgpu-moge-fixture"
    assert row["route_job"]["routeId"] == "moge.depth-normal.webgpu-local.v0"
    assert row["route_job"]["executor"]["kind"] == "browser-webgpu"
    assert row["route_job"]["executor"]["backendKind"] == "webgpu-local"
    assert row["route_job"]["intent"] == "preview"
    assert row["route_job"]["capabilities"]["warmCacheSensitive"] is True
    assert row["route_job"]["capabilities"]["memoryExclusive"] is True
    assert row["route_job"]["capabilities"]["deferBeforeStart"] is False
    assert row["route_job"]["capabilities"]["abortBeforeCommit"] is False
    assert row["route_job"]["capabilities"]["cooperativeYieldable"] is False
    assert row["route_job"]["capabilities"]["schedulerConfigurable"] is False
    assert row["route_job"]["capabilities"]["memoryPressureSensitive"] is True
    assert row["route_job"]["capabilities"]["frameBudgetSensitive"] is True
    assert row["route_job"]["capabilities"]["chunkYieldable"] is False
    assert row["route_job"]["capabilities"]["resumable"] is False
    assert row["route_job"]["controls"] == []
    assert row["route_job"]["metadata"]["effectiveBackend"]["kind"] == "webgpu-local"
    assert row["route_job"]["metadata"]["model"]["id"] == "Ruicheng/moge-2-vitl-normal"
    assert row["route_job"]["metadata"]["cache"]["state"] == "not-loaded"
    assert row["route_job"]["metadata"]["runtimeProfile"]["schema"] == "kaminos.webgpu-runtime-profile.v0"
    assert row["route_job"]["metadata"]["runtimeProfile"]["routeId"] == "moge.depth-normal.webgpu-local.v0"
    assert row["route_job"]["metadata"]["runtimeProfile"]["backend"]["kind"] == "webgpu-local"
    assert row["route_job"]["metadata"]["runtimeProfile"]["backend"]["runtime"] == "browser"
    assert row["route_job"]["metadata"]["runtimeProfile"]["backend"]["adapterName"] == "not-probed"
    assert row["route_job"]["metadata"]["scheduler"]["schema"] == "kaminos.webgpu-route-scheduler.v0"
    assert row["route_job"]["metadata"]["scheduler"]["requestedScheduler"]["mode"] == "throughput"
    assert row["route_job"]["metadata"]["scheduler"]["effectiveScheduler"]["mode"] == "throughput"
    assert row["route_job"]["metadata"]["scheduler"]["verificationState"] == "scheduler-unverified"
    assert row["route_job"]["metadata"]["scheduler"]["effectiveScheduler"]["unsupportedFields"] == []
    assert row["route_job"]["metadata"]["backpressure"]["schema"] == "kaminos.webgpu-route-backpressure.v0"
    assert row["route_job"]["metadata"]["backpressure"]["requestedBudget"] == "visible-wait"
    assert row["route_job"]["metadata"]["backpressure"]["effectiveBudget"] == "visible-wait"
    assert row["route_job"]["metadata"]["backpressure"]["memoryExclusivity"] == "unknown"
    assert row["route_job"]["metadata"]["backpressure"]["warmCacheState"] == "not-loaded"
    assert row["route_job"]["metadata"]["backpressure"]["frameTail"]["longFrameCount"] == 0
    assert row["route_job"]["metadata"]["evidenceClassification"]["schema"] == "kaminos.webgpu-route-evidence-classification.v0"
    assert row["route_job"]["metadata"]["evidenceClassification"]["classification"] == "demo"
    assert row["route_job"]["metadata"]["evidenceClassification"]["authoritative"] is False
    assert row["route_job"]["metadata"]["evidenceClassification"]["schedulerVerificationState"] == "scheduler-unverified"
    assert row["route_job"]["metadata"]["evidenceClassification"]["schedulerMode"] == "throughput"
    assert row["route_job"]["metadata"]["evidenceClassification"]["requestedBudget"] == "visible-wait"
    assert row["route_job"]["metadata"]["evidenceClassification"]["effectiveBudget"] == "visible-wait"
    assert row["route_job"]["metadata"]["evidenceClassification"]["longFrameCount"] == 0
    assert any(warning["kind"] == "scheduler_unverified" for warning in row["warnings"])
    assert any(warning["kind"] == "fixture_route_identity_only" for warning in row["warnings"])


def test_browser_webgpu_route_provider_ingests_authoritative_kit_result():
    with TemporaryDirectory(dir="/tmp") as tmp:
        results_dir = Path(tmp) / "browser-webgpu-results"
        results_dir.mkdir()
        result_path = results_dir / "moge-live.json"
        result_path.write_text(json.dumps(browser_webgpu_route_result()), encoding="utf-8")
        previous = getattr(serve, "BROWSER_WEBGPU_ROUTE_RESULTS_DIR", None)
        serve.BROWSER_WEBGPU_ROUTE_RESULTS_DIR = results_dir
        try:
            index = build_browser_webgpu_route_provider_index()
        finally:
            serve.BROWSER_WEBGPU_ROUTE_RESULTS_DIR = previous

    assert index["provider"]["kind"] == "browser-webgpu"
    assert index["provider"]["source"] == "route-result-files"
    assert index["provider"]["result_dir"] == str(results_dir)
    assert index["summary"] == {"done": 1}
    assert index["invalid_result_count"] == 0
    [row] = index["rows"]
    assert row["provider"] == "browser-webgpu"
    assert row["status_dir"] == "route-result"
    assert row["job_id"] == "browser-webgpu-req:moge-bunnycake"
    assert row["route_job"]["id"] == "browser-webgpu-req:moge-bunnycake"
    assert row["route_job"]["status"] == "done"
    assert row["route_job"]["routeId"] == MOGE_WEBGPU_ROUTE_ID
    assert row["route_job"]["executor"]["kind"] == "browser-webgpu"
    assert row["route_job"]["metadata"]["sourceResultPath"] == str(result_path)
    assert row["route_job"]["metadata"]["evidenceClassification"]["classification"] == "authoritative-live-webgpu"
    assert row["route_job"]["metadata"]["evidenceClassification"]["authoritative"] is True
    assert row["route_job"]["metadata"]["evidenceClassification"]["schedulerVerificationState"] == "verified"
    assert row["route_job"]["metadata"]["evidenceClassification"]["schedulerMode"] == "cooperative"
    assert row["route_job"]["metadata"]["evidenceClassification"]["longFrameCount"] == 1
    assert row["route_job"]["metadata"]["runtimeProfile"]["backend"]["adapterName"] == "apple metal-3"
    assert row["route_job"]["metadata"]["scheduler"]["verificationState"] == "verified"
    assert row["route_job"]["metadata"]["backpressure"]["warmCacheState"] == "warm"
    assert row["route_job"]["controls"] == []
    assert row["warnings"] == []
    assert row["receipt_link"] == "/api/read?root=browser-webgpu-route-results&path=moge-live.json"
    assert [link["kind"] for link in row["output_links"]] == ["depth", "normal", "pointmap"]
    assert row["output_links"][0]["path"] == "data:image/png;base64,ZGVwdGg="
    assert row["output_links"][0]["name"] == "depth:bunnycake"
    assert row["output_links"][0]["media_type"] == "image/png"


def test_browser_webgpu_route_provider_projects_fallback_kit_results_without_authority():
    with TemporaryDirectory(dir="/tmp") as tmp:
        results_dir = Path(tmp) / "browser-webgpu-results"
        results_dir.mkdir()
        (results_dir / "fallback.json").write_text(json.dumps(browser_webgpu_route_result(status="fallback")), encoding="utf-8")
        previous = getattr(serve, "BROWSER_WEBGPU_ROUTE_RESULTS_DIR", None)
        serve.BROWSER_WEBGPU_ROUTE_RESULTS_DIR = results_dir
        try:
            index = build_browser_webgpu_route_provider_index()
        finally:
            serve.BROWSER_WEBGPU_ROUTE_RESULTS_DIR = previous

    assert index["provider"]["source"] == "route-result-files"
    assert index["provider"]["result_dir"] == str(results_dir)
    assert index["invalid_result_count"] == 0
    assert index["summary"] == {"done": 1}
    [row] = index["rows"]
    assert row["job_id"] == "browser-webgpu-req:moge-bunnycake"
    assert row["route_job"]["metadata"]["evidenceClassification"]["classification"] == "fallback"
    assert row["route_job"]["metadata"]["evidenceClassification"]["authoritative"] is False
    assert any(warning["kind"] == "browser_webgpu_demo_evidence" for warning in row["warnings"])


def test_browser_webgpu_route_provider_rejects_partial_or_incomplete_kit_results_as_row_owners():
    with TemporaryDirectory(dir="/tmp") as tmp:
        results_dir = Path(tmp) / "browser-webgpu-results"
        results_dir.mkdir()
        (results_dir / "partial.json").write_text(json.dumps(browser_webgpu_route_result(output_status="partial")), encoding="utf-8")
        (results_dir / "missing-hash.json").write_text(json.dumps(browser_webgpu_route_result(output_status="missing-hash")), encoding="utf-8")
        previous = getattr(serve, "BROWSER_WEBGPU_ROUTE_RESULTS_DIR", None)
        serve.BROWSER_WEBGPU_ROUTE_RESULTS_DIR = results_dir
        try:
            index = build_browser_webgpu_route_provider_index()
        finally:
            serve.BROWSER_WEBGPU_ROUTE_RESULTS_DIR = previous

    assert index["provider"]["source"] == "fixture"
    assert index["provider"]["result_dir"] == str(results_dir)
    assert index["invalid_result_count"] == 2
    assert index["summary"] == {"reserved": 1}
    [row] = index["rows"]
    assert row["job_id"] == "browser-webgpu-moge-fixture"
    assert row["route_job"]["metadata"]["evidenceClassification"]["classification"] == "demo"


def test_browser_webgpu_route_result_writer_persists_authoritative_payload():
    with TemporaryDirectory(dir="/tmp") as tmp:
        results_dir = Path(tmp) / "browser-webgpu-results"
        previous = getattr(serve, "BROWSER_WEBGPU_ROUTE_RESULTS_DIR", None)
        serve.BROWSER_WEBGPU_ROUTE_RESULTS_DIR = results_dir
        try:
            result = serve.write_browser_webgpu_route_result(browser_webgpu_route_result())
        finally:
            serve.BROWSER_WEBGPU_ROUTE_RESULTS_DIR = previous

        result_path = Path(result["result_path"])
        assert result["schema"] == "kaminos.browser-webgpu-route-result-write.v0"
        assert result["provider"] == "browser-webgpu"
        assert result_path.parent == results_dir.resolve()
        assert result_path.name == "moge.depth-normal.webgpu-local.v0__req-moge-bunnycake.json"
        assert result["receipt_link"] == "/api/read?root=browser-webgpu-route-results&path=moge.depth-normal.webgpu-local.v0__req-moge-bunnycake.json"
        assert result_path.exists()
        assert not list(results_dir.glob("*.tmp"))
        written = json.loads(result_path.read_text(encoding="utf-8"))
        assert written["schema"] == "kaminos.webgpu-route-result.v0"
        assert written["requestId"] == "req:moge-bunnycake"
        assert written["receipt"]["effectiveRouteId"] == MOGE_WEBGPU_ROUTE_ID
        assert result["route_provider_index"]["provider"]["source"] == "route-result-files"
        [row] = result["route_provider_index"]["rows"]
        assert row["job_id"] == "browser-webgpu-req:moge-bunnycake"
        assert row["route_job"]["metadata"]["evidenceClassification"]["authoritative"] is True


def test_browser_webgpu_route_result_writer_rejects_unconfigured_or_incomplete_payloads():
    previous = getattr(serve, "BROWSER_WEBGPU_ROUTE_RESULTS_DIR", None)
    serve.BROWSER_WEBGPU_ROUTE_RESULTS_DIR = None
    try:
        try:
            serve.write_browser_webgpu_route_result(browser_webgpu_route_result())
            assert False, "unconfigured writer should fail"
        except RuntimeError as error:
            assert "KAMINOS_BROWSER_WEBGPU_ROUTE_RESULTS_DIR" in str(error)
    finally:
        serve.BROWSER_WEBGPU_ROUTE_RESULTS_DIR = previous

    with TemporaryDirectory(dir="/tmp") as tmp:
        results_dir = Path(tmp) / "browser-webgpu-results"
        previous = getattr(serve, "BROWSER_WEBGPU_ROUTE_RESULTS_DIR", None)
        serve.BROWSER_WEBGPU_ROUTE_RESULTS_DIR = results_dir
        try:
            fallback_result = serve.write_browser_webgpu_route_result(browser_webgpu_route_result(status="fallback"))
            assert Path(fallback_result["result_path"]).is_file()
            try:
                serve.write_browser_webgpu_route_result(browser_webgpu_route_result(output_status="missing-hash"))
                assert False, "missing-hash writer should fail"
            except ValueError as error:
                assert "sha256" in str(error)
        finally:
            serve.BROWSER_WEBGPU_ROUTE_RESULTS_DIR = previous

        assert [path.name for path in results_dir.glob("*.json")] == ["moge.depth-normal.webgpu-local.v0__req-moge-bunnycake.json"]


def test_webgpu_inference_kit_static_asset_resolves_to_local_package_only():
    package_root = Path(__file__).resolve().parents[1] / "node_modules" / "@kaminos" / "webgpu-inference-kit"
    index_js = package_root / "src" / "index.js"
    assert index_js.is_file(), "@kaminos/webgpu-inference-kit must be installed for browser route producer smoke"

    resolved = serve.resolve_webgpu_inference_kit_asset("/vendor/@kaminos/webgpu-inference-kit/src/index.js")
    assert resolved == index_js.resolve()

    try:
        serve.resolve_webgpu_inference_kit_asset("/vendor/@kaminos/webgpu-inference-kit/../package.json")
        assert False, "path escape should fail"
    except PermissionError as error:
        assert "escapes" in str(error)


def test_route_provider_all_combines_native_greenroom_and_browser_webgpu_rows():
    with TemporaryDirectory(dir="/tmp") as tmp:
        greenroom = Path(tmp) / "greenroom"
        job_dir = greenroom / "pending" / "run123"
        output_dir = greenroom / "outputs" / "run123"
        job_dir.mkdir(parents=True)
        output_dir.mkdir(parents=True)
        (job_dir / "status.json").write_text(json.dumps({
            "job_id": "run123",
            "status": "pending",
            "job_type": "trellis2mlx",
            "input_path": "/tmp/source.png",
            "output_dir": str(output_dir),
            "checkpoint_stop_file": str(output_dir / "_control" / "checkpoint-stop"),
        }))
        previous = BROWSE_ROOTS["greenroom"]
        BROWSE_ROOTS["greenroom"] = greenroom
        try:
            index = build_route_provider_index("all")
        finally:
            BROWSE_ROOTS["greenroom"] = previous

    providers = {row["provider"] for row in index["rows"]}
    assert index["provider"]["kind"] == "kaminos-route-providers"
    assert providers == {"native-greenroom", "browser-webgpu"}
    assert index["summary"]["pending"] == 1
    assert index["summary"]["reserved"] == 1


def test_native_greenroom_route_provider_preserves_degraded_legacy_rows():
    with TemporaryDirectory(dir="/tmp") as tmp:
        greenroom = Path(tmp) / "greenroom"
        legacy_dir = greenroom / "failed" / "legacy-provider-route"
        legacy_dir.mkdir(parents=True)
        (legacy_dir / "status.json").write_text("""{
          "jobId": "legacy-provider-route",
          "jobType": "kaminos.orb-inner-engine.provider-route",
          "status": "failed"
        }""")

        previous = BROWSE_ROOTS["greenroom"]
        BROWSE_ROOTS["greenroom"] = greenroom
        try:
            index = build_greenroom_route_provider_index()
        finally:
            BROWSE_ROOTS["greenroom"] = previous

    [row] = index["rows"]
    assert row["route_job"]["id"] == "legacy-provider-route"
    assert row["route_job"]["status"] == "degraded"
    assert row["route_job"]["executor"]["kind"] == "native-greenroom"
    assert row["parse_error"]
    assert row["warnings"][0]["kind"] == "degraded_greenroom_status"
    assert row["controls"] == []


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
    test_volume_only_scene_save_name_uses_scene_fallback()
    test_greenroom_job_display_metadata_promotes_receipt_identity_over_job_id()
    test_greenroom_output_display_metadata_uses_job_context_for_hostile_output_names()
    test_greenroom_configured_root_outputs_are_served_even_when_outside_home()
    test_greenroom_stray_output_dirs_do_not_get_load_affordance()
    test_native_greenroom_route_provider_projects_route_job_rows()
    test_native_greenroom_route_provider_projects_checkpoint_paused_rows()
    test_native_greenroom_route_provider_projects_pause_request_controls()
    test_native_greenroom_checkpoint_pause_request_refuses_non_trellis_rows()
    test_browser_webgpu_route_provider_projects_fixture_route_identity()
    test_browser_webgpu_route_provider_ingests_authoritative_kit_result()
    test_browser_webgpu_route_provider_projects_fallback_kit_results_without_authority()
    test_browser_webgpu_route_provider_rejects_partial_or_incomplete_kit_results_as_row_owners()
    test_browser_webgpu_route_result_writer_persists_authoritative_payload()
    test_browser_webgpu_route_result_writer_rejects_unconfigured_or_incomplete_payloads()
    test_webgpu_inference_kit_static_asset_resolves_to_local_package_only()
    test_route_provider_all_combines_native_greenroom_and_browser_webgpu_rows()
    test_native_greenroom_route_provider_preserves_degraded_legacy_rows()
    test_splat_asset_index_separates_experimental_and_production_roots()
    test_splat_asset_index_allows_pointer_symlinks_inside_declared_roots()
    test_splat_asset_ingest_writes_only_to_experimental_inbox()
    test_splat_asset_correction_roundtrips_as_sidecar_metadata()
    test_runtime_config_exposes_hybrid_overlay_module_url_env()
