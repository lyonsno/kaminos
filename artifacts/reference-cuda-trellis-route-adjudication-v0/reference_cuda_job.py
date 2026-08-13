#!/usr/bin/env python3
"""Run the disputed stone source through stock Microsoft TRELLIS.2 on CUDA."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import tempfile
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


MODEL_ID = "microsoft/TRELLIS.2-4B"
MODEL_REVISION = "af44b45f2e35a493886929c6d786e563ec68364d"
SPACE_ID = "microsoft/TRELLIS.2"
SPACE_REVISION = "ebf60b20fc5a4607f90a1c11c0aab0ceeda5429d"
SPACE_APP_SHA256 = "97edffac5d1c78992643551cc2d7daab6d9b3d7c0f049ddb5d9640ad11cfd4c3"
RESULT_REPO = "lyonsno/kaminos-private-cuda-receipts"
SOURCE_PATH = "reference-cuda-trellis/stone-seed80301-res1024/preprocessed.png"
SOURCE_SHA256 = "b1d13ee8169c6310d783b5a9395a2f43ebc010d6c3d711712c29e9080cac24e7"
SAMPLER = {
    "sparseStructure": {
        "steps": 12,
        "guidance_strength": 7.5,
        "guidance_rescale": 0.7,
        "rescale_t": 5.0,
    },
    "shapeSlat": {
        "steps": 12,
        "guidance_strength": 7.5,
        "guidance_rescale": 0.5,
        "rescale_t": 3.0,
    },
    "textureSlat": {
        "steps": 12,
        "guidance_strength": 1.0,
        "guidance_rescale": 0.0,
        "rescale_t": 3.0,
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_initial_report() -> dict[str, Any]:
    return {
        "schema": "kaminos.reference_cuda_trellis_job.v1",
        "status": "running",
        "failurePhase": None,
        "lastTrustworthyEvidence": "invocation-recorded",
        "source": {
            "repo": RESULT_REPO,
            "path": SOURCE_PATH,
            "sha256": SOURCE_SHA256,
            "preprocessing": "official-microsoft-space-preprocess_image-return",
        },
        "effectiveRoute": {
            "containerImage": "hf.co/spaces/microsoft/TRELLIS.2",
            "spaceId": SPACE_ID,
            "spaceRevisionExpected": SPACE_REVISION,
            "spaceAppSha256Expected": SPACE_APP_SHA256,
            "modelId": MODEL_ID,
            "modelRevision": MODEL_REVISION,
            "hardwareFlavor": "a10g-small",
            "gpuMemoryGiB": 24,
            "timeoutMinutes": 15,
            "costUsdPerMinute": 0.0167,
            "maximumCostUsd": 0.2505,
            "seed": 80301,
            "pipelineType": "1024_cascade",
            "sampler": SAMPLER,
            "decimationTarget": 300000,
            "textureSize": 2048,
            "remesh": True,
            "remeshBand": 1,
            "remeshProject": 0,
        },
        "environment": {},
        "output": None,
        "timingsSeconds": {},
    }


def emit_local_report(path: Path, report: dict[str, Any]) -> None:
    serialized = json.dumps(report, indent=2, sort_keys=True) + "\n"
    path.write_text(serialized)
    print(json.dumps({
        "event": "reference_cuda_report",
        "status": report["status"],
        "failurePhase": report["failurePhase"],
        "lastTrustworthyEvidence": report["lastTrustworthyEvidence"],
        "report": report,
    }, sort_keys=True), flush=True)


def main() -> int:
    os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
    os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
    os.environ["ATTN_BACKEND"] = "flash_attn"
    os.environ["FLEX_GEMM_AUTOTUNE_CACHE_PATH"] = "/home/user/app/autotune_cache.json"
    os.environ["FLEX_GEMM_AUTOTUNER_VERBOSE"] = "1"

    from huggingface_hub import HfApi, hf_hub_download, snapshot_download

    token = os.environ.get("HF_TOKEN")
    if not token:
        raise RuntimeError("HF_TOKEN is required for private result persistence")

    api = HfApi(token=token)
    report = build_initial_report()
    started = time.monotonic()
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    remote_root = f"reference-cuda-trellis/stone-seed80301-res1024/jobs/{run_id}"
    report["runId"] = run_id
    report["remoteRoot"] = remote_root

    with tempfile.TemporaryDirectory(prefix="trellis-reference-cuda-") as temporary:
        work_dir = Path(temporary)
        report_path = work_dir / "run-report.json"
        output_path = work_dir / "output.glb"

        def persist_report() -> None:
            emit_local_report(report_path, report)
            api.upload_file(
                path_or_fileobj=report_path,
                path_in_repo=f"{remote_root}/run-report.json",
                repo_id=RESULT_REPO,
                repo_type="dataset",
                commit_message=f"cuda assay: {run_id} report {report['status']}",
            )

        persist_report()
        phase = "environment-validation"
        try:
            import torch

            if not torch.cuda.is_available():
                raise RuntimeError("CUDA is unavailable inside the requested GPU job")
            gpu = torch.cuda.get_device_properties(0)
            report["environment"] = {
                "python": platform.python_version(),
                "platform": platform.platform(),
                "torch": torch.__version__,
                "cudaRuntime": torch.version.cuda,
                "gpuName": gpu.name,
                "gpuCapability": list(torch.cuda.get_device_capability(0)),
                "gpuMemoryBytes": gpu.total_memory,
                "jobId": os.environ.get("HF_JOB_ID"),
            }
            app_path = Path("/home/user/app/app.py")
            if not app_path.is_file():
                raise RuntimeError("official Space app.py is absent from the Space image")
            observed_app_sha = sha256(app_path)
            report["environment"]["spaceAppPath"] = str(app_path)
            report["environment"]["spaceAppSha256Observed"] = observed_app_sha
            if observed_app_sha != SPACE_APP_SHA256:
                raise RuntimeError(
                    f"Space image source drift: expected {SPACE_APP_SHA256}, got {observed_app_sha}"
                )
            report["lastTrustworthyEvidence"] = "official-space-image-and-cuda-verified"
            persist_report()

            phase = "source-download"
            phase_started = time.monotonic()
            source = Path(
                hf_hub_download(
                    RESULT_REPO,
                    SOURCE_PATH,
                    repo_type="dataset",
                    token=token,
                )
            )
            observed_source_sha = sha256(source)
            report["source"]["sha256Observed"] = observed_source_sha
            report["timingsSeconds"][phase] = time.monotonic() - phase_started
            if observed_source_sha != SOURCE_SHA256:
                raise RuntimeError(
                    f"source drift: expected {SOURCE_SHA256}, got {observed_source_sha}"
                )
            report["lastTrustworthyEvidence"] = "exact-preprocessed-source-verified"
            persist_report()

            phase = "model-load"
            phase_started = time.monotonic()
            from trellis2.pipelines import Trellis2ImageTo3DPipeline

            model_path = snapshot_download(
                MODEL_ID,
                revision=MODEL_REVISION,
                token=token,
            )
            pipeline = Trellis2ImageTo3DPipeline.from_pretrained(model_path)
            pipeline.rembg_model = None
            pipeline.low_vram = False
            pipeline.cuda()
            report["environment"]["modelSnapshotPath"] = model_path
            report["timingsSeconds"][phase] = time.monotonic() - phase_started
            report["lastTrustworthyEvidence"] = "pinned-official-model-loaded-on-cuda"
            persist_report()

            phase = "model-inference"
            phase_started = time.monotonic()
            from PIL import Image

            image = Image.open(source).convert("RGB")
            outputs, latents = pipeline.run(
                image,
                seed=80301,
                preprocess_image=False,
                sparse_structure_sampler_params=SAMPLER["sparseStructure"],
                shape_slat_sampler_params=SAMPLER["shapeSlat"],
                tex_slat_sampler_params=SAMPLER["textureSlat"],
                pipeline_type="1024_cascade",
                return_latent=True,
            )
            outputs[0].simplify(16777216)
            report["timingsSeconds"][phase] = time.monotonic() - phase_started
            report["lastTrustworthyEvidence"] = "official-model-latents-and-preview-mesh-returned"
            persist_report()

            phase = "glb-extraction"
            phase_started = time.monotonic()
            import o_voxel

            shape_slat, tex_slat, resolution = latents
            mesh = pipeline.decode_latent(shape_slat, tex_slat, resolution)[0]
            mesh.simplify(16777216)
            glb = o_voxel.postprocess.to_glb(
                vertices=mesh.vertices,
                faces=mesh.faces,
                attr_volume=mesh.attrs,
                coords=mesh.coords,
                attr_layout=pipeline.pbr_attr_layout,
                grid_size=resolution,
                aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
                decimation_target=300000,
                texture_size=2048,
                remesh=True,
                remesh_band=1,
                remesh_project=0,
                use_tqdm=True,
            )
            glb.export(output_path, extension_webp=True)
            if output_path.stat().st_size <= 4096 or output_path.read_bytes()[:4] != b"glTF":
                raise RuntimeError("stock CUDA export did not produce a plausible GLB")
            report["timingsSeconds"][phase] = time.monotonic() - phase_started
            report["output"] = {
                "path": f"{remote_root}/output.glb",
                "sha256": sha256(output_path),
                "bytes": output_path.stat().st_size,
            }
            report["lastTrustworthyEvidence"] = "stock-cuda-glb-validated"
            persist_report()

            phase = "output-persistence"
            phase_started = time.monotonic()
            api.upload_file(
                path_or_fileobj=output_path,
                path_in_repo=report["output"]["path"],
                repo_id=RESULT_REPO,
                repo_type="dataset",
                commit_message=f"cuda assay: {run_id} stock TRELLIS GLB",
            )
            report["timingsSeconds"][phase] = time.monotonic() - phase_started
            report["timingsSeconds"]["total"] = time.monotonic() - started
            report["status"] = "completed"
            report["failurePhase"] = None
            report["lastTrustworthyEvidence"] = "stock-cuda-glb-persisted"
            persist_report()
            print(json.dumps(report, sort_keys=True))
            return 0
        except BaseException as error:
            report["status"] = "failed"
            report["failurePhase"] = phase
            report["error"] = {
                "type": type(error).__name__,
                "message": str(error),
                "traceback": traceback.format_exc(),
            }
            report["timingsSeconds"]["total"] = time.monotonic() - started
            persist_report()
            raise


if __name__ == "__main__":
    raise SystemExit(main())
