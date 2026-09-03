import importlib.util
import json
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("kaminos_serve_http", ROOT / "serve.py")
serve = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(serve)


SOURCE = {
    "repoRoot": str(ROOT),
    "serverPort": 18412,
    "branch": "cc/handy-basin-atlas-rail-recorder-0830",
    "commit": "1" * 40,
    "dirty": False,
}


def control_state(control_schema):
    values = {"basin": {}, "renderer": {}, "presentation": {}}
    for descriptor in control_schema["inventory"]:
        values[descriptor["axis"]][descriptor["id"]] = (
            "on" if descriptor["id"] == "raymarch-smoke-presentation" else 0
        )
    return {
        "schema": "kaminos.volume.basin-drive-control-state.v0",
        **values,
        "effectivePresentation": {
            "raymarch-smoke-presentation": {"effective": "on", "fallbackReason": None},
        },
        "route": "http://127.0.0.1:18412/?kaminos_volume_smoke=1",
    }


def session_document(session_store):
    control_schema = serve._canonical_volume_basin_drive_control_schema()
    return {
        "schema": "kaminos.volume.basin-drive-session.v0",
        "status": "complete",
        "sessionId": "operator-http-001",
        "source": {"repository": "kaminos", "commit": SOURCE["commit"], "dirty": False},
        "controlSchema": control_schema,
        "runtime": {
            "requestedRoute": "http://127.0.0.1:18412/?kaminos_volume_smoke=1",
            "effectiveRoute": "http://127.0.0.1:18412/?kaminos_volume_smoke=1",
            "backend": "WebGPU:apple",
            "requestedStorePath": str(Path(session_store).resolve()),
            "effectiveStorePath": str(Path(session_store).resolve()),
        },
        "clock": {"identity": "monotonic-relative-ms"},
        "startedAt": "2026-08-30T18:00:00.000Z",
        "endedAt": "2026-08-30T18:00:01.000Z",
        "durationMs": 1000,
        "initialState": control_state(control_schema),
        "events": [],
        "eventCount": 0,
        "controlEventCount": 0,
        "markCount": 0,
        "finalState": control_state(control_schema),
    }


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


with tempfile.TemporaryDirectory(prefix="kaminos-basin-session-http-") as temporary:
    serve.VOLUME_BASIN_SESSION_STORE = Path(temporary).resolve()
    serve.volume_settings_server_source = lambda: dict(SOURCE)
    server = serve.http.server.ThreadingHTTPServer(("127.0.0.1", 0), serve.KaminosHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        status, runtime = request_json(f"{origin}/api/runtime-config")
        assert status == 200
        assert runtime["volumeBasinSessionStore"] == str(serve.VOLUME_BASIN_SESSION_STORE)

        status, receipt = request_json(
            f"{origin}/api/volume-basin-drive-sessions",
            method="POST",
            document={"session": session_document(serve.VOLUME_BASIN_SESSION_STORE)},
        )
        assert status == 200
        assert receipt["effective"]["storePath"] == str(serve.VOLUME_BASIN_SESSION_STORE)
        artifact_id = receipt["effective"]["artifactId"]

        status, artifact = request_json(f"{origin}/api/volume-basin-drive-session?id={artifact_id}")
        assert status == 200
        assert artifact["session"] == session_document(serve.VOLUME_BASIN_SESSION_STORE)

        status, index = request_json(f"{origin}/api/volume-basin-drive-sessions")
        assert status == 200
        assert [entry["artifactId"] for entry in index["entries"]] == [artifact_id]

        truncated = session_document(serve.VOLUME_BASIN_SESSION_STORE)
        truncated["eventCount"] = 1
        status, failure = request_json(
            f"{origin}/api/volume-basin-drive-sessions",
            method="POST",
            document={"session": truncated},
        )
        assert status == 400
        assert failure["failurePhase"] == "basin-drive-session-write"
        assert failure["storePath"] == str(serve.VOLUME_BASIN_SESSION_STORE)
        assert "event count" in failure["error"].lower()

        status, failure = request_json(
            f"{origin}/api/volume-basin-drive-sessions",
            method="POST",
            document={"session": session_document(serve.VOLUME_BASIN_SESSION_STORE), "fallback": True},
        )
        assert status == 400
        assert "exactly session" in failure["error"].lower()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

print("volume basin drive session HTTP contracts passed")
