import importlib.util
import json
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("kaminos_serve", ROOT / "serve.py")
serve = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(serve)


SOURCE = {
    "repoRoot": str(ROOT),
    "serverPort": 18412,
    "branch": "cc/handy-basin-atlas-rail-recorder-0830",
    "commit": "1" * 40,
    "dirty": False,
}


def control_state(control_schema, exposure):
    values = {"basin": {}, "renderer": {}, "presentation": {}}
    for descriptor in control_schema["inventory"]:
        value = 0
        if descriptor["id"] == "volume-exposure":
            value = exposure
        elif descriptor["id"] == "raymarch-smoke-presentation":
            value = "on"
        values[descriptor["axis"]][descriptor["id"]] = value
    return {
        "schema": "kaminos.volume.basin-drive-control-state.v0",
        **values,
        "effectivePresentation": {
            "raymarch-smoke-presentation": {"effective": "on", "fallbackReason": None},
        },
        "route": f"http://127.0.0.1:18412/?kaminos_volume_smoke=1&volume_exposure={exposure}",
    }


def session_document(session_store):
    control_schema = serve._canonical_volume_basin_drive_control_schema()
    return {
        "schema": "kaminos.volume.basin-drive-session.v0",
        "status": "complete",
        "sessionId": "operator-blue-ring-001",
        "source": {
            "repository": "kaminos", "commit": SOURCE["commit"],
            "branch": SOURCE["branch"], "dirty": False,
        },
        "controlSchema": control_schema,
        "runtime": {
            "requestedRoute": "http://127.0.0.1:18412/?kaminos_volume_smoke=1",
            "effectiveRoute": "http://127.0.0.1:18412/?kaminos_volume_smoke=1&volume_emitter_family=ring",
            "backend": "WebGPU:apple",
            "requestedStorePath": str(Path(session_store).resolve()),
            "effectiveStorePath": str(Path(session_store).resolve()),
        },
        "clock": {"identity": "monotonic-relative-ms"},
        "startedAt": "2026-08-30T18:00:00.000Z",
        "endedAt": "2026-08-30T18:00:01.000Z",
        "durationMs": 1000,
        "initialState": control_state(control_schema, 0.9),
        "events": [{
                "kind": "control",
                "axis": "basin",
                "controlId": "volume-exposure",
            "param": "volume_exposure",
            "inputType": "range",
            "requested": 0.12345678901234566,
            "effective": 0.12345678901234566,
            "gesture": {
                "eventType": "input", "targetId": "volume-exposure",
                "targeted": True, "trusted": True, "commandDriven": False,
            },
            "transactionId": "operator-exposure-0",
            "transactionIndex": 0,
            "transactionCount": 1,
            "sequence": 0,
            "elapsedMs": 500,
        }],
        "eventCount": 1,
        "controlEventCount": 1,
        "markCount": 0,
        "finalState": control_state(control_schema, 0.12345678901234566),
    }


with tempfile.TemporaryDirectory(prefix="kaminos-basin-session-store-") as temporary:
    root = Path(temporary)
    settings_store = root / "settings"
    session_store = root / "drive-sessions"
    serve.volume_settings_server_source = lambda: dict(SOURCE)
    port, effective_settings_store, effective_session_store, effective_layout_store = serve.parse_server_arguments([
        "18412",
        "--volume-settings-store", str(settings_store),
        "--volume-basin-session-store", str(session_store),
    ])
    assert port == 18412
    assert effective_settings_store == settings_store.resolve()
    assert effective_session_store == session_store.resolve()
    assert effective_layout_store == serve.VOLUME_COCKPIT_LAYOUT_STORE_DEFAULT

    receipt = serve.write_volume_basin_drive_session(session_store, session_document(session_store))
    assert receipt["identity"] == "kaminos.volume.basin-drive-session-write-receipt.v0"
    assert receipt["requested"]["storePath"] == str(session_store.resolve())
    assert receipt["requested"]["sessionId"] == "operator-blue-ring-001"
    assert receipt["effective"]["storePath"] == str(session_store.resolve())
    assert receipt["effective"]["artifactPath"].startswith(str(session_store.resolve()))
    assert receipt["effective"]["contentHash"].startswith("sha256:")
    assert receipt["effective"]["eventCount"] == 1
    assert Path(receipt["effective"]["artifactPath"]).is_file()

    artifact = serve.read_volume_basin_drive_session(session_store, receipt["effective"]["artifactId"])
    assert artifact["session"] == session_document(session_store)
    index = serve.list_volume_basin_drive_sessions(session_store)
    assert index["storePath"] == str(session_store.resolve())
    assert [entry["artifactId"] for entry in index["entries"]] == [receipt["effective"]["artifactId"]]

    repeated = serve.write_volume_basin_drive_session(session_store, session_document(session_store))
    assert repeated["effective"]["artifactId"] == receipt["effective"]["artifactId"]
    assert repeated["effective"]["idempotent"] is True

    truncated = session_document(session_store)
    truncated["eventCount"] = 2
    try:
        serve.write_volume_basin_drive_session(session_store, truncated)
    except ValueError as error:
        assert "event count" in str(error).lower()
    else:
        raise AssertionError("server accepted a self-inconsistent truncated session")

    forged = session_document(session_store)
    forged["source"]["commit"] = "fallback"
    try:
        serve.write_volume_basin_drive_session(session_store, forged)
    except ValueError as error:
        assert "source commit" in str(error).lower()
    else:
        raise AssertionError("server accepted fallback source identity")

print("volume basin drive session store contracts passed")
