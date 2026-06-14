#!/usr/bin/env python3
"""Kaminos dev server with directory browsing API."""

import http.server
import json
import os
import sys
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
            # For receipt dirs, include receipt summary
            receipt_file = entry / "receipt.json" if entry.is_dir() else None
            if receipt_file and receipt_file.exists():
                try:
                    receipt = json.loads(receipt_file.read_text())
                    info["receipt"] = {
                        k: receipt.get(k) for k in [
                            "status", "job_type", "exit_code",
                            "started_at", "finished_at", "failure_phase",
                            "output_dir", "input_path",
                        ]
                    }
                    # List output files if output_dir exists
                    out_dir = receipt.get("output_dir")
                    if out_dir and Path(out_dir).is_dir():
                        info["output_files"] = [
                            f.name for f in sorted(Path(out_dir).iterdir())
                            if f.is_file() and not f.name.startswith(".")
                        ]
                except Exception:
                    pass
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

        receipt_data = None
        for status_dir in ("done", "failed", "running", "pending", "cancelled"):
            receipt_path = greenroom / status_dir / job_id / "receipt.json"
            if receipt_path.exists():
                receipt_data = json.loads(receipt_path.read_text())
                break

        if not receipt_data:
            self.send_json({"error": f"Job {job_id} not found"}, 404)
            return

        output_dir = receipt_data.get("output_dir")
        if not output_dir or not Path(output_dir).is_dir():
            self.send_json({"entries": [], "output_dir": output_dir})
            return

        # Verify output_dir is under a known root or home directory
        output_resolved = Path(output_dir).resolve()
        home = Path.home().resolve()
        if not output_resolved.is_relative_to(home):
            self.send_json({"error": "output_dir outside home directory"}, 403)
            return

        entries = []
        for f in sorted(Path(output_dir).iterdir()):
            if f.name.startswith("."):
                continue
            entries.append({
                "name": f.name,
                "type": "dir" if f.is_dir() else "file",
                "size": f.stat().st_size if f.is_file() else None,
            })
        self.send_json({"entries": entries, "output_dir": output_dir})

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

        # Find the job in any status directory
        receipt_data = None
        for status_dir in ("done", "failed", "running", "pending", "cancelled"):
            receipt_path = greenroom / status_dir / job_id / "receipt.json"
            if receipt_path.exists():
                receipt_data = json.loads(receipt_path.read_text())
                break

        if not receipt_data:
            self.send_json({"error": f"Job {job_id} not found"}, 404)
            return

        output_dir = receipt_data.get("output_dir")
        if not output_dir:
            self.send_json({"error": "No output_dir in receipt"}, 404)
            return

        # Verify output_dir is under home directory
        output_resolved = Path(output_dir).resolve()
        home = Path.home().resolve()
        if not output_resolved.is_relative_to(home):
            self.send_json({"error": "output_dir outside home directory"}, 403)
            return

        target = (Path(output_dir) / filename).resolve()
        # Security: must be under the receipt's output_dir
        if not target.is_relative_to(output_resolved):
            self.send_json({"error": "Path traversal"}, 403)
            return

        if not target.is_file():
            self.send_json({"error": f"File not found: {filename}"}, 404)
            return

        ext = target.suffix.lower()
        content_types = {
            ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
            ".exr": "application/octet-stream", ".ply": "application/octet-stream",
            ".json": "application/json", ".txt": "text/plain", ".log": "text/plain",
        }
        self.send_response(200)
        self.send_header("Content-Type", content_types.get(ext, "application/octet-stream"))
        self.end_headers()
        self.wfile.write(target.read_bytes())

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
    server = http.server.HTTPServer(("", PORT), KaminosHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
