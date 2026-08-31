#!/usr/bin/env python3

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
    with urllib.request.urlopen(request, timeout=3) as response:
        return response.status, json.loads(response.read())


def wait_for_server(url):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        try:
            request_json(url)
            return
        except (OSError, urllib.error.URLError):
            time.sleep(0.05)
    raise AssertionError("cockpit layout HTTP server did not become available")


def sample_layout(label="Operator Layout"):
    schema = json.loads((ROOT / "volume-settings-preset-schema-v2.json").read_text())
    control_ids = [entry["key"] for entry in [*schema["controls"], *schema["rendererControls"]]]
    return {
        "identity": "kaminos.volume.cockpit-layout.v1",
        "layoutId": "operator-layout",
        "label": label,
        "groups": [{
            "id": "primary-controls",
            "label": "Primary Controls",
            "surface": "primary",
            "collapsed": False,
            "controlIds": control_ids,
        }],
    }


def main():
    with tempfile.TemporaryDirectory(prefix="kaminos-layout-http-") as temporary:
        store = Path(temporary) / "layouts"
        port = free_port()
        process = subprocess.Popen(
            [
                sys.executable,
                str(ROOT / "serve.py"),
                str(port),
                "--volume-settings-store", str(Path(temporary) / "settings"),
                "--volume-basin-session-store", str(Path(temporary) / "sessions"),
                "--volume-cockpit-layout-store", str(store),
            ],
            cwd=ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        base = f"http://127.0.0.1:{port}"
        try:
            wait_for_server(f"{base}/api/runtime-config")
            status, runtime = request_json(f"{base}/api/runtime-config")
            assert status == 200
            assert runtime["volumeCockpitLayoutStore"] == str(store.resolve())

            status, index = request_json(f"{base}/api/volume-cockpit-layouts")
            assert status == 200
            assert index == {
                "identity": "kaminos.volume.cockpit-layout-index.v1",
                "storePath": str(store.resolve()),
                "activeLayoutId": None,
                "entries": [],
            }

            status, receipt = request_json(f"{base}/api/volume-cockpit-layouts", {
                "layout": sample_layout(),
                "activate": True,
            })
            assert status == 200
            assert receipt["effective"]["layoutId"] == "operator-layout"
            assert receipt["effective"]["storePath"] == str(store.resolve())

            status, index = request_json(f"{base}/api/volume-cockpit-layouts")
            assert status == 200
            assert index["activeLayoutId"] == "operator-layout"
            assert index["entries"][0]["label"] == "Operator Layout"

            status, artifact = request_json(f"{base}/api/volume-cockpit-layout?id=operator-layout")
            assert status == 200
            assert artifact["layout"] == sample_layout()

            status, _ = request_json(f"{base}/api/volume-cockpit-layouts", {
                "layout": sample_layout("Renamed Layout"),
                "activate": True,
            })
            assert status == 200
            _, artifact = request_json(f"{base}/api/volume-cockpit-layout?id=operator-layout")
            assert artifact["layout"]["label"] == "Renamed Layout"
        finally:
            process.terminate()
            try:
                process.wait(timeout=4)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=4)
            stdout, stderr = process.communicate()
            if process.returncode not in (0, -15):
                raise AssertionError(f"layout HTTP server failed: {stdout}\n{stderr}")

        rotated_port = free_port()
        rotated = subprocess.Popen(
            [
                sys.executable,
                str(ROOT / "serve.py"),
                str(rotated_port),
                "--volume-settings-store", str(Path(temporary) / "settings-rotated"),
                "--volume-basin-session-store", str(Path(temporary) / "sessions-rotated"),
                "--volume-cockpit-layout-store", str(store),
            ],
            cwd=ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        rotated_base = f"http://127.0.0.1:{rotated_port}"
        try:
            wait_for_server(f"{rotated_base}/api/runtime-config")
            status, index = request_json(f"{rotated_base}/api/volume-cockpit-layouts")
            assert status == 200
            assert index["storePath"] == str(store.resolve())
            assert index["activeLayoutId"] == "operator-layout"
            assert index["entries"][0]["label"] == "Renamed Layout"
            status, artifact = request_json(f"{rotated_base}/api/volume-cockpit-layout?id=operator-layout")
            assert status == 200
            assert artifact["layout"]["label"] == "Renamed Layout"
        finally:
            rotated.terminate()
            try:
                rotated.wait(timeout=4)
            except subprocess.TimeoutExpired:
                rotated.kill()
                rotated.wait(timeout=4)
            stdout, stderr = rotated.communicate()
            if rotated.returncode not in (0, -15):
                raise AssertionError(f"rotated layout HTTP server failed: {stdout}\n{stderr}")

    print("volume cockpit layout HTTP contracts passed")


if __name__ == "__main__":
    main()
