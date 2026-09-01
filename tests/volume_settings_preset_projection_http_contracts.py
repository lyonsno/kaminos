#!/usr/bin/env python3

import importlib.util
import json
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


serve = load_module("kaminos_projection_http_serve", ROOT / "serve.py")
contracts = load_module(
    "kaminos_projection_contract_fixture",
    ROOT / "tests" / "volume_settings_preset_projection_contracts.py",
)


def request_json(url, method="GET", document=None):
    data = None if document is None else json.dumps(document).encode()
    request = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


schema = json.loads((ROOT / "volume-settings-preset-schema-v2.json").read_text())
source = {
    "repoRoot": str(ROOT),
    "serverPort": 0,
    "branch": "cc/handy-kiln-fire-composition-0901",
    "commit": "4" * 40,
    "dirty": False,
}

with tempfile.TemporaryDirectory(prefix="kaminos-preset-projection-http-") as temporary:
    serve.VOLUME_SETTINGS_STORE = Path(temporary).resolve()
    serve.volume_settings_server_source = lambda: dict(source)
    parent = serve.write_volume_settings_preset(
        serve.VOLUME_SETTINGS_STORE,
        "actually-looks-like-fire-FUCKAHHHHH",
        contracts.build_payload(schema),
        source,
        schema,
    )
    parent_id = parent["effective"]["presetId"]
    parent_path = serve.VOLUME_SETTINGS_STORE / "presets" / f"{parent_id}.json"
    parent_bytes = parent_path.read_bytes()

    server = serve.http.server.ThreadingHTTPServer(("127.0.0.1", 0), serve.KaminosHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        request = {
            "label": "actually-looks-like-fire-FUCKAHHHHH-kiln-96-rs025",
            "sourcePreset": parent_id,
            "profile": contracts.PROFILE,
        }
        status, receipt = request_json(
            f"{origin}/api/volume-settings-preset-projections",
            method="POST",
            document=request,
        )
        assert status == 200
        assert receipt["identity"] == "kaminos-volume-settings-preset-projection-receipt-v1"
        assert receipt["parent"]["presetId"] == parent_id
        assert receipt["effective"]["profile"] == contracts.PROFILE
        assert parent_path.read_bytes() == parent_bytes

        status, artifact = request_json(
            f"{origin}/api/volume-settings-preset?id={receipt['effective']['presetId']}"
        )
        assert status == 200
        assert artifact["presetId"] == receipt["effective"]["presetId"]
        assert artifact["preset"]["domControls"]["volume-resolution"]["value"] == "96"
        assert artifact["preset"]["domControls"]["volume-render-scale"]["value"] == 0.25

        status, failure = request_json(
            f"{origin}/api/volume-settings-preset-projections",
            method="POST",
            document={**request, "profile": {**contracts.PROFILE, "simulationResolution": 90}},
        )
        assert status == 400
        assert failure["failurePhase"] == "settings-preset-projection"
        assert failure["error"] == "unsupported simulation resolution: 90"

        status, failure = request_json(
            f"{origin}/api/volume-settings-preset-projections",
            method="POST",
            document={**request, "fallback": True},
        )
        assert status == 400
        assert failure["failurePhase"] == "settings-preset-projection-request"
        assert "requires exactly" in failure["error"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

print("volume settings preset projection HTTP contracts passed")
