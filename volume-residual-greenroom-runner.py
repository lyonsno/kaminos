#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path


SCHEMA = "kaminos.volume.residual-greenroom-runner.v0"


def truthy(value):
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def optional_value(value):
    text = str(value or "").strip()
    return text if text else None


def parse_args():
    parser = argparse.ArgumentParser(description="GPU Greenroom wrapper for Kaminos MLX residual-upscale jobs.")
    parser.add_argument("--corpus-manifest", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--low-render-scale", default="0.1")
    parser.add_argument("--max-steps", default="40")
    parser.add_argument("--batch-size", default="2")
    parser.add_argument("--patch-size", default="64")
    parser.add_argument("--model-arch", default="tiny-conv")
    parser.add_argument("--feature-input-mode", default="rgb")
    parser.add_argument("--hidden-channels", default="16")
    parser.add_argument("--detail-residual-gate", default="2.0")
    parser.add_argument("--learning-rate", default="0.001")
    parser.add_argument("--eval-patches", default="8")
    parser.add_argument("--preview-size", default="384")
    parser.add_argument("--preview-mode", default="foreground")
    parser.add_argument("--preview-frame-count", default="1")
    parser.add_argument("--seed", default="630")
    parser.add_argument("--sleep-ms", default="0")
    parser.add_argument("--foreground-threshold", default="0.025")
    parser.add_argument("--foreground-probability", default="0.85")
    parser.add_argument("--loss-mode", default="weighted")
    parser.add_argument("--foreground-loss-weight", default="2.0")
    parser.add_argument("--difference-loss-weight", default="0.25")
    parser.add_argument("--edge-band-mode", default="off")
    parser.add_argument("--edge-band-threshold", default="0.03")
    parser.add_argument("--edge-band-dilate", default="2")
    parser.add_argument("--edge-sampling-probability", default="0")
    parser.add_argument("--edge-loss-weight", default="0")
    parser.add_argument("--edge-gradient-loss-weight", default="0")
    parser.add_argument("--outside-edge-residual-weight", default="0")
    parser.add_argument("--residual-output-limit", default="0")
    parser.add_argument("--residual-color-mode", default="rgb")
    parser.add_argument("--chroma-residual-scale", default="1.0")
    parser.add_argument("--chroma-residual-loss-weight", default="0")
    parser.add_argument("--residual-application-mask-mode", default="off")
    parser.add_argument("--residual-mask-feather-radius", default="0")
    parser.add_argument("--residual-smoothness-loss-weight", default="0")
    parser.add_argument("--smoke-structure-loss-weight", default="0")
    parser.add_argument("--smoke-residual-dc-loss-weight", default="0")
    parser.add_argument("--smoke-residual-energy-loss-weight", default="0")
    parser.add_argument("--smoke-mask-threshold", default="0.025")
    parser.add_argument("--condition-render-scale", default="false")
    parser.add_argument("--temporal-eval", default="true")
    parser.add_argument("--temporal-eval-scope", default="selected")
    parser.add_argument("--temporal-crop-size", default="")
    parser.add_argument("--temporal-loss-weight", default="0")
    parser.add_argument("--residual-temporal-loss-weight", default="0")
    parser.add_argument("--residual-continuation-mode", default="none")
    parser.add_argument("--residual-continuation-alpha", default="1.0")
    parser.add_argument("--save-model-dir", default="")
    parser.add_argument("--load-model-dir", default="")
    parser.add_argument("--eval-only", default="false")
    parser.add_argument("--probe-only", default="false")
    return parser.parse_args()


def mlx_identity():
    try:
        import mlx.core as mx

        return {
            "mlxAvailable": True,
            "mlxDefaultDevice": str(mx.default_device()),
        }
    except Exception as exc:
        return {
            "mlxAvailable": False,
            "mlxDefaultDevice": None,
            "mlxImportError": repr(exc),
        }


def append_arg(command, flag, value):
    text = optional_value(value)
    if text is not None:
        command.extend([flag, text])


def build_child_command(args):
    runner = Path(__file__).with_name("volume-residual-upscale-mlx.py")
    command = [
        sys.executable,
        "-u",
        str(runner),
        "--corpus-manifest",
        str(Path(args.corpus_manifest).resolve()),
        "--out-dir",
        str(Path(args.out_dir).resolve()),
        "--low-render-scale",
        str(args.low_render_scale),
        "--max-steps",
        str(args.max_steps),
        "--batch-size",
        str(args.batch_size),
        "--patch-size",
        str(args.patch_size),
        "--model-arch",
        str(args.model_arch),
        "--feature-input-mode",
        str(args.feature_input_mode),
        "--hidden-channels",
        str(args.hidden_channels),
        "--detail-residual-gate",
        str(args.detail_residual_gate),
        "--learning-rate",
        str(args.learning_rate),
        "--eval-patches",
        str(args.eval_patches),
        "--preview-size",
        str(args.preview_size),
        "--preview-mode",
        str(args.preview_mode),
        "--preview-frame-count",
        str(args.preview_frame_count),
        "--seed",
        str(args.seed),
        "--sleep-ms",
        str(args.sleep_ms),
        "--foreground-threshold",
        str(args.foreground_threshold),
        "--foreground-probability",
        str(args.foreground_probability),
        "--loss-mode",
        str(args.loss_mode),
        "--foreground-loss-weight",
        str(args.foreground_loss_weight),
        "--difference-loss-weight",
        str(args.difference_loss_weight),
        "--edge-band-mode",
        str(args.edge_band_mode),
        "--edge-band-threshold",
        str(args.edge_band_threshold),
        "--edge-band-dilate",
        str(args.edge_band_dilate),
        "--edge-sampling-probability",
        str(args.edge_sampling_probability),
        "--edge-loss-weight",
        str(args.edge_loss_weight),
        "--edge-gradient-loss-weight",
        str(args.edge_gradient_loss_weight),
        "--outside-edge-residual-weight",
        str(args.outside_edge_residual_weight),
        "--residual-output-limit",
        str(args.residual_output_limit),
        "--residual-color-mode",
        str(args.residual_color_mode),
        "--chroma-residual-scale",
        str(args.chroma_residual_scale),
        "--chroma-residual-loss-weight",
        str(args.chroma_residual_loss_weight),
        "--residual-application-mask-mode",
        str(args.residual_application_mask_mode),
        "--residual-mask-feather-radius",
        str(args.residual_mask_feather_radius),
        "--residual-smoothness-loss-weight",
        str(args.residual_smoothness_loss_weight),
        "--smoke-structure-loss-weight",
        str(args.smoke_structure_loss_weight),
        "--smoke-residual-dc-loss-weight",
        str(args.smoke_residual_dc_loss_weight),
        "--smoke-residual-energy-loss-weight",
        str(args.smoke_residual_energy_loss_weight),
        "--smoke-mask-threshold",
        str(args.smoke_mask_threshold),
        "--temporal-eval-scope",
        str(args.temporal_eval_scope),
        "--temporal-loss-weight",
        str(args.temporal_loss_weight),
        "--residual-temporal-loss-weight",
        str(args.residual_temporal_loss_weight),
        "--residual-continuation-mode",
        str(args.residual_continuation_mode),
        "--residual-continuation-alpha",
        str(args.residual_continuation_alpha),
    ]
    if truthy(args.condition_render_scale):
        command.append("--condition-render-scale")
    if truthy(args.temporal_eval):
        command.append("--temporal-eval")
    if truthy(args.eval_only):
        command.append("--eval-only")
    append_arg(command, "--temporal-crop-size", args.temporal_crop_size)
    append_arg(command, "--save-model-dir", args.save_model_dir)
    append_arg(command, "--load-model-dir", args.load_model_dir)
    return command


def main():
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    route_proof = {
        "schema": SCHEMA,
        "phase": "route-proof-before-child",
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "python": sys.executable,
        "cwd": str(Path.cwd()),
        "script": str(Path(__file__).resolve()),
        "corpusManifest": str(Path(args.corpus_manifest).resolve()),
        "outDir": str(out_dir),
        "pid": os.getpid(),
        "env": {
            "PYTHONPATH": os.environ.get("PYTHONPATH"),
            "MLX_METAL_DEBUG": os.environ.get("MLX_METAL_DEBUG"),
        },
        **mlx_identity(),
    }
    proof_path = out_dir / "greenroom-route-proof.json"
    proof_path.write_text(json.dumps(route_proof, indent=2) + "\n")
    print(json.dumps(route_proof), flush=True)
    if not route_proof["mlxAvailable"]:
        raise SystemExit("MLX import/device proof failed before residual run")
    if truthy(args.probe_only):
        print(json.dumps({**route_proof, "phase": "probe-only-complete", "proofPath": str(proof_path)}), flush=True)
        return 0

    child_command = build_child_command(args)
    run_receipt = {
        "schema": SCHEMA,
        "phase": "child-start",
        "childCommand": child_command,
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "routeProofPath": str(proof_path),
    }
    (out_dir / "greenroom-runner-receipt.json").write_text(json.dumps(run_receipt, indent=2) + "\n")
    print(json.dumps(run_receipt), flush=True)
    completed = subprocess.run(child_command, cwd=Path(__file__).resolve().parent)
    report_path = out_dir / "residual-report.json"
    final_receipt = {
        **run_receipt,
        "phase": "child-complete",
        "finishedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "exitCode": completed.returncode,
        "residualReport": str(report_path) if report_path.exists() else None,
    }
    if report_path.exists():
        try:
            report = json.loads(report_path.read_text())
            final_receipt["residualReportDevice"] = report.get("device")
            final_receipt["residualReportSchema"] = report.get("schema")
            final_receipt["baselinePsnr"] = report.get("baselinePsnr")
            final_receipt["modelPsnr"] = report.get("modelPsnr")
            final_receipt["deltaPsnr"] = report.get("deltaPsnr")
            final_receipt["weightedDeltaPsnr"] = report.get("weightedDeltaPsnr")
            final_receipt["edgeBandDeltaPsnr"] = report.get("edgeBandDeltaPsnr")
            final_receipt["targetEdgeBandDeltaPsnr"] = report.get("targetEdgeBandDeltaPsnr")
            final_receipt["edgeBandAuthority"] = report.get("edgeBandAuthority")
            final_receipt["featureInputMode"] = report.get("featureInputMode")
            final_receipt["featureInputAuthority"] = report.get("featureInputAuthority")
            final_receipt["featureInputChannels"] = report.get("featureInputChannels")
            final_receipt["outsideEdgeResidualMse"] = report.get("outsideEdgeResidualMse")
            final_receipt["residualOutputLimit"] = report.get("residualOutputLimit")
            final_receipt["residualColorMode"] = report.get("residualColorMode")
            final_receipt["chromaResidualScale"] = report.get("chromaResidualScale")
            final_receipt["chromaResidualLossWeight"] = report.get("chromaResidualLossWeight")
            final_receipt["residualApplicationMaskMode"] = report.get("residualApplicationMaskMode")
            final_receipt["residualMaskFeatherRadius"] = report.get("residualMaskFeatherRadius")
            final_receipt["residualSmoothnessLossWeight"] = report.get("residualSmoothnessLossWeight")
        except Exception as exc:
            final_receipt["residualReportReadError"] = repr(exc)
    (out_dir / "greenroom-runner-receipt.json").write_text(json.dumps(final_receipt, indent=2) + "\n")
    print(json.dumps(final_receipt), flush=True)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
