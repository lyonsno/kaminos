#!/usr/bin/env python3
"""Run the official fine-fur source through TRELLIS-Mac and retain mesh geometry."""

from __future__ import annotations

import argparse
import gc
import hashlib
import json
import os
import subprocess
import sys
import time
import traceback
from pathlib import Path
from typing import Any


JOB_TYPE = "trellis_mac_fine_fur_mps_geometry_0810"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_identity(repo: Path) -> dict[str, Any]:
    def run(*args: str) -> str:
        return subprocess.run(
            ["git", *args], cwd=repo, check=True, capture_output=True, text=True
        ).stdout.strip()

    return {
        "root": str(repo.resolve()),
        "commit": run("rev-parse", "HEAD"),
        "dirty": bool(run("status", "--short")),
    }


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")


def apply_target_contract(report: dict[str, Any]) -> bool:
    target_faces = int(report["effectiveRoute"]["targetFaces"])
    final_faces = int(report["geometry"]["finalFaces"])
    target_satisfied = final_faces <= target_faces
    report["geometry"]["targetSatisfied"] = target_satisfied
    if target_satisfied:
        report["status"] = "completed"
        report["failurePhase"] = None
        return True

    report["status"] = "partial"
    report["failurePhase"] = "geometry-simplification-target"
    return False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--trellis-root", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=80301)
    parser.add_argument("--pipeline-type", default="512", choices=["512"])
    parser.add_argument("--steps", type=int, default=6)
    parser.add_argument("--target-faces", type=int, default=500000)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = args.source.resolve()
    output_dir = args.output_dir.resolve()
    trellis_root = args.trellis_root.resolve()
    runner = Path(__file__).resolve()
    report_path = output_dir / "run-report.json"
    output_path = output_dir / "output.glb"
    started = time.monotonic()

    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    os.environ.setdefault("ATTN_BACKEND", "sdpa")
    os.environ.setdefault("SPARSE_ATTN_BACKEND", "sdpa")
    os.environ.setdefault("SPARSE_CONV_BACKEND", "flex_gemm")
    sys.path.insert(0, str(trellis_root / "TRELLIS.2"))
    sys.path.append(str(trellis_root / "stubs"))

    report: dict[str, Any] = {
        "schema": "kaminos.trellis_mps_geometry_run.v1",
        "status": "running",
        "failurePhase": None,
        "lastTrustworthyEvidence": "invocation-recorded",
        "source": {"path": str(source), "sha256": None},
        "runner": {"path": str(runner), "sha256": sha256(runner)},
        "trellis": None,
        "effectiveRoute": {
            "jobType": JOB_TYPE,
            "requestedBackend": "mps",
            "requestedDevice": "mps:0",
            "cpuFallbackPermitted": os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] == "1",
            "modelId": "microsoft/TRELLIS.2-4B",
            "modelRevision": None,
            "pipelineType": args.pipeline_type,
            "steps": args.steps,
            "retainedMeshAttributes": ["vertices", "faces"],
            "textureStageObservation": "not-instrumented",
            "targetFaces": args.target_faces,
            "seed": args.seed,
            "env": {
                key: os.environ[key]
                for key in (
                    "PYTORCH_ENABLE_MPS_FALLBACK",
                    "ATTN_BACKEND",
                    "SPARSE_ATTN_BACKEND",
                    "SPARSE_CONV_BACKEND",
                )
            },
        },
        "geometry": {},
        "output": None,
        "timingsSeconds": {},
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    write_report(report_path, report)

    phase = "trellis-route-preflight"
    try:
        if not trellis_root.is_dir():
            raise FileNotFoundError(trellis_root)
        report["trellis"] = git_identity(trellis_root)
        report["lastTrustworthyEvidence"] = "trellis-route-identity-observed"
        write_report(report_path, report)

        phase = "source-validation"
        if not source.is_file():
            raise FileNotFoundError(source)
        report["source"]["sha256"] = sha256(source)
        report["lastTrustworthyEvidence"] = "source-identity-verified"
        write_report(report_path, report)

        phase = "backend-import"
        import torch
        from PIL import Image
        from trellis2.pipelines.trellis2_image_to_3d import Trellis2ImageTo3DPipeline

        if not torch.backends.mps.is_available():
            raise RuntimeError("torch reports MPS unavailable")
        report["effectiveRoute"]["torchVersion"] = torch.__version__
        report["lastTrustworthyEvidence"] = "mps-backend-observed"
        write_report(report_path, report)

        phase = "pipeline-load"
        phase_started = time.monotonic()
        pipeline = Trellis2ImageTo3DPipeline.from_pretrained("microsoft/TRELLIS.2-4B")
        pipeline.to(torch.device("mps"))
        report["timingsSeconds"][phase] = time.monotonic() - phase_started
        report["lastTrustworthyEvidence"] = "pipeline-loaded-on-mps"
        write_report(report_path, report)

        phase = "inference"
        phase_started = time.monotonic()
        sampler = {"steps": args.steps}
        outputs = pipeline.run(
            Image.open(source),
            seed=args.seed,
            pipeline_type=args.pipeline_type,
            sparse_structure_sampler_params=sampler,
            shape_slat_sampler_params=sampler,
            tex_slat_sampler_params=sampler,
        )
        mesh = outputs[0] if isinstance(outputs, list) else outputs
        vertices = mesh.vertices.cpu().numpy()
        faces = mesh.faces.cpu().numpy()
        if not len(vertices) or not len(faces):
            raise RuntimeError("TRELLIS decoded an empty mesh")
        report["timingsSeconds"][phase] = time.monotonic() - phase_started
        report["geometry"].update(
            {"rawVertices": int(len(vertices)), "rawFaces": int(len(faces))}
        )
        report["lastTrustworthyEvidence"] = "nonempty-raw-mesh-decoded"
        write_report(report_path, report)

        del mesh, outputs, pipeline
        gc.collect()
        torch.mps.empty_cache()

        phase = "geometry-simplification"
        phase_started = time.monotonic()
        import pymeshlab

        mesh_set = pymeshlab.MeshSet()
        mesh_set.add_mesh(pymeshlab.Mesh(vertices, faces))
        if len(faces) > args.target_faces:
            mesh_set.meshing_decimation_quadric_edge_collapse(
                targetfacenum=args.target_faces,
                preservetopology=True,
            )
        simplified = mesh_set.current_mesh()
        final_vertices = simplified.vertex_matrix()
        final_faces = simplified.face_matrix()
        if not len(final_vertices) or len(final_faces) < 8:
            raise RuntimeError("simplification produced an invalid mesh")
        report["timingsSeconds"][phase] = time.monotonic() - phase_started
        report["geometry"].update(
            {
                "finalVertices": int(len(final_vertices)),
                "finalFaces": int(len(final_faces)),
                "simplifier": "pymeshlab-quadric-edge-collapse-preserve-topology",
            }
        )
        report["lastTrustworthyEvidence"] = "simplified-geometry-observed"
        write_report(report_path, report)

        phase = "geometry-export"
        phase_started = time.monotonic()
        import trimesh

        scene = trimesh.Scene(
            trimesh.Trimesh(
                vertices=final_vertices,
                faces=final_faces,
                process=False,
            )
        )
        scene.export(output_path)
        if not output_path.is_file() or output_path.stat().st_size <= 4096:
            raise RuntimeError("geometry-only GLB was missing or implausibly small")
        report["timingsSeconds"][phase] = time.monotonic() - phase_started
        report["output"] = {
            "path": str(output_path),
            "sha256": sha256(output_path),
            "bytes": output_path.stat().st_size,
        }
        target_satisfied = apply_target_contract(report)
        report["lastTrustworthyEvidence"] = (
            "target-compliant-geometry-glb-exported"
            if target_satisfied
            else "dense-geometry-glb-exported-target-missed"
        )
        report["timingsSeconds"]["total"] = time.monotonic() - started
        write_report(report_path, report)
        print(json.dumps(report, sort_keys=True))
        return 0 if target_satisfied else 2
    except BaseException as error:
        report["status"] = "failed"
        report["failurePhase"] = phase
        report["error"] = {
            "type": type(error).__name__,
            "message": str(error),
            "traceback": traceback.format_exc(),
        }
        report["timingsSeconds"]["total"] = time.monotonic() - started
        write_report(report_path, report)
        raise


if __name__ == "__main__":
    raise SystemExit(main())
