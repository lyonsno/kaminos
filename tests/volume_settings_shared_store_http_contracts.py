#!/usr/bin/env python3
"""Two servers with different local stores share basins through one library."""

import json
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import serve  # noqa: E402


def free_port():
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        return server.getsockname()[1]


def request_json(url, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"} if data is not None else {},
        method="POST" if data is not None else "GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def start_server(temporary, name, *shared_args, env=None):
    port = free_port()
    process = subprocess.Popen(
        [sys.executable, str(ROOT / "serve.py"), str(port),
         "--volume-settings-store", str(Path(temporary) / name),
         "--volume-basin-session-store", str(Path(temporary) / f"{name}-sessions"),
         "--volume-cockpit-layout-store", str(Path(temporary) / f"{name}-layouts"),
         *shared_args],
        cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        env=env,
    )
    base = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        try:
            request_json(f"{base}/api/runtime-config")
            return process, base
        except (OSError, urllib.error.URLError):
            if process.poll() is not None:
                raise AssertionError(f"server exited: {process.stderr.read()}")
            time.sleep(0.05)
    process.terminate()
    raise AssertionError("server did not become available")


def current_payload():
    artifact = json.loads((ROOT / "artifacts" / "default-basin" / "cheap-blast-furnace.json").read_text())
    payload, _projection = serve.normalize_volume_settings_preset_payload(artifact["preset"])
    return payload


def main():
    home = Path.home() / ".local" / "share" / "kaminos" / "basins"
    assert serve.shared_basin_store_from_environment({}) == home.resolve()
    assert serve.shared_basin_store_from_environment({"KAMINOS_SHARED_BASIN_STORE": ""}) is None
    assert serve.shared_basin_store_from_environment({"KAMINOS_SHARED_BASIN_STORE": "off"}) is None
    assert serve.shared_basin_store_from_environment({"KAMINOS_SHARED_BASIN_STORE": "/tmp/x"}) == Path("/tmp/x").resolve()
    assert serve.split_shared_basin_store_arguments(["8095", "--shared-basin-store", "/tmp/y", "--volume-settings-store", "/tmp/z"], home) == (
        ["8095", "--volume-settings-store", "/tmp/z"], Path("/tmp/y").resolve())
    assert serve.split_shared_basin_store_arguments(["--no-shared-basin-store"], home) == ([], None)
    assert serve.split_shared_basin_store_arguments(["8095"], home) == (["8095"], home)

    with tempfile.TemporaryDirectory(prefix="kaminos-shared-basins-") as temporary:
        shared = Path(temporary) / "library"
        processes = []
        try:
            writer, writer_base = start_server(temporary, "branch-a", "--shared-basin-store", str(shared))
            processes.append(writer)
            status, runtime = request_json(f"{writer_base}/api/runtime-config")
            assert status == 200 and runtime["sharedBasinStore"] == str(shared.resolve()), runtime
            status, receipt = request_json(f"{writer_base}/api/volume-settings-presets", {"label": "shared furnace", "preset": current_payload()})
            assert status == 200, receipt
            preset_id = receipt["effective"]["presetId"]
            assert receipt["sharedPublication"]["published"] is True, receipt["sharedPublication"]

            reader, reader_base = start_server(temporary, "branch-b", "--shared-basin-store", str(shared))
            processes.append(reader)
            status, index = request_json(f"{reader_base}/api/volume-settings-presets")
            assert status == 200, index
            assert [(entry["presetId"], entry["storeRole"]) for entry in index["entries"]] == [(preset_id, "shared")], index
            status, document = request_json(f"{reader_base}/api/volume-settings-preset?preset=shared-furnace")
            assert status == 200 and document["presetId"] == preset_id and document["storeRole"] == "shared", document

            isolated, isolated_base = start_server(temporary, "branch-c", "--no-shared-basin-store")
            processes.append(isolated)
            status, runtime = request_json(f"{isolated_base}/api/runtime-config")
            assert runtime["sharedBasinStore"] is None
            status, index = request_json(f"{isolated_base}/api/volume-settings-presets")
            assert status == 200 and index["entries"] == [], index
            status, missing = request_json(f"{isolated_base}/api/volume-settings-preset?preset={preset_id}")
            assert status == 404, missing
        finally:
            for process in processes:
                process.terminate()
                process.wait(timeout=5)
    print("volume settings shared store HTTP contracts passed")


if __name__ == "__main__":
    main()
