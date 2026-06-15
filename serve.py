#!/usr/bin/env python3
"""Kaminos dev server with directory browsing API."""

import http.server
import json
import os
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlparse, parse_qs

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
ROOT = Path(__file__).parent.resolve()

# Directories the browse API can access
SCENES_DIR = ROOT / "scenes"
SCENES_DIR.mkdir(exist_ok=True)

BROWSE_ROOTS = {
    "scratch": ROOT / "scratch",
    "scenes": SCENES_DIR,
    "greenroom": Path(os.environ.get(
        "GPU_GREENROOM_DIR",
        os.path.expanduser("~/.local/state/gpu-greenroom"),
    )),
    "pixal3d": Path(os.path.expanduser("~/dev/pixal3d-mlx/outputs")),
    "trellis2mlx": Path(os.path.expanduser("~/dev/trellis2mlx/assets/outputs")),
}

GREENROOM_STATUS_DIRS = ("done", "failed", "running", "pending", "cancelled")
MESH_EXTENSIONS = {".glb", ".gltf", ".obj"}
JOB_OUTPUT_EVENTS = []
JOB_OUTPUT_EVENTS_LOCK = threading.Lock()


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


class KaminosHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/browse":
            self.handle_browse(parse_qs(parsed.query))
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
        else:
            self.send_json({"error": "Not found"}, 404)

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
            model = data.get("model") or {}
            model_name = model.get("fileName", "scene")
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

    def handle_read(self, params):
        """Read a file's content. ?root=scratch&path=file.json"""
        root_name = params.get("root", ["scratch"])[0]
        sub_path = params.get("path", [""])[0]

        root = BROWSE_ROOTS.get(root_name)
        if not root:
            self.send_json({"error": f"Unknown root: {root_name}"}, 400)
            return

        target = (root / sub_path).resolve()
        if not target.is_relative_to(root.resolve()):
            self.send_json({"error": "Path traversal"}, 403)
            return

        if not target.is_file():
            self.send_json({"error": "Not a file"}, 404)
            return

        # For images, serve directly
        ext = target.suffix.lower()
        if ext in (".png", ".jpg", ".jpeg", ".exr", ".glb", ".gltf", ".ply"):
            self.send_response(200)
            content_types = {
                ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
                ".exr": "application/octet-stream", ".ply": "application/octet-stream",
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
            ".exr": "application/octet-stream", ".ply": "application/octet-stream",
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
    print(f"Kaminos server at http://localhost:{PORT}")
    print(f"  Scratch: {BROWSE_ROOTS['scratch']}")
    print(f"  Greenroom: {BROWSE_ROOTS['greenroom']}")
    server = http.server.ThreadingHTTPServer(("", PORT), KaminosHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
