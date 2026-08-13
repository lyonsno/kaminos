#!/usr/bin/env python3
"""Run one image through Microsoft's deployed TRELLIS.2 Space."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import time
import traceback
from pathlib import Path
from typing import Any
from urllib.request import urlopen


SPACE_ID = "microsoft/TRELLIS.2"
SPACE_API = "https://huggingface.co/api/spaces/microsoft/TRELLIS.2"
MODEL_ID = "microsoft/TRELLIS.2-4B"
DEFAULT_SAMPLER = {
    "ssGuidanceStrength": 7.5,
    "ssGuidanceRescale": 0.7,
    "ssSamplingSteps": 12,
    "ssRescaleT": 5.0,
    "shapeSlatGuidanceStrength": 7.5,
    "shapeSlatGuidanceRescale": 0.5,
    "shapeSlatSamplingSteps": 12,
    "shapeSlatRescaleT": 3.0,
    "texSlatGuidanceStrength": 1.0,
    "texSlatGuidanceRescale": 0.0,
    "texSlatSamplingSteps": 12,
    "texSlatRescaleT": 3.0,
}


def reset_run_outputs(output_dir: Path) -> None:
    """Remove stale success artifacts before a new external-route attempt."""
    output_dir.mkdir(parents=True, exist_ok=True)
    for name in ("output.glb", "preprocessed.png", "preview.html", "run-report.json"):
        path = output_dir / name
        if path.exists():
            path.unlink()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")


def space_identity() -> dict[str, Any]:
    with urlopen(SPACE_API, timeout=30) as response:
        payload = json.load(response)
    return {
        "id": payload["id"],
        "sha": payload["sha"],
        "stage": payload.get("runtime", {}).get("stage"),
        "hardware": payload.get("runtime", {}).get("hardware"),
        "requestedHardware": payload.get("runtime", {}).get("requestedHardware"),
        "lastModified": payload.get("lastModified"),
    }


def local_path(value: Any) -> Path:
    if isinstance(value, str):
        return Path(value)
    if isinstance(value, dict) and value.get("path"):
        return Path(value["path"])
    if hasattr(value, "path"):
        return Path(value.path)
    raise TypeError(f"No downloaded path in Gradio return: {type(value).__name__}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--resolution", choices=("512", "1024", "1536"), default="1024")
    parser.add_argument("--decimation-target", type=int, default=300000)
    parser.add_argument("--texture-size", type=int, default=2048)
    return parser.parse_args()


def main() -> int:
    from gradio_client import Client, handle_file
    from huggingface_hub import get_token

    args = parse_args()
    source = args.source.resolve()
    output_dir = args.output_dir.resolve()
    report_path = output_dir / "run-report.json"
    output_path = output_dir / "output.glb"
    preprocessed_path = output_dir / "preprocessed.png"
    preview_path = output_dir / "preview.html"
    started = time.monotonic()
    reset_run_outputs(output_dir)
    token = get_token()
    if not token:
        raise RuntimeError("no local Hugging Face token; refusing an anonymous quota-confounded run")

    route_before = space_identity()
    report: dict[str, Any] = {
        "schema": "kaminos.reference_cuda_trellis_space_run.v1",
        "status": "running",
        "failurePhase": None,
        "lastTrustworthyEvidence": "invocation-recorded",
        "source": {"path": str(source), "sha256": None},
        "effectiveRoute": {
            "space": SPACE_ID,
            "authentication": "local-huggingface-token-present",
            "spaceIdentityBefore": route_before,
            "modelIdDeclaredBySpaceSource": MODEL_ID,
            "seed": args.seed,
            "resolution": args.resolution,
            "sampler": DEFAULT_SAMPLER,
            "preprocessing": "public-/preprocess_image endpoint",
            "decimationTarget": args.decimation_target,
            "textureSize": args.texture_size,
        },
        "preprocessed": None,
        "output": None,
        "previewReturned": False,
        "timingsSeconds": {},
    }
    write_report(report_path, report)

    phase = "source-validation"
    try:
        if not source.is_file():
            raise FileNotFoundError(source)
        report["source"]["sha256"] = sha256(source)
        report["lastTrustworthyEvidence"] = "source-identity-verified"
        write_report(report_path, report)

        phase = "space-client-connect"
        phase_started = time.monotonic()
        client = Client(
            SPACE_ID,
            token=token,
            verbose=False,
            download_files=output_dir / "downloads",
        )
        client.predict(api_name="/start_session")
        report["timingsSeconds"][phase] = time.monotonic() - phase_started
        report["lastTrustworthyEvidence"] = "official-space-session-opened"
        write_report(report_path, report)

        phase = "space-preprocessing"
        phase_started = time.monotonic()
        preprocessed = client.predict(handle_file(source), api_name="/preprocess_image")
        downloaded_preprocessed = local_path(preprocessed)
        shutil.copy2(downloaded_preprocessed, preprocessed_path)
        report["timingsSeconds"][phase] = time.monotonic() - phase_started
        report["preprocessed"] = {
            "path": str(preprocessed_path),
            "sha256": sha256(preprocessed_path),
            "bytes": preprocessed_path.stat().st_size,
        }
        report["lastTrustworthyEvidence"] = "official-preprocessed-input-downloaded"
        write_report(report_path, report)

        phase = "space-inference"
        phase_started = time.monotonic()
        preview = client.predict(
            handle_file(preprocessed_path),
            args.seed,
            args.resolution,
            DEFAULT_SAMPLER["ssGuidanceStrength"],
            DEFAULT_SAMPLER["ssGuidanceRescale"],
            DEFAULT_SAMPLER["ssSamplingSteps"],
            DEFAULT_SAMPLER["ssRescaleT"],
            DEFAULT_SAMPLER["shapeSlatGuidanceStrength"],
            DEFAULT_SAMPLER["shapeSlatGuidanceRescale"],
            DEFAULT_SAMPLER["shapeSlatSamplingSteps"],
            DEFAULT_SAMPLER["shapeSlatRescaleT"],
            DEFAULT_SAMPLER["texSlatGuidanceStrength"],
            DEFAULT_SAMPLER["texSlatGuidanceRescale"],
            DEFAULT_SAMPLER["texSlatSamplingSteps"],
            DEFAULT_SAMPLER["texSlatRescaleT"],
            api_name="/image_to_3d",
        )
        report["timingsSeconds"][phase] = time.monotonic() - phase_started
        report["previewReturned"] = isinstance(preview, str) and bool(preview.strip())
        if not report["previewReturned"]:
            raise RuntimeError("official Space returned no 3D preview")
        preview_path.write_text(preview)
        report["preview"] = {
            "path": str(preview_path),
            "sha256": sha256(preview_path),
            "bytes": preview_path.stat().st_size,
        }
        report["lastTrustworthyEvidence"] = "official-space-preview-returned"
        write_report(report_path, report)

        phase = "space-glb-extraction"
        phase_started = time.monotonic()
        extracted = client.predict(
            args.decimation_target,
            args.texture_size,
            api_name="/extract_glb",
        )
        candidates = extracted if isinstance(extracted, tuple) else (extracted,)
        downloaded_glb = next((local_path(item) for item in candidates if item), None)
        if downloaded_glb is None:
            raise RuntimeError("official Space returned no GLB path")
        shutil.copy2(downloaded_glb, output_path)
        if output_path.stat().st_size <= 4096 or output_path.read_bytes()[:4] != b"glTF":
            raise RuntimeError("downloaded output is not a plausible GLB")
        report["timingsSeconds"][phase] = time.monotonic() - phase_started
        report["output"] = {
            "path": str(output_path),
            "sha256": sha256(output_path),
            "bytes": output_path.stat().st_size,
        }
        report["lastTrustworthyEvidence"] = "official-space-glb-downloaded"
        write_report(report_path, report)

        phase = "route-identity-recheck"
        route_after = space_identity()
        report["effectiveRoute"]["spaceIdentityAfter"] = route_after
        if route_after["sha"] != route_before["sha"]:
            raise RuntimeError("official Space revision changed during the run")
        report["status"] = "completed"
        report["failurePhase"] = None
        report["lastTrustworthyEvidence"] = "revision-stable-official-space-glb-downloaded"
        report["timingsSeconds"]["total"] = time.monotonic() - started
        write_report(report_path, report)
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
        write_report(report_path, report)
        raise


if __name__ == "__main__":
    raise SystemExit(main())
