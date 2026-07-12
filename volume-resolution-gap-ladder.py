#!/usr/bin/env python3
"""Run a compact phase-aligned resolution-gap ladder over one high history.

The ladder is an orchestration harness. It delegates corpus construction to
`volume-phase-aligned-corpus-contract.py` and model probing/dense cue export to
`volume-sidecar-meta-probe.py`, then writes one aggregate manifest with leg
receipts and a small candidate recommendation set for receiver playback.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA = "kaminos.volume.resolution-gap-ladder.v0"
IDENTITY = "phase-aligned-resolution-gap-ladder-v0"
AUTHORITY = "offline-phase-aligned-multi-gap-producer-ladder-not-browser-witness-not-product-inference"
STORAGE_DISCIPLINE_IDENTITY = "regenerable-intermediates-not-retained-by-default"
CORPUS_SCRIPT = "volume-phase-aligned-corpus-contract.py"
PROBE_SCRIPT = "volume-sidecar-meta-probe.py"
DEFAULT_TARGET_GRIDS = [144, 128, 112, 96]
DEFAULT_TARGET_CHANNELS = "support,coverage,ridge,proximity"
DEFAULT_CLASSIFIER_CHANNELS = "support,coverage,ridge,proximity"


class LadderFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError as err:
        raise LadderFailure("manifest-read", f"Missing JSON manifest {path}", {"path": str(path)}) from err
    except json.JSONDecodeError as err:
        raise LadderFailure("manifest-read", f"Invalid JSON manifest {path}", {"path": str(path), "error": str(err)}) from err


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_ref(path: Path) -> dict[str, Any]:
    return {
        "path": str(path),
        "sha256": sha256_file(path),
        "byteLength": int(path.stat().st_size),
    }


def parse_grid_list(value: str) -> list[int]:
    grids: list[int] = []
    for raw in value.split(","):
        part = raw.strip()
        if not part:
            continue
        try:
            grid = int(part)
        except ValueError as err:
            raise argparse.ArgumentTypeError("--target-grid-list must contain integers") from err
        if grid <= 0:
            raise argparse.ArgumentTypeError("--target-grid-list grids must be positive")
        if grid not in grids:
            grids.append(grid)
    if not grids:
        raise argparse.ArgumentTypeError("--target-grid-list must contain at least one grid")
    return grids


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--high-manifest", required=True, help="High-resolution full-grid export manifest.")
    parser.add_argument("--high-boundary-sidecar-manifest", default="", help="High-resolution boundary sidecar manifest; defaults to --high-manifest when it carries boundarySidecar.")
    parser.add_argument("--out-dir", required=True, help="Output directory for aggregate manifest, leg corpuses, probes, and selected dense packs.")
    parser.add_argument("--target-grid-list", type=parse_grid_list, default=list(DEFAULT_TARGET_GRIDS), help="Comma-separated target grids, e.g. 144,128,112,96.")
    parser.add_argument("--source-note", default="", help="Compact source note recorded in the aggregate manifest.")
    parser.add_argument("--target-channel-list", default=DEFAULT_TARGET_CHANNELS, help="Target channels passed to the sidecar/meta probe.")
    parser.add_argument("--classifier-channel-list", default=DEFAULT_CLASSIFIER_CHANNELS, help="Sparse classifier channels passed to the sidecar/meta probe.")
    parser.add_argument("--classifier-target-thresholds", default="support:0.03,coverage:0.1,ridge:0.1,proximity:0.1")
    parser.add_argument("--train-samples", type=int, default=40_000)
    parser.add_argument("--test-samples", type=int, default=24_000)
    parser.add_argument("--epochs", type=int, default=35)
    parser.add_argument("--hidden-width", type=int, default=48)
    parser.add_argument("--batch-size", type=int, default=4096)
    parser.add_argument("--learning-rate", type=float, default=1.0e-3)
    parser.add_argument("--context-radius", type=int, default=2)
    parser.add_argument("--support-sample-fraction", type=float, default=0.60)
    parser.add_argument("--dense-export-chunk-size", type=int, default=131_072)
    parser.add_argument("--seed-base", type=int, default=17100)
    parser.add_argument("--continue-on-leg-failure", action="store_true", help="Record failed legs and keep the remaining ladder running.")
    parser.add_argument("--force", action="store_true", help="Recompute legs even when captured manifests already exist.")
    parser.add_argument("--dry-run", action="store_true", help="Write the aggregate plan without running corpus/probe subprocesses.")
    return parser.parse_args()


def run_command(cmd: list[str], cwd: Path) -> dict[str, Any]:
    result = subprocess.run(cmd, cwd=str(cwd), text=True, capture_output=True)
    return {
        "command": cmd,
        "returnCode": int(result.returncode),
        "stdoutTail": result.stdout[-4000:],
        "stderrTail": result.stderr[-4000:],
    }


def captured(path: Path) -> bool:
    if not path.exists():
        return False
    try:
        return read_json(path).get("status") == "captured"
    except LadderFailure:
        return False


def manifest_ref_or_none(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    return file_ref(path)


def extract_metric(report: dict[str, Any], channel: str, key: str) -> float | None:
    value = (((report.get("perChannelVerdicts") or {}).get(channel) or {}).get(key))
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    return None


def classifier_best_jaccard(report: dict[str, Any], channel: str) -> float | None:
    sparse = (((report.get("phaseAlignedTeacher") or {}).get("sparseClassifiers") or {}).get(channel) or {})
    value = ((sparse.get("probabilityThresholdSweep") or {}).get("bestJaccard"))
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    return None


def summarize_probe(report: dict[str, Any]) -> dict[str, Any]:
    channels = (((report.get("target") or {}).get("selectedTargetChannels")) or [])
    reductions: dict[str, Any] = {}
    classifiers: dict[str, Any] = {}
    score_parts: list[float] = []
    for channel in channels:
        reduction = extract_metric(report, str(channel), "mlpReductionVsBlockPct")
        if reduction is not None:
            reductions[str(channel)] = reduction
            if channel in ("support", "ridge", "proximity"):
                score_parts.append(reduction)
        jaccard = classifier_best_jaccard(report, str(channel))
        if jaccard is not None:
            classifiers[str(channel)] = jaccard
            if channel in ("support", "ridge", "proximity"):
                score_parts.append(jaccard * 100.0)
    return {
        "lowGrid": ((report.get("target") or {}).get("lowGrid")),
        "highGrid": ((report.get("target") or {}).get("highGrid")),
        "reductionRatio": ((report.get("target") or {}).get("reductionRatio")),
        "perChannelMlpReductionVsBlockPct": reductions,
        "classifierBestJaccard": classifiers,
        "score": float(sum(score_parts) / len(score_parts)) if score_parts else None,
        "verdicts": report.get("perChannelVerdicts"),
    }


def leg_paths(out_dir: Path, high_grid: int, target_grid: int) -> dict[str, Path]:
    slug = f"{high_grid}-to-{target_grid}"
    return {
        "corpusDir": out_dir / "corpuses" / slug,
        "corpusManifest": out_dir / "corpuses" / slug / "manifest.json",
        "probeManifest": out_dir / "probes" / f"{slug}.json",
        "denseCuePackManifest": out_dir / "dense-cue-packs" / slug / "manifest.json",
    }


def build_leg(args: argparse.Namespace, repo_root: Path, out_dir: Path, high_manifest: Path, high_grid: int, target_grid: int) -> dict[str, Any]:
    paths = leg_paths(out_dir, high_grid, target_grid)
    leg: dict[str, Any] = {
        "identity": "resolution-gap-ladder-leg-v0",
        "status": "planned",
        "failurePhase": None,
        "highGrid": int(high_grid),
        "targetGrid": int(target_grid),
        "reductionRatio": float(high_grid) / float(target_grid),
        "corpusManifest": str(paths["corpusManifest"]),
        "probeManifest": str(paths["probeManifest"]),
        "denseCuePackManifest": str(paths["denseCuePackManifest"]),
        "subprocesses": [],
    }
    if args.dry_run:
        leg["status"] = "planned-dry-run"
        return leg

    high_boundary = Path(args.high_boundary_sidecar_manifest).resolve() if args.high_boundary_sidecar_manifest else high_manifest
    corpus_cmd = [
        sys.executable,
        CORPUS_SCRIPT,
        "--high-manifest",
        str(high_manifest),
        "--high-boundary-sidecar-manifest",
        str(high_boundary),
        "--target-grid",
        str(target_grid),
        "--out-dir",
        str(paths["corpusDir"]),
        "--source-note",
        f"phase-aligned-resolution-gap-ladder {high_grid}->{target_grid}",
    ]
    probe_cmd = [
        sys.executable,
        PROBE_SCRIPT,
        "--corpus-manifest",
        str(paths["corpusManifest"]),
        "--out",
        str(paths["probeManifest"]),
        "--target-channel-list",
        str(args.target_channel_list),
        "--classifier-channel-list",
        str(args.classifier_channel_list),
        "--classifier-target-thresholds",
        str(args.classifier_target_thresholds),
        "--train-samples",
        str(args.train_samples),
        "--test-samples",
        str(args.test_samples),
        "--epochs",
        str(args.epochs),
        "--hidden-width",
        str(args.hidden_width),
        "--batch-size",
        str(args.batch_size),
        "--learning-rate",
        str(args.learning_rate),
        "--context-radius",
        str(args.context_radius),
        "--support-sample-fraction",
        str(args.support_sample_fraction),
        "--ridge-classifier-mode",
        "binary",
        "--export-dense-cue-pack",
        str(paths["denseCuePackManifest"]),
        "--dense-export-chunk-size",
        str(args.dense_export_chunk_size),
        "--seed",
        str(int(args.seed_base) + int(target_grid)),
    ]

    try:
        if args.force or not captured(paths["corpusManifest"]):
            leg["subprocesses"].append(run_command(corpus_cmd, repo_root))
            if leg["subprocesses"][-1]["returnCode"] != 0:
                raise LadderFailure("corpus-subprocess", "Corpus leg subprocess failed.", {"targetGrid": target_grid})
        else:
            leg["subprocesses"].append({"command": corpus_cmd, "returnCode": 0, "reusedCapturedManifest": str(paths["corpusManifest"])})
        if args.force or not captured(paths["probeManifest"]) or not captured(paths["denseCuePackManifest"]):
            leg["subprocesses"].append(run_command(probe_cmd, repo_root))
            if leg["subprocesses"][-1]["returnCode"] != 0:
                raise LadderFailure("probe-subprocess", "Probe leg subprocess failed.", {"targetGrid": target_grid})
        else:
            leg["subprocesses"].append({"command": probe_cmd, "returnCode": 0, "reusedCapturedManifest": str(paths["probeManifest"])})
        probe = read_json(paths["probeManifest"])
        leg.update({
            "status": "captured",
            "corpusManifestRef": manifest_ref_or_none(paths["corpusManifest"]),
            "probeManifestRef": manifest_ref_or_none(paths["probeManifest"]),
            "denseCuePackManifestRef": manifest_ref_or_none(paths["denseCuePackManifest"]),
            "probeSummary": summarize_probe(probe),
        })
    except Exception as err:
        failure_phase = err.phase if isinstance(err, LadderFailure) else "leg-run"
        leg.update({
            "status": "failed",
            "failurePhase": failure_phase,
            "message": str(err),
            "corpusManifestRef": manifest_ref_or_none(paths["corpusManifest"]),
            "probeManifestRef": manifest_ref_or_none(paths["probeManifest"]),
            "denseCuePackManifestRef": manifest_ref_or_none(paths["denseCuePackManifest"]),
        })
        if not args.continue_on_leg_failure:
            raise LadderFailure(failure_phase, f"Ladder leg {target_grid} failed.", {"leg": leg}) from err
    return leg


def select_candidates(legs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    captured_legs = [leg for leg in legs if leg.get("status") == "captured"]
    if not captured_legs:
        return []
    by_near_gap = sorted(captured_legs, key=lambda leg: int(leg.get("targetGrid") or 0), reverse=True)
    scored = sorted(
        captured_legs,
        key=lambda leg: float(((leg.get("probeSummary") or {}).get("score")) or -1.0),
        reverse=True,
    )
    selected: list[dict[str, Any]] = []
    seen: set[int] = set()
    for reason, leg in (
        ("near-gap first motion discriminator", by_near_gap[0]),
        ("best producer-side score", scored[0]),
        ("wide-gap cliff probe", by_near_gap[-1]),
    ):
        grid = int(leg.get("targetGrid") or 0)
        if grid in seen:
            continue
        seen.add(grid)
        selected.append({
            "targetGrid": grid,
            "highGrid": int(leg.get("highGrid") or 0),
            "reason": reason,
            "denseCuePackManifest": leg.get("denseCuePackManifest"),
            "probeManifest": leg.get("probeManifest"),
            "score": ((leg.get("probeSummary") or {}).get("score")),
            "receiverAsk": "Route through Anti-Nonsense continuous playback with no_learned_live first; judge smoke/flame separately.",
        })
    return selected


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parent
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    high_manifest_path = Path(args.high_manifest).resolve()
    phase = "start"
    legs: list[dict[str, Any]] = []
    try:
        phase = "source-manifest-read"
        high_manifest = read_json(high_manifest_path)
        high_grid = int(high_manifest.get("grid") or 0)
        if high_grid <= 0:
            raise LadderFailure("source-manifest-validate", "High manifest is missing a positive grid.", {"highManifest": str(high_manifest_path)})
        if any(int(grid) >= high_grid for grid in args.target_grid_list):
            raise LadderFailure("argument-validate", "Every target grid must be lower than the high grid.", {
                "highGrid": high_grid,
                "targetGridList": args.target_grid_list,
            })
        for target_grid in args.target_grid_list:
            legs.append(build_leg(args, repo_root, out_dir, high_manifest_path, high_grid, int(target_grid)))
        status = "captured" if any(leg.get("status") == "captured" for leg in legs) else ("planned" if args.dry_run else "failed")
        failure_phase = None if all(leg.get("status") in ("captured", "planned-dry-run") for leg in legs) else "one-or-more-leg-failures"
        report = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": status,
            "failurePhase": failure_phase,
            "capturedAt": now_iso(),
            "authority": AUTHORITY,
            "sourceNote": str(args.source_note),
            "sourceHighHistoryManifest": {
                **file_ref(high_manifest_path),
                "grid": high_grid,
                "schema": high_manifest.get("schema"),
                "identity": high_manifest.get("identity"),
                "routeIdentity": high_manifest.get("routeIdentity"),
                "effectiveRoute": high_manifest.get("effectiveRoute"),
                "backend": high_manifest.get("backend"),
                "deterministicReplay": high_manifest.get("deterministicReplay"),
            },
            "targetGridList": [int(grid) for grid in args.target_grid_list],
            "storageDiscipline": {
                "identity": STORAGE_DISCIPLINE_IDENTITY,
                "policy": "Retain source manifests, leg manifests, selected dense cue packs, checksums, and scale-law summaries; avoid gratuitous non-selected corpse grids when they can be regenerated from recorded manifests and commands.",
                "operatorConstraint": "Box storage pressure is real; this ladder is allowed to run, but artifacts should remain compact and replayable.",
            },
            "trainingRegime": {
                "targetChannelList": str(args.target_channel_list),
                "classifierChannelList": str(args.classifier_channel_list),
                "trainSamples": int(args.train_samples),
                "testSamples": int(args.test_samples),
                "epochs": int(args.epochs),
                "hiddenWidth": int(args.hidden_width),
                "contextRadius": int(args.context_radius),
                "supportSampleFraction": float(args.support_sample_fraction),
                "denseExportChunkSize": int(args.dense_export_chunk_size),
                "seedBase": int(args.seed_base),
            },
            "executionPolicy": {
                "continue-on-leg-failure": bool(args.continue_on_leg_failure),
                "reuseExistingCapturedLegsUnlessForce": not bool(args.force),
                "dryRun": bool(args.dry_run),
            },
            "ladderLegs": legs,
            "selectedCandidateRecommendations": select_candidates(legs),
            "decisionCriteria": [
                "Near-gap candidate improves flame in continuous playback without learned-phase overlay/swim.",
                "Record the flame cliff separately from smoke because smoke may tolerate wider gaps.",
                "If near-gap still swims, change target/loss/receiver objective before blaming browser runtime architecture.",
            ],
            "nonGoals": [
                "not a browser/WebGPU receiver witness",
                "not native-low deployment closure",
                "not a product visual claim",
            ],
        }
        write_json(out_dir / "manifest.json", report)
        print(json.dumps({
            "ok": status in ("captured", "planned"),
            "manifest": str(out_dir / "manifest.json"),
            "status": status,
            "capturedLegs": len([leg for leg in legs if leg.get("status") == "captured"]),
            "selectedCandidateRecommendations": report["selectedCandidateRecommendations"],
        }, indent=2))
        return 0 if status in ("captured", "planned") else 1
    except Exception as err:
        failure_phase = err.phase if isinstance(err, LadderFailure) else phase
        payload = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "failed",
            "failurePhase": failure_phase,
            "capturedAt": now_iso(),
            "authority": AUTHORITY,
            "sourceHighHistoryManifest": str(high_manifest_path),
            "targetGridList": [int(grid) for grid in args.target_grid_list],
            "storageDiscipline": {
                "identity": STORAGE_DISCIPLINE_IDENTITY,
                "policy": "regenerable-intermediates-not-retained-by-default",
            },
            "ladderLegs": legs,
            "message": str(err),
            "details": err.evidence if isinstance(err, LadderFailure) else {},
        }
        write_json(out_dir / "manifest.json", payload)
        print(json.dumps(payload, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
