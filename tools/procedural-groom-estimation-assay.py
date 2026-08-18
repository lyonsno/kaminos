#!/usr/bin/env python3
"""Materialize and resume repeatable procedural-groom VLM→SAM assay arms."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any


CONFIG_SCHEMA = "kaminos.procedural-groom-estimation-assay-config.v0"
MANIFEST_SCHEMA = "kaminos.procedural-groom-estimation-assay-run.v0"
GREENROOM_DEFAULT = Path.home() / "dev" / "gpu-greenroom" / ".venv" / "bin" / "gpu-greenroom"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def repo_path(repo_root: Path, value: str, label: str) -> Path:
    path = (repo_root / value).resolve()
    try:
        path.relative_to(repo_root.resolve())
    except ValueError as error:
        raise ValueError(f"{label} escapes repo root") from error
    return path


def load_config(config_path: Path, repo_root: Path) -> dict[str, Any]:
    config_path = config_path.resolve()
    config = json.loads(config_path.read_text())
    if config.get("schema") != CONFIG_SCHEMA:
        raise ValueError(f"expected config schema {CONFIG_SCHEMA}")
    if not isinstance(config.get("claimCeiling"), str) or not config["claimCeiling"].strip():
        raise ValueError("assay config requires a nonblank claim ceiling")
    arms = config.get("arms")
    if not isinstance(arms, dict) or not arms:
        raise ValueError("assay config requires at least one arm")
    output_roots = [arm.get("outputRoot") for arm in arms.values() if isinstance(arm, dict)]
    if len(output_roots) != len(set(output_roots)):
        raise ValueError("every assay arm requires a distinct output root")
    for label in ("promptPath", "truthRoot"):
        value = config.get(label)
        if not isinstance(value, str) or not value:
            raise ValueError(f"assay config requires {label}")
        path = repo_path(repo_root, value, label)
        if not path.exists():
            raise ValueError(f"{label} is missing: {path}")
    for route_name in ("vlm", "sam"):
        route = config.get(route_name)
        if not isinstance(route, dict):
            raise ValueError(f"assay config requires {route_name} route")
        for field in ("jobType", "model", "backend"):
            if not isinstance(route.get(field), str) or not route[field]:
                raise ValueError(f"{route_name} route requires {field}")
    threshold = config["sam"].get("threshold")
    if not isinstance(threshold, (int, float)) or not 0 < float(threshold) < 1:
        raise ValueError("SAM threshold must be in (0, 1)")
    return config


def load_projector():
    path = Path(__file__).resolve().parent / "prepare-procedural-groom-source-like-vlm-observation.py"
    spec = importlib.util.spec_from_file_location("procedural_groom_source_like_projector", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load observation projector {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def arm_paths(config: dict[str, Any], arm_id: str, repo_root: Path) -> dict[str, Path]:
    arm = config["arms"].get(arm_id)
    if not isinstance(arm, dict):
        raise ValueError(f"unknown assay arm {arm_id}")
    for field in ("sourceLikeObservation", "outputRoot", "expectedObservationId", "controlledDifference"):
        if not isinstance(arm.get(field), str) or not arm[field]:
            raise ValueError(f"assay arm {arm_id} requires {field}")
    source = repo_path(repo_root, arm["sourceLikeObservation"], "source-like observation")
    if not source.is_file() or source.stat().st_size <= 0:
        raise ValueError(f"source-like observation is missing or blank: {source}")
    output = repo_path(repo_root, arm["outputRoot"], "assay output root")
    return {
        "source": source,
        "output": output,
        "observation": output / "observation.json",
        "manifest": output / "run-manifest.json",
        "vlm": output / "vlm-raw",
        "normalized": output / "vlm-raw" / "normalized-inventory.json",
        "seal": output / "vlm-raw" / "proposal-seal.json",
        "sam": output / "sam3-raw",
        "comparison": output / "comparison.json",
    }


def commands(config: dict[str, Any], paths: dict[str, Path], repo_root: Path) -> dict[str, list[str]]:
    greenroom = Path(config.get("greenroomBinary") or GREENROOM_DEFAULT).resolve()
    python = sys.executable
    prompt = repo_path(repo_root, config["promptPath"], "promptPath")
    truth = repo_path(repo_root, config["truthRoot"], "truthRoot")
    return {
        "vlmSubmit": [
            str(greenroom), "submit", config["vlm"]["jobType"],
            str(paths["observation"]), str(paths["vlm"]), "--cwd", str(repo_root.resolve()),
        ],
        "sealProposal": [
            python, str(repo_root / "tools" / "seal-procedural-groom-vlm-proposal.py"),
            "--observation", str(paths["observation"]),
            "--inventory", str(paths["vlm"] / "inventory.json"),
            "--report", str(paths["vlm"] / "report.json"),
            "--output", str(paths["seal"]),
        ],
        "samSubmit": [
            str(greenroom), "submit", config["sam"]["jobType"],
            str(paths["observation"]), str(paths["sam"]),
            "--cwd", str(repo_root.resolve()), "-p",
            f"observation={paths['observation']}",
            f"inventory={paths['normalized']}",
            f"seal={paths['seal']}",
        ],
        "compare": [
            python, str(repo_root / "tools" / "compare-procedural-groom-estimation.py"),
            "--sam-report", str(paths["sam"] / "report.json"),
            "--truth-root", str(truth),
            "--output", str(paths["comparison"]),
        ],
        "directVlmEvidenceCommand": [
            str(prompt), config["vlm"]["model"], config["vlm"]["backend"],
        ],
    }


def command_templates(
    config: dict[str, Any],
    paths: dict[str, Path],
    repo_root: Path,
) -> dict[str, list[str]]:
    """Preserve executable command shape without publishing checkout coordinates."""
    repo_prefix = str(repo_root.resolve())
    greenroom = str(Path(config.get("greenroomBinary") or GREENROOM_DEFAULT).resolve())

    def portable(value: str) -> str:
        if value == sys.executable:
            return "{python}"
        if value == greenroom:
            return "{greenroom}"
        return value.replace(repo_prefix, "{repoRoot}")

    return {
        name: [portable(value) for value in argv]
        for name, argv in commands(config, paths, repo_root).items()
    }


def materialize_run(config_path: Path, arm_id: str, repo_root: Path) -> dict[str, Any]:
    repo_root = repo_root.resolve()
    config_path = config_path.resolve()
    config = load_config(config_path, repo_root)
    arm = config["arms"][arm_id] if arm_id in config["arms"] else None
    if arm is None:
        raise ValueError(f"unknown assay arm {arm_id}")
    paths = arm_paths(config, arm_id, repo_root)
    source = json.loads(paths["source"].read_text())
    if source.get("observationId") != arm["expectedObservationId"]:
        raise ValueError("source-like observation identity does not match the configured arm")
    paths["output"].mkdir(parents=True, exist_ok=True)
    projected = load_projector().project_source_like_observation(paths["source"], paths["observation"])
    manifest = {
        "schema": MANIFEST_SCHEMA,
        "state": "prepared_for_vlm_submission",
        "armId": arm_id,
        "controlledDifference": arm["controlledDifference"],
        "observationId": projected["observationId"],
        "sourceLikeObservation": paths["source"].relative_to(repo_root).as_posix(),
        "sourceLikeObservationSha256": sha256(paths["source"]),
        "projectedObservation": paths["observation"].relative_to(repo_root).as_posix(),
        "projectedObservationSha256": sha256(paths["observation"]),
        "configPath": config_path.relative_to(repo_root).as_posix(),
        "configSha256": sha256(config_path),
        "promptSha256": sha256(repo_path(repo_root, config["promptPath"], "promptPath")),
        "requestedVlm": config["vlm"],
        "requestedSam": config["sam"],
        "truthRoot": config["truthRoot"],
        "claimCeiling": config["claimCeiling"],
        "modelFailureInterpretation": config.get("modelFailureInterpretation"),
        "commandTemplates": command_templates(config, paths, repo_root),
        "visualAdmission": False,
        "scientificAdmission": False,
    }
    write_json(paths["manifest"], manifest)
    return manifest


def next_action(config_path: Path, arm_id: str, repo_root: Path) -> dict[str, Any]:
    config = load_config(config_path.resolve(), repo_root.resolve())
    paths = arm_paths(config, arm_id, repo_root.resolve())
    if not paths["manifest"].is_file():
        return {"state": "unprepared", "nextAction": "prepare"}
    vlm_report = paths["vlm"] / "report.json"
    if not vlm_report.is_file():
        return {"state": "prepared_for_vlm_submission", "nextAction": "submit_vlm"}
    vlm = json.loads(vlm_report.read_text())
    if vlm.get("state") == "failed":
        return {
            "state": "vlm_failed", "nextAction": None,
            "failurePhase": vlm.get("phase"), "error": vlm.get("error"),
        }
    if not (paths["vlm"] / "inventory.json").is_file():
        return {"state": "vlm_terminal_without_inventory", "nextAction": None}
    if not paths["seal"].is_file():
        return {"state": "vlm_captured", "nextAction": "seal_proposal"}
    seal = json.loads(paths["seal"].read_text())
    if seal.get("sealed") is not True:
        return {"state": "proposal_seal_failed", "nextAction": None}
    if not paths["normalized"].is_file():
        return {"state": "proposal_sealed_without_normalized_inventory", "nextAction": None}
    sam_report = paths["sam"] / "report.json"
    if not sam_report.is_file():
        return {"state": "proposal_sealed", "nextAction": "submit_sam"}
    sam = json.loads(sam_report.read_text())
    if sam.get("state") == "failed":
        return {
            "state": "sam_failed", "nextAction": None,
            "failurePhase": sam.get("phase"), "error": sam.get("error"),
        }
    if not paths["comparison"].is_file():
        return {"state": "sam_captured", "nextAction": "compare"}
    return {"state": "comparison_captured", "nextAction": None}


def run_local_phase(config_path: Path, arm_id: str, repo_root: Path, phase: str) -> int:
    config = load_config(config_path.resolve(), repo_root.resolve())
    paths = arm_paths(config, arm_id, repo_root.resolve())
    command_name = {"seal": "sealProposal", "compare": "compare"}[phase]
    live_commands = commands(config, paths, repo_root)
    return subprocess.run(live_commands[command_name], cwd=repo_root).returncode


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    subparsers = parser.add_subparsers(dest="action", required=True)
    for action in ("prepare", "next", "commands", "seal", "compare"):
        sub = subparsers.add_parser(action)
        sub.add_argument("arm")
    args = parser.parse_args()
    if args.action == "prepare":
        result = materialize_run(args.config, args.arm, args.repo_root)
    elif args.action == "next":
        result = next_action(args.config, args.arm, args.repo_root)
    elif args.action == "commands":
        config = load_config(args.config.resolve(), args.repo_root.resolve())
        paths = arm_paths(config, args.arm, args.repo_root.resolve())
        result = {
            key: shlex.join(value)
            for key, value in commands(config, paths, args.repo_root.resolve()).items()
            if key != "directVlmEvidenceCommand"
        }
    else:
        return run_local_phase(args.config, args.arm, args.repo_root.resolve(), args.action)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
