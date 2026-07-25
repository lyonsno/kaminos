#!/usr/bin/env python3
"""Kaminos dev server with directory browsing API."""

import http.server
import json
import math
import mimetypes
import os
import queue
import re
import secrets
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlencode

PORT = int(sys.argv[1]) if len(sys.argv) > 1 and str(sys.argv[1]).isdigit() else 8090
ROOT = Path(__file__).parent.resolve()
VOLUME_CAPTURE_DIR = ROOT / "artifacts" / "volume-captures"

# Directories the browse API can access
SCENES_DIR = ROOT / "scenes"
SCENES_DIR.mkdir(exist_ok=True)
KAMINOS_ASSETS_DIR = Path(os.environ.get(
    "KAMINOS_ASSETS_DIR",
    os.path.expanduser("~/.local/state/kaminos/assets"),
)).expanduser()
KAMINOS_SPLAT_INBOX_DIR = Path(os.environ.get(
    "KAMINOS_SPLAT_INBOX_DIR",
    str(KAMINOS_ASSETS_DIR / "splats" / "inbox"),
)).expanduser()
KAMINOS_SPLAT_PRODUCTION_DIR = Path(os.environ.get(
    "KAMINOS_SPLAT_PRODUCTION_DIR",
    str(KAMINOS_ASSETS_DIR / "splats" / "production"),
)).expanduser()
KAMINOS_PIPELINE_RUNS_DIR = Path(os.environ.get(
    "KAMINOS_PIPELINE_RUNS_DIR",
    str(KAMINOS_ASSETS_DIR / "pipeline-runs"),
)).expanduser()
KAMINOS_IMAGE_INBOX_DIR = Path(os.environ.get(
    "KAMINOS_IMAGE_INBOX_DIR",
    str(KAMINOS_ASSETS_DIR / "images" / "inbox"),
)).expanduser()
KAMINOS_SHARP_WEBGPU_REPO = Path(os.environ.get(
    "KAMINOS_SHARP_WEBGPU_REPO",
    os.path.expanduser("~/dev/sharp-webgpu"),
)).expanduser().resolve()
KAMINOS_SHARP_WEBGPU_EXPECTED_REVISION_ENV = "KAMINOS_SHARP_WEBGPU_EXPECTED_REVISION"
KAMINOS_SHARP_WEBGPU_EXPECTED_MODULE_SHA256_ENV = "KAMINOS_SHARP_WEBGPU_EXPECTED_MODULE_SHA256"
SHARP_INLINE_MODULE_PATH = KAMINOS_SHARP_WEBGPU_REPO / "dist-inline" / "sharp-inline.js"
SHARP_INLINE_ASSETS_PATH = KAMINOS_SHARP_WEBGPU_REPO / "dist-inline" / "assets"
KAMINOS_SHARP_WEBGPU_WEIGHTS = Path(os.environ.get(
    "KAMINOS_SHARP_WEBGPU_WEIGHTS",
    str(KAMINOS_SHARP_WEBGPU_REPO / "public" / "weights.bin"),
)).expanduser().resolve()
SHARP_INLINE_WEIGHTS_PATH = KAMINOS_SHARP_WEBGPU_WEIGHTS

BROWSE_ROOTS = {
    "scratch": ROOT / "scratch",
    "scenes": SCENES_DIR,
    "splat-inbox": KAMINOS_SPLAT_INBOX_DIR,
    "splat-production": KAMINOS_SPLAT_PRODUCTION_DIR,
    "image-inbox": KAMINOS_IMAGE_INBOX_DIR,
    "pipeline-runs": KAMINOS_PIPELINE_RUNS_DIR,
    "sharp-inline": KAMINOS_SHARP_WEBGPU_REPO,
    "greenroom": Path(os.environ.get(
        "GPU_GREENROOM_DIR",
        os.path.expanduser("~/.local/state/gpu-greenroom"),
    )),
    "lerms-preview": Path(os.environ.get(
        "KAMINOS_LERMS_PREVIEW_ROOT",
        "/private/tmp",
    )),
    "pixal3d": Path(os.path.expanduser("~/dev/pixal3d-mlx/outputs")),
    "trellis2mlx": Path(os.path.expanduser("~/dev/trellis2mlx/assets/outputs")),
}
PIPELINE_SOURCE_ROOT_EXCLUSIONS = {
    "lerms-preview",
}

GREENROOM_STATUS_DIRS = ("done", "failed", "running", "pending", "cancelled")
MESH_EXTENSIONS = {".glb", ".gltf", ".obj", ".ply", ".spz"}
SPLAT_EXTENSIONS = {".ply", ".spz"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
SPLAT_CORRECTION_SCHEMA = "kaminos.splat-correction.v0"
HYBRID_SPLAT_OVERLAY_MODULE_URL_ENV = "KAMINOS_HYBRID_SPLAT_OVERLAY_MODULE_URL"
HYBRID_SPLAT_OVERLAY_MODULE_URL_ENV_LEGACY = "KAMINOS_HYBRID_SPLAT_MODULE_URL"
FORGE_HOST_REGISTRY_SNAPSHOT_SCHEMA = "kaminos.forge-host.registry-snapshot.v0"
FORGE_HOST_ENDPOINT_REGISTRY_PATH = Path(os.environ.get(
    "KAMINOS_FORGE_HOST_ENDPOINT_REGISTRY",
    os.path.expanduser("~/.local/state/epistaxis/directive-alert-endpoints.json"),
)).expanduser()
FORGE_HOST_DIAULOS_REGISTRY_PATH = Path(os.environ.get(
    "KAMINOS_FORGE_HOST_DIAULOS_REGISTRY",
    os.path.expanduser("~/.local/state/epistaxis/directive-state/epistaxis/metadosis/diaulos-registry/diauloi.json"),
)).expanduser()
ASSET_ROOTS = [
    {
        "id": "splat-inbox",
        "label": "Experimental Splat Inbox",
        "kind": "splat",
        "stage": "experimental",
        "path": KAMINOS_SPLAT_INBOX_DIR,
    },
    {
        "id": "splat-production",
        "label": "Production Splats",
        "kind": "splat",
        "stage": "production",
        "path": KAMINOS_SPLAT_PRODUCTION_DIR,
    },
    {
        "id": "image-inbox",
        "label": "Local Image Inbox",
        "kind": "image",
        "stage": "working",
        "path": KAMINOS_IMAGE_INBOX_DIR,
    },
]
for index, extra_root in enumerate(filter(None, os.environ.get("KAMINOS_SPLAT_ASSET_ROOTS", "").split(os.pathsep)), 1):
    root_id = f"splat-extra-{index}"
    root_path = Path(extra_root).expanduser()
    BROWSE_ROOTS[root_id] = root_path
    ASSET_ROOTS.append({
        "id": root_id,
        "label": f"Experimental Splat Root {index}",
        "kind": "splat",
        "stage": "experimental",
        "path": root_path,
    })
JOB_OUTPUT_EVENTS = []
JOB_OUTPUT_EVENTS_LOCK = threading.Lock()
SHARP_INLINE_REPORT_LOCK = threading.Lock()
PIPELINE_MANIFEST_PATH = ROOT / "pipelines" / "asset-pipelines.json"
PIPELINE_WITNESS_PATH = ROOT / "pipeline-witness.mjs"
SHARP_SCHEDULER_PROFILES = {
    "baseline-default": {
        "id": "baseline-default",
        "operatorLabel": "Default",
        "label": "Baseline default SHARP route",
        "scheduler": {"mode": "default"},
        "env": {
            "KAMINOS_SHARP_WEBGPU_SCHEDULER": json.dumps({"mode": "default"}, separators=(",", ":")),
        },
        "proofExpectation": {
            "schedulerVerification": "not-verified-without-observed-events",
            "comparisonRole": "baseline-throughput-and-frame-tail-only",
        },
    },
    "cooperative-spn-gaussian": {
        "id": "cooperative-spn-gaussian",
        "operatorLabel": "Friendly",
        "label": "Cooperative SHARP SPN plus Gaussian phase",
        "scheduler": {
            "mode": "cooperative",
            "spnPatchChunkSize": 1,
            "yieldMs": 4,
            "waitForSubmittedWorkDone": True,
            "gaussianPhaseYieldMs": 4,
            "vitBlockChunkSize": 1,
            "vitMicroduty": True,
            "vitMicrodutyMode": "four-stage",
            "cpuChunkItems": 16384,
            "routeTailYieldMs": 3,
            "spnFusionChunkItems": 524288,
            "decoderKernelChunkItems": 262144,
            "decoderKernelMinChunkItems": 65536,
            "decoderKernelMaxChunkItems": 8388608,
            "decoderKernelTargetDurationMs": 12,
            "decoderKernelAdjustmentGain": 0.375,
            "plyAssemblyMode": "worker",
            "retirePostInferenceBuffers": True,
        },
        "env": {
            "KAMINOS_SHARP_WEBGPU_SCHEDULER": json.dumps({
                "mode": "cooperative",
                "spnPatchChunkSize": 1,
                "yieldMs": 4,
                "waitForSubmittedWorkDone": True,
                "gaussianPhaseYieldMs": 4,
                "vitBlockChunkSize": 1,
                "vitMicroduty": True,
                "vitMicrodutyMode": "four-stage",
                "cpuChunkItems": 16384,
                "routeTailYieldMs": 3,
                "spnFusionChunkItems": 524288,
                "decoderKernelChunkItems": 262144,
                "decoderKernelMinChunkItems": 65536,
                "decoderKernelMaxChunkItems": 8388608,
                "decoderKernelTargetDurationMs": 12,
                "decoderKernelAdjustmentGain": 0.375,
                "plyAssemblyMode": "worker",
                "retirePostInferenceBuffers": True,
            }, separators=(",", ":")),
        },
        "unsupportedFields": [],
        "proofExpectation": {
            "schedulerVerification": "observed-events-plus-boundary-assertions",
            "comparisonRole": "reviewed-spn-tiling-and-vit-microduty-proof",
            "requiredBoundary": "phaseChunkSize.spnFusionOutputItems",
            "minimumRangeEvents": 2,
        },
    },
    "cooperative-fixed-16ms-donation": {
        "id": "cooperative-fixed-16ms-donation",
        "operatorVisible": False,
        "operatorLabel": "Fixed 16 ms donation test",
        "label": "Cooperative SHARP with fixed 16 ms post-drain donation",
        "scheduler": {
            "mode": "cooperative",
            "spnPatchChunkSize": 1,
            "yieldMs": 16,
            "waitForSubmittedWorkDone": True,
            "gaussianPhaseYieldMs": 16,
            "vitBlockChunkSize": 1,
            "vitMicroduty": True,
            "vitMicrodutyMode": "four-stage",
            "cpuChunkItems": 16384,
            "routeTailYieldMs": 16,
            "spnFusionChunkItems": 524288,
            "decoderKernelChunkItems": 262144,
            "decoderKernelMinChunkItems": 65536,
            "decoderKernelMaxChunkItems": 8388608,
            "decoderKernelTargetDurationMs": 12,
            "decoderKernelAdjustmentGain": 0.375,
            "plyAssemblyMode": "worker",
            "retirePostInferenceBuffers": True,
        },
        "env": {
            "KAMINOS_SHARP_WEBGPU_SCHEDULER": json.dumps({
                "mode": "cooperative",
                "spnPatchChunkSize": 1,
                "yieldMs": 16,
                "waitForSubmittedWorkDone": True,
                "gaussianPhaseYieldMs": 16,
                "vitBlockChunkSize": 1,
                "vitMicroduty": True,
                "vitMicrodutyMode": "four-stage",
                "cpuChunkItems": 16384,
                "routeTailYieldMs": 16,
                "spnFusionChunkItems": 524288,
                "decoderKernelChunkItems": 262144,
                "decoderKernelMinChunkItems": 65536,
                "decoderKernelMaxChunkItems": 8388608,
                "decoderKernelTargetDurationMs": 12,
                "decoderKernelAdjustmentGain": 0.375,
                "plyAssemblyMode": "worker",
                "retirePostInferenceBuffers": True,
            }, separators=(",", ":")),
        },
        "unsupportedFields": [],
        "proofExpectation": {
            "schedulerVerification": "observed-events-plus-boundary-assertions",
            "comparisonRole": "fixed-post-drain-donation-experiment",
            "requiredBoundary": "phaseChunkSize.spnFusionOutputItems",
            "minimumRangeEvents": 2,
        },
    },
    "cooperative-spn-fusion-tiles-524288": {
        "id": "cooperative-spn-fusion-tiles-524288",
        "operatorVisible": False,
        "operatorLabel": "SPN fusion tile experiment",
        "label": "Cooperative SHARP with 524288-item SPN fusion output tiles",
        "scheduler": {
            "mode": "cooperative",
            "spnPatchChunkSize": 1,
            "yieldMs": 4,
            "waitForSubmittedWorkDone": True,
            "gaussianPhaseYieldMs": 4,
            "vitBlockChunkSize": 1,
            "vitMicroduty": True,
            "vitMicrodutyMode": "four-stage",
            "cpuChunkItems": 16384,
            "routeTailYieldMs": 3,
            "spnFusionChunkItems": 524288,
            "decoderKernelChunkItems": 262144,
            "decoderKernelMinChunkItems": 65536,
            "decoderKernelMaxChunkItems": 8388608,
            "decoderKernelTargetDurationMs": 12,
            "decoderKernelAdjustmentGain": 0.375,
            "plyAssemblyMode": "worker",
            "retirePostInferenceBuffers": True,
        },
        "env": {
            "KAMINOS_SHARP_WEBGPU_SCHEDULER": json.dumps({
                "mode": "cooperative",
                "spnPatchChunkSize": 1,
                "yieldMs": 4,
                "waitForSubmittedWorkDone": True,
                "gaussianPhaseYieldMs": 4,
                "vitBlockChunkSize": 1,
                "vitMicroduty": True,
                "vitMicrodutyMode": "four-stage",
                "cpuChunkItems": 16384,
                "routeTailYieldMs": 3,
                "spnFusionChunkItems": 524288,
                "decoderKernelChunkItems": 262144,
                "decoderKernelMinChunkItems": 65536,
                "decoderKernelMaxChunkItems": 8388608,
                "decoderKernelTargetDurationMs": 12,
                "decoderKernelAdjustmentGain": 0.375,
                "plyAssemblyMode": "worker",
                "retirePostInferenceBuffers": True,
            }, separators=(",", ":")),
        },
        "unsupportedFields": [],
        "proofExpectation": {
            "schedulerVerification": "observed-events-plus-boundary-assertions",
            "comparisonRole": "promoted-friendly-tiling-compatibility-alias",
            "requiredBoundary": "phaseChunkSize.spnFusionOutputItems",
            "minimumRangeEvents": 2,
        },
    },
}


def _sharp_inline_revision():
    explicit_revision = os.environ.get("KAMINOS_SHARP_WEBGPU_REVISION", "").strip()
    if explicit_revision:
        return explicit_revision
    try:
        result = subprocess.run(
            ["git", "-C", str(KAMINOS_SHARP_WEBGPU_REPO), "rev-parse", "HEAD"],
            capture_output=True,
            check=True,
            text=True,
            timeout=2,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip() or None


def runtime_config():
    """Return runtime-only browser defaults for this dev server instance."""
    module_url = (
        os.environ.get(HYBRID_SPLAT_OVERLAY_MODULE_URL_ENV)
        or os.environ.get(HYBRID_SPLAT_OVERLAY_MODULE_URL_ENV_LEGACY)
        or ""
    ).strip()
    sharp_revision = _sharp_inline_revision()
    expected_sharp_revision = os.environ.get(
        KAMINOS_SHARP_WEBGPU_EXPECTED_REVISION_ENV,
        "",
    ).strip() or None
    revision_matches_expectation = (
        None
        if expected_sharp_revision is None
        else bool(sharp_revision and sharp_revision == expected_sharp_revision)
    )
    if expected_sharp_revision is None:
        revision_contract_status = "unpinned"
    elif not sharp_revision:
        revision_contract_status = "missing"
    elif revision_matches_expectation:
        revision_contract_status = "matched"
    else:
        revision_contract_status = "mismatch"
    revision_contract_allows_registration = (
        expected_sharp_revision is None or revision_matches_expectation is True
    )
    module_exists = SHARP_INLINE_MODULE_PATH.is_file()
    expected_module_sha256 = os.environ.get(
        KAMINOS_SHARP_WEBGPU_EXPECTED_MODULE_SHA256_ENV,
        "",
    ).strip().lower() or None
    module_sha256 = _sha256_file(SHARP_INLINE_MODULE_PATH) if module_exists else None
    module_expectation_valid = (
        expected_module_sha256 is None
        or bool(re.fullmatch(r"[a-f0-9]{64}", expected_module_sha256))
    )
    module_sha256_matches_expectation = (
        None
        if expected_module_sha256 is None
        else bool(
            module_expectation_valid
            and module_sha256
            and module_sha256 == expected_module_sha256
        )
    )
    if expected_module_sha256 is None:
        module_identity_status = "unpinned"
    elif not module_expectation_valid:
        module_identity_status = "invalid-expectation"
    elif not module_sha256:
        module_identity_status = "missing"
    elif module_sha256_matches_expectation:
        module_identity_status = "matched"
    else:
        module_identity_status = "mismatch"
    module_identity_allows_registration = (
        expected_module_sha256 is None
        or module_sha256_matches_expectation is True
    )
    sharp_module_url = (
        f"/sharp-inline/sharp-inline.js?sha256={module_sha256}"
        if module_sha256
        else "/sharp-inline/sharp-inline.js"
    )
    weights_exist = SHARP_INLINE_WEIGHTS_PATH.is_file()
    return {
        "schema": "kaminos.runtime-config.v0",
        "hybridSplatOverlayModuleUrl": module_url or None,
        "sharpInline": {
            "registered": (
                bool(sharp_revision)
                and revision_contract_allows_registration
                and module_identity_allows_registration
                and module_exists
                and weights_exist
            ),
            "repo": str(KAMINOS_SHARP_WEBGPU_REPO),
            "expectedRevision": expected_sharp_revision,
            "revision": sharp_revision,
            "revisionStatus": "resolved" if sharp_revision else "missing",
            "revisionMatchesExpectation": revision_matches_expectation,
            "revisionContractStatus": revision_contract_status,
            "modulePath": str(SHARP_INLINE_MODULE_PATH),
            "moduleExists": module_exists,
            "expectedModuleSha256": expected_module_sha256,
            "moduleSha256": module_sha256,
            "moduleSha256MatchesExpectation": module_sha256_matches_expectation,
            "moduleIdentityStatus": module_identity_status,
            "moduleUrl": sharp_module_url,
            "weightsPath": str(SHARP_INLINE_WEIGHTS_PATH),
            "weightsExists": weights_exist,
            "weightsUrl": "/sharp-inline/weights.bin",
        },
    }


def _read_json_file(path):
    with Path(path).expanduser().open() as handle:
        return json.load(handle)


def _registry_file_status(path):
    resolved = Path(path).expanduser()
    return {
        "path": str(resolved),
        "exists": resolved.exists(),
        "loaded": False,
        "schema": None,
    }


def _diaulos_registry_index(diaulos_registry):
    rows = diaulos_registry.get("diauloi") if isinstance(diaulos_registry, dict) else None
    index = {}
    for row in rows or []:
        handle = row.get("handle")
        if handle:
            index[str(handle)] = row
        for alias in row.get("aliases") or []:
            index[str(alias)] = row
    return index


def build_forge_host_registry_snapshot(
    endpoint_registry_path=FORGE_HOST_ENDPOINT_REGISTRY_PATH,
    diaulos_registry_path=FORGE_HOST_DIAULOS_REGISTRY_PATH,
):
    """Build a source-honest Forge Host view over live Epistaxis registries."""
    loaded_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    warnings = []
    endpoint_status = _registry_file_status(endpoint_registry_path)
    diaulos_status = _registry_file_status(diaulos_registry_path)
    endpoint_registry = None
    diaulos_registry = None

    try:
        endpoint_registry = _read_json_file(endpoint_registry_path)
        endpoint_status["loaded"] = True
        endpoint_status["schema"] = endpoint_registry.get("schema")
    except FileNotFoundError:
        warnings.append(f"endpoint registry missing: {endpoint_status['path']}")
    except json.JSONDecodeError as error:
        warnings.append(f"endpoint registry invalid JSON: {endpoint_status['path']}: {error}")

    try:
        diaulos_registry = _read_json_file(diaulos_registry_path)
        diaulos_status["loaded"] = True
        diaulos_status["schema"] = diaulos_registry.get("schema")
    except FileNotFoundError:
        warnings.append(f"diaulos registry missing: {diaulos_status['path']}")
    except json.JSONDecodeError as error:
        warnings.append(f"diaulos registry invalid JSON: {diaulos_status['path']}: {error}")

    diauloi = _diaulos_registry_index(diaulos_registry or {})
    endpoints = []
    for row in (endpoint_registry or {}).get("endpoints", []):
        if row.get("status") != "active":
            continue
        diaulos = str(row.get("diaulos") or "").strip()
        if not diaulos:
            warnings.append("active endpoint row missing diaulos handle")
            continue
        registry_row = diauloi.get(diaulos) or {}
        endpoints.append({
            "diaulos": diaulos,
            "diaulosId": registry_row.get("id"),
            "status": row.get("status"),
            "observedAt": row.get("observed_at"),
            "endpoint": row.get("endpoint") or {},
            "registryStatus": registry_row.get("status"),
            "sourceTopoi": registry_row.get("source_topoi") or [],
        })

    source_authority = "live_registry" if endpoint_status["loaded"] else "fallback"
    return {
        "schema": FORGE_HOST_REGISTRY_SNAPSHOT_SCHEMA,
        "sourceAuthority": source_authority,
        "loadedAt": loaded_at,
        "endpointRegistry": endpoint_status,
        "diaulosRegistry": diaulos_status,
        "endpoints": endpoints,
        "warnings": warnings,
    }


def splat_asset_root_allows_pointer(root_name):
    return any(root.get("id") == root_name and root.get("kind") == "splat" for root in ASSET_ROOTS)


def _sha256_file(path):
    import hashlib
    digest = hashlib.sha256()
    with Path(path).open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def pipeline_manifest_payload():
    document = json.loads(PIPELINE_MANIFEST_PATH.read_text())
    return {
        **document,
        "manifestPath": str(PIPELINE_MANIFEST_PATH),
        "manifestSha256": _sha256_file(PIPELINE_MANIFEST_PATH),
    }


def _declared_read_roots():
    roots = [ROOT]
    roots.extend(Path(path).expanduser() for path in BROWSE_ROOTS.values())
    return [root.resolve() for root in roots if root.exists()]


def _declared_pipeline_source_roots():
    roots = [ROOT]
    roots.extend(
        Path(path).expanduser()
        for root_id, path in BROWSE_ROOTS.items()
        if root_id not in PIPELINE_SOURCE_ROOT_EXCLUSIONS
    )
    return [root.resolve() for root in roots if root.exists()]


def _resolve_api_read_source(source):
    parsed = urlparse(source)
    if parsed.path != "/api/read":
        raise ValueError("source route must use /api/read")
    params = parse_qs(parsed.query)
    root_name = params.get("root", [""])[0]
    rel_path = params.get("path", [""])[0]
    root = BROWSE_ROOTS.get(root_name)
    if not root:
        raise ValueError(f"Unknown root: {root_name}")
    lexical_target = Path(root).expanduser() / rel_path
    target = lexical_target.resolve()
    if not target.is_relative_to(Path(root).expanduser().resolve()):
        if splat_asset_root_allows_pointer(root_name) and lexical_target.suffix.lower() in SPLAT_EXTENSIONS:
            target = lexical_target
        else:
            raise PermissionError("Path traversal")
    if not target.is_file():
        raise FileNotFoundError(str(target))
    return target.resolve()


def _api_read_source_root(source):
    parsed = urlparse(source)
    if parsed.path != "/api/read":
        raise ValueError("source route must use /api/read")
    params = parse_qs(parsed.query)
    return params.get("root", [""])[0]


def resolve_pipeline_source(payload):
    source = str(payload.get("source") or "").strip()
    source_path = str(payload.get("sourcePath") or "").strip()
    if source.startswith("/api/read"):
        if _api_read_source_root(source) in PIPELINE_SOURCE_ROOT_EXCLUSIONS:
            raise PermissionError("pipeline source must live under declared Kaminos roots")
        target = _resolve_api_read_source(source)
        return {"source": source, "path": str(target)}
    if source_path:
        candidate = Path(source_path).expanduser()
    elif source:
        candidate = Path(source).expanduser()
    else:
        raise ValueError("source or sourcePath required")
    if not candidate.is_absolute():
        candidate = ROOT / candidate
    target = candidate.resolve()
    if not target.is_file():
        raise FileNotFoundError(str(target))
    if not any(target.is_relative_to(root) for root in _declared_pipeline_source_roots()):
        raise PermissionError("pipeline source must live under declared Kaminos roots")
    return {"source": source or source_path, "path": str(target)}


def _default_pipeline_out_dir(pipeline_id):
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", pipeline_id or "pipeline").strip("-") or "pipeline"
    stamp = time.strftime("%Y%m%d-%H%M%S")
    return (KAMINOS_PIPELINE_RUNS_DIR / f"{stamp}-{os.getpid()}-{safe}").resolve()


def write_pipeline_subprocess_failure_report(
    *,
    report_path,
    pipeline_id,
    source,
    command,
    exit_code,
    stdout_tail="",
    stderr_tail="",
    scheduler_profile=None,
    phase="subprocess-exit-before-report",
    wrapper_timeout_seconds=None,
):
    report_path = Path(report_path)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    source_path = source.get("path") if isinstance(source, dict) else None
    source_document = {
        "source": source.get("source") if isinstance(source, dict) else None,
        "path": source_path,
    }
    try:
        source_stat = Path(source_path).stat() if source_path else None
    except OSError:
        source_stat = None
    if source_stat:
        source_document["bytes"] = source_stat.st_size
    report = {
        "schema": "kaminos.pipeline-witness.v0",
        "ok": False,
        "requestedPipelineId": pipeline_id,
        "effectivePipelineId": None,
        "phase": phase,
        "error": (stderr_tail or stdout_tail or f"pipeline witness exited {exit_code} before writing a report").strip().splitlines()[0],
        "failureAuthority": "kaminos.serve.py-subprocess-wrapper.v0",
        "effectiveRouteConfig": {
            "routeId": pipeline_id,
            "manifestPath": str(PIPELINE_MANIFEST_PATH),
            "manifestSha256": None,
            "outputRoot": str(report_path.parent),
            "stageCount": 0,
        },
        "artifacts": {
            "input": {
                "role": "source-image",
                "status": "requested",
                **source_document,
            },
        },
        "stages": [],
        "lastTrustworthyEvidence": {
            "source": source_document,
            "command": command,
            "exitCode": exit_code,
            "schedulerProfileId": scheduler_profile.get("id") if isinstance(scheduler_profile, dict) else None,
            "wrapperTimeoutSeconds": wrapper_timeout_seconds,
        },
        "command": command,
        "exitCode": exit_code,
        "stdoutTail": stdout_tail,
        "stderrTail": stderr_tail,
    }
    report_path.write_text(json.dumps(report, indent=2))
    return report


def pipeline_witness_timeout_seconds(env=None):
    environment = os.environ if env is None else env
    raw = str(environment.get("KAMINOS_PIPELINE_WITNESS_TIMEOUT") or "").strip()
    if not raw:
        return None
    try:
        timeout = float(raw)
    except ValueError as error:
        raise ValueError("KAMINOS_PIPELINE_WITNESS_TIMEOUT must be a positive number of seconds") from error
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValueError("KAMINOS_PIPELINE_WITNESS_TIMEOUT must be a positive number of seconds")
    return timeout


def terminate_pipeline_process_group(proc, grace_seconds=1.0):
    if proc.poll() is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        proc.wait(timeout=grace_seconds)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            return
        proc.wait()


def resolve_sharp_scheduler_profile(profile_id):
    requested = str(profile_id or "").strip()
    if not requested:
        return None
    profile = SHARP_SCHEDULER_PROFILES.get(requested)
    if not profile:
        raise ValueError(f"Unknown SHARP scheduler profile: {requested}")
    return json.loads(json.dumps(profile))


def pipeline_witness_env_for_payload(payload):
    profile = resolve_sharp_scheduler_profile(payload.get("schedulerProfileId") or payload.get("scheduler_profile_id"))
    if not profile:
        return {}, None
    return dict(profile.get("env") or {}), profile


def run_pipeline_witness(payload):
    pipeline_id = str(payload.get("pipelineId") or payload.get("pipeline_id") or "").strip()
    if not pipeline_id:
        raise ValueError("pipelineId required")
    source = resolve_pipeline_source(payload)
    env_patch, scheduler_profile = pipeline_witness_env_for_payload(payload)
    out_dir_raw = str(payload.get("outDir") or payload.get("out_dir") or "").strip()
    out_dir = Path(out_dir_raw).expanduser() if out_dir_raw else _default_pipeline_out_dir(pipeline_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / "pipeline-witness.json"
    command = [
        os.environ.get("KAMINOS_NODE", "node"),
        str(PIPELINE_WITNESS_PATH),
        "--manifest", str(PIPELINE_MANIFEST_PATH),
        "--pipeline-id", pipeline_id,
        "--input", source["path"],
        "--out-dir", str(out_dir),
        "--report", str(report_path),
    ]
    timeout = pipeline_witness_timeout_seconds()
    proc = subprocess.Popen(
        command,
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env={**os.environ, **env_patch},
        start_new_session=True,
    )
    timed_out = False
    try:
        stdout, stderr = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        terminate_pipeline_process_group(proc)
        stdout, stderr = proc.communicate()
    report = json.loads(report_path.read_text()) if report_path.exists() and not timed_out else None
    if timed_out:
        report = write_pipeline_subprocess_failure_report(
            report_path=report_path,
            pipeline_id=pipeline_id,
            source=source,
            command=command,
            exit_code=proc.returncode,
            stdout_tail=stdout[-4000:],
            stderr_tail=f"pipeline witness wrapper timed out after {timeout} seconds\n{stderr}"[-4000:],
            scheduler_profile=scheduler_profile,
            phase="pipeline-witness-wrapper-timeout",
            wrapper_timeout_seconds=timeout,
        )
    elif report is None and proc.returncode != 0:
        report = write_pipeline_subprocess_failure_report(
            report_path=report_path,
            pipeline_id=pipeline_id,
            source=source,
            command=command,
            exit_code=proc.returncode,
            stdout_tail=stdout[-4000:],
            stderr_tail=stderr[-4000:],
            scheduler_profile=scheduler_profile,
        )
    bundle_path = Path(report["bundleIndex"]["path"]) if report and report.get("bundleIndex") else None
    bundle = json.loads(bundle_path.read_text()) if bundle_path and bundle_path.exists() else None
    return {
        "schema": "kaminos.pipeline-run-result.v0",
        "ok": proc.returncode == 0 and bool(report and report.get("ok")),
        "pipelineId": pipeline_id,
        "schedulerProfile": scheduler_profile,
        "source": source,
        "command": command,
        "exitCode": proc.returncode,
        "stdoutTail": stdout[-4000:],
        "stderrTail": stderr[-4000:],
        "report": {
            "path": str(report_path),
            "document": report,
        },
        "bundle": {
            "path": str(bundle_path) if bundle_path else None,
            "document": bundle,
        },
    }


def _pipeline_progress_event_from_line(line, stream_name):
    text = str(line or "").strip()
    if not text:
        return None
    try:
        event = json.loads(text)
    except json.JSONDecodeError:
        return None
    if event.get("schema") != "kaminos.pipeline-progress.v0":
        return None
    return {
        **event,
        "schema": "kaminos.pipeline-progress.v0",
        "kind": event.get("kind") or "pipeline-progress",
        "stream": stream_name,
    }


def _write_pipeline_stream_event(handler, event):
    body = (json.dumps(event, separators=(",", ":")) + "\n").encode()
    handler.wfile.write(body)
    handler.wfile.flush()


def run_pipeline_witness_stream(handler, payload):
    pipeline_id = str(payload.get("pipelineId") or payload.get("pipeline_id") or "").strip()
    if not pipeline_id:
        raise ValueError("pipelineId required")
    source = resolve_pipeline_source(payload)
    env_patch, scheduler_profile = pipeline_witness_env_for_payload(payload)
    out_dir_raw = str(payload.get("outDir") or payload.get("out_dir") or "").strip()
    out_dir = Path(out_dir_raw).expanduser() if out_dir_raw else _default_pipeline_out_dir(pipeline_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / "pipeline-witness.json"
    command = [
        os.environ.get("KAMINOS_NODE", "node"),
        str(PIPELINE_WITNESS_PATH),
        "--manifest", str(PIPELINE_MANIFEST_PATH),
        "--pipeline-id", pipeline_id,
        "--input", source["path"],
        "--out-dir", str(out_dir),
        "--report", str(report_path),
    ]
    timeout = pipeline_witness_timeout_seconds()
    proc = subprocess.Popen(
        command,
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        env={**os.environ, **env_patch, "KAMINOS_PIPELINE_PROGRESS_STREAM": "1"},
        start_new_session=True,
    )
    events = queue.Queue()
    stdout_chunks = []
    stderr_chunks = []

    def reader(pipe, stream_name, chunks):
        try:
            for line in iter(pipe.readline, ""):
                chunks.append(line)
                event = _pipeline_progress_event_from_line(line, stream_name)
                if event:
                    events.put(event)
        finally:
            pipe.close()

    threads = [
        threading.Thread(target=reader, args=(proc.stdout, "stdout", stdout_chunks), daemon=True),
        threading.Thread(target=reader, args=(proc.stderr, "stderr", stderr_chunks), daemon=True),
    ]
    for thread in threads:
        thread.start()
    started = time.monotonic()
    timed_out = False
    while proc.poll() is None:
        if timeout is not None and time.monotonic() - started > timeout:
            timed_out = True
            terminate_pipeline_process_group(proc)
            break
        try:
            _write_pipeline_stream_event(handler, events.get(timeout=0.05))
        except queue.Empty:
            pass
    for thread in threads:
        thread.join(timeout=1)
    while True:
        try:
            _write_pipeline_stream_event(handler, events.get_nowait())
        except queue.Empty:
            break

    stdout_tail = "".join(stdout_chunks)[-4000:]
    stderr_tail = "".join(stderr_chunks)[-4000:]
    report = json.loads(report_path.read_text()) if report_path.exists() and not timed_out else None
    if timed_out:
        report = write_pipeline_subprocess_failure_report(
            report_path=report_path,
            pipeline_id=pipeline_id,
            source=source,
            command=command,
            exit_code=proc.returncode,
            stdout_tail=stdout_tail,
            stderr_tail=f"pipeline witness wrapper timed out after {timeout} seconds\n{stderr_tail}"[-4000:],
            scheduler_profile=scheduler_profile,
            phase="pipeline-witness-wrapper-timeout",
            wrapper_timeout_seconds=timeout,
        )
    elif report is None and proc.returncode != 0:
        report = write_pipeline_subprocess_failure_report(
            report_path=report_path,
            pipeline_id=pipeline_id,
            source=source,
            command=command,
            exit_code=proc.returncode,
            stdout_tail=stdout_tail,
            stderr_tail=stderr_tail,
            scheduler_profile=scheduler_profile,
        )
    bundle_path = Path(report["bundleIndex"]["path"]) if report and report.get("bundleIndex") else None
    bundle = json.loads(bundle_path.read_text()) if bundle_path and bundle_path.exists() else None
    result = {
        "schema": "kaminos.pipeline-run-result.v0",
        "kind": "pipeline-result",
        "ok": proc.returncode == 0 and bool(report and report.get("ok")),
        "pipelineId": pipeline_id,
        "schedulerProfile": scheduler_profile,
        "source": source,
        "command": command,
        "exitCode": proc.returncode,
        "stdoutTail": stdout_tail,
        "stderrTail": stderr_tail,
        "report": {
            "path": str(report_path),
            "document": report,
        },
        "bundle": {
            "path": str(bundle_path) if bundle_path else None,
            "document": bundle,
        },
    }
    _write_pipeline_stream_event(handler, result)
    return result


def _clean_label(value, fallback="Untitled"):
    text = str(value or "").strip()
    if not text:
        return fallback
    stem = Path(text).stem if ("/" in text or "\\" in text or "." in Path(text).name) else text
    words = []
    for token in stem.replace("-", " ").replace("_", " ").split():
        if token.isupper() and len(token) <= 4:
            words.append(token)
        elif token.lower() in {"mlx", "qem", "glb", "obj", "vs3d"}:
            words.append(token.upper() if token.lower() in {"mlx", "glb", "obj"} else token.capitalize())
        else:
            words.append(token.capitalize())
    return " ".join(words) or fallback


def _receipt_params(receipt):
    params = receipt.get("params") if isinstance(receipt, dict) else None
    return params if isinstance(params, dict) else {}


def _first_present(*values):
    for value in values:
        if value not in (None, ""):
            return value
    return None


def _count_mesh_outputs(output_files):
    return len([
        name for name in (output_files or [])
        if Path(str(name)).suffix.lower() in MESH_EXTENSIONS
    ])


def _output_count_label(count):
    if count == 1:
        return "1 output"
    return f"{count} outputs"


def build_display_metadata(entry_name, *, entry_type, receipt=None, output_files=None, size=None):
    """Build deterministic human-facing labels while preserving raw identity."""
    receipt = receipt if isinstance(receipt, dict) else {}
    params = _receipt_params(receipt)
    input_value = _first_present(
        receipt.get("input_name"),
        receipt.get("input_path"),
        receipt.get("prompt"),
        receipt.get("name"),
        receipt.get("output_dir"),
        entry_name,
    )
    job_type = receipt.get("job_type")
    job_type_label = _clean_label(job_type, "Job") if job_type else None
    title = _clean_label(input_value, _clean_label(entry_name, "Untitled"))
    seed = _first_present(params.get("seed"), receipt.get("seed"))
    timestamp = _first_present(receipt.get("finished_at"), receipt.get("created_at"), receipt.get("started_at"))
    output_count = len(output_files or [])

    subtitle_parts = []
    if job_type_label:
        subtitle_parts.append(job_type_label)
    if seed is not None:
        subtitle_parts.append(f"seed {seed}")
    if output_count:
        subtitle_parts.append(_output_count_label(output_count))
    if timestamp:
        subtitle_parts.append(str(timestamp)[:19].replace("T", " "))
    if size is not None and entry_type == "file":
        subtitle_parts.append(str(size))

    mesh_count = _count_mesh_outputs(output_files)
    return {
        "title": title,
        "subtitle": " / ".join(subtitle_parts),
        "meta": f"raw {entry_name}",
        "raw_name": entry_name,
        "job_type": job_type,
        "job_type_label": job_type_label,
        "input_label": _clean_label(input_value, ""),
        "seed": str(seed) if seed is not None else None,
        "output_count": output_count,
        "mesh_output_count": mesh_count,
        "load_label": "Load mesh" if mesh_count or Path(entry_name).suffix.lower() in MESH_EXTENSIONS else "Open",
    }


def build_output_display_metadata(entry_name, *, job_display=None, size=None):
    job_display = job_display if isinstance(job_display, dict) else {}
    ext = Path(entry_name).suffix.lower().lstrip(".").upper() or "FILE"
    seed = job_display.get("seed")
    title_root = job_display.get("title") or _clean_label(entry_name)
    is_mesh = Path(entry_name).suffix.lower() in MESH_EXTENSIONS
    if is_mesh and Path(entry_name).stem.lower().startswith("seed-") and title_root:
        title = f"{title_root} Mesh"
    else:
        title = _clean_label(entry_name)
    subtitle_parts = [ext]
    if seed:
        subtitle_parts.append(f"seed {seed}")
    if size is not None:
        subtitle_parts.append(_format_size(size))
    return {
        "title": title,
        "subtitle": " / ".join(subtitle_parts),
        "meta": f"raw {entry_name}",
        "raw_name": entry_name,
        "load_label": "Load mesh" if is_mesh else "Open",
    }


def build_asset_display_metadata(path, *, root_label, stage, size=None):
    ext = path.suffix.lower().lstrip(".").upper() or "FILE"
    subtitle_parts = [ext, stage, root_label]
    size_label = _format_size(size)
    if size_label:
        subtitle_parts.append(size_label)
    return {
        "title": _clean_label(path.name, "Untitled Splat"),
        "subtitle": " / ".join(subtitle_parts),
        "meta": f"raw {path.name}",
        "raw_name": path.name,
        "load_label": "Import Splat",
        "stage": stage,
        "root_label": root_label,
    }


def inspect_splat_renderability(path):
    suffix = Path(path).suffix.lower()
    if suffix == ".spz":
        return {
            "schema": "kaminos.splat-renderability.v0",
            "status": "likely-splat",
            "previewState": "not-rendered",
            "reason": "SPZ files are treated as splat assets; no thumbnail preview has been rendered.",
        }
    if suffix != ".ply":
        return {
            "schema": "kaminos.splat-renderability.v0",
            "status": "unknown",
            "previewState": "not-rendered",
            "reason": f"{suffix or 'unknown'} files are indexed but not inspected as PLY splats.",
        }
    try:
        header = Path(path).read_bytes()[:32768].decode("utf-8", errors="ignore").lower()
    except OSError as error:
        return {
            "schema": "kaminos.splat-renderability.v0",
            "status": "unknown",
            "previewState": "not-rendered",
            "reason": f"Could not inspect PLY header: {error}",
        }
    gaussian_markers = ("property float opacity", "property float scale_0", "property float rot_0")
    color_markers = ("property float f_dc_0", "property uchar red")
    if all(marker in header for marker in gaussian_markers) and any(marker in header for marker in color_markers):
        return {
            "schema": "kaminos.splat-renderability.v0",
            "status": "splat-header-like",
            "previewState": "not-rendered",
            "reason": "PLY header contains common gaussian splat properties; this is not a verified render and no thumbnail preview has been rendered.",
        }
    return {
        "schema": "kaminos.splat-renderability.v0",
        "status": "not-splat-like",
        "previewState": "not-rendered",
        "reason": "PLY header does not contain common gaussian splat properties; it may be a mesh stub or non-renderable fixture.",
    }


def _format_size(size):
    try:
        size = int(size)
    except (TypeError, ValueError):
        return ""
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size / (1024 * 1024):.1f} MB"


def list_asset_entries(kind="splat"):
    """List declared Kaminos asset roots without scanning outside them."""
    entries = []
    for root in ASSET_ROOTS:
        if kind not in ("all", root.get("kind")):
            continue
        root_id = root["id"]
        root_path = Path(root["path"]).expanduser()
        if not root_path.is_dir():
            continue
        if root.get("kind") == "splat":
            suffixes = SPLAT_EXTENSIONS
        elif root.get("kind") == "image":
            suffixes = IMAGE_EXTENSIONS
        else:
            suffixes = MESH_EXTENSIONS
        for path in sorted(root_path.rglob("*")):
            if any(part.startswith(".") for part in path.relative_to(root_path).parts):
                continue
            if not path.is_file() or path.suffix.lower() not in suffixes:
                continue
            entries.append(build_asset_entry(root, path))
    return entries


def build_asset_entry(root, path):
    root_id = root["id"]
    root_path = Path(root["path"]).expanduser()
    path = Path(path)
    try:
        rel_path = path.relative_to(root_path).as_posix()
    except ValueError:
        rel_path = path.relative_to(root_path.resolve()).as_posix()
    size = path.stat().st_size
    kind = root.get("kind")
    correction_document = load_splat_asset_correction(root_id, rel_path) if kind == "splat" else None
    display = build_asset_display_metadata(
        path,
        root_label=root.get("label") or root_id,
        stage=root.get("stage", "experimental"),
        size=size,
    )
    if kind == "image":
        display["load_label"] = "Use Image"
    return {
        "id": f"{root_id}:{rel_path}",
        "kind": kind,
        "stage": root.get("stage", "experimental"),
        "root_id": root_id,
        "root_label": root.get("label") or root_id,
        "name": path.name,
        "path": rel_path,
        "size": size,
        "mtime": path.stat().st_mtime,
        "source": "/api/read?" + urlencode({"root": root_id, "path": rel_path}),
        "correction": correction_document.get("correction") if correction_document else None,
        "display": display,
        "renderability": inspect_splat_renderability(path) if kind == "splat" else {
            "schema": "kaminos.image-preview.v0",
            "status": "image",
            "previewState": "direct-read",
            "reason": "Local image asset served through /api/read for graph input.",
        },
    }


def splat_asset_root(root_id):
    for root in ASSET_ROOTS:
        if root.get("id") == root_id and root.get("kind") == "splat":
            return root
    return None


def _asset_relative_path(rel_path):
    rel = Path(str(rel_path or ""))
    if rel.is_absolute() or any(part == ".." for part in rel.parts):
        raise PermissionError("Path traversal")
    return rel


def resolve_splat_asset_path(root_id, rel_path):
    root = splat_asset_root(root_id)
    if not root:
        raise FileNotFoundError(f"splat asset root not configured: {root_id}")
    root_path = Path(root["path"]).expanduser().resolve()
    target = root_path / _asset_relative_path(rel_path)
    if target.suffix.lower() not in SPLAT_EXTENSIONS:
        raise ValueError(f"Unsupported splat asset extension: {target.suffix or 'missing'}")
    if not target.is_file():
        raise FileNotFoundError("splat asset not found")
    return root, root_path, target


def splat_correction_sidecar_path(asset_path):
    return asset_path.with_name(asset_path.name + ".kaminos-splat.json")


def _number_list(value, *, length, fallback):
    if not isinstance(value, list) or len(value) != length:
        return list(fallback)
    try:
        parsed = [float(item) for item in value]
    except (TypeError, ValueError):
        return list(fallback)
    return parsed if all(item == item and item not in (float("inf"), float("-inf")) for item in parsed) else list(fallback)


def _axis_flips(value):
    return [-1 if item < 0 else 1 for item in _number_list(value, length=3, fallback=[1, 1, 1])]


def normalize_splat_asset_correction(payload):
    source = payload if isinstance(payload, dict) else {}
    orientation = source.get("orientation") if isinstance(source.get("orientation"), dict) else {}
    crop = source.get("crop") if isinstance(source.get("crop"), dict) else {}
    return {
        "orientation": {
            "rotation": _number_list(orientation.get("rotation"), length=3, fallback=[0, 0, 0]),
        },
        "axisFlips": _axis_flips(source.get("axisFlips")),
        "centroidOffset": _number_list(source.get("centroidOffset"), length=3, fallback=[0, 0, 0]),
        "crop": {
            "enabled": bool(crop.get("enabled", False)),
            "min": _number_list(crop.get("min"), length=3, fallback=[-0.5, -0.5, -0.5]),
            "max": _number_list(crop.get("max"), length=3, fallback=[0.5, 0.5, 0.5]),
        },
    }


def load_splat_asset_correction(root_id, rel_path):
    try:
        root, root_path, asset_path = resolve_splat_asset_path(root_id, rel_path)
    except (FileNotFoundError, PermissionError, ValueError):
        return None
    sidecar = splat_correction_sidecar_path(asset_path)
    if not sidecar.is_file():
        return None
    try:
        document = json.loads(sidecar.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    if document.get("schema") != SPLAT_CORRECTION_SCHEMA:
        return None
    correction = normalize_splat_asset_correction(document.get("correction"))
    return {
        "schema": SPLAT_CORRECTION_SCHEMA,
        "root_id": root.get("id") or root_id,
        "path": asset_path.relative_to(root_path).as_posix(),
        "source": "/api/read?" + urlencode({"root": root.get("id") or root_id, "path": asset_path.relative_to(root_path).as_posix()}),
        "correction": correction,
        "updatedAt": document.get("updatedAt"),
    }


def save_splat_asset_correction(root_id, rel_path, payload):
    root, root_path, asset_path = resolve_splat_asset_path(root_id, rel_path)
    rel = asset_path.relative_to(root_path).as_posix()
    document = {
        "schema": SPLAT_CORRECTION_SCHEMA,
        "root_id": root.get("id") or root_id,
        "path": rel,
        "source": "/api/read?" + urlencode({"root": root.get("id") or root_id, "path": rel}),
        "correction": normalize_splat_asset_correction(payload),
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    splat_correction_sidecar_path(asset_path).write_text(json.dumps(document, indent=2))
    return document


def splat_inbox_root():
    for root in ASSET_ROOTS:
        if root.get("id") == "splat-inbox" and root.get("kind") == "splat":
            return root
    return None


def sanitize_splat_filename(filename):
    raw_name = Path(str(filename or "splat.ply")).name
    ext = Path(raw_name).suffix.lower()
    if ext not in SPLAT_EXTENSIONS:
        raise ValueError(f"Unsupported splat asset extension: {ext or 'missing'}")
    stem = Path(raw_name).stem.strip() or "splat"
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip(".-_") or "splat"
    return f"{stem.lower()}{ext}"


def ingest_splat_asset(filename, content):
    root = splat_inbox_root()
    if not root:
        raise FileNotFoundError("splat-inbox root is not configured")
    root_path = Path(root["path"]).expanduser()
    root_path.mkdir(parents=True, exist_ok=True)
    safe_name = sanitize_splat_filename(filename)
    target = (root_path / safe_name).resolve()
    if not target.is_relative_to(root_path.resolve()):
        raise PermissionError("Path traversal")
    target.write_bytes(content)
    sidecar = splat_correction_sidecar_path(target)
    if sidecar.exists():
        sidecar.unlink()
    entry = build_asset_entry(root, target)
    entry["sha256"] = _sha256_file(target)
    entry["bytes"] = target.stat().st_size
    entry["status"] = "real"
    return entry


def greenroom_output_roots():
    """Roots that can lawfully serve receipt output_dir files."""
    roots = [Path.home().resolve()]
    greenroom = BROWSE_ROOTS.get("greenroom")
    if greenroom:
        roots.append(greenroom.resolve())
    return roots


def resolve_greenroom_output_dir(output_dir):
    """Resolve a receipt output_dir only if it is under a serving root."""
    if not output_dir:
        return None
    output_resolved = Path(output_dir).resolve()
    if not output_resolved.is_dir():
        return None
    if any(output_resolved.is_relative_to(root) for root in greenroom_output_roots()):
        return output_resolved
    return None


def list_greenroom_output_files(receipt):
    output_dir = resolve_greenroom_output_dir((receipt or {}).get("output_dir"))
    if not output_dir:
        return []
    return [
        f.name for f in sorted(output_dir.iterdir())
        if f.is_file() and not f.name.startswith(".")
    ]


def find_greenroom_receipt(job_id):
    greenroom = BROWSE_ROOTS.get("greenroom")
    if not greenroom or not greenroom.exists():
        return None
    for status_dir in GREENROOM_STATUS_DIRS:
        receipt_path = (greenroom / status_dir / job_id / "receipt.json").resolve()
        status_root = (greenroom / status_dir).resolve()
        if not receipt_path.is_relative_to(status_root):
            continue
        if receipt_path.exists():
            return json.loads(receipt_path.read_text())
    return None


def greenroom_job_output_delay_seconds(job_id, filename):
    config = os.environ.get("KAMINOS_JOB_OUTPUT_DELAY_MS_BY_JOB", "")
    for item in config.split(","):
        if ":" not in item:
            continue
        key, value = item.split(":", 1)
        key = key.strip()
        if key not in {job_id, filename, f"{job_id}/{filename}"}:
            continue
        try:
            return max(0.0, float(value.strip()) / 1000.0)
        except ValueError:
            return 0.0
    return 0.0


def record_job_output_event(event):
    with JOB_OUTPUT_EVENTS_LOCK:
        JOB_OUTPUT_EVENTS.append(event)


def _safe_sharp_inline_name(value):
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", str(value)).strip("-") or "firing"


def _utc_timestamp():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _atomic_write_json(path, document):
    temporary_path = path.with_name(f".{path.name}.{secrets.token_hex(6)}.tmp")
    with temporary_path.open("w", encoding="utf-8") as stream:
        json.dump(document, stream, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary_path.replace(path)


def write_sharp_inline_report_state(run_dir, state):
    _atomic_write_json(run_dir / "sharp-inline-report-state.json", state)


def load_sharp_inline_report_state(session_id):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", session_id):
        raise ValueError("Invalid SHARP inline report sessionId")
    pipeline_runs_root = KAMINOS_PIPELINE_RUNS_DIR.resolve()
    run_dir = (pipeline_runs_root / session_id).resolve()
    if run_dir.parent != pipeline_runs_root:
        raise ValueError("SHARP inline report session escaped pipeline-runs")
    state_path = run_dir / "sharp-inline-report-state.json"
    if not state_path.is_file():
        raise ValueError(f"Unknown SHARP inline report session: {session_id}")
    try:
        state = json.loads(state_path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Unreadable SHARP inline report state: {error}") from error
    if state.get("sessionId") != session_id:
        raise ValueError("SHARP inline report state session identity mismatch")
    return run_dir, state


def _pipeline_run_read_url(path):
    relative_path = path.resolve().relative_to(KAMINOS_PIPELINE_RUNS_DIR.resolve())
    return f"/api/read?root=pipeline-runs&path={urlencode({'path': str(relative_path)})[5:]}"


def _inspect_ndjson_file(path):
    import hashlib
    digest = hashlib.sha256()
    byte_count = 0
    row_count = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            byte_count += len(chunk)
            row_count += chunk.count(b"\n")
            digest.update(chunk)
    return {
        "bytes": byte_count,
        "rows": row_count,
        "sha256": digest.hexdigest(),
    }


def _sharp_inline_complete_receipt(run_dir, state):
    report_path = run_dir / "sharp-inline-report.json"
    return {
        "schema": "kaminos.sharp-inline-run-report-receipt.v0",
        "status": "complete",
        "sessionId": state["sessionId"],
        "path": str(report_path),
        "outputRoot": str(run_dir),
        "readUrl": _pipeline_run_read_url(report_path),
        "writtenAt": state.get("completedAt"),
        "traceArtifacts": state.get("traceArtifacts") or {},
    }


class KaminosHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/runtime-config":
            self.handle_runtime_config()
        elif parsed.path == "/api/pipeline-manifest":
            self.handle_pipeline_manifest()
        elif parsed.path == "/api/browse":
            self.handle_browse(parse_qs(parsed.query))
        elif parsed.path == "/api/assets":
            self.handle_assets(parse_qs(parsed.query))
        elif parsed.path == "/api/splat-correction":
            self.handle_splat_correction_get(parse_qs(parsed.query))
        elif parsed.path == "/api/forge-host/registry":
            self.handle_forge_host_registry()
        elif parsed.path == "/api/volume-capture":
            self.handle_volume_capture_get(parse_qs(parsed.query))
        elif parsed.path == "/api/volume-captures":
            self.handle_volume_captures()
        elif parsed.path == "/api/roots":
            self.handle_roots()
        elif parsed.path.startswith("/api/read"):
            self.handle_read(parse_qs(parsed.query))
        elif parsed.path == "/api/job-output-events":
            self.handle_job_output_events(parse_qs(parsed.query))
        elif parsed.path == "/api/job-outputs":
            self.handle_job_outputs(parse_qs(parsed.query))
        elif parsed.path.startswith("/api/job-output"):
            self.handle_job_output(parse_qs(parsed.query))
        elif parsed.path == "/api/delete-scene":
            self.handle_delete_scene(parse_qs(parsed.query))
        elif parsed.path.startswith("/sharp-inline/"):
            self.handle_sharp_inline_file(parsed.path)
        else:
            super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/save-scene":
            self.handle_save_scene()
        elif parsed.path == "/api/run-pipeline":
            self.handle_run_pipeline()
        elif parsed.path == "/api/ingest-splat":
            self.handle_ingest_splat(parse_qs(parsed.query))
        elif parsed.path == "/api/sharp-inline-run-report":
            self.handle_sharp_inline_run_report()
        elif parsed.path == "/api/sharp-inline-run-report/start":
            self.handle_sharp_inline_run_report_start()
        elif parsed.path == "/api/sharp-inline-run-report/chunk":
            self.handle_sharp_inline_run_report_chunk()
        elif parsed.path == "/api/sharp-inline-run-report/finish":
            self.handle_sharp_inline_run_report_finish()
        elif parsed.path == "/api/sharp-inline-run-report/abort":
            self.handle_sharp_inline_run_report_abort()
        elif parsed.path == "/api/splat-correction":
            self.handle_splat_correction_post(parse_qs(parsed.query))
        elif parsed.path == "/api/volume-capture":
            self.handle_volume_capture()
        else:
            self.send_json({"error": "Not found"}, 404)

    def handle_runtime_config(self):
        self.send_json(runtime_config())

    def handle_sharp_inline_run_report(self):
        try:
            payload = self.read_json_body()
        except ValueError as error:
            self.send_json({"error": str(error)}, 400)
            return
        document = payload.get("document") if isinstance(payload, dict) else None
        if not isinstance(document, dict):
            self.send_json({"error": "SHARP inline report document must be a JSON object"}, 400)
            return
        pipeline_id = str(payload.get("pipelineId") or "sharp-image-to-splat-live-v0")
        firing_id = re.sub(r"[^A-Za-z0-9_.-]+", "-", str(payload.get("firingId") or "firing")).strip("-") or "firing"
        stamp = time.strftime("%Y%m%d-%H%M%S")
        run_dir = (KAMINOS_PIPELINE_RUNS_DIR / f"{stamp}-{time.time_ns()}-{os.getpid()}-{firing_id}").resolve()
        report_path = run_dir / "sharp-inline-report.json"
        try:
            run_dir.mkdir(parents=True, exist_ok=False)
            document = {
                **document,
                "pipelineId": document.get("pipelineId") or pipeline_id,
                "outputRoot": str(run_dir),
                "reportPath": str(report_path),
                "writtenAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            report_path.write_text(json.dumps(document, indent=2))
        except Exception as error:
            failure_dir = (KAMINOS_PIPELINE_RUNS_DIR / f"{stamp}-{time.time_ns()}-{os.getpid()}-{firing_id}-failure").resolve()
            failure_path = failure_dir / "sharp-inline-report.json"
            failure_document = {
                "schema": "kaminos.sharp-inline-pipeline-report-failure.v0",
                "status": "failed",
                "phase": "durable-report-write",
                "pipelineId": pipeline_id,
                "firingId": payload.get("firingId"),
                "error": str(error),
                "lastTrustworthyEvidence": document,
            }
            try:
                failure_dir.mkdir(parents=True, exist_ok=False)
                failure_path.write_text(json.dumps(failure_document, indent=2))
            except Exception:
                self.send_json({"error": f"SHARP inline report write failed: {error}"}, 500)
                return
            relative_failure = failure_path.relative_to(KAMINOS_PIPELINE_RUNS_DIR)
            self.send_json({
                "error": f"SHARP inline report write failed: {error}",
                "failureReportPath": str(failure_path),
                "failureReadUrl": f"/api/read?root=pipeline-runs&path={urlencode({'path': str(relative_failure)})[5:]}",
            }, 500)
            return
        relative_path = report_path.relative_to(KAMINOS_PIPELINE_RUNS_DIR)
        self.send_json({
            "schema": "kaminos.sharp-inline-run-report-receipt.v0",
            "path": str(report_path),
            "outputRoot": str(run_dir),
            "readUrl": f"/api/read?root=pipeline-runs&path={urlencode({'path': str(relative_path)})[5:]}",
        })

    def handle_sharp_inline_run_report_start(self):
        try:
            payload = self.read_json_body()
            document = payload.get("document")
            if not isinstance(document, dict):
                raise ValueError("SHARP inline report document must be a JSON object")
            raw_collections = payload.get("collections")
            if not isinstance(raw_collections, list):
                raise ValueError("SHARP inline report collections must be an array")
            last_trustworthy_output = payload.get("lastTrustworthyOutput")
            if last_trustworthy_output is not None and not isinstance(last_trustworthy_output, dict):
                raise ValueError("SHARP inline lastTrustworthyOutput must be an object")
            collections = {}
            for raw_collection in raw_collections:
                if not isinstance(raw_collection, dict):
                    raise ValueError("SHARP inline report collection entries must be objects")
                collection_id = str(raw_collection.get("id") or "")
                if not re.fullmatch(r"[A-Za-z0-9_.-]+", collection_id):
                    raise ValueError(f"Invalid SHARP inline collection id: {collection_id!r}")
                if collection_id in collections:
                    raise ValueError(f"Duplicate SHARP inline collection id: {collection_id}")
                expected_count = raw_collection.get("expectedCount")
                live_append = raw_collection.get("liveAppend") is True
                if expected_count is None and not live_append:
                    raise ValueError(f"Invalid expectedCount for {collection_id}")
                if expected_count is not None and (
                    not isinstance(expected_count, int)
                    or isinstance(expected_count, bool)
                    or expected_count < 0
                ):
                    raise ValueError(f"Invalid expectedCount for {collection_id}")
                if raw_collection.get("retention") != "uncapped":
                    raise ValueError(f"Collection {collection_id} must declare uncapped retention")
                collections[collection_id] = {
                    "jsonPointer": raw_collection.get("jsonPointer"),
                    "expectedCount": expected_count,
                    "liveAppend": live_append,
                    "receivedCount": 0,
                    "committedBytes": 0,
                    "retention": "uncapped",
                    "mediaType": "application/x-ndjson",
                    "relativePath": f"traces/{collection_id}.ndjson",
                }
        except ValueError as error:
            self.send_json({"error": str(error)}, 400)
            return

        pipeline_id = str(payload.get("pipelineId") or "sharp-image-to-splat-live-v0")
        firing_id = _safe_sharp_inline_name(payload.get("firingId") or "firing")
        stamp = time.strftime("%Y%m%d-%H%M%S")
        session_id = (
            f"{stamp}-{time.time_ns()}-{os.getpid()}-{secrets.token_hex(6)}-{firing_id}"
        )
        run_dir = (KAMINOS_PIPELINE_RUNS_DIR / session_id).resolve()
        state_path = run_dir / "sharp-inline-report-state.json"
        state_read_url = _pipeline_run_read_url(state_path)
        state = {
            "schema": "kaminos.sharp-inline-report-state.v0",
            "status": "receiving",
            "phase": "report-session-start",
            "sessionId": session_id,
            "pipelineId": pipeline_id,
            "firingId": payload.get("firingId"),
            "outputRoot": str(run_dir),
            "statePath": str(state_path),
            "stateReadUrl": state_read_url,
            "reportPath": str(run_dir / "sharp-inline-report.json"),
            "startedAt": _utc_timestamp(),
            "document": document,
            "lastTrustworthyOutput": last_trustworthy_output,
            "collections": collections,
        }
        try:
            with SHARP_INLINE_REPORT_LOCK:
                run_dir.mkdir(parents=True, exist_ok=False)
                (run_dir / "traces").mkdir()
                for collection in collections.values():
                    (run_dir / collection["relativePath"]).touch(exist_ok=False)
                write_sharp_inline_report_state(run_dir, state)
        except Exception as error:
            failure_receipt = {}
            try:
                if run_dir.is_dir():
                    failure_path = run_dir / "sharp-inline-report-failure.json"
                    _atomic_write_json(failure_path, {
                        "schema": "kaminos.sharp-inline-pipeline-report-failure.v0",
                        "status": "failed",
                        "phase": "report-session-start",
                        "pipelineId": pipeline_id,
                        "firingId": payload.get("firingId"),
                        "sessionId": session_id,
                        "error": str(error),
                        "lastTrustworthyOutput": payload.get("lastTrustworthyOutput"),
                        "lastTrustworthyCounts": {
                            collection_id: 0 for collection_id in collections
                        },
                        "failedAt": _utc_timestamp(),
                    })
                    failure_receipt = {
                        "failureReportPath": str(failure_path),
                        "failureReadUrl": _pipeline_run_read_url(failure_path),
                    }
            except Exception:
                failure_receipt = {}
            self.send_json({
                "error": f"SHARP inline report start failed: {error}",
                **failure_receipt,
            }, 500)
            return
        self.send_json({
            "schema": "kaminos.sharp-inline-run-report-session.v0",
            "status": "receiving",
            "sessionId": session_id,
            "outputRoot": str(run_dir),
            "statePath": str(state_path),
            "stateReadUrl": state_read_url,
        })

    def handle_sharp_inline_run_report_chunk(self):
        try:
            payload = self.read_json_body()
            session_id = str(payload.get("sessionId") or "")
            collection_id = str(payload.get("collectionId") or "")
            expected_start = payload.get("expectedStart")
            rows = payload.get("rows")
            batching = payload.get("batching")
            if not isinstance(expected_start, int) or isinstance(expected_start, bool):
                raise ValueError("SHARP inline trace expectedStart must be an integer")
            if not isinstance(rows, list):
                raise ValueError("SHARP inline trace rows must be an array")
            with SHARP_INLINE_REPORT_LOCK:
                run_dir, state = load_sharp_inline_report_state(session_id)
                if state.get("status") != "receiving":
                    raise ValueError(f"SHARP inline report session is {state.get('status')}")
                collection = state.get("collections", {}).get(collection_id)
                if not isinstance(collection, dict):
                    raise ValueError(f"Unknown SHARP inline collection: {collection_id}")
                received_count = collection.get("receivedCount")
                expected_count = collection.get("expectedCount")
                committed_bytes = collection.get("committedBytes", 0)
                if expected_start != received_count:
                    raise ValueError(
                        f"Non-contiguous SHARP inline chunk for {collection_id}: "
                        f"expectedStart {expected_start}, receivedCount {received_count}"
                    )
                if (
                    expected_count is not None
                    and received_count + len(rows) > expected_count
                ):
                    raise ValueError(
                        f"SHARP inline chunk exceeds expectedCount for {collection_id}"
                    )
                trace_path = (run_dir / collection["relativePath"]).resolve()
                if not trace_path.is_relative_to(run_dir):
                    raise ValueError("SHARP inline trace path escaped its run directory")
                durable_size = trace_path.stat().st_size
                if durable_size < committed_bytes:
                    raise RuntimeError(
                        f"SHARP inline trace {collection_id} is shorter than committedBytes: "
                        f"{durable_size} < {committed_bytes}"
                    )
                if durable_size > committed_bytes:
                    with trace_path.open("r+b") as stream:
                        stream.truncate(committed_bytes)
                        stream.flush()
                        os.fsync(stream.fileno())
                chunk_bytes = "".join(
                    f"{json.dumps(row, separators=(',', ':'))}\n" for row in rows
                ).encode("utf-8")
                with trace_path.open("ab") as stream:
                    stream.write(chunk_bytes)
                    stream.flush()
                    os.fsync(stream.fileno())
                collection["receivedCount"] = received_count + len(rows)
                collection["committedBytes"] = committed_bytes + len(chunk_bytes)
                gate_b = state.get("document", {}).get("gateB")
                if isinstance(gate_b, dict):
                    if not isinstance(batching, dict):
                        raise ValueError("SHARP Gate B chunk omitted batching state")
                    if batching.get("schema") != "kaminos.sharp-gate-b-batching.v0":
                        raise ValueError("SHARP Gate B chunk has wrong batching schema")
                    if batching.get("retention") != "uncapped":
                        raise ValueError("SHARP Gate B batching retention must be uncapped")
                    if batching.get("maxRowsPerFlush") is not None:
                        raise ValueError("SHARP Gate B batching must not cap rows per flush")
                    flush_interval_ms = batching.get("flushIntervalMs")
                    flush_ordinal = batching.get("flushOrdinal")
                    if (
                        not isinstance(flush_interval_ms, (int, float))
                        or isinstance(flush_interval_ms, bool)
                        or not math.isfinite(flush_interval_ms)
                        or flush_interval_ms <= 0
                    ):
                        raise ValueError("SHARP Gate B batching flushIntervalMs is invalid")
                    if (
                        not isinstance(flush_ordinal, int)
                        or isinstance(flush_ordinal, bool)
                        or flush_ordinal < 0
                    ):
                        raise ValueError("SHARP Gate B batching flushOrdinal is invalid")
                    batching_collections = batching.get("collections")
                    client_counts = (
                        batching_collections.get(collection_id)
                        if isinstance(batching_collections, dict)
                        else None
                    )
                    if not isinstance(client_counts, dict):
                        raise ValueError(
                            f"SHARP Gate B batching omitted {collection_id} counts"
                        )
                    queued = client_counts.get("queued")
                    flushed = client_counts.get("flushed")
                    in_flight = client_counts.get("inFlight")
                    unflushed = client_counts.get("unflushed")
                    for count_name, count_value in {
                        "queued": queued,
                        "flushed": flushed,
                        "inFlight": in_flight,
                        "unflushed": unflushed,
                    }.items():
                        if (
                            not isinstance(count_value, int)
                            or isinstance(count_value, bool)
                            or count_value < 0
                        ):
                            raise ValueError(
                                f"SHARP Gate B batching {collection_id}.{count_name} is invalid"
                            )
                    if (
                        queued != expected_start + len(rows)
                        or flushed != expected_start
                        or in_flight != len(rows)
                        or unflushed != queued - flushed
                    ):
                        raise ValueError(
                            f"SHARP Gate B batching counts contradict chunk {collection_id}"
                        )
                    flushed_at = _utc_timestamp()
                    durable_batching = {
                        **batching,
                        "lastFlushedAt": flushed_at,
                        "collections": {
                            **batching_collections,
                            collection_id: {
                                "queued": queued,
                                "flushed": collection["receivedCount"],
                                "inFlight": 0,
                                "unflushed": queued - collection["receivedCount"],
                            },
                        },
                    }
                    flush_receipts = gate_b.get("flushReceipts")
                    if not isinstance(flush_receipts, list):
                        flush_receipts = []
                    flush_receipts.append({
                        "schema": "kaminos.sharp-gate-b-flush-receipt.v0",
                        "flushOrdinal": flush_ordinal,
                        "collectionId": collection_id,
                        "expectedStart": expected_start,
                        "rowCount": len(rows),
                        "receivedCount": collection["receivedCount"],
                        "flushedAt": flushed_at,
                        "retention": "uncapped",
                    })
                    state["document"]["gateB"] = {
                        **gate_b,
                        "batching": durable_batching,
                        "flushReceipts": flush_receipts,
                    }
                state["phase"] = "trace-chunk-upload"
                state["updatedAt"] = _utc_timestamp()
                write_sharp_inline_report_state(run_dir, state)
                durable_count = collection["receivedCount"]
        except ValueError as error:
            self.send_json({"error": str(error)}, 409)
            return
        except Exception as error:
            self.send_json({"error": f"SHARP inline trace chunk failed: {error}"}, 500)
            return
        self.send_json({
            "schema": "kaminos.sharp-inline-run-report-chunk-receipt.v0",
            "status": "receiving",
            "sessionId": session_id,
            "collectionId": collection_id,
            "receivedCount": durable_count,
        })

    def handle_sharp_inline_run_report_finish(self):
        try:
            payload = self.read_json_body()
            session_id = str(payload.get("sessionId") or "")
            with SHARP_INLINE_REPORT_LOCK:
                run_dir, state = load_sharp_inline_report_state(session_id)
                if state.get("status") == "complete":
                    receipt = _sharp_inline_complete_receipt(run_dir, state)
                elif state.get("status") != "receiving":
                    raise ValueError(f"SHARP inline report session is {state.get('status')}")
                else:
                    expected_counts = payload.get("expectedCounts")
                    if expected_counts is not None and not isinstance(expected_counts, dict):
                        raise ValueError("SHARP inline expectedCounts must be an object")
                    document_patch = payload.get("documentPatch")
                    if document_patch is not None:
                        if not isinstance(document_patch, dict):
                            raise ValueError("SHARP inline documentPatch must be an object")
                        unsupported_patch_keys = set(document_patch) - {
                            "status",
                            "phase",
                            "artifact",
                            "gateB",
                        }
                        if unsupported_patch_keys:
                            raise ValueError(
                                "SHARP inline documentPatch contains unsupported keys: "
                                + ", ".join(sorted(unsupported_patch_keys))
                            )
                    for collection_id, collection in state.get("collections", {}).items():
                        if collection.get("expectedCount") is not None:
                            if (
                                isinstance(expected_counts, dict)
                                and collection_id in expected_counts
                                and expected_counts[collection_id]
                                != collection.get("expectedCount")
                            ):
                                raise ValueError(
                                    f"SHARP inline expectedCount cannot change for {collection_id}"
                                )
                            continue
                        final_count = (
                            expected_counts.get(collection_id)
                            if isinstance(expected_counts, dict)
                            else None
                        )
                        if (
                            not isinstance(final_count, int)
                            or isinstance(final_count, bool)
                            or final_count < 0
                        ):
                            raise ValueError(
                                f"SHARP inline live collection {collection_id} "
                                "requires a final expectedCount"
                            )
                        if final_count != collection.get("receivedCount"):
                            raise ValueError(
                                f"SHARP inline live collection {collection_id} "
                                f"received {collection.get('receivedCount')}, "
                                f"not final expectedCount {final_count}"
                            )
                        collection["expectedCount"] = final_count
                    gate_b_document = state.get("document", {}).get("gateB")
                    if isinstance(gate_b_document, dict):
                        required_gate_b_collections = {
                            "progress-events",
                            "scheduler-events",
                            "resource-snapshots",
                            "raf-opportunity-snapshots",
                            "host-stats",
                            "runtime-errors",
                        }
                        missing_gate_b_collections = (
                            required_gate_b_collections
                            - set(state.get("collections", {}))
                        )
                        if missing_gate_b_collections:
                            raise ValueError(
                                "SHARP Gate B is missing live collections: "
                                + ", ".join(sorted(missing_gate_b_collections))
                            )
                        empty_gate_b_collections = sorted(
                            collection_id
                            for collection_id in (
                                required_gate_b_collections - {"runtime-errors"}
                            )
                            if state["collections"][collection_id].get("receivedCount") == 0
                        )
                        if empty_gate_b_collections:
                            raise ValueError(
                                "SHARP Gate B has empty live collections: "
                                + ", ".join(empty_gate_b_collections)
                            )
                        artifact = (
                            document_patch.get("artifact")
                            if isinstance(document_patch, dict)
                            else None
                        )
                        if (
                            not isinstance(artifact, dict)
                            or not artifact.get("path")
                            or not re.fullmatch(r"[a-f0-9]{64}", str(artifact.get("sha256") or ""))
                            or not isinstance(artifact.get("bytes"), int)
                            or isinstance(artifact.get("bytes"), bool)
                            or artifact.get("bytes") <= 0
                        ):
                            raise ValueError(
                                "SHARP Gate B completion lacks a trustworthy PLY artifact"
                            )
                        gate_b_patch = document_patch.get("gateB")
                        if not isinstance(gate_b_patch, dict):
                            raise ValueError("SHARP Gate B completion omitted gateB disposition")
                        validation_failures = gate_b_patch.get("validationFailures")
                        if validation_failures != []:
                            raise ValueError(
                                "SHARP Gate B completion has unresolved validation failures"
                            )
                    if document_patch:
                        gate_b_patch = document_patch.get("gateB")
                        state["document"] = {
                            **state["document"],
                            **document_patch,
                            **({
                                "gateB": {
                                    **state["document"].get("gateB", {}),
                                    **gate_b_patch,
                                },
                            } if isinstance(gate_b_patch, dict) else {}),
                        }
                    incomplete = [
                        collection_id
                        for collection_id, collection in state.get("collections", {}).items()
                        if collection.get("receivedCount") != collection.get("expectedCount")
                    ]
                    if incomplete:
                        raise ValueError(
                            "SHARP inline report collections are incomplete: " + ", ".join(incomplete)
                        )
                    report_path = run_dir / "sharp-inline-report.json"
                    written_at = _utc_timestamp()
                    trace_artifacts = {}
                    for collection_id, collection in state.get("collections", {}).items():
                        trace_path = run_dir / collection["relativePath"]
                        trace_inspection = _inspect_ndjson_file(trace_path)
                        if trace_inspection["bytes"] != collection.get("committedBytes"):
                            raise RuntimeError(
                                f"SHARP inline trace byte count mismatch for {collection_id}: "
                                f"{trace_inspection['bytes']} != {collection.get('committedBytes')}"
                            )
                        if trace_inspection["rows"] != collection.get("expectedCount"):
                            raise RuntimeError(
                                f"SHARP inline trace row count mismatch for {collection_id}: "
                                f"{trace_inspection['rows']} != {collection.get('expectedCount')}"
                            )
                        trace_artifacts[collection_id] = {
                            "schema": "kaminos.sharp-inline-trace-artifact.v0",
                            "path": str(trace_path),
                            "readUrl": _pipeline_run_read_url(trace_path),
                            "mediaType": "application/x-ndjson",
                            "jsonPointer": collection.get("jsonPointer"),
                            "count": trace_inspection["rows"],
                            "bytes": trace_inspection["bytes"],
                            "sha256": trace_inspection["sha256"],
                            "retention": "uncapped",
                        }
                    document = {
                        **state["document"],
                        "pipelineId": state["document"].get("pipelineId") or state["pipelineId"],
                        "outputRoot": str(run_dir),
                        "reportPath": str(report_path),
                        "writtenAt": written_at,
                        "traceArtifacts": trace_artifacts,
                    }
                    _atomic_write_json(report_path, document)
                    state.update({
                        "status": "complete",
                        "phase": "report-session-finish",
                        "completedAt": written_at,
                        "traceArtifacts": trace_artifacts,
                    })
                    write_sharp_inline_report_state(run_dir, state)
                    receipt = _sharp_inline_complete_receipt(run_dir, state)
        except ValueError as error:
            self.send_json({"error": str(error)}, 409)
            return
        except Exception as error:
            self.send_json({"error": f"SHARP inline report finish failed: {error}"}, 500)
            return
        self.send_json(receipt)

    def handle_sharp_inline_run_report_abort(self):
        try:
            payload = self.read_json_body()
            session_id = str(payload.get("sessionId") or "")
            with SHARP_INLINE_REPORT_LOCK:
                run_dir, state = load_sharp_inline_report_state(session_id)
                if state.get("status") == "complete":
                    receipt = _sharp_inline_complete_receipt(run_dir, state)
                    self.send_json(receipt)
                    return
                if state.get("status") == "failed":
                    failure_path = Path(state.get("failureReportPath") or "")
                    self.send_json({
                        "schema": "kaminos.sharp-inline-run-report-abort-receipt.v0",
                        "status": "failed",
                        "sessionId": session_id,
                        "failureReportPath": str(failure_path),
                        "failureReadUrl": _pipeline_run_read_url(failure_path),
                    })
                    return
                failure_path = run_dir / "sharp-inline-report-failure.json"
                failed_at = _utc_timestamp()
                durable_counts = {
                    collection_id: collection.get("receivedCount")
                    for collection_id, collection in state.get("collections", {}).items()
                }
                client_counts = payload.get("lastTrustworthyCounts")
                count_mismatches = {
                    collection_id: {
                        "clientClaimed": client_counts.get(collection_id),
                        "durable": durable_count,
                    }
                    for collection_id, durable_count in durable_counts.items()
                    if isinstance(client_counts, dict)
                    and client_counts.get(collection_id) != durable_count
                }
                failure_document = {
                    "schema": "kaminos.sharp-inline-pipeline-report-failure.v0",
                    "status": "failed",
                    "phase": payload.get("phase") or "report-session-abort",
                    "pipelineId": state.get("pipelineId"),
                    "firingId": state.get("firingId"),
                    "sessionId": session_id,
                    "error": payload.get("error") or "SHARP inline report session aborted",
                    "lastTrustworthyOutput": state.get("lastTrustworthyOutput")
                    or payload.get("lastTrustworthyOutput"),
                    "lastTrustworthyCounts": durable_counts,
                    "clientClaimedCounts": client_counts if isinstance(client_counts, dict) else None,
                    "countMismatches": count_mismatches,
                    "failedAt": failed_at,
                    "statePath": str(run_dir / "sharp-inline-report-state.json"),
                }
                gate_b_document = state.get("document", {}).get("gateB")
                if isinstance(gate_b_document, dict):
                    failure_document["gateB"] = {
                        "schema": "kaminos.sharp-gate-b-failure-state.v0",
                        "routeIdentity": gate_b_document.get("routeIdentity"),
                        "durableBatching": gate_b_document.get("batching"),
                        "flushReceipts": gate_b_document.get("flushReceipts", []),
                        "clientBatching": payload.get("batching"),
                    }
                _atomic_write_json(failure_path, failure_document)
                state.update({
                    "status": "failed",
                    "phase": failure_document["phase"],
                    "error": failure_document["error"],
                    "failedAt": failed_at,
                    "failureReportPath": str(failure_path),
                })
                write_sharp_inline_report_state(run_dir, state)
        except ValueError as error:
            self.send_json({"error": str(error)}, 404)
            return
        except Exception as error:
            self.send_json({"error": f"SHARP inline report abort failed: {error}"}, 500)
            return
        self.send_json({
            "schema": "kaminos.sharp-inline-run-report-abort-receipt.v0",
            "status": "failed",
            "sessionId": session_id,
            "failureReportPath": str(failure_path),
            "failureReadUrl": _pipeline_run_read_url(failure_path),
        })

    def read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError as error:
            raise ValueError("Invalid Content-Length") from error
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError as error:
            raise ValueError(f"Invalid JSON: {error}") from error

    def handle_sharp_inline_file(self, request_path):
        if request_path == "/sharp-inline/sharp-inline.js":
            target = SHARP_INLINE_MODULE_PATH
            content_type = "application/javascript; charset=utf-8"
        elif request_path == "/sharp-inline/weights.bin":
            target = SHARP_INLINE_WEIGHTS_PATH
            content_type = "application/octet-stream"
        elif request_path.startswith("/sharp-inline/assets/"):
            asset_name = request_path.removeprefix("/sharp-inline/assets/")
            if not asset_name or "/" in asset_name or "\\" in asset_name:
                self.send_error(404, "Unknown SHARP inline asset")
                return
            target = (SHARP_INLINE_ASSETS_PATH / asset_name).resolve()
            if target.parent != SHARP_INLINE_ASSETS_PATH.resolve():
                self.send_error(404, "Unknown SHARP inline asset")
                return
            content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        else:
            self.send_error(404, "Unknown SHARP inline asset")
            return
        if not target.is_file():
            self.send_error(404, f"SHARP inline asset missing: {target.name}")
            return
        stat = target.stat()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(stat.st_size))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        with target.open("rb") as handle:
            self.copyfile(handle, self.wfile)

    def handle_forge_host_registry(self):
        self.send_json(build_forge_host_registry_snapshot())

    def handle_pipeline_manifest(self):
        try:
            self.send_json(pipeline_manifest_payload())
        except FileNotFoundError as error:
            self.send_json({"error": str(error)}, 404)
        except Exception as error:
            self.send_json({"error": str(error)}, 500)

    def volume_capture_slug(self, payload):
        requested = str(payload.get("name") or payload.get("captureId") or payload.get("kind") or "volume-capture")
        slug = re.sub(r"[^A-Za-z0-9_.-]+", "-", requested).strip(".-").lower()[:72] or "volume-capture"
        stamp = time.strftime("%Y%m%d-%H%M%S")
        return f"{stamp}-{slug}"

    def volume_capture_path_for_id(self, capture_id):
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", str(capture_id or "")).strip(".-")
        if not safe:
            raise ValueError("capture id required")
        if not safe.endswith(".json"):
            safe = f"{safe}.json"
        path = (VOLUME_CAPTURE_DIR / safe).resolve()
        if VOLUME_CAPTURE_DIR.resolve() not in path.parents:
            raise ValueError("capture path traversal")
        return path

    def handle_volume_captures(self):
        VOLUME_CAPTURE_DIR.mkdir(parents=True, exist_ok=True)
        entries = []
        for path in sorted(VOLUME_CAPTURE_DIR.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
            stat = path.stat()
            entries.append({
                "id": path.stem,
                "relativePath": str(path.relative_to(ROOT)),
                "bytes": stat.st_size,
                "mtimeMs": int(stat.st_mtime * 1000),
            })
        self.send_json({
            "identity": "kaminos-volume-captures-index-v1",
            "root": str(VOLUME_CAPTURE_DIR.relative_to(ROOT)),
            "entries": entries,
        })

    def handle_volume_capture_get(self, query):
        capture_id = (query.get("id") or query.get("capture") or [""])[0]
        try:
            path = self.volume_capture_path_for_id(capture_id)
        except ValueError as error:
            self.send_json({"error": str(error)}, 400)
            return
        if not path.exists():
            self.send_json({"error": "capture not found", "id": capture_id}, 404)
            return
        try:
            document = json.loads(path.read_text())
        except Exception as error:
            self.send_json({"error": f"failed to read capture: {error}"}, 500)
            return
        self.send_json(document)

    def handle_volume_capture(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_json({"error": "Invalid Content-Length"}, 400)
            return
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON"}, 400)
            return
        if not isinstance(payload, dict):
            self.send_json({"error": "capture payload must be a JSON object"}, 400)
            return

        VOLUME_CAPTURE_DIR.mkdir(parents=True, exist_ok=True)
        capture_id = self.volume_capture_slug(payload)
        path = self.volume_capture_path_for_id(capture_id)
        relative_path = str(path.relative_to(ROOT))
        document = {
            "identity": "kaminos-volume-agent-capture-artifact-v1",
            "captureId": capture_id,
            "writtenAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "artifactRelativePath": relative_path,
            "witnessCommand": f"node volume-witness.mjs --capture {relative_path}",
            "capture": payload,
        }
        path.write_text(json.dumps(document, indent=2))
        self.send_json({
            "ok": True,
            "captureId": capture_id,
            "relativePath": relative_path,
            "path": str(path),
            "witnessCommand": document["witnessCommand"],
            "document": document,
        })

    def handle_run_pipeline(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_json({"error": "Invalid Content-Length"}, 400)
            return
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON"}, 400)
            return
        wants_stream = bool(payload.get("streamProgress")) or "application/x-ndjson" in self.headers.get("Accept", "")
        if wants_stream:
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                run_pipeline_witness_stream(self, payload)
            except ValueError as error:
                _write_pipeline_stream_event(self, {"schema": "kaminos.pipeline-run-result.v0", "kind": "pipeline-result", "ok": False, "error": str(error)})
            except PermissionError as error:
                _write_pipeline_stream_event(self, {"schema": "kaminos.pipeline-run-result.v0", "kind": "pipeline-result", "ok": False, "error": str(error)})
            except FileNotFoundError as error:
                _write_pipeline_stream_event(self, {"schema": "kaminos.pipeline-run-result.v0", "kind": "pipeline-result", "ok": False, "error": str(error)})
            except subprocess.TimeoutExpired:
                _write_pipeline_stream_event(self, {"schema": "kaminos.pipeline-run-result.v0", "kind": "pipeline-result", "ok": False, "error": "pipeline witness timed out"})
            except Exception as error:
                _write_pipeline_stream_event(self, {"schema": "kaminos.pipeline-run-result.v0", "kind": "pipeline-result", "ok": False, "error": str(error)})
            return
        try:
            result = run_pipeline_witness(payload)
        except ValueError as error:
            self.send_json({"error": str(error)}, 400)
            return
        except PermissionError as error:
            self.send_json({"error": str(error)}, 403)
            return
        except FileNotFoundError as error:
            self.send_json({"error": str(error)}, 404)
            return
        except subprocess.TimeoutExpired:
            self.send_json({"error": "pipeline witness timed out"}, 504)
            return
        except Exception as error:
            self.send_json({"error": str(error)}, 500)
            return
        self.send_json(result, 200 if result.get("ok") else 500)

    def handle_save_scene(self):
        """Save a scene JSON to the scenes directory.

        If _filename is provided and exists, overwrites that file (Save).
        Otherwise creates a new file (Save As).
        """
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            data = json.loads(body)
        except Exception:
            self.send_json({"error": "Invalid JSON"}, 400)
            return

        # Check for overwrite hint
        hint = data.pop("_filename", None)
        if hint:
            safe_hint = "".join(c for c in hint if c.isalnum() or c in "._-")
            if safe_hint and (SCENES_DIR / safe_hint).exists():
                filename = safe_hint
            else:
                hint = None  # fall through to new file

        if not hint:
            # Generate new filename from model name and timestamp
            model_name = (data.get("model") or {}).get("fileName", "scene")
            model_name = Path(model_name).stem
            timestamp = data.get("timestamp", "")[:19].replace(":", "-").replace("T", "_")
            filename = f"{model_name}_{timestamp}.kaminos.json"
            filename = "".join(c for c in filename if c.isalnum() or c in "._-")
            if not filename:
                filename = "scene.kaminos.json"

        scene_path = SCENES_DIR / filename
        # Security: ensure under SCENES_DIR
        if not scene_path.resolve().is_relative_to(SCENES_DIR.resolve()):
            self.send_json({"error": "Path traversal"}, 403)
            return

        scene_path.write_text(json.dumps(data, indent=2))
        self.send_json({"saved": filename, "path": str(scene_path)})

    def handle_ingest_splat(self, params):
        """Write a dropped PLY/SPZ into the experimental splat inbox."""
        filename = params.get("name", [""])[0]
        if not filename:
            self.send_json({"error": "name required"}, 400)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_json({"error": "Invalid Content-Length"}, 400)
            return
        try:
            entry = ingest_splat_asset(filename, self.rfile.read(length))
        except ValueError as error:
            self.send_json({"error": str(error)}, 400)
            return
        except PermissionError:
            self.send_json({"error": "Path traversal"}, 403)
            return
        except FileNotFoundError as error:
            self.send_json({"error": str(error)}, 404)
            return
        self.send_json({
            "schema": "kaminos.asset-ingest.v0",
            "kind": "splat",
            "entry": entry,
        })

    def handle_splat_correction_get(self, params):
        root_id = params.get("root", [""])[0]
        rel_path = params.get("path", [""])[0]
        try:
            document = load_splat_asset_correction(root_id, rel_path)
            if document is None:
                resolve_splat_asset_path(root_id, rel_path)
                document = {
                    "schema": SPLAT_CORRECTION_SCHEMA,
                    "root_id": root_id,
                    "path": rel_path,
                    "source": "/api/read?" + urlencode({"root": root_id, "path": rel_path}),
                    "correction": None,
                }
        except ValueError as error:
            self.send_json({"error": str(error)}, 400)
            return
        except PermissionError:
            self.send_json({"error": "Path traversal"}, 403)
            return
        except FileNotFoundError as error:
            self.send_json({"error": str(error)}, 404)
            return
        self.send_json(document)

    def handle_splat_correction_post(self, params):
        root_id = params.get("root", [""])[0]
        rel_path = params.get("path", [""])[0]
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_json({"error": "Invalid Content-Length"}, 400)
            return
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON"}, 400)
            return
        try:
            document = save_splat_asset_correction(root_id, rel_path, payload.get("correction", payload))
        except ValueError as error:
            self.send_json({"error": str(error)}, 400)
            return
        except PermissionError:
            self.send_json({"error": "Path traversal"}, 403)
            return
        except FileNotFoundError as error:
            self.send_json({"error": str(error)}, 404)
            return
        self.send_json(document)

    def handle_delete_scene(self, params):
        """Delete a scene file."""
        name = params.get("name", [""])[0]
        if not name:
            self.send_json({"error": "name required"}, 400)
            return
        target = (SCENES_DIR / name).resolve()
        if not target.is_relative_to(SCENES_DIR.resolve()):
            self.send_json({"error": "Path traversal"}, 403)
            return
        if not target.is_file():
            self.send_json({"error": "Not found"}, 404)
            return
        target.unlink()
        self.send_json({"deleted": name})

    def handle_roots(self):
        """List available browse roots and their existence."""
        roots = {}
        for name, path in BROWSE_ROOTS.items():
            roots[name] = {
                "path": str(path.resolve()),
                "exists": path.exists(),
            }
        self.send_json(roots)

    def handle_browse(self, params):
        """List directory contents. ?root=scratch&path=subdir"""
        root_name = params.get("root", ["scratch"])[0]
        sub_path = params.get("path", [""])[0]

        root = BROWSE_ROOTS.get(root_name)
        if not root:
            self.send_json({"error": f"Unknown root: {root_name}"}, 400)
            return

        target = (root / sub_path).resolve()
        # Security: ensure target is under root
        if not target.is_relative_to(root.resolve()):
            self.send_json({"error": "Path traversal"}, 403)
            return

        if not target.exists():
            self.send_json({"error": "Not found"}, 404)
            return

        if target.is_file():
            # Return file info
            self.send_json({
                "type": "file",
                "name": target.name,
                "size": target.stat().st_size,
                "path": str(target),
            })
            return

        entries = []
        for entry in sorted(target.iterdir()):
            if entry.name.startswith("."):
                continue
            info = {
                "name": entry.name,
                "type": "dir" if entry.is_dir() else "file",
                "size": entry.stat().st_size if entry.is_file() else None,
            }
            # For greenroom job dirs, include status
            status_file = entry / "status.json" if entry.is_dir() else None
            if status_file and status_file.exists():
                try:
                    status = json.loads(status_file.read_text())
                    info["job_status"] = status.get("status")
                    info["job_type"] = status.get("job_type")
                    info["input_path"] = status.get("input_path")
                except Exception:
                    pass
            # For output dirs with metadata sidecar (from greenroom)
            metadata_file = entry / "metadata.json" if entry.is_dir() else None
            if metadata_file and metadata_file.exists():
                try:
                    meta = json.loads(metadata_file.read_text())
                    info["metadata"] = meta
                except Exception:
                    pass
            # For receipt dirs, include receipt summary
            receipt_file = entry / "receipt.json" if entry.is_dir() else None
            if receipt_file and receipt_file.exists():
                try:
                    receipt = json.loads(receipt_file.read_text())
                    info["receipt"] = {
                        k: receipt.get(k) for k in [
                            "status", "job_type", "exit_code",
                            "started_at", "finished_at", "failure_phase",
                            "output_dir", "input_path", "input_name",
                        ]
                    }
                    output_files = list_greenroom_output_files(receipt)
                    if output_files:
                        info["output_files"] = output_files
                    info["display"] = build_display_metadata(
                        entry.name,
                        entry_type=info["type"],
                        receipt=receipt,
                        output_files=output_files,
                        size=info["size"],
                    )
                except Exception:
                    pass
            if "display" not in info:
                status_receipt = None
                if info.get("job_type") or info.get("input_path") or info.get("job_status"):
                    status_receipt = {
                        "status": info.get("job_status"),
                        "job_type": info.get("job_type"),
                        "input_path": info.get("input_path"),
                    }
                info["display"] = build_display_metadata(
                    entry.name,
                    entry_type=info["type"],
                    receipt=status_receipt,
                    size=info["size"],
                )
            entries.append(info)

        self.send_json({
            "type": "dir",
            "root": root_name,
            "path": sub_path,
            "entries": entries,
        })

    def handle_assets(self, params):
        """List declared asset roots."""
        kind = params.get("kind", ["splat"])[0]
        if kind not in {"splat", "image", "all"}:
            self.send_json({"error": f"Unsupported asset kind: {kind}"}, 400)
            return
        roots = [
            {
                "id": root["id"],
                "label": root.get("label") or root["id"],
                "kind": root.get("kind"),
                "stage": root.get("stage", "experimental"),
                "path": str(Path(root["path"]).expanduser().resolve()),
                "exists": Path(root["path"]).expanduser().exists(),
            }
            for root in ASSET_ROOTS
            if kind in {"all", root.get("kind")}
        ]
        self.send_json({
            "schema": "kaminos.asset-index.v0",
            "kind": kind,
            "roots": roots,
            "entries": list_asset_entries(kind=kind),
        })

    def handle_read(self, params):
        """Read a file's content. ?root=scratch&path=file.json"""
        root_name = params.get("root", ["scratch"])[0]
        sub_path = params.get("path", [""])[0]

        root = BROWSE_ROOTS.get(root_name)
        if not root:
            self.send_json({"error": f"Unknown root: {root_name}"}, 400)
            return

        lexical_target = root / sub_path
        target = lexical_target.resolve()
        if not target.is_relative_to(root.resolve()):
            if splat_asset_root_allows_pointer(root_name) and lexical_target.suffix.lower() in SPLAT_EXTENSIONS:
                target = lexical_target
            else:
                self.send_json({"error": "Path traversal"}, 403)
                return

        if not target.is_file():
            self.send_json({"error": "Not a file"}, 404)
            return

        # For images, serve directly
        ext = target.suffix.lower()
        if ext in (".png", ".jpg", ".jpeg", ".webp", ".exr", ".glb", ".gltf", ".ply", ".spz", ".ndjson"):
            self.send_response(200)
            content_types = {
                ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".webp": "image/webp",
                ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
                ".exr": "application/octet-stream", ".ply": "application/octet-stream", ".spz": "application/octet-stream",
                ".ndjson": "application/x-ndjson",
            }
            body = target.read_bytes()
            self.send_header("Content-Type", content_types.get(ext, "application/octet-stream"))
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        # For text/json, return as JSON-wrapped text
        try:
            text = target.read_text()
            if ext == ".json":
                self.send_json(json.loads(text))
            else:
                self.send_json({"content": text})
        except Exception:
            self.send_json({"error": "Failed to read file"}, 500)

    def handle_job_outputs(self, params):
        """List files in a job's output_dir. ?job_id=xxx"""
        job_id = params.get("job_id", [""])[0]
        if not job_id:
            self.send_json({"error": "job_id required"}, 400)
            return

        greenroom = BROWSE_ROOTS.get("greenroom")
        if not greenroom or not greenroom.exists():
            self.send_json({"error": "Greenroom not available"}, 404)
            return

        receipt_data = find_greenroom_receipt(job_id)

        if not receipt_data:
            self.send_json({"error": f"Job {job_id} not found"}, 404)
            return

        output_dir = receipt_data.get("output_dir")
        if not output_dir:
            self.send_json({"entries": [], "output_dir": output_dir})
            return

        output_resolved = resolve_greenroom_output_dir(output_dir)
        if not output_resolved:
            self.send_json({"error": "output_dir outside serving roots"}, 403)
            return

        output_files = list_greenroom_output_files(receipt_data)
        job_display = build_display_metadata(
            job_id,
            entry_type="dir",
            receipt=receipt_data,
            output_files=output_files,
        )
        entries = []
        for f in sorted(output_resolved.iterdir()):
            if f.name.startswith("."):
                continue
            size = f.stat().st_size if f.is_file() else None
            entries.append({
                "name": f.name,
                "type": "dir" if f.is_dir() else "file",
                "size": size,
                "display": build_output_display_metadata(f.name, job_display=job_display, size=size),
            })
        self.send_json({"entries": entries, "output_dir": output_dir, "job_display": job_display})

    def handle_job_output_events(self, params):
        """Expose job-output route timing for local witness runs."""
        should_clear = params.get("clear", ["0"])[0] == "1"
        with JOB_OUTPUT_EVENTS_LOCK:
            if should_clear:
                JOB_OUTPUT_EVENTS.clear()
            events = list(JOB_OUTPUT_EVENTS)
        self.send_json({"events": events, "cleared": should_clear})

    def handle_job_output(self, params):
        """Serve files from a completed job's output_dir. ?job_id=xxx&file=output.glb

        Security: only serves from output_dir paths recorded in greenroom receipts.
        """
        job_id = params.get("job_id", [""])[0]
        filename = params.get("file", [""])[0]
        if not job_id or not filename:
            self.send_json({"error": "job_id and file required"}, 400)
            return

        greenroom = BROWSE_ROOTS.get("greenroom")
        if not greenroom or not greenroom.exists():
            self.send_json({"error": "Greenroom not available"}, 404)
            return

        receipt_data = find_greenroom_receipt(job_id)

        if not receipt_data:
            self.send_json({"error": f"Job {job_id} not found"}, 404)
            return

        output_dir = receipt_data.get("output_dir")
        if not output_dir:
            self.send_json({"error": "No output_dir in receipt"}, 404)
            return

        output_resolved = resolve_greenroom_output_dir(output_dir)
        if not output_resolved:
            self.send_json({"error": "output_dir outside serving roots"}, 403)
            return

        target = (output_resolved / filename).resolve()
        # Security: must be under the receipt's output_dir
        if not target.is_relative_to(output_resolved):
            self.send_json({"error": "Path traversal"}, 403)
            return

        if not target.is_file():
            self.send_json({"error": f"File not found: {filename}"}, 404)
            return

        delay_seconds = greenroom_job_output_delay_seconds(job_id, filename)
        delay_ms = int(delay_seconds * 1000)
        started_at_ms = int(time.time() * 1000)
        body = target.read_bytes()
        if delay_seconds:
            time.sleep(delay_seconds)
        ended_at_ms = int(time.time() * 1000)
        record_job_output_event({
            "job_id": job_id,
            "file": filename,
            "path": f"/api/job-output?job_id={job_id}&file={filename}",
            "delay_ms": delay_ms,
            "started_at_ms": started_at_ms,
            "ended_at_ms": ended_at_ms,
            "duration_ms": ended_at_ms - started_at_ms,
            "content_length": len(body),
        })

        ext = target.suffix.lower()
        content_types = {
            ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
            ".exr": "application/octet-stream", ".ply": "application/octet-stream", ".spz": "application/octet-stream",
            ".json": "application/json", ".txt": "text/plain", ".log": "text/plain",
        }
        self.send_response(200)
        self.send_header("Content-Type", content_types.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, data, status=200):
        body = json.dumps(data, indent=2).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, format, *args):
        rendered = format % args if args else format
        if "/api/" in rendered:
            return  # quiet API spam
        super().log_message(format, *args)


if __name__ == "__main__":
    for path in (BROWSE_ROOTS.get("splat-inbox"), BROWSE_ROOTS.get("splat-production")):
        if path:
            path.mkdir(parents=True, exist_ok=True)
    print(f"Kaminos server at http://localhost:{PORT}")
    print(f"  Scratch: {BROWSE_ROOTS['scratch']}")
    print(f"  Greenroom: {BROWSE_ROOTS['greenroom']}")
    print(f"  Splat inbox: {BROWSE_ROOTS['splat-inbox']}")
    print(f"  Production splats: {BROWSE_ROOTS['splat-production']}")
    server = http.server.ThreadingHTTPServer(("", PORT), KaminosHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
