#!/usr/bin/env python3
"""Extract the four serving controls from the same pinned official checkpoint."""
import argparse
import hashlib
import json
import os
from pathlib import Path

CHECKPOINT_SHA256 = "sha256:0567debeec80ba4ac6369540c6c248025283cb3ff2b92827509e57e2b3541cb6"
CONTROLS = {
    "valid": ("tracker.model.output_valid_embed", [16, 256]),
    "invalid": ("tracker.model.output_invalid_embed", [16, 256]),
    "noMemory": ("tracker.model.interactivity_no_mem_embed", [1, 1, 256]),
    "positionMatrix": ("tracker.model.image_pe_layer.positional_encoding_gaussian_matrix", [2, 128]),
}


def extract(checkpoint, out):
    out.mkdir(parents=True, exist_ok=True)
    report = {"schema": "kaminos.sam31-stream-controls.v1", "status": "running", "phase": "checkpoint-hash",
              "checkpoint": str(checkpoint.resolve()), "controls": {}}
    try:
        with checkpoint.open("rb") as stream:
            actual = "sha256:" + hashlib.file_digest(stream, "sha256").hexdigest()
        report["checkpointSha256"] = actual
        if actual != CHECKPOINT_SHA256:
            raise ValueError("official checkpoint SHA mismatch")
        report["phase"] = "checkpoint-load"
        import torch
        state = torch.load(checkpoint, map_location="cpu", weights_only=True, mmap=True)
        report["phase"] = "control-extraction"
        for name, (key, shape) in CONTROLS.items():
            tensor = state[key].float().contiguous()
            if list(tensor.shape) != shape or not torch.isfinite(tensor).all().item():
                raise ValueError(f"invalid control tensor {key}")
            data = tensor.numpy().tobytes()
            path = out / f"{name}.bin"
            path.write_bytes(data)
            report["controls"][name] = {"file": path.name, "role": name, "officialKey": key,
                "shape": shape, "dtype": "float32", "sha256": "sha256:" + hashlib.sha256(data).hexdigest(), "byteLength": len(data)}
        # Independent PyTorch interpolation receipt for the native prompt resize.
        ramp = torch.arange(7, dtype=torch.float32).reshape(1, 1, 1, 7).expand(1, 1, 7, 7)
        report["promptResizeReference"] = {"backend": "torch-cpu", "version": torch.__version__,
            "mode": "bilinear", "alignCorners": False, "antialias": True,
            "inputShape": [1, 1, 7, 7], "outputShape": [1, 1, 8, 8],
            "values": torch.nn.functional.interpolate(ramp, size=(8, 8), mode="bilinear", align_corners=False, antialias=True).flatten().tolist()}
        report.update(status="complete", phase="complete")
        return report
    except Exception as error:
        report.update(status="failed", error=str(error))
        raise
    finally:
        text = json.dumps(report, indent=2)
        (out / "controls.json").write_text(text)
        if os.environ.get("EPISTAXIS_JOB_PRIMARY_OUTPUT"):
            Path(os.environ["EPISTAXIS_JOB_PRIMARY_OUTPUT"]).write_text(text)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    extract(args.checkpoint, args.out)
