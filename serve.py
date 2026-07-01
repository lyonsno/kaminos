#!/usr/bin/env python3
"""Kaminos dev server with directory browsing API."""

import http.server
import json
import os
import re
import sys
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlencode

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
ROOT = Path(__file__).parent.resolve()

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

BROWSE_ROOTS = {
    "scratch": ROOT / "scratch",
    "scenes": SCENES_DIR,
    "splat-inbox": KAMINOS_SPLAT_INBOX_DIR,
    "splat-production": KAMINOS_SPLAT_PRODUCTION_DIR,
    "greenroom": Path(os.environ.get(
        "GPU_GREENROOM_DIR",
        os.path.expanduser("~/.local/state/gpu-greenroom"),
    )),
    "pixal3d": Path(os.path.expanduser("~/dev/pixal3d-mlx/outputs")),
    "trellis2mlx": Path(os.path.expanduser("~/dev/trellis2mlx/assets/outputs")),
}

GREENROOM_STATUS_DIRS = ("done", "failed", "checkpoint_paused", "running", "pending", "cancelled")
MESH_EXTENSIONS = {".glb", ".gltf", ".obj", ".ply", ".spz"}
SPLAT_EXTENSIONS = {".ply", ".spz"}
SPLAT_CORRECTION_SCHEMA = "kaminos.splat-correction.v0"
ROUTE_PROVIDER_INDEX_SCHEMA = "kaminos.route-provider-index.v0"
ROUTE_JOB_SCHEMA = "kaminos.route-job.v0"
CHECKPOINT_PAUSE_REQUEST_SCHEMA = "gpu-greenroom.checkpoint-pause-request.v1"
WEBGPU_RUNTIME_PROFILE_SCHEMA = "kaminos.webgpu-runtime-profile.v0"
WEBGPU_ROUTE_EVIDENCE_CLASSIFICATION_SCHEMA = "kaminos.webgpu-route-evidence-classification.v0"
WEBGPU_ROUTE_SCHEDULER_SCHEMA = "kaminos.webgpu-route-scheduler.v0"
WEBGPU_ROUTE_BACKPRESSURE_SCHEMA = "kaminos.webgpu-route-backpressure.v0"
WEBGPU_ROUTE_RESULT_SCHEMA = "kaminos.webgpu-route-result.v0"
WEBGPU_ROUTE_RECEIPT_SCHEMA = "kaminos.webgpu-route-receipt.v0"
BROWSER_WEBGPU_ROUTE_RESULTS_DIR = (
    Path(os.environ["KAMINOS_BROWSER_WEBGPU_ROUTE_RESULTS_DIR"]).expanduser()
    if os.environ.get("KAMINOS_BROWSER_WEBGPU_ROUTE_RESULTS_DIR")
    else None
)
if BROWSER_WEBGPU_ROUTE_RESULTS_DIR:
    BROWSE_ROOTS["browser-webgpu-route-results"] = BROWSER_WEBGPU_ROUTE_RESULTS_DIR
ROUTE_JOB_STATUSES = {
    "pending",
    "reserved",
    "running",
    "checkpointing",
    "checkpoint_paused",
    "paused_at_checkpoint",
    "done",
    "failed",
    "cancelled",
    "degraded",
}
ROUTE_JOB_INTENTS = {"preview", "hero", "checkpoint", "unknown"}
HYBRID_SPLAT_OVERLAY_MODULE_URL_ENV = "KAMINOS_HYBRID_SPLAT_OVERLAY_MODULE_URL"
HYBRID_SPLAT_OVERLAY_MODULE_URL_ENV_LEGACY = "KAMINOS_HYBRID_SPLAT_MODULE_URL"
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


def runtime_config():
    """Return runtime-only browser defaults for this dev server instance."""
    module_url = (
        os.environ.get(HYBRID_SPLAT_OVERLAY_MODULE_URL_ENV)
        or os.environ.get(HYBRID_SPLAT_OVERLAY_MODULE_URL_ENV_LEGACY)
        or ""
    ).strip()
    return {
        "schema": "kaminos.runtime-config.v0",
        "hybridSplatOverlayModuleUrl": module_url or None,
    }


def splat_asset_root_allows_pointer(root_name):
    return any(root.get("id") == root_name and root.get("kind") == "splat" for root in ASSET_ROOTS)


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
        suffixes = SPLAT_EXTENSIONS if root.get("kind") == "splat" else MESH_EXTENSIONS
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
    correction_document = load_splat_asset_correction(root_id, rel_path)
    return {
        "id": f"{root_id}:{rel_path}",
        "kind": root.get("kind"),
        "stage": root.get("stage", "experimental"),
        "root_id": root_id,
        "root_label": root.get("label") or root_id,
        "name": path.name,
        "path": rel_path,
        "size": size,
        "mtime": path.stat().st_mtime,
        "source": "/api/read?" + urlencode({"root": root_id, "path": rel_path}),
        "correction": correction_document.get("correction") if correction_document else None,
        "display": build_asset_display_metadata(
            path,
            root_label=root.get("label") or root_id,
            stage=root.get("stage", "experimental"),
            size=size,
        ),
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
    return build_asset_entry(root, target)


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


def normalize_route_job_status(status):
    return status if status in ROUTE_JOB_STATUSES else "degraded"


def normalize_route_job_intent(intent):
    return intent if intent in ROUTE_JOB_INTENTS else "unknown"


def _read_json_file(path):
    try:
        return json.loads(path.read_text()), None
    except Exception as exc:
        return None, exc


def _greenroom_schedule(job_dir, state=None):
    schedule, _ = _read_json_file(job_dir / "schedule.json")
    schedule = schedule if isinstance(schedule, dict) else {}
    params = (state or {}).get("params") if isinstance(state, dict) else {}
    params = params if isinstance(params, dict) else {}
    submitted_at = (
        schedule.get("submitted_at")
        or schedule.get("submittedAt")
        or (state or {}).get("submitted_at")
        or (state or {}).get("submittedAt")
        or 0
    )
    priority_class = (
        schedule.get("priority_class")
        or schedule.get("priorityClass")
        or params.get("priority_class")
        or params.get("priorityClass")
        or "normal"
    )
    return {
        "schema": schedule.get("schema") or "gpu-greenroom.schedule.v1",
        "priority_class": str(priority_class),
        "submitted_at": submitted_at,
    }


def _greenroom_route_intent(job_type, status, schedule, state):
    params = (state or {}).get("params") if isinstance(state, dict) else {}
    params = params if isinstance(params, dict) else {}
    explicit = (
        (state or {}).get("route_intent")
        or (state or {}).get("routeIntent")
        or params.get("route_intent")
        or params.get("routeIntent")
        or params.get("intent")
    )
    if explicit:
        return normalize_route_job_intent(str(explicit))
    priority = str((schedule or {}).get("priority_class") or "")
    if priority in {"preview", "hero", "checkpoint"}:
        return priority
    if status == "checkpoint_paused" or isinstance((state or {}).get("checkpoint_yield"), dict):
        return "checkpoint"
    if "checkpoint" in str(job_type or ""):
        return "checkpoint"
    return "unknown"


def _greenroom_receipt_link(status_dir, job_id):
    return "/api/read?" + urlencode({
        "root": "greenroom",
        "path": f"{status_dir}/{job_id}/receipt.json",
    })


def _greenroom_output_links(job_id, receipt):
    links = []
    for name in list_greenroom_output_files(receipt):
        links.append({
            "name": name,
            "path": f"/api/job-output?job_id={job_id}&file={name}",
            "kind": "mesh" if Path(name).suffix.lower() in MESH_EXTENSIONS else "file",
        })
    return links


def _greenroom_read_link_for_path(path):
    greenroom = BROWSE_ROOTS.get("greenroom")
    if not greenroom or not path:
        return None
    try:
        root = Path(greenroom).expanduser().resolve()
        resolved = Path(path).expanduser().resolve()
    except OSError:
        return None
    if not resolved.is_file() or not resolved.is_relative_to(root):
        return None
    return "/api/read?" + urlencode({
        "root": "greenroom",
        "path": str(resolved.relative_to(root)),
    })


def _browser_webgpu_result_read_link(path):
    result_root = BROWSER_WEBGPU_ROUTE_RESULTS_DIR
    if not result_root or not path:
        return None
    try:
        root = Path(result_root).expanduser().resolve()
        resolved = Path(path).expanduser().resolve()
    except OSError:
        return None
    if not resolved.is_file() or not resolved.is_relative_to(root):
        return None
    BROWSE_ROOTS["browser-webgpu-route-results"] = root
    return "/api/read?" + urlencode({
        "root": "browser-webgpu-route-results",
        "path": str(resolved.relative_to(root)),
    })


def _greenroom_checkpoint_pause_capable(job_type):
    return job_type == "trellis2mlx" or str(job_type or "").startswith("trellis2mlx.")


def _greenroom_read_checkpoint_pause_request(job_dir):
    request_path = job_dir / "_control" / "checkpoint_pause_request.json"
    request, _ = _read_json_file(request_path)
    if not isinstance(request, dict):
        return None
    if request.get("schema") != CHECKPOINT_PAUSE_REQUEST_SCHEMA:
        return None
    if request.get("status") != "requested":
        return None
    request.setdefault("receipt_path", str(request_path))
    return request


def _greenroom_control_paths(state):
    output_dir = (state or {}).get("output_dir") or (state or {}).get("outputDir")
    checkpoint_dir = (state or {}).get("checkpoint_dir") or (state or {}).get("checkpointDir")
    checkpoint_stop_file = (
        (state or {}).get("checkpoint_stop_file")
        or (state or {}).get("checkpointStopFile")
    )
    if not checkpoint_dir and output_dir:
        checkpoint_dir = str(Path(output_dir) / "checkpoints")
    if not checkpoint_stop_file and output_dir:
        checkpoint_stop_file = str(Path(output_dir) / "_control" / "checkpoint-stop")
    return checkpoint_dir, checkpoint_stop_file


def _greenroom_path_is_writable_control(path):
    greenroom = BROWSE_ROOTS.get("greenroom")
    if not greenroom or not path:
        return False
    try:
        root = Path(greenroom).expanduser().resolve()
        resolved = Path(path).expanduser().resolve()
    except OSError:
        return False
    return resolved == root or resolved.is_relative_to(root)


def _greenroom_resumability(state, checkpoint_pause_request=None):
    checkpoint_yield = (state or {}).get("checkpoint_yield")
    if isinstance(checkpoint_yield, dict) and checkpoint_yield.get("schema") == "trellis2mlx.checkpoint_yield.v1":
        resumability = {
            "kind": "cooperative-checkpoint",
            "state": checkpoint_yield.get("status"),
            "completedStage": checkpoint_yield.get("completed_stage"),
            "nextStage": checkpoint_yield.get("next_stage"),
            "resumeSupported": bool(checkpoint_yield.get("resume_supported")),
            "checkpointReceipt": checkpoint_yield.get("receipt_path"),
            "pauseRequested": bool(checkpoint_pause_request),
        }
        if checkpoint_yield.get("resume_blocker"):
            resumability["resumeBlocker"] = checkpoint_yield.get("resume_blocker")
        if checkpoint_yield.get("resume_command_hint"):
            resumability["resumeCommandHint"] = checkpoint_yield.get("resume_command_hint")
        return resumability
    if checkpoint_pause_request:
        return {
            "kind": "cooperative-checkpoint",
            "state": "pause_requested",
            "pauseRequested": True,
            "resumeSupported": False,
            "checkpointStopFile": checkpoint_pause_request.get("checkpoint_stop_file"),
            "pauseRequestReceipt": checkpoint_pause_request.get("receipt_path"),
        }
    return {"kind": "unknown"}


def _greenroom_native_checkpoint_fields(state, checkpoint_pause_request=None):
    fields = {}
    if (state or {}).get("checkpoint_dir"):
        fields["checkpoint_dir"] = state.get("checkpoint_dir")
    if (state or {}).get("checkpoint_stop_file"):
        fields["checkpoint_stop_file"] = state.get("checkpoint_stop_file")
    checkpoint_yield = (state or {}).get("checkpoint_yield")
    if isinstance(checkpoint_yield, dict) and checkpoint_yield.get("receipt_path"):
        fields["checkpoint_yield_receipt"] = checkpoint_yield.get("receipt_path")
    if checkpoint_pause_request:
        fields["checkpoint_pause_requested"] = True
        if checkpoint_pause_request.get("receipt_path"):
            fields["checkpoint_pause_request_receipt"] = checkpoint_pause_request.get("receipt_path")
        if checkpoint_pause_request.get("checkpoint_stop_file"):
            fields["checkpoint_stop_file"] = checkpoint_pause_request.get("checkpoint_stop_file")
    return fields


def _greenroom_route_controls(job_type, status, state, checkpoint_pause_request):
    if status not in {"pending", "running"}:
        return []
    if checkpoint_pause_request:
        return []
    if isinstance((state or {}).get("checkpoint_yield"), dict):
        return []
    if not _greenroom_checkpoint_pause_capable(job_type):
        return []
    _, checkpoint_stop_file = _greenroom_control_paths(state)
    if not _greenroom_path_is_writable_control(checkpoint_stop_file):
        return []
    return [{
        "kind": "request-checkpoint-pause",
        "label": "Stop after checkpoint",
    }]


def _greenroom_route_capabilities(job_type, status, state, checkpoint_pause_request, controls):
    resumability = _greenroom_resumability(state, checkpoint_pause_request)
    checkpoint_capable = _greenroom_checkpoint_pause_capable(job_type)
    return {
        "deferable": status == "pending",
        "abortable": status in {"pending", "running"},
        "chunkYieldable": False,
        "checkpointable": checkpoint_capable,
        "checkpointPauseRequestable": any(control.get("kind") == "request-checkpoint-pause" for control in controls),
        "resumable": False,
        "resumeAdvertised": bool(resumability.get("resumeSupported")),
        "warmCacheSensitive": False,
        "memoryExclusive": True,
    }


def _greenroom_route_warnings(status, resumability, warnings):
    route_warnings = list(warnings or [])
    if resumability.get("pauseRequested"):
        route_warnings.append({
            "kind": "pause_requested",
            "message": "Cooperative stop has been requested; the job has not checkpoint-paused yet.",
        })
    if status == "checkpoint_paused" and resumability.get("resumeSupported"):
        route_warnings.append({
            "kind": "resume_unverified",
            "message": "Resume is advertised by the checkpoint receipt but has not been exercised through Kaminos.",
        })
    if resumability.get("kind") == "unknown" and status in {"pending", "running"}:
        route_warnings.append({
            "kind": "non_resumable_unverified",
            "message": "This route has no verified checkpoint/resume contract.",
        })
    return route_warnings


def _native_greenroom_route_job(job_id, job_type, status, schedule, state, status_dir, job_dir, checkpoint_pause_request=None, controls=None, warnings=None):
    input_path = (state or {}).get("input_path") or (state or {}).get("inputPath")
    output_dir = (state or {}).get("output_dir") or (state or {}).get("outputDir")
    input_artifacts = []
    if input_path:
        input_artifacts.append({"role": "input", "path": input_path})
    controls = list(controls or [])
    normalized_status = normalize_route_job_status(status)
    resumability = _greenroom_resumability(state, checkpoint_pause_request)
    route_warnings = _greenroom_route_warnings(normalized_status, resumability, warnings)
    return {
        "schema": ROUTE_JOB_SCHEMA,
        "id": job_id,
        "routeId": job_type or "unknown",
        "executor": {
            "kind": "native-greenroom",
            "id": "local-greenroom",
            "nativeQueueDir": str(BROWSE_ROOTS.get("greenroom", "")),
        },
        "intent": _greenroom_route_intent(job_type, normalized_status, schedule, state),
        "priorityClass": schedule["priority_class"],
        "status": normalized_status,
        "inputArtifacts": input_artifacts,
        "outputPolicy": {"root": output_dir, "mode": "caller-owned"} if output_dir else None,
        "capabilities": _greenroom_route_capabilities(job_type, normalized_status, state, checkpoint_pause_request, controls),
        "controls": controls,
        "resumability": resumability,
        "warnings": route_warnings,
        "native": {
            "greenroom_job_id": job_id,
            "status_dir": status_dir,
            "job_dir": str(job_dir),
            "output_dir": output_dir,
            **_greenroom_native_checkpoint_fields(state, checkpoint_pause_request),
        },
    }


def _greenroom_route_row(greenroom, status_dir, job_dir):
    raw, exc = _read_json_file(job_dir / "status.json")
    raw = raw if isinstance(raw, dict) else {}
    parse_error = None
    legacy_status = None
    warnings = []
    if exc is not None:
        parse_error = str(exc)
    try:
        job_id = raw["job_id"]
        job_type = raw["job_type"]
        status = raw["status"]
    except KeyError as missing:
        job_id = raw.get("job_id") or raw.get("jobId") or job_dir.name
        job_type = raw.get("job_type") or raw.get("jobType")
        status = "degraded"
        parse_error = parse_error or f"missing current Greenroom status field: {missing.args[0]}"
        legacy_status = raw
        warnings.append({
            "kind": "degraded_greenroom_status",
            "message": "Greenroom status row did not match the current native executor schema.",
        })

    if status not in ROUTE_JOB_STATUSES:
        warnings.append({
            "kind": "unknown_route_status",
            "message": f"Unknown route status: {status}",
        })
        status = "degraded"

    schedule = _greenroom_schedule(job_dir, raw)
    receipt, receipt_exc = _read_json_file(job_dir / "receipt.json")
    receipt = receipt if isinstance(receipt, dict) else {}
    if receipt_exc and (job_dir / "receipt.json").exists():
        warnings.append({
            "kind": "receipt_parse_error",
            "message": str(receipt_exc),
        })
    if receipt:
        raw = {**raw, **{k: v for k, v in receipt.items() if v is not None}}
    checkpoint_pause_request = _greenroom_read_checkpoint_pause_request(job_dir)
    controls = _greenroom_route_controls(job_type, status, raw, checkpoint_pause_request)
    route_job = _native_greenroom_route_job(
        job_id,
        job_type,
        status,
        schedule,
        raw,
        status_dir,
        job_dir,
        checkpoint_pause_request,
        controls,
        warnings,
    )
    warnings = route_job.get("warnings", warnings)
    display = build_display_metadata(
        job_id,
        entry_type="dir",
        receipt=receipt or raw,
        output_files=list_greenroom_output_files(receipt or raw),
    )
    row = {
        "schema": "kaminos.route-provider-row.v0",
        "provider": "native-greenroom",
        "job_id": job_id,
        "status_dir": status_dir,
        "route_job": route_job,
        "display": display,
        "schedule": schedule,
        "process": {
            "pid": raw.get("pid"),
            "worker_pid": raw.get("worker_pid") or raw.get("workerPid"),
            "child_pid": raw.get("child_pid") or raw.get("childPid"),
            "process_group_id": raw.get("process_group_id") or raw.get("processGroupId"),
        },
        "receipt_link": _greenroom_receipt_link(status_dir, job_id) if (job_dir / "receipt.json").exists() else None,
        "checkpoint_receipt_link": _greenroom_read_link_for_path(
            (raw.get("checkpoint_yield") or {}).get("receipt_path")
            if isinstance(raw.get("checkpoint_yield"), dict)
            else None
        ),
        "output_links": _greenroom_output_links(job_id, receipt or raw),
        "controls": controls,
        "checkpoint_pause_request": checkpoint_pause_request,
        "warnings": warnings,
        "parse_error": parse_error,
    }
    if legacy_status is not None:
        row["legacy_status"] = legacy_status
    return row


def _find_greenroom_job_dir(job_id, status_dirs=("running", "pending")):
    greenroom = BROWSE_ROOTS.get("greenroom")
    if not greenroom or not greenroom.exists():
        return None
    root = greenroom.resolve()
    for status_dir in status_dirs:
        job_dir = (greenroom / status_dir / job_id).resolve()
        status_root = (greenroom / status_dir).resolve()
        if not job_dir.is_relative_to(status_root):
            continue
        if not job_dir.is_relative_to(root):
            continue
        if (job_dir / "status.json").exists():
            return job_dir, status_dir
    return None


def request_greenroom_checkpoint_pause(job_id):
    located = _find_greenroom_job_dir(job_id)
    if not located:
        return None
    job_dir, status_dir = located
    state, exc = _read_json_file(job_dir / "status.json")
    state = state if isinstance(state, dict) else {}
    if exc is not None:
        raise ValueError(f"Could not read Greenroom status for {job_id}: {exc}")
    job_type = state.get("job_type") or state.get("jobType")
    if not _greenroom_checkpoint_pause_capable(job_type):
        raise ValueError(f"Job type {job_type!r} does not advertise cooperative checkpoint pause")
    checkpoint_dir, checkpoint_stop_file = _greenroom_control_paths(state)
    if not checkpoint_stop_file:
        raise ValueError(f"Job {job_id} has no checkpoint stop file")
    if not _greenroom_path_is_writable_control(checkpoint_stop_file):
        raise PermissionError("checkpoint stop file is outside the configured Greenroom root")

    stop_path = Path(checkpoint_stop_file).expanduser().resolve()
    request_path = job_dir / "_control" / "checkpoint_pause_request.json"
    receipt = {
        "schema": CHECKPOINT_PAUSE_REQUEST_SCHEMA,
        "status": "requested",
        "job_id": job_id,
        "job_type": job_type,
        "job_status_at_request": state.get("status") or status_dir,
        "requested_at": time.time(),
        "checkpoint_dir": checkpoint_dir,
        "checkpoint_stop_file": str(stop_path),
        "receipt_path": str(request_path),
        "request_semantics": "cooperative_stop_after_next_checkpoint",
    }
    request_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_request = request_path.with_suffix(request_path.suffix + ".tmp")
    tmp_request.write_text(json.dumps(receipt, indent=2) + "\n")
    os.replace(tmp_request, request_path)

    stop_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_stop = stop_path.with_suffix(stop_path.suffix + ".tmp")
    tmp_stop.write_text(json.dumps(receipt, indent=2) + "\n")
    os.replace(tmp_stop, stop_path)
    return receipt


def build_greenroom_route_provider_index():
    greenroom = BROWSE_ROOTS.get("greenroom")
    queue_dir = Path(greenroom).expanduser() if greenroom else None
    rows = []
    if queue_dir and queue_dir.exists():
        for status_dir in GREENROOM_STATUS_DIRS:
            status_root = queue_dir / status_dir
            if not status_root.is_dir():
                continue
            for job_dir in sorted(path for path in status_root.iterdir() if path.is_dir()):
                if not (job_dir / "status.json").exists():
                    continue
                rows.append(_greenroom_route_row(queue_dir, status_dir, job_dir))

    summary = {}
    for row in rows:
        status = row.get("route_job", {}).get("status") or "degraded"
        summary[status] = summary.get(status, 0) + 1
    return {
        "schema": ROUTE_PROVIDER_INDEX_SCHEMA,
        "provider": {
            "kind": "native-greenroom",
            "id": "local-greenroom",
            "source": "filesystem",
            "queue_dir": str(queue_dir) if queue_dir else None,
        },
        "summary": summary,
        "rows": rows,
    }


def _browser_webgpu_evidence_classification(receipt, *, authoritative=False, classification="demo", reasons=None):
    runtime = receipt.get("runtime") if isinstance(receipt, dict) else {}
    runtime = runtime if isinstance(runtime, dict) else {}
    scheduler = runtime.get("scheduler") if isinstance(runtime.get("scheduler"), dict) else {}
    backpressure = runtime.get("backpressure") if isinstance(runtime.get("backpressure"), dict) else {}
    backend = receipt.get("backend") if isinstance(receipt, dict) and isinstance(receipt.get("backend"), dict) else {}
    timings = receipt.get("timings") if isinstance(receipt, dict) and isinstance(receipt.get("timings"), dict) else {}
    outputs = receipt.get("outputs") if isinstance(receipt, dict) and isinstance(receipt.get("outputs"), list) else []
    frame_tail = backpressure.get("frameTail") if isinstance(backpressure.get("frameTail"), dict) else {}
    return {
        "schema": WEBGPU_ROUTE_EVIDENCE_CLASSIFICATION_SCHEMA,
        "classification": classification,
        "authoritative": bool(authoritative),
        "reasons": list(reasons or []),
        "routeId": receipt.get("effectiveRouteId") or receipt.get("requestedRouteId") if isinstance(receipt, dict) else None,
        "requestedRouteId": receipt.get("requestedRouteId") if isinstance(receipt, dict) else None,
        "effectiveRouteId": receipt.get("effectiveRouteId") if isinstance(receipt, dict) else None,
        "backendKind": backend.get("kind"),
        "adapterName": backend.get("adapterName"),
        "timingSource": timings.get("source"),
        "totalMs": timings.get("totalMs") if isinstance(timings.get("totalMs"), (int, float)) else None,
        "schedulerVerificationState": scheduler.get("verificationState"),
        "schedulerMode": (
            scheduler.get("effectiveScheduler", {}).get("mode")
            if isinstance(scheduler.get("effectiveScheduler"), dict)
            else None
        ) or (
            scheduler.get("requestedScheduler", {}).get("mode")
            if isinstance(scheduler.get("requestedScheduler"), dict)
            else None
        ),
        "schedulerUnsupportedFields": (
            list(scheduler.get("effectiveScheduler", {}).get("unsupportedFields", []))
            if isinstance(scheduler.get("effectiveScheduler"), dict)
            and isinstance(scheduler.get("effectiveScheduler", {}).get("unsupportedFields"), list)
            else []
        ),
        "requestedBudget": backpressure.get("requestedBudget"),
        "effectiveBudget": backpressure.get("effectiveBudget"),
        "longFrameCount": frame_tail.get("longFrameCount") if isinstance(frame_tail.get("longFrameCount"), int) else None,
        "maxFrameGapMs": frame_tail.get("maxFrameGapMs") if isinstance(frame_tail.get("maxFrameGapMs"), (int, float)) else None,
        "outputRoles": [output.get("role") for output in outputs if isinstance(output, dict) and output.get("role")],
        "createdAt": receipt.get("createdAt") if isinstance(receipt, dict) else None,
    }


def _browser_webgpu_fixture_row():
    route_id = "moge.depth-normal.webgpu-local.v0"
    backend_identity = {
        "kind": "webgpu-local",
        "runtime": "browser",
        "adapterName": "not-probed",
        "browser": None,
        "features": [],
        "requestedFeatures": [],
        "limits": {},
        "timestampQuery": "not-requested",
    }
    scheduler_profile = {
        "schema": WEBGPU_ROUTE_SCHEDULER_SCHEMA,
        "requestedScheduler": {
            "mode": "throughput",
            "yieldMs": 0,
            "waitForSubmittedWorkDone": False,
            "phaseChunkSize": {},
        },
        "effectiveScheduler": {
            "mode": "throughput",
            "yieldMs": 0,
            "waitForSubmittedWorkDone": False,
            "phaseChunkSize": {},
            "unsupportedFields": [],
        },
        "verificationState": "scheduler-unverified",
    }
    backpressure_profile = {
        "schema": WEBGPU_ROUTE_BACKPRESSURE_SCHEMA,
        "requestedBudget": "visible-wait",
        "effectiveBudget": "visible-wait",
        "memoryExclusivity": "unknown",
        "warmCacheState": "not-loaded",
        "frameTail": {
            "sampleWindowMs": 0,
            "longFrameCount": 0,
            "maxFrameGapMs": 0,
            "p95FrameGapMs": None,
            "p99FrameGapMs": None,
        },
    }
    runtime_profile = {
        "schema": WEBGPU_RUNTIME_PROFILE_SCHEMA,
        "routeId": route_id,
        "runtimeLabel": "fixture-browser-webgpu-not-probed",
        "backend": backend_identity,
        "kernel": {
            "kitVersion": "fixture",
            "profile": "moge-depth-normal-fixture",
            "commit": None,
        },
        "profile": {
            "schema": "kaminos.webgpu-staged-profile.v0",
            "route": "fixture-not-run",
            "timingSource": "fixture-not-run",
            "timestampQueryValidatedAgainstStaged": False,
            "requiredStages": ["fixture-not-run"],
            "stages": [{"name": "fixture-not-run", "ms": 0}],
            "stageNames": ["fixture-not-run"],
            "totalMs": 0,
        },
        "evidence": {
            "mode": "demo",
            "source": "kaminos-browser-webgpu-route-fixture",
            "fallbackReason": None,
        },
        "requiredStages": ["fixture-not-run"],
        "timingSource": "fixture-not-run",
        "createdAt": None,
    }
    evidence_classification = {
        **_browser_webgpu_evidence_classification({
            "requestedRouteId": route_id,
            "effectiveRouteId": route_id,
            "backend": backend_identity,
            "timings": {"source": "fixture-not-run", "totalMs": 0},
            "outputs": [
                {"role": "depth"},
                {"role": "normal"},
                {"role": "pointmap"},
            ],
            "runtime": {
                "scheduler": scheduler_profile,
                "backpressure": backpressure_profile,
            },
            "createdAt": None,
        }, authoritative=False, classification="demo", reasons=["fixture route identity only; no live WebGPU receipt has been produced"]),
    }
    route_job = {
        "schema": ROUTE_JOB_SCHEMA,
        "id": "browser-webgpu-moge-fixture",
        "routeId": route_id,
        "executor": {
            "kind": "browser-webgpu",
            "id": "webgpu-inference-kit-fixture",
            "backendKind": "webgpu-local",
            "workerModule": "webgpu-inference-kit/routes/moge-worker.js",
        },
        "intent": "preview",
        "priorityClass": "preview",
        "status": "reserved",
        "inputArtifacts": [],
        "outputPolicy": {"mode": "kaminos-artifact-sidecar"},
        "capabilities": {
            "deferable": False,
            "abortable": False,
            "chunkYieldable": False,
            "deferBeforeStart": False,
            "abortBeforeCommit": False,
            "cooperativeYieldable": False,
            "schedulerConfigurable": False,
            "checkpointable": False,
            "checkpointPauseRequestable": False,
            "resumable": False,
            "resumeAdvertised": False,
            "warmCacheSensitive": True,
            "memoryExclusive": True,
            "memoryPressureSensitive": True,
            "frameBudgetSensitive": True,
        },
        "controls": [],
        "resumability": {
            "kind": "unproven",
            "resumeSupported": False,
            "yieldSupported": False,
        },
        "warnings": [
            {
                "kind": "scheduler_unverified",
                "message": "Browser WebGPU scheduler/backpressure fields are fixture evidence; no cooperative scheduler telemetry has been exercised.",
            },
            {
                "kind": "fixture_route_identity_only",
                "message": "Browser WebGPU route identity fixture only; no live model execution or cooperative yield has been exercised.",
            },
        ],
        "metadata": {
            "effectiveBackend": {
                "kind": "webgpu-local",
                "execution": "browser-worker",
            },
            "model": {
                "id": "Ruicheng/moge-2-vitl-normal",
                "role": "depth-normal-pointmap",
            },
            "cache": {
                "state": "not-loaded",
                "warmCacheSensitive": True,
            },
            "device": {
                "adapter": None,
                "features": [],
                "identitySource": "not-probed",
            },
            "runtimeProfile": runtime_profile,
            "scheduler": scheduler_profile,
            "backpressure": backpressure_profile,
            "evidenceClassification": evidence_classification,
        },
    }
    row = {
        "schema": "kaminos.route-provider-row.v0",
        "provider": "browser-webgpu",
        "job_id": route_job["id"],
        "status_dir": "fixture",
        "route_job": route_job,
        "display": {
            "title": "MoGE WebGPU",
            "subtitle": "browser-webgpu / webgpu-local / preview",
            "meta": "fixture route identity only",
            "raw_name": route_job["id"],
            "job_type_label": "Browser WebGPU",
            "load_label": "Open",
        },
        "schedule": {
            "schema": "kaminos.browser-webgpu.schedule.v0",
            "priority_class": "preview",
            "submitted_at": 0,
        },
        "process": {
            "pid": None,
            "worker_pid": None,
            "child_pid": None,
            "process_group_id": None,
        },
        "receipt_link": None,
        "checkpoint_receipt_link": None,
        "output_links": [],
        "controls": [],
        "warnings": route_job["warnings"],
        "parse_error": None,
    }
    return row


def _is_nonempty_string(value):
    return isinstance(value, str) and bool(value.strip())


def _browser_webgpu_result_errors(result):
    errors = []
    if not isinstance(result, dict):
        return ["result must be an object"]
    if result.get("schema") != WEBGPU_ROUTE_RESULT_SCHEMA:
        errors.append(f"schema must be {WEBGPU_ROUTE_RESULT_SCHEMA}")
    if not _is_nonempty_string(result.get("requestId")):
        errors.append("requestId must be a non-empty string")
    if not _is_nonempty_string(result.get("routeId")):
        errors.append("routeId must be a non-empty string")
    receipt = result.get("receipt")
    if not isinstance(receipt, dict):
        errors.append("receipt must be an object")
        return errors
    if receipt.get("schema") != WEBGPU_ROUTE_RECEIPT_SCHEMA:
        errors.append(f"receipt.schema must be {WEBGPU_ROUTE_RECEIPT_SCHEMA}")
    if receipt.get("requestedRouteId") != result.get("routeId"):
        errors.append("receipt.requestedRouteId must match result.routeId")
    if receipt.get("effectiveRouteId") != result.get("routeId"):
        errors.append("receipt.effectiveRouteId must match result.routeId")
    if result.get("status") != "real" or receipt.get("status") != "real":
        errors.append("result and receipt status must be real")
    if receipt.get("fallbackReason"):
        errors.append("fallbackReason must be absent for authoritative evidence")

    backend = receipt.get("backend")
    if not isinstance(backend, dict):
        errors.append("receipt.backend must be an object")
    else:
        if backend.get("kind") != "webgpu-local":
            errors.append("receipt.backend.kind must be webgpu-local")
        if backend.get("runtime") != "browser":
            errors.append("receipt.backend.runtime must be browser")

    model = receipt.get("model")
    if not isinstance(model, dict):
        errors.append("receipt.model must be an object")
    else:
        for field in ("id", "revision", "weightsHash", "dtype"):
            if not _is_nonempty_string(model.get(field)):
                errors.append(f"receipt.model.{field} must be a non-empty string")

    kernel = receipt.get("kernel")
    if not isinstance(kernel, dict):
        errors.append("receipt.kernel must be an object")
    else:
        for field in ("kitVersion", "profile"):
            if not _is_nonempty_string(kernel.get(field)):
                errors.append(f"receipt.kernel.{field} must be a non-empty string")

    inputs = receipt.get("inputs")
    if not isinstance(inputs, list) or not inputs:
        errors.append("receipt.inputs must be a non-empty array")
    else:
        for index, artifact in enumerate(inputs):
            for field in ("role", "artifactId", "sha256"):
                if not _is_nonempty_string((artifact or {}).get(field)):
                    errors.append(f"receipt.inputs[{index}].{field} must be a non-empty string")

    outputs = receipt.get("outputs")
    if not isinstance(outputs, list) or not outputs:
        errors.append("receipt.outputs must be a non-empty array")
    else:
        for index, artifact in enumerate(outputs):
            artifact = artifact if isinstance(artifact, dict) else {}
            for field in ("role", "artifactId", "sha256"):
                if not _is_nonempty_string(artifact.get(field)):
                    errors.append(f"receipt.outputs[{index}].{field} must be a non-empty string")
            if artifact.get("status") != "real":
                errors.append(f"receipt.outputs[{index}].status must be real")

    timings = receipt.get("timings")
    if not isinstance(timings, dict):
        errors.append("receipt.timings must be an object")
    else:
        if not _is_nonempty_string(timings.get("source")):
            errors.append("receipt.timings.source must be a non-empty string")
        if not isinstance(timings.get("totalMs"), (int, float)) or timings.get("totalMs") < 0:
            errors.append("receipt.timings.totalMs must be a finite non-negative number")
    return errors


def _browser_webgpu_result_filename(result):
    route_id = str(result.get("routeId") or "browser-webgpu-route")
    request_id = str(result.get("requestId") or uuid.uuid4().hex)
    raw_name = f"{route_id}__{request_id}"
    safe_name = "".join(
        char if char.isalnum() or char in ".-_" else "-"
        for char in raw_name
    ).strip(".-_")
    return f"{safe_name or uuid.uuid4().hex}.json"


def write_browser_webgpu_route_result(result):
    """Validate and persist one authoritative browser WebGPU route result."""
    if not BROWSER_WEBGPU_ROUTE_RESULTS_DIR:
        raise RuntimeError("KAMINOS_BROWSER_WEBGPU_ROUTE_RESULTS_DIR is required")

    errors = _browser_webgpu_result_errors(result)
    if errors:
        raise ValueError("; ".join(errors))

    result_root = Path(BROWSER_WEBGPU_ROUTE_RESULTS_DIR).expanduser()
    result_root.mkdir(parents=True, exist_ok=True)
    BROWSE_ROOTS["browser-webgpu-route-results"] = result_root
    filename = _browser_webgpu_result_filename(result)
    result_path = (result_root / filename).resolve()
    root = result_root.resolve()
    if not result_path.is_relative_to(root):
        raise PermissionError("route result path escapes browser WebGPU result root")

    body = json.dumps(result, indent=2, sort_keys=True) + "\n"
    tmp_path = result_path.with_name(f".{result_path.name}.{uuid.uuid4().hex}.tmp")
    tmp_path.write_text(body, encoding="utf-8")
    os.replace(tmp_path, result_path)

    return {
        "schema": "kaminos.browser-webgpu-route-result-write.v0",
        "provider": "browser-webgpu",
        "result_path": str(result_path),
        "receipt_link": _browser_webgpu_result_read_link(result_path),
        "route_provider_index": build_browser_webgpu_route_provider_index(),
    }


def _browser_webgpu_route_row_from_result(path, result):
    receipt = result["receipt"]
    runtime = receipt.get("runtime") if isinstance(receipt.get("runtime"), dict) else {}
    scheduler = runtime.get("scheduler") if isinstance(runtime.get("scheduler"), dict) else None
    backpressure = runtime.get("backpressure") if isinstance(runtime.get("backpressure"), dict) else None
    runtime_profile = runtime.get("runtimeProfile") if isinstance(runtime.get("runtimeProfile"), dict) else None
    backend = receipt.get("backend") if isinstance(receipt.get("backend"), dict) else {}
    model = receipt.get("model") if isinstance(receipt.get("model"), dict) else {}
    cache_state = backpressure.get("warmCacheState") if isinstance(backpressure, dict) else "unknown"
    evidence_classification = _browser_webgpu_evidence_classification(
        receipt,
        authoritative=True,
        classification="authoritative-live-webgpu",
        reasons=[],
    )
    cooperative_verified = (
        isinstance(scheduler, dict)
        and scheduler.get("verificationState") == "verified"
        and isinstance(scheduler.get("effectiveScheduler"), dict)
        and scheduler["effectiveScheduler"].get("mode") == "cooperative"
    )
    route_id = receipt.get("effectiveRouteId") or result.get("routeId")
    job_id = f"browser-webgpu-{result.get('requestId')}"
    route_job = {
        "schema": ROUTE_JOB_SCHEMA,
        "id": job_id,
        "routeId": route_id,
        "executor": {
            "kind": "browser-webgpu",
            "id": "webgpu-inference-kit-result",
            "backendKind": "webgpu-local",
            "workerModule": result.get("request", {}).get("workerModule") if isinstance(result.get("request"), dict) else None,
        },
        "intent": "preview",
        "priorityClass": "preview",
        "status": "done",
        "inputArtifacts": receipt.get("inputs") or [],
        "outputPolicy": {"mode": "kit-route-result"},
        "capabilities": {
            "deferable": False,
            "abortable": False,
            "chunkYieldable": cooperative_verified,
            "deferBeforeStart": False,
            "abortBeforeCommit": False,
            "cooperativeYieldable": cooperative_verified,
            "schedulerConfigurable": False,
            "checkpointable": False,
            "checkpointPauseRequestable": False,
            "resumable": False,
            "resumeAdvertised": False,
            "warmCacheSensitive": True,
            "memoryExclusive": backpressure.get("memoryExclusivity") == "exclusive" if isinstance(backpressure, dict) else False,
            "memoryPressureSensitive": True,
            "frameBudgetSensitive": True,
        },
        "controls": [],
        "resumability": {
            "kind": "cooperative-yield" if cooperative_verified else "unproven",
            "resumeSupported": False,
            "yieldSupported": cooperative_verified,
            "schedulerVerificationState": scheduler.get("verificationState") if isinstance(scheduler, dict) else None,
        },
        "warnings": [] if cooperative_verified else [{
            "kind": "scheduler_unverified",
            "message": "Browser WebGPU result did not prove effective cooperative scheduler telemetry.",
        }],
        "metadata": {
            "effectiveBackend": {
                "kind": backend.get("kind"),
                "execution": backend.get("runtime"),
            },
            "model": {
                "id": model.get("id"),
                "revision": model.get("revision"),
                "role": "depth-normal-pointmap" if model.get("id") == "Ruicheng/moge-2-vitl-normal" else None,
            },
            "cache": {
                "state": cache_state,
                "warmCacheSensitive": True,
            },
            "device": {
                "adapter": backend.get("adapterName"),
                "features": backend.get("features") if isinstance(backend.get("features"), list) else [],
                "identitySource": "route-result",
            },
            "runtimeProfile": runtime_profile,
            "scheduler": scheduler,
            "backpressure": backpressure,
            "evidenceClassification": evidence_classification,
            "sourceResultPath": str(path),
            "routeResult": result,
        },
    }
    display_title = "MoGE WebGPU Live" if route_id == "moge.depth-normal.webgpu-local.v0" else _clean_label(route_id, "Browser WebGPU")
    row = {
        "schema": "kaminos.route-provider-row.v0",
        "provider": "browser-webgpu",
        "job_id": job_id,
        "status_dir": "route-result",
        "route_job": route_job,
        "display": {
            "title": display_title,
            "subtitle": "browser-webgpu / webgpu-local / live receipt",
            "meta": f"kit route result {Path(path).name}",
            "raw_name": job_id,
            "job_type_label": "Browser WebGPU",
            "load_label": "Open",
        },
        "schedule": {
            "schema": "kaminos.browser-webgpu.schedule.v0",
            "priority_class": "preview",
            "submitted_at": result.get("createdAt") or receipt.get("createdAt"),
        },
        "process": {
            "pid": None,
            "worker_pid": None,
            "child_pid": None,
            "process_group_id": None,
        },
        "receipt_link": _browser_webgpu_result_read_link(path),
        "checkpoint_receipt_link": None,
        "output_links": [],
        "controls": [],
        "warnings": route_job["warnings"],
        "parse_error": None,
    }
    return row


def _load_browser_webgpu_result_rows(result_dir):
    if not result_dir:
        return [], 0
    result_root = Path(result_dir).expanduser()
    if not result_root.is_dir():
        return [], 0
    rows = []
    invalid_count = 0
    for path in sorted(result_root.glob("*.json")):
        try:
            result = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            invalid_count += 1
            continue
        errors = _browser_webgpu_result_errors(result)
        if errors:
            invalid_count += 1
            continue
        rows.append(_browser_webgpu_route_row_from_result(path, result))
    return rows, invalid_count


def build_browser_webgpu_route_provider_index():
    live_rows, invalid_count = _load_browser_webgpu_result_rows(BROWSER_WEBGPU_ROUTE_RESULTS_DIR)
    rows = live_rows if live_rows else [_browser_webgpu_fixture_row()]
    return {
        "schema": ROUTE_PROVIDER_INDEX_SCHEMA,
        "provider": {
            "kind": "browser-webgpu",
            "id": "local-browser-webgpu",
            "source": "route-result-files" if live_rows else "fixture",
            "result_dir": str(BROWSER_WEBGPU_ROUTE_RESULTS_DIR) if BROWSER_WEBGPU_ROUTE_RESULTS_DIR else None,
        },
        "summary": {
            status: sum(1 for row in rows if row.get("route_job", {}).get("status") == status)
            for status in sorted({row.get("route_job", {}).get("status") for row in rows})
            if status
        },
        "invalid_result_count": invalid_count,
        "rows": rows,
    }


def build_route_provider_index(provider="native-greenroom"):
    if provider == "native-greenroom":
        return build_greenroom_route_provider_index()
    if provider == "browser-webgpu":
        return build_browser_webgpu_route_provider_index()
    if provider != "all":
        raise ValueError(f"Unsupported route job provider: {provider}")

    indexes = [
        build_greenroom_route_provider_index(),
        build_browser_webgpu_route_provider_index(),
    ]
    rows = []
    summary = {}
    for index in indexes:
        rows.extend(index.get("rows") or [])
        for status, count in (index.get("summary") or {}).items():
            summary[status] = summary.get(status, 0) + count
    return {
        "schema": ROUTE_PROVIDER_INDEX_SCHEMA,
        "provider": {
            "kind": "kaminos-route-providers",
            "id": "all",
            "source": "combined",
            "providers": [index.get("provider", {}) for index in indexes],
        },
        "summary": summary,
        "rows": rows,
    }


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


class KaminosHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/runtime-config":
            self.handle_runtime_config()
        elif parsed.path == "/api/browse":
            self.handle_browse(parse_qs(parsed.query))
        elif parsed.path == "/api/assets":
            self.handle_assets(parse_qs(parsed.query))
        elif parsed.path == "/api/route-jobs":
            self.handle_route_jobs(parse_qs(parsed.query))
        elif parsed.path == "/api/splat-correction":
            self.handle_splat_correction_get(parse_qs(parsed.query))
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
        else:
            super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/save-scene":
            self.handle_save_scene()
        elif parsed.path == "/api/ingest-splat":
            self.handle_ingest_splat(parse_qs(parsed.query))
        elif parsed.path == "/api/splat-correction":
            self.handle_splat_correction_post(parse_qs(parsed.query))
        elif parsed.path == "/api/route-results/browser-webgpu":
            self.handle_browser_webgpu_route_result_post()
        elif parsed.path == "/api/route-jobs/checkpoint-pause":
            self.handle_route_job_checkpoint_pause(parse_qs(parsed.query))
        else:
            self.send_json({"error": "Not found"}, 404)

    def handle_runtime_config(self):
        self.send_json(runtime_config())

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
        """List declared asset roots. v0 supports splat assets."""
        kind = params.get("kind", ["splat"])[0]
        if kind not in {"splat", "all"}:
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

    def handle_route_jobs(self, params):
        """Expose read-only route job rows for route trays."""
        provider = params.get("provider", ["native-greenroom"])[0]
        if provider not in {"native-greenroom", "browser-webgpu", "all"}:
            self.send_json({"error": f"Unsupported route job provider: {provider}"}, 400)
            return
        self.send_json(build_route_provider_index(provider))

    def handle_route_job_checkpoint_pause(self, params):
        """Request cooperative stop after the next checkpoint boundary."""
        provider = params.get("provider", ["native-greenroom"])[0]
        if provider != "native-greenroom":
            self.send_json({"error": f"Unsupported route job provider: {provider}"}, 400)
            return
        job_id = params.get("job_id", [""])[0]
        if not job_id:
            self.send_json({"error": "job_id required"}, 400)
            return
        try:
            receipt = request_greenroom_checkpoint_pause(job_id)
        except PermissionError as error:
            self.send_json({"error": str(error)}, 403)
            return
        except ValueError as error:
            self.send_json({"error": str(error)}, 400)
            return
        if receipt is None:
            self.send_json({"error": f"Job {job_id} not found or not pending/running"}, 404)
            return
        self.send_json({
            "schema": "kaminos.route-job-action-result.v0",
            "provider": "native-greenroom",
            "job_id": job_id,
            "action": "request-checkpoint-pause",
            "receipt": receipt,
            "route_provider_index": build_greenroom_route_provider_index(),
        })

    def handle_browser_webgpu_route_result_post(self):
        """Persist a browser WebGPU kit route result for route-tray ingestion."""
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_json({"error": "Invalid Content-Length"}, 400)
            return
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            self.send_json({"error": "Invalid JSON"}, 400)
            return
        try:
            result = write_browser_webgpu_route_result(payload)
        except RuntimeError as error:
            self.send_json({"error": str(error)}, 503)
            return
        except PermissionError as error:
            self.send_json({"error": str(error)}, 403)
            return
        except ValueError as error:
            self.send_json({"error": str(error)}, 400)
            return
        self.send_json(result, 201)

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
        if ext in (".png", ".jpg", ".jpeg", ".exr", ".glb", ".gltf", ".ply", ".spz"):
            self.send_response(200)
            content_types = {
                ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
                ".exr": "application/octet-stream", ".ply": "application/octet-stream", ".spz": "application/octet-stream",
            }
            self.send_header("Content-Type", content_types.get(ext, "application/octet-stream"))

            self.end_headers()
            self.wfile.write(target.read_bytes())
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
        self.send_header("Content-Length", len(body))
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
