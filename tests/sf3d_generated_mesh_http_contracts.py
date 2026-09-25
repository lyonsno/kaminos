#!/usr/bin/env python3
import hashlib
import json
import os
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        return server.getsockname()[1]


def glb_fixture():
    document = json.dumps({"asset": {"version": "2.0"}}, separators=(",", ":")).encode()
    document += b" " * ((-len(document)) % 4)
    chunk = struct.pack("<I4s", len(document), b"JSON") + document
    return b"glTF" + struct.pack("<II", 2, 12 + len(chunk)) + chunk


def main():
    with tempfile.TemporaryDirectory(prefix="kaminos-generated-mesh-") as temporary:
        root = Path(temporary)
        mesh_root = root / "generated-meshes"
        port = free_port()
        env = {**os.environ, "KAMINOS_GENERATED_MESH_DIR": str(mesh_root)}
        process = subprocess.Popen(
            [sys.executable, str(ROOT / "serve.py"), str(port),
             "--volume-settings-store", str(root / "settings"),
             "--volume-basin-session-store", str(root / "sessions"),
             "--volume-cockpit-layout-store", str(root / "layouts")],
            cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        base = f"http://127.0.0.1:{port}"
        try:
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                try:
                    urllib.request.urlopen(base + "/api/runtime-config", timeout=1).close()
                    break
                except OSError:
                    time.sleep(0.05)
            else:
                raise AssertionError("Kaminos HTTP server did not start")

            payload = glb_fixture()
            digest = hashlib.sha256(payload).hexdigest()
            request = urllib.request.Request(base + "/api/ingest-mesh", data=payload,
                                             headers={"Content-Type": "model/gltf-binary"}, method="POST")
            with urllib.request.urlopen(request, timeout=3) as response:
                receipt = json.loads(response.read())
            assert receipt["schema"] == "kaminos.generated-mesh.v0"
            assert receipt["sha256"] == digest and receipt["bytes"] == len(payload)
            assert (mesh_root / f"{digest}.glb").read_bytes() == payload
            with urllib.request.urlopen(base + receipt["source"], timeout=3) as response:
                assert response.read() == payload

            with urllib.request.urlopen(request, timeout=3) as response:
                duplicate = json.loads(response.read())
            assert duplicate == receipt, "same content must produce the same durable asset receipt"

            bad = urllib.request.Request(base + "/api/ingest-mesh", data=b"not a glb" * 4,
                                         headers={"Content-Type": "model/gltf-binary"}, method="POST")
            try:
                urllib.request.urlopen(bad, timeout=3)
                raise AssertionError("malformed GLB was accepted")
            except urllib.error.HTTPError as error:
                assert error.code == 400
                assert "Invalid GLB" in json.loads(error.read())["error"]
            assert sorted(path.name for path in mesh_root.iterdir()) == [f"{digest}.glb"]
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
    print("generated mesh HTTP persistence and rejection contracts passed")


if __name__ == "__main__":
    main()
