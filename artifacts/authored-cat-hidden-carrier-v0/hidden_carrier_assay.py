"""Durable CPU transaction for the authored-cat hidden-carrier assay.

The transaction deliberately exposes only the displaced observation and its
normals to the recovery arm. The authored carrier and per-vertex coat depths
remain available to the scoring phase, not the recovery call.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from hidden_carrier_fixture import (
    PROFILES,
    build_fixture_contract,
    coat_depths,
    load_glb_surface,
    recover_uniform_inset,
    recovery_metrics,
    synthesize_observation,
)


SCHEMA = "kaminos.authored-cat-hidden-carrier-assay.v0"
ROUTE = "cpu-numpy-authored-cat-hidden-carrier-v0"
RECOVERY_ARM = "uniform-inset-negative-control-v0"
BACKEND = "python-numpy-cpu"
KNOWN_OUTPUTS = ("observation.npz", "recovered-carrier.npz")


class AssayFailure(RuntimeError):
    pass


class AssayArgumentError(RuntimeError):
    pass


class _ReportableArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        raise AssayArgumentError(message)


def _now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False
    )
    temporary = Path(handle.name)
    try:
        with handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _implementation_identity(repo_root):
    repo_root = Path(repo_root).resolve()
    identities = {}
    for name, path in (
        ("runner", Path(__file__).resolve()),
        ("fixture", Path(__file__).resolve().with_name("hidden_carrier_fixture.py")),
    ):
        try:
            locator = path.relative_to(repo_root).as_posix()
        except ValueError as error:
            raise AssayFailure(f"{name} implementation is outside the explicit repo root") from error
        identities[name] = {"path": locator, "sha256": _sha256(path)}
    return identities


def _repo_locator_or_absolute(path, repo_root):
    path = Path(path).resolve()
    try:
        return path.relative_to(Path(repo_root).resolve()).as_posix()
    except ValueError:
        return str(path)


def _write_npz(path, **arrays):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        mode="w+b", dir=path.parent, prefix=f".{path.name}.", delete=False
    )
    temporary = Path(handle.name)
    try:
        with handle:
            np.savez_compressed(handle, **arrays)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _validate_points(name, value, *, count=None):
    points = np.asarray(value)
    if points.ndim != 2 or points.shape[1] != 3 or not len(points):
        raise AssayFailure(f"{name} must have non-empty shape (n, 3)")
    if count is not None and len(points) != count:
        raise AssayFailure(f"{name} cardinality mismatch: {len(points)} != {count}")
    if not np.issubdtype(points.dtype, np.number) or not np.isfinite(points).all():
        raise AssayFailure(f"{name} must contain only finite numeric values")
    return points


def _artifact_info(path, required_arrays, *, expected_count):
    path = Path(path)
    if not path.is_file():
        raise AssayFailure(f"primary artifact is missing: {path.name}")
    byte_length = path.stat().st_size
    if byte_length <= 0:
        raise AssayFailure(f"primary artifact is blank: {path.name}")
    try:
        with np.load(path, allow_pickle=False) as archive:
            missing = sorted(set(required_arrays) - set(archive.files))
            if missing:
                raise AssayFailure(f"{path.name} is partial; missing arrays: {missing}")
            arrays = {
                name: _validate_points(name, archive[name], count=expected_count)
                for name in required_arrays
            }
    except AssayFailure:
        raise
    except Exception as error:
        raise AssayFailure(f"primary artifact is unreadable: {path.name}: {error}") from error
    return {
        "path": path.name,
        "sha256": _sha256(path),
        "byteLength": byte_length,
        "arrays": {
            name: {"shape": list(array.shape), "dtype": str(array.dtype)}
            for name, array in arrays.items()
        },
    }


def _base_report(*, execution_id, started_at, requested, prior_report_sha256):
    return {
        "schema": SCHEMA,
        "executionId": execution_id,
        "status": "running",
        "terminal": False,
        "startedAt": started_at,
        "finishedAt": None,
        "failurePhase": None,
        "reason": None,
        "requestedConfig": requested,
        "effectiveConfig": None,
        "source": None,
        "artifacts": {},
        "metrics": None,
        "lastTrustworthyEvidence": {},
        "priorTerminalReportSha256": prior_report_sha256,
        "truthIsolation": {
            "recoveryInputs": ["observedPositions", "observedNormals", "uniformInset"],
            "withheldUntilScoring": ["authoredCarrierPositions", "perVertexCoatDepths", "regionIds"],
        },
        "claimCeiling": (
            "Source-specific negative-control evidence under a deterministic authored truth "
            "fixture; not volumetric recovery, arbitrary-source fur reconstruction, or visual admission."
        ),
    }


def _finish_report(report_path, state_path, report):
    report["finishedAt"] = _now()
    report["terminal"] = True
    _write_json(report_path, report)
    _write_json(
        state_path,
        {
            "schema": f"{SCHEMA}.run-state",
            "executionId": report["executionId"],
            "status": report["status"],
            "terminal": True,
            "terminalReport": report_path.name,
            "terminalReportSha256": _sha256(report_path),
        },
    )
    return report


def _option_value(argv, option):
    for index, value in enumerate(argv):
        if value == option and index + 1 < len(argv) and not argv[index + 1].startswith("--"):
            return argv[index + 1]
    return None


def _invalidate_known_outputs(output_dir):
    failures = []
    for name in KNOWN_OUTPUTS:
        path = Path(output_dir) / name
        try:
            path.unlink(missing_ok=True)
        except OSError as error:
            failures.append(f"{name}: {type(error).__name__}: {error}")
    return failures


def _argument_failure(*, output_dir, requested, phase, reason):
    if output_dir is None:
        return None
    output_dir = Path(output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "report.json"
    state_path = output_dir / "run-state.json"
    prior_report_sha256 = _sha256(report_path) if report_path.is_file() else None
    report = _base_report(
        execution_id=str(uuid.uuid4()),
        started_at=_now(),
        requested=requested,
        prior_report_sha256=prior_report_sha256,
    )
    report["status"] = "failed"
    report["failurePhase"] = phase
    report["reason"] = reason
    _write_json(report_path, report)
    invalidation_failures = _invalidate_known_outputs(output_dir)
    if invalidation_failures:
        report["reason"] = f"{reason}; could not invalidate primaries: {'; '.join(invalidation_failures)}"
        report["lastTrustworthyEvidence"]["primaryInvalidationFailures"] = invalidation_failures
    return _finish_report(report_path, state_path, report)


def run_assay(
    *,
    repo_root,
    source_path,
    output_dir,
    profile,
    uniform_inset,
    requested_route=ROUTE,
    recovery_arm=RECOVERY_ARM,
):
    requested_repo_root = str(repo_root)
    repo_root = Path(repo_root).expanduser().resolve()
    requested_source = str(source_path)
    source_path = Path(source_path).expanduser().resolve()
    requested_output_dir = str(output_dir)
    output_dir = Path(output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "report.json"
    state_path = output_dir / "run-state.json"
    prior_report_sha256 = _sha256(report_path) if report_path.is_file() else None

    requested = {
        "repoRoot": requested_repo_root,
        "sourcePath": requested_source,
        "outputDir": requested_output_dir,
        "profile": profile,
        "recoveryArm": recovery_arm,
        "uniformInset": uniform_inset,
        "route": requested_route,
    }
    execution_id = str(uuid.uuid4())
    started_at = _now()
    report = _base_report(
        execution_id=execution_id,
        started_at=started_at,
        requested=requested,
        prior_report_sha256=prior_report_sha256,
    )
    report["implementation"] = _implementation_identity(repo_root)
    phase = "output-initialization"
    _write_json(report_path, report)
    _write_json(
        state_path,
        {
            "schema": f"{SCHEMA}.run-state",
            "executionId": execution_id,
            "status": "running",
            "terminal": False,
            "startedAt": started_at,
            "report": report_path.name,
        },
    )

    try:
        phase = "output-initialization"
        invalidation_failures = _invalidate_known_outputs(output_dir)
        if invalidation_failures:
            report["lastTrustworthyEvidence"]["primaryInvalidationFailures"] = invalidation_failures
            raise AssayFailure(
                f"could not invalidate prior primaries: {'; '.join(invalidation_failures)}"
            )
        phase = "route-validation"
        if requested_route != ROUTE:
            raise AssayFailure(
                f"unsupported route {requested_route!r}; no fallback from required route {ROUTE!r}"
            )
        phase = "configuration-validation"
        if profile not in PROFILES:
            raise AssayFailure(f"unknown coat profile: {profile}")
        if recovery_arm != RECOVERY_ARM:
            raise AssayFailure(f"unsupported recovery arm: {recovery_arm}")
        uniform_inset = float(uniform_inset)
        if not np.isfinite(uniform_inset) or uniform_inset < 0.0:
            raise AssayFailure("uniform inset must be finite and nonnegative")

        phase = "source-validation"
        contract = build_fixture_contract(source_path, repo_root=repo_root)
        report["effectiveConfig"] = {
            "route": ROUTE,
            "backend": BACKEND,
            "repoRoot": ".",
            "sourcePath": contract["source"]["path"],
            "outputDir": _repo_locator_or_absolute(output_dir, repo_root),
            "profile": profile,
            "recoveryArm": recovery_arm,
            "uniformInset": uniform_inset,
            "uniformInsetAuthority": "assay-author-explicit-config",
            "uniformInsetCalibration": (
                "fixture-author-selected-from-prior-authored-truth-depth-summary"
            ),
            "sourceLocator": contract["source"]["path"],
            "sourceSha256": contract["source"]["sha256"],
        }
        report["lastTrustworthyEvidence"] = {
            "sourceLocator": contract["source"]["path"],
            "sourceSha256": contract["source"]["sha256"],
            "route": ROUTE,
        }

        phase = "carrier-load"
        surface = load_glb_surface(source_path)
        carrier = _validate_points("authored carrier positions", surface["positions"])
        normals = _validate_points("authored carrier normals", surface["normals"], count=len(carrier))
        report["source"] = {
            **contract["source"],
            "vertexCount": len(carrier),
            "frame": contract["frame"],
        }
        report["lastTrustworthyEvidence"]["vertexCount"] = len(carrier)

        phase = "coat-synthesis"
        depths = coat_depths(carrier, profile)
        observed = synthesize_observation(carrier, normals, depths)
        short_depths = coat_depths(carrier, "short-v0")
        medium = depths > short_depths + np.finfo(np.float64).eps * 32.0
        region_ids = np.where(medium, "medium-scapular", "short-coat")

        phase = "observation-artifact-write"
        observation_path = output_dir / "observation.npz"
        _write_npz(
            observation_path,
            observedPositions=np.asarray(observed, dtype=np.float64),
            observedNormals=np.asarray(normals, dtype=np.float64),
        )
        phase = "observation-artifact-validation"
        report["artifacts"]["observation"] = _artifact_info(
            observation_path,
            ("observedPositions", "observedNormals"),
            expected_count=len(carrier),
        )
        report["lastTrustworthyEvidence"].update(
            {
                "observationSha256": report["artifacts"]["observation"]["sha256"],
                "coatDepthSummary": {
                    "minimum": float(np.min(depths)),
                    "median": float(np.median(depths)),
                    "maximum": float(np.max(depths)),
                },
                "regionCounts": {
                    "short-coat": int(np.count_nonzero(~medium)),
                    "medium-scapular": int(np.count_nonzero(medium)),
                },
            }
        )

        phase = "recovery"
        recovered = recover_uniform_inset(observed, normals, uniform_inset)
        phase = "recovery-validation"
        recovered = _validate_points("recovered carrier positions", recovered, count=len(carrier))

        phase = "recovery-artifact-write"
        recovery_path = output_dir / "recovered-carrier.npz"
        _write_npz(recovery_path, positions=np.asarray(recovered, dtype=np.float64))
        phase = "recovery-artifact-validation"
        report["artifacts"]["recoveredCarrier"] = _artifact_info(
            recovery_path, ("positions",), expected_count=len(carrier)
        )
        report["lastTrustworthyEvidence"]["recoveredCarrierSha256"] = report["artifacts"][
            "recoveredCarrier"
        ]["sha256"]

        phase = "scoring"
        report["metrics"] = recovery_metrics(carrier, recovered, region_ids)
        report["status"] = "captured"
        report["failurePhase"] = None
        report["reason"] = None
        return _finish_report(report_path, state_path, report)
    except Exception as error:
        report["status"] = "failed"
        report["failurePhase"] = phase
        report["reason"] = str(error)
        return _finish_report(report_path, state_path, report)


def main(argv=None):
    raw_argv = list(sys.argv[1:] if argv is None else argv)
    parser = _ReportableArgumentParser(description=__doc__)
    parser.add_argument("--repo-root")
    parser.add_argument("--source")
    parser.add_argument("--output-dir")
    parser.add_argument("--profile")
    parser.add_argument("--uniform-inset", type=float)
    parser.add_argument("--route", default=ROUTE)
    parser.add_argument("--recovery-arm", default=RECOVERY_ARM)
    try:
        args = parser.parse_args(raw_argv)
    except AssayArgumentError as error:
        reason = str(error)
        _argument_failure(
            output_dir=_option_value(raw_argv, "--output-dir"),
            requested={"rawArgv": raw_argv},
            phase="argument-parse",
            reason=reason,
        )
        print(reason, file=sys.stderr)
        return 2
    missing = [
        option
        for option, value in (
            ("--repo-root", args.repo_root),
            ("--source", args.source),
            ("--output-dir", args.output_dir),
            ("--profile", args.profile),
            ("--uniform-inset", args.uniform_inset),
        )
        if value is None
    ]
    if missing:
        reason = f"missing required arguments: {', '.join(missing)}"
        _argument_failure(
            output_dir=args.output_dir,
            requested=vars(args),
            phase="argument-validation",
            reason=reason,
        )
        print(reason, file=sys.stderr)
        return 2
    report = run_assay(
        repo_root=args.repo_root,
        source_path=args.source,
        output_dir=args.output_dir,
        profile=args.profile,
        uniform_inset=args.uniform_inset,
        requested_route=args.route,
        recovery_arm=args.recovery_arm,
    )
    stream = sys.stdout if report["status"] == "captured" else sys.stderr
    print(
        json.dumps(
            {
                "ok": report["status"] == "captured",
                "report": str(Path(args.output_dir).expanduser().resolve() / "report.json"),
                "executionId": report["executionId"],
                "failurePhase": report["failurePhase"],
            },
            indent=2,
        ),
        file=stream,
    )
    return 0 if report["status"] == "captured" else 2


if __name__ == "__main__":
    raise SystemExit(main())
