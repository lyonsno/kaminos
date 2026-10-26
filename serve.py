#!/usr/bin/env python3
"""Kaminos dev server with directory browsing API."""

import http.server
import copy
import fcntl
import importlib.util
import glob
import hashlib
import json
import math
import os
import queue
import re
import select
import shutil
import socket
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse, parse_qs, parse_qsl, urlencode

PORT = 8090
ROOT = Path(__file__).parent.resolve()
_VANTAGE = None
_VANTAGE_LOCK = threading.Lock()


def vantage_bridge():
    """The agent vantage relay module and its one broker, loaded on first use
    from beside this file so importing serve.py by path needs no sys.path."""
    global _VANTAGE
    with _VANTAGE_LOCK:
        if _VANTAGE is None:
            spec = importlib.util.spec_from_file_location("kaminos_agent_vantage_bridge", ROOT / "agent_vantage_bridge.py")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            _VANTAGE = (module, module.VantageBroker())
        return _VANTAGE


_NOTES = None
_NOTES_LOCK = threading.Lock()


def notes_http():
    """Kaminos notes (kaminos_notes.py, docs/notes.md), loaded from beside this
    file on first use. Every server on the machine shares one notes log."""
    global _NOTES
    with _NOTES_LOCK:
        if _NOTES is None:
            spec = importlib.util.spec_from_file_location("kaminos_notes", ROOT / "kaminos_notes.py")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            log = module.NotesLog(module.default_root(), page_author=module.default_page_author())
            # KAMINOS_NOTES_DIRECTORY names a JSON file of people to offer in the
            # @ list; KAMINOS_NOTES_NOTIFY is a command run, with the note on
            # stdin, for each recipient not listening when a note is posted.
            people = os.environ.get("KAMINOS_NOTES_DIRECTORY")
            _NOTES = module.NotesHttp(log, source=lambda: {"origin": f"http://127.0.0.1:{PORT}", **volume_settings_server_source()},
                                      directory=(lambda: module.directory_from_file(people)) if people else (lambda: []),
                                      notify=module.notify_command(os.environ.get("KAMINOS_NOTES_NOTIFY", "")))
        return _NOTES


def observe_sf3d_source_host():
    """Fresh source-machine identity; no browser/physical-capacity inference."""
    observation = {"source": "live-source-host", "platform": sys.platform,
                   "atUnixMs": time.time_ns() // 1000000}
    if sys.platform != "darwin":
        return observation
    command = ["/usr/sbin/sysctl", "-n", "hw.model", "hw.memsize", "machdep.cpu.brand_string"]
    result = subprocess.run(command, capture_output=True, text=True, check=True)
    rows = result.stdout.strip().splitlines()
    if len(rows) != 3:
        raise ValueError("incomplete source-machine sysctl observation")
    observation.update(source="live-macos-sysctl", effectiveRoute="/usr/sbin/sysctl",
                       machine=rows[0], hostTotalBytes=int(rows[1]), cpu=rows[2])
    if not observation["machine"] or not observation["cpu"] or observation["hostTotalBytes"] <= 0:
        raise ValueError("invalid source-machine identity")
    return observation


def sf3d_source_admission():
    """Carry the unadmitted M2 full-route hold; never grant positive fit authority."""
    report = {"schema": "kaminos.sf3d-source-admission.v0",
              "authority": "circuit-breaker-only", "repoRoot": str(ROOT),
              "sourcePath": str((ROOT / "lib/sf3d/weights.bin").resolve()),
              "modelPayloadBytesServed": 0,
              "meaning": "source-host full-model hold, not browser capacity or positive model admission"}
    try:
        observation = observe_sf3d_source_host()
        report["observation"] = observation
        if not isinstance(observation, dict) or not isinstance(observation.get("platform"), str):
            raise ValueError("live source platform required")
        if observation["platform"] != "darwin" and observation.get("source") != "live-source-host":
            raise ValueError("unverified source identity cannot release the source hold")
        if observation.get("platform") == "darwin":
            if (observation.get("source") != "live-macos-sysctl" or
                    not isinstance(observation.get("machine"), str) or
                    not isinstance(observation.get("cpu"), str) or
                    type(observation.get("hostTotalBytes")) is not int or observation["hostTotalBytes"] <= 0):
                raise ValueError("unverified live Mac identity cannot release the source hold")
            # The recorded machine, CPU and RAM join identify this box. RAM
            # alone is never used to infer model admission or another machine.
            exact = (observation["machine"] == "Mac14,9" and observation["cpu"] == "Apple M2 Pro" and
                     observation["hostTotalBytes"] == 17179869184)
            conflicting = observation["machine"] == "Mac14,9" or observation["cpu"] == "Apple M2 Pro"
            if exact or conflicting:
                report.update(verdict="refused", reason="M2 Pro full-model admission remains unresolved")
                return report
        report.update(verdict="not-applicable", reason="this source-host hold does not identify the observed machine; no positive fit claim")
    except Exception as error:
        report.update(verdict="refused", reason="source-machine identity unavailable",
                      failurePhase="source-host-observation", error=str(error))
        return report
    try:
        source = Path(report["sourcePath"])
        if not source.is_file():
            raise ValueError("SF3D source must be an observed regular file")
        size = source.stat().st_size
        if not 16 <= size <= 9007199254740991:
            raise ValueError("SF3D source size is outside the loader's exact integer contract")
        report["weightSource"] = {"source": "live-source-file-stat",
                                 "requestedPath": "/lib/sf3d/weights.bin",
                                 "sourcePath": str(source), "bytes": size}
    except Exception as error:
        report.update(verdict="refused", reason="source weight metadata unavailable",
                      failurePhase="weight-source-metadata", error=str(error))
    return report


VOLUME_CAPTURE_DIR = ROOT / "artifacts" / "volume-captures"
VOLUME_SETTINGS_PRESET_SCHEMA_PATH = ROOT / "volume-settings-preset-schema-v2.json"
VOLUME_SETTINGS_STORE_DEFAULT = Path(os.environ.get(
    "KAMINOS_VOLUME_SETTINGS_STORE",
    os.path.expanduser("~/.local/share/kaminos/volume-settings-presets"),
)).expanduser().resolve()
VOLUME_SETTINGS_STORE = VOLUME_SETTINGS_STORE_DEFAULT


def shared_basin_store_from_environment(environment=None):
    """The shared basin library every branch's server publishes to and reads from."""
    environment = os.environ if environment is None else environment
    configured = environment.get("KAMINOS_SHARED_BASIN_STORE")
    if configured is None:
        configured = "~/.local/share/kaminos/basins"
    if configured.strip().lower() in SHARED_BASIN_STORE_OFF_VALUES:
        return None
    return _shared_basin_store_path(configured)


SHARED_BASIN_STORE_OFF_VALUES = {"", "off", "none", "0", "false", "no", "disabled"}


def _shared_basin_store_path(configured):
    path = Path(configured).expanduser()
    if not path.is_absolute():
        raise ValueError(f"shared basin store must be an absolute path: {configured}")
    return path.resolve()


try:
    SHARED_BASIN_STORE_DEFAULT = shared_basin_store_from_environment()
    SHARED_BASIN_STORE_ERROR = None
except ValueError as _shared_basin_store_error:
    SHARED_BASIN_STORE_DEFAULT = None
    SHARED_BASIN_STORE_ERROR = str(_shared_basin_store_error)
SHARED_BASIN_STORE = SHARED_BASIN_STORE_DEFAULT
VOLUME_BASIN_SESSION_STORE_DEFAULT = Path(os.environ.get(
    "KAMINOS_VOLUME_BASIN_SESSION_STORE",
    os.path.expanduser("~/.local/share/kaminos/volume-basin-drive-sessions"),
)).expanduser().resolve()
VOLUME_BASIN_SESSION_STORE = VOLUME_BASIN_SESSION_STORE_DEFAULT
VOLUME_COCKPIT_LAYOUT_STORE_DEFAULT = Path(os.environ.get(
    "KAMINOS_VOLUME_COCKPIT_LAYOUT_STORE",
    os.path.expanduser("~/.local/share/kaminos/volume-cockpit-layouts"),
)).expanduser().resolve()
VOLUME_COCKPIT_LAYOUT_STORE = VOLUME_COCKPIT_LAYOUT_STORE_DEFAULT
VOLUME_SETTINGS_PRESET_IDENTITY = "kaminos-volume-settings-preset-v2"
VOLUME_SETTINGS_PRESET_ARTIFACT_IDENTITY = "kaminos-volume-settings-preset-artifact-v2"
VOLUME_SETTINGS_PRESET_SCHEMA_IDENTITY = "kaminos-volume-settings-preset-schema-v2"
VOLUME_BASIN_PROMOTION_CLI = ROOT / "volume-basin-promotion-package.mjs"
VOLUME_BASIN_DRIVE_SESSION_CLI = ROOT / "volume-basin-drive-session-cli.mjs"


def write_volume_basin_drive_session(store_path, session):
    store = _volume_settings_store_path(store_path)
    normalized = _normalize_volume_basin_drive_session(session)
    if normalized["runtime"]["effectiveStorePath"] != str(store):
        raise ValueError("volume basin drive session effective store path mismatch")
    content_hash = _volume_basin_drive_session_content_hash(normalized)
    artifact_id = f"vds-{content_hash}"
    written_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    document = {
        "identity": "kaminos.volume.basin-drive-session-artifact.v0",
        "artifactId": artifact_id,
        "contentHash": f"sha256:{content_hash}",
        "writtenAt": written_at,
        "source": volume_settings_server_source(),
        "session": normalized,
    }
    artifact_path = store / "sessions" / f"{artifact_id}.json"
    with _volume_settings_store_lock(store):
        created = _atomic_create_json(artifact_path, document)
        idempotent = not created
        if idempotent:
            existing = read_volume_basin_drive_session(store, artifact_id)
            if existing.get("contentHash") != document["contentHash"]:
                raise ValueError("volume basin drive session content identity collision")
    return {
        "ok": True,
        "identity": "kaminos.volume.basin-drive-session-write-receipt.v0",
        "requested": {
            "storePath": str(store),
            "sessionId": normalized["sessionId"],
            "eventCount": normalized["eventCount"],
            "sourceCommit": normalized["source"]["commit"],
        },
        "effective": {
            "storePath": str(store),
            "artifactPath": str(artifact_path),
            "artifactId": artifact_id,
            "contentHash": document["contentHash"],
            "sessionId": normalized["sessionId"],
            "eventCount": normalized["eventCount"],
            "controlEventCount": normalized["controlEventCount"],
            "markCount": normalized["markCount"],
            "sourceCommit": normalized["source"]["commit"],
            "idempotent": idempotent,
        },
        "sessionUrl": f"/api/volume-basin-drive-session?id={artifact_id}",
    }


def read_volume_basin_drive_session(store_path, session_ref):
    store = _volume_settings_store_path(store_path)
    artifact_id = str(session_ref or "").strip()
    if not re.fullmatch(r"vds-[0-9a-f]{64}", artifact_id):
        raise ValueError("volume basin drive session artifact id is invalid")
    artifact_path = store / "sessions" / f"{artifact_id}.json"
    try:
        document = _read_json_object(artifact_path, "basin drive session artifact")
    except FileNotFoundError as error:
        raise FileNotFoundError(f"volume basin drive session not found: {artifact_id}") from error
    if (
        document.get("identity") != "kaminos.volume.basin-drive-session-artifact.v0"
        or document.get("artifactId") != artifact_id
    ):
        raise ValueError("volume basin drive session artifact identity mismatch")
    normalized = _normalize_volume_basin_drive_session(document.get("session"), require_current_runtime=False)
    content_hash = _volume_basin_drive_session_content_hash(normalized)
    if document.get("contentHash") != f"sha256:{content_hash}" or artifact_id != f"vds-{content_hash}":
        raise ValueError("volume basin drive session artifact content hash mismatch")
    return {
        **document,
        "session": normalized,
        "artifactPath": str(artifact_path),
        "storePath": str(store),
        "replayCompatibility": volume_basin_drive_replay_compatibility(normalized),
    }


def list_volume_basin_drive_sessions(store_path):
    store = _volume_settings_store_path(store_path)
    sessions_dir = store / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    for artifact_path in sessions_dir.glob("vds-*.json"):
        document = read_volume_basin_drive_session(store, artifact_path.stem)
        session = document["session"]
        entries.append({
            "artifactId": document["artifactId"],
            "contentHash": document["contentHash"],
            "artifactPath": document["artifactPath"],
            "sessionId": session["sessionId"],
            "startedAt": session["startedAt"],
            "endedAt": session["endedAt"],
            "eventCount": session["eventCount"],
            "controlEventCount": session["controlEventCount"],
            "markCount": session["markCount"],
            "sourceCommit": session["source"]["commit"],
            "writtenAt": document.get("writtenAt"),
            "replayCompatibility": document["replayCompatibility"],
        })
    entries.sort(key=lambda entry: (entry.get("writtenAt") or "", entry["artifactId"]), reverse=True)
    return {
        "identity": "kaminos.volume.basin-drive-session-index.v0",
        "storePath": str(store),
        "entries": entries,
    }


def _normalize_volume_basin_drive_session(session, *, require_current_runtime=True):
    if not isinstance(session, dict):
        raise ValueError("volume basin drive session must be a JSON object")
    result = subprocess.run(
        ["node", str(VOLUME_BASIN_DRIVE_SESSION_CLI), "normalize"],
        cwd=ROOT,
        text=True,
        input=json.dumps(session, ensure_ascii=True),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        message = (result.stderr or result.stdout).strip().splitlines()
        detail = next((line.removeprefix("Error: ") for line in message if "Error:" in line), None)
        raise ValueError(detail or "volume basin drive session validation failed")
    try:
        normalized = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise ValueError(f"volume basin drive session validator returned invalid JSON: {error}") from error
    if not isinstance(normalized, dict):
        raise ValueError("volume basin drive session validator returned a non-object")
    if not require_current_runtime:
        return normalized
    canonical_schema = _canonical_volume_basin_drive_control_schema()
    authored_schema = normalized.get("controlSchema") or {}
    for field in (
        "identity", "sha256", "basinControlCount", "rendererControlCount",
        "presentationControlCount", "inventory",
    ):
        if authored_schema.get(field) != canonical_schema.get(field):
            raise ValueError(f"volume basin drive session canonical control schema mismatch: {field}")
    server_source = volume_settings_server_source()
    if server_source.get("dirty") is not False:
        raise ValueError("volume basin drive session server source is dirty")
    if normalized.get("source", {}).get("commit") != server_source.get("commit"):
        raise ValueError("volume basin drive session source commit does not match the effective server")
    return normalized


def volume_basin_drive_replay_compatibility(session):
    canonical = _canonical_volume_basin_drive_control_schema()
    recorded = session["controlSchema"]
    source = volume_settings_server_source()
    reasons = []
    if any(recorded.get(field) != value for field, value in canonical.items()):
        reasons.append("control-schema-mismatch")
    if session["source"]["commit"] != source.get("commit"):
        reasons.append("source-commit-mismatch")
    if source.get("dirty") is not False:
        reasons.append("server-source-dirty")
    return {
        "identity": "kaminos.volume.basin-drive-replay-compatibility.v0",
        "compatible": not reasons,
        "reasons": reasons,
        "recordedSourceCommit": session["source"]["commit"],
        "effectiveSourceCommit": source.get("commit"),
        "recordedControlSchemaSha256": recorded["sha256"],
        "effectiveControlSchemaSha256": canonical["sha256"],
    }


def _canonical_volume_basin_drive_control_schema():
    schema_bytes = VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_bytes()
    schema = json.loads(schema_bytes)
    inventory = []
    for axis, field in (
        ("basin", "controls"),
        ("renderer", "rendererControls"),
        ("presentation", "presentationControls"),
    ):
        inventory.extend({
            "axis": axis,
            "id": descriptor["key"],
            "param": descriptor["param"],
            "type": descriptor["type"],
        } for descriptor in schema.get(field) or [])
    return {
        "identity": schema["identity"],
        "sha256": hashlib.sha256(schema_bytes).hexdigest(),
        "basinControlCount": len(schema.get("controls") or []),
        "rendererControlCount": len(schema.get("rendererControls") or []),
        "presentationControlCount": len(schema.get("presentationControls") or []),
        "inventory": inventory,
    }


def _volume_basin_drive_session_content_hash(session):
    canonical = json.dumps(session, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return hashlib.sha256(canonical).hexdigest()


def _settings_preset_route_value(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return ""
    return str(value)


def _settings_preset_descriptor_value(descriptor):
    return descriptor.get("rawValue") if "rawValue" in descriptor else descriptor.get("value")


# The procedural-force switches were retired 2026-10-22: Microdetail and Shred
# are their own switches (0 is off) and Fine breakup became Swirl jostle. A
# switch that was off moves onto its slider as 0, so a saved basin keeps the
# forces it had. Mirrors transferRetiredForceSwitches in
# volume-retired-control-migration.mjs.
FORCE_SWITCH_TRANSFERS = (
    ("volume-force-micro-carrier", "volume-microdetail"),
    ("volume-force-interface-shred", "volume-interface-shred"),
    ("volume-force-fine-breakup", "volume-swirl-jostle"),
)


def _force_switch_off(value):
    return value is False or value == 0 or str(value).lower() in ("false", "0")


def _settings_preset_descriptor_for_default(descriptor):
    return {
        "id": descriptor["key"],
        "param": descriptor["param"],
        "tagName": descriptor["tagName"],
        "type": descriptor["type"],
        "value": descriptor["additiveDefault"],
    }


def _validate_settings_preset_descriptor(key, descriptor, expected):
    if not isinstance(descriptor, dict):
        raise ValueError(f"settings preset control descriptor is invalid: {key}")
    if descriptor.get("id") != key:
        raise ValueError(f"settings preset control descriptor id mismatch for {key}")
    if (
        descriptor.get("param") != expected.get("param")
        or str(descriptor.get("tagName") or "").upper() != str(expected.get("tagName") or "").upper()
        or str(descriptor.get("type") or "").lower() != str(expected.get("type") or "").lower()
    ):
        raise ValueError(f"settings preset control inventory mismatch for {key}")
    stored_value_fields = [field for field in ("value", "rawValue") if field in descriptor]
    if len(stored_value_fields) != 1:
        raise ValueError(f"settings preset control stored value is invalid for {key}")
    value = descriptor[stored_value_fields[0]]
    control_type = str(expected.get("type") or "").lower()
    value_type_valid = True
    if control_type == "range":
        if isinstance(value, bool) or not isinstance(value, (int, float, str)):
            value_type_valid = False
        else:
            try:
                value_type_valid = math.isfinite(float(value))
            except (TypeError, ValueError):
                value_type_valid = False
    elif control_type == "checkbox":
        value_type_valid = isinstance(value, bool)
    elif control_type in {"color", "text", "select-one", "button-state"}:
        value_type_valid = isinstance(value, str)
    if not value_type_valid:
        raise ValueError(f"settings preset control stored value type mismatch for {key}")
    allowed_values = expected.get("allowedValues")
    if allowed_values is not None and value not in allowed_values:
        raise ValueError(f"settings preset control has unsupported value for {key}")


def _validate_settings_preset_schema(schema):
    if schema.get("identity") != VOLUME_SETTINGS_PRESET_SCHEMA_IDENTITY:
        raise ValueError("settings preset canonical schema identity mismatch")
    controls = schema.get("controls") or []
    if schema.get("controlCount") != len(controls):
        raise ValueError("settings preset canonical schema control count mismatch")
    axes = [controls, schema.get("rendererControls") or [], schema.get("presentationControls") or []]
    all_controls = [descriptor for axis in axes for descriptor in axis]
    if (
        any(not isinstance(descriptor, dict) for descriptor in all_controls)
        or len({descriptor.get("key") for descriptor in all_controls}) != len(all_controls)
        or len({descriptor.get("param") for descriptor in all_controls}) != len(all_controls)
    ):
        raise ValueError("settings preset canonical schema inventory is invalid")
    retired_controls = schema.get("retiredControls") or []
    if not isinstance(retired_controls, list) or any(
        not isinstance(descriptor, dict)
        or descriptor.get("axis") not in {"domControls", "rendererControls", "presentationControls"}
        or any(
            not isinstance(descriptor.get(field), str) or not descriptor[field].strip()
            for field in ("key", "param", "tagName", "type")
        )
        or (
            "allowedValues" in descriptor
            and (
                not isinstance(descriptor["allowedValues"], list)
                or not descriptor["allowedValues"]
                or len(set(map(str, descriptor["allowedValues"]))) != len(descriptor["allowedValues"])
            )
        )
        for descriptor in retired_controls
    ):
        raise ValueError("settings preset retired control inventory is invalid")
    combined_controls = [*all_controls, *retired_controls]
    if (
        len({descriptor.get("key") for descriptor in combined_controls}) != len(combined_controls)
        or len({descriptor.get("param") for descriptor in combined_controls}) != len(combined_controls)
    ):
        raise ValueError("settings preset retired controls overlap the canonical inventory")
    return schema


class UnsupportedVolumeSettingsControls(ValueError):
    """Saved controls require a different renderer/schema version."""


def normalize_volume_settings_preset_payload(payload, schema=None, tolerate_foreign_controls=False):
    """Project a compatible older payload through schema-owned additive defaults.

    With tolerate_foreign_controls (reads only), a basin saved by a branch with
    a different control inventory still projects: controls this schema lacks are
    carried out of the applied route and reported, and option values this schema
    does not offer fall back to the control's additive default with a receipt.
    """
    schema = _validate_settings_preset_schema(
        schema or json.loads(VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
    )
    # On reads, a basin whose inventory differs from this schema is schema
    # skew (saved by another branch), not a damaged artifact.
    skew = UnsupportedVolumeSettingsControls if tolerate_foreign_controls else ValueError
    if not isinstance(payload, dict):
        raise ValueError("settings preset additive projection source is invalid")
    if payload.get("identity") != VOLUME_SETTINGS_PRESET_IDENTITY or payload.get("kind") != "settings-preset":
        raise ValueError("settings preset identity mismatch")
    if payload.get("schemaIdentity") != schema.get("identity"):
        raise ValueError("settings preset schema identity mismatch")
    allowed_fields = set(schema.get("allowedNativePresetFields") or [])
    if "sourceRadiusSpace" in payload and payload["sourceRadiusSpace"] != "simulation-v1":
        raise ValueError("Unknown preset source radius space")
    unexpected_fields = sorted(set(payload) - allowed_fields)
    if unexpected_fields:
        raise skew(f"settings preset contains fields outside its canonical schema: {','.join(unexpected_fields)}")

    normalized = copy.deepcopy(payload)
    defaults_applied = []
    retired_controls_stripped = []
    carried_controls = []
    unsupported_values_defaulted = []
    routed_source_values = {}
    routed_default_values = {}
    routed_retired_values = {}
    routed_carried_values = {}
    routed_replaced_values = {}
    retired_by_axis = {
        "domControls": {},
        "rendererControls": {},
        "presentationControls": {},
    }
    for descriptor in schema.get("retiredControls") or []:
        retired_by_axis[descriptor["axis"]][descriptor["key"]] = descriptor
    schema_params = {
        descriptor["param"]
        for axis in ("controls", "rendererControls", "presentationControls", "retiredControls")
        for descriptor in schema.get(axis) or []
    }
    axis_specs = (
        ("domControls", "controlCount", schema.get("controls") or [], True, "basin"),
        ("rendererControls", "rendererControlCount", schema.get("rendererControls") or [], False, "renderer"),
        ("presentationControls", "presentationControlCount", schema.get("presentationControls") or [], True, "presentation"),
    )
    for field, count_field, expected_descriptors, default_missing_axis, axis_name in axis_specs:
        source_controls = copy.deepcopy(payload.get(field))
        axis_authored = source_controls is not None
        if source_controls is None:
            source_controls = {}
        if not isinstance(source_controls, dict):
            raise ValueError(f"settings preset {field} are invalid")
        source_count = payload.get(count_field)
        if source_count not in (None, len(source_controls)):
            raise ValueError(f"settings preset {count_field} does not match its authored inventory")
        expected_by_key = {descriptor["key"]: descriptor for descriptor in expected_descriptors}
        retired_by_key = retired_by_axis[field]
        unknown = sorted(set(source_controls) - set(expected_by_key) - set(retired_by_key))
        if unknown and not tolerate_foreign_controls:
            raise UnsupportedVolumeSettingsControls(f"settings preset {field} contain unknown controls: {','.join(unknown)}")
        for key in unknown:
            descriptor = source_controls.pop(key)
            if (
                not isinstance(descriptor, dict)
                or descriptor.get("id") != key
                or not isinstance(descriptor.get("param"), str)
                or not descriptor["param"]
                or len([value_field for value_field in ("value", "rawValue") if value_field in descriptor]) != 1
            ):
                raise ValueError(f"settings preset control descriptor is invalid: {key}")
            if descriptor["param"] in schema_params or descriptor["param"] in routed_carried_values:
                raise UnsupportedVolumeSettingsControls(
                    f"settings preset {field} control {key} reuses parameter {descriptor['param']}"
                )
            value = _settings_preset_descriptor_value(descriptor)
            routed_carried_values[descriptor["param"]] = _settings_preset_route_value(value)
            carried_controls.append({"axis": axis_name, "id": key, "param": descriptor["param"], "value": value})
        for key in sorted(set(source_controls) & set(retired_by_key)):
            descriptor = source_controls.pop(key)
            expected = retired_by_key[key]
            _validate_settings_preset_descriptor(key, descriptor, expected)
            value = _settings_preset_descriptor_value(descriptor)
            routed_retired_values[expected["param"]] = _settings_preset_route_value(value)
            retired_controls_stripped.append({
                "axis": axis_name,
                "id": key,
                "param": expected["param"],
                "value": value,
            })
        for key, descriptor in list(source_controls.items()):
            expected = expected_by_key[key]
            allowed_values = expected.get("allowedValues")
            value = _settings_preset_descriptor_value(descriptor) if isinstance(descriptor, dict) else None
            if tolerate_foreign_controls and isinstance(descriptor, dict) and (
                descriptor.get("param") != expected.get("param")
                or str(descriptor.get("tagName") or "").upper() != str(expected.get("tagName") or "").upper()
                or str(descriptor.get("type") or "").lower() != str(expected.get("type") or "").lower()
            ):
                raise skew(f"settings preset control inventory mismatch for {key}")
            if tolerate_foreign_controls and allowed_values is not None and value not in allowed_values:
                _validate_settings_preset_descriptor(
                    key, descriptor, {name: entry for name, entry in expected.items() if name != "allowedValues"}
                )
                if "additiveDefault" not in expected:
                    raise UnsupportedVolumeSettingsControls(
                        f"settings preset {field} value {value!r} for {key} is not offered by this schema"
                    )
                source_controls[key] = _settings_preset_descriptor_for_default(expected)
                routed_replaced_values[expected["param"]] = (
                    _settings_preset_route_value(value),
                    _settings_preset_route_value(expected["additiveDefault"]),
                )
                unsupported_values_defaulted.append({
                    "axis": axis_name,
                    "id": key,
                    "param": expected["param"],
                    "value": value,
                    "effective": expected["additiveDefault"],
                })
                continue
            _validate_settings_preset_descriptor(key, descriptor, expected)
            routed_source_values[expected["param"]] = _settings_preset_route_value(value)

        missing = [descriptor for descriptor in expected_descriptors if descriptor["key"] not in source_controls]
        missing_axis_is_fully_additive = bool(missing) and all(
            "additiveDefault" in descriptor for descriptor in missing
        )
        if missing and not axis_authored and not default_missing_axis and not missing_axis_is_fully_additive:
            missing_nonadditive = next(
                descriptor for descriptor in missing if "additiveDefault" not in descriptor
            )
            raise skew(
                f"settings preset is missing non-additive control: {missing_nonadditive['key']}"
            )
        if missing and (axis_authored or default_missing_axis or missing_axis_is_fully_additive):
            for descriptor in missing:
                if "additiveDefault" not in descriptor:
                    raise skew(f"settings preset is missing non-additive control: {descriptor['key']}")
                default_descriptor = _settings_preset_descriptor_for_default(descriptor)
                source_controls[descriptor["key"]] = default_descriptor
                routed_default_values[descriptor["param"]] = _settings_preset_route_value(
                    descriptor["additiveDefault"]
                )
                defaults_applied.append(descriptor["key"])
        if axis_authored or source_controls or (default_missing_axis and expected_descriptors):
            normalized[field] = source_controls
            normalized[count_field] = len(source_controls)
        else:
            normalized.pop(field, None)
            normalized.pop(count_field, None)

    stripped_switches = {
        entry["id"]: entry["value"] for entry in retired_controls_stripped if entry["axis"] == "basin"
    }
    master_off = "volume-procedural-detail-forces" in stripped_switches and _force_switch_off(
        stripped_switches["volume-procedural-detail-forces"]
    )
    params_by_key = {descriptor["key"]: descriptor["param"] for descriptor in schema.get("controls") or []}
    force_switch_transfers = []
    zeroed_params = set()
    for switch_key, slider_key in FORCE_SWITCH_TRANSFERS:
        if not (master_off or (switch_key in stripped_switches and _force_switch_off(stripped_switches[switch_key]))):
            continue
        descriptor = (normalized.get("domControls") or {}).get(slider_key)
        if not isinstance(descriptor, dict):
            continue
        descriptor.pop("rawValue", None)
        descriptor["value"] = 0
        zeroed_params.add(params_by_key[slider_key])
        force_switch_transfers.append(slider_key)

    exclusions = payload.get("stateExclusions") or {}
    if any(exclusions.get(field) is not True for field in schema.get("excludedStateFields") or []):
        raise ValueError("settings preset must explicitly exclude runtime and replay state")
    if any(field in payload for field in schema.get("forbiddenPresetFields") or []):
        raise ValueError("settings preset must not contain runtime, renderer, camera, or replay state")

    route = payload.get("route")
    if not isinstance(route, str) or not route:
        raise ValueError("settings preset requires an exact control route")
    parsed = urlparse(route)
    route_entries = parse_qsl(parsed.query, keep_blank_values=True)
    route_values = {}
    for key, value in route_entries:
        if key in route_values:
            raise ValueError(f"settings preset route duplicates parameter {key}")
        route_values[key] = value
    activation = schema.get("activationParam") or {}
    if route_values.pop(activation.get("key"), None) != activation.get("value"):
        raise ValueError("settings preset route omitted the native volume activation gate")
    for key, expected_value in routed_source_values.items():
        if route_values.pop(key, None) != expected_value:
            raise ValueError(f"settings preset route/control mismatch for {key}")
    for key, expected_value in routed_retired_values.items():
        if route_values.pop(key, None) != expected_value:
            raise ValueError(f"settings preset retired route/control mismatch for {key}")
    for key, expected_value in routed_carried_values.items():
        if route_values.pop(key, None) != expected_value:
            raise ValueError(f"settings preset carried route/control mismatch for {key}")
    for key, (source_value, _effective_value) in routed_replaced_values.items():
        if route_values.pop(key, None) != source_value:
            raise ValueError(f"settings preset route/control mismatch for {key}")
    if routed_retired_values or routed_carried_values:
        route_entries = [
            (key, value) for key, value in route_entries
            if key not in routed_retired_values and key not in routed_carried_values
        ]
    if routed_replaced_values:
        route_entries = [
            (key, routed_replaced_values[key][1] if key in routed_replaced_values else value)
            for key, value in route_entries
        ]
    for key, default_value in routed_default_values.items():
        if key in route_values:
            raise ValueError(f"settings preset route contains unowned additive parameter {key}")
        route_entries.append((key, default_value))
    for key in schema.get("routeExtraParams") or []:
        if key not in route_values:
            raise skew(f"settings preset route omitted metadata parameter {key}")
        route_values.pop(key)
    if route_values:
        raise skew(f"settings preset route contains unexpected parameters: {','.join(sorted(route_values))}")
    if zeroed_params:
        route_entries = [(key, "0" if key in zeroed_params else value) for key, value in route_entries]
    normalized["route"] = parsed._replace(query=urlencode(route_entries)).geturl()
    return normalized, {
        "identity": "kaminos-volume-settings-schema-projection-v1",
        "sourceControlCount": payload.get("controlCount"),
        "effectiveControlCount": normalized.get("controlCount"),
        "sourceRendererControlCount": payload.get("rendererControlCount", 0),
        "effectiveRendererControlCount": normalized.get("rendererControlCount", 0),
        "sourcePresentationControlCount": payload.get("presentationControlCount", 0),
        "effectivePresentationControlCount": normalized.get("presentationControlCount", 0),
        "defaultsApplied": defaults_applied,
        "retiredControlsStripped": retired_controls_stripped,
        "carriedControls": carried_controls,
        "unsupportedValuesDefaulted": unsupported_values_defaulted,
        "forceSwitchTransfers": force_switch_transfers,
    }


def validate_volume_settings_preset_payload(payload, schema=None):
    if "sourceRadiusSpace" in payload and payload["sourceRadiusSpace"] != "simulation-v1":
        raise ValueError("Unknown preset source radius space")
    schema = _validate_settings_preset_schema(
        schema or json.loads(VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
    )
    if payload.get("identity") != VOLUME_SETTINGS_PRESET_IDENTITY or payload.get("kind") != "settings-preset":
        raise ValueError("settings preset identity mismatch")
    if payload.get("schemaIdentity") != schema.get("identity"):
        raise ValueError("settings preset schema identity mismatch")

    allowed_fields = set(schema.get("allowedNativePresetFields") or [])
    unexpected_fields = sorted(set(payload) - allowed_fields)
    if unexpected_fields:
        raise ValueError(f"settings preset contains fields outside its canonical schema: {','.join(unexpected_fields)}")

    dom_controls = payload.get("domControls")
    expected_controls = schema.get("controls") or []
    if not isinstance(dom_controls, dict) or payload.get("controlCount") != len(expected_controls) or len(dom_controls) != len(expected_controls):
        raise ValueError(f"settings preset requires exactly {len(expected_controls)} canonical controls")
    expected_by_key = {entry["key"]: entry for entry in expected_controls}
    if set(dom_controls) != set(expected_by_key):
        raise ValueError("settings preset control inventory does not match the canonical schema")

    expected_renderer_controls = schema.get("rendererControls") or []
    renderer_controls = payload.get("rendererControls")
    if renderer_controls is None and not expected_renderer_controls:
        if payload.get("rendererControlCount") not in (None, 0):
            raise ValueError("settings preset renderer control count is invalid")
        renderer_controls = {}
    elif (
        not isinstance(renderer_controls, dict)
        or payload.get("rendererControlCount") != len(expected_renderer_controls)
        or len(renderer_controls) != len(expected_renderer_controls)
    ):
        raise ValueError(
            f"settings preset requires exactly {len(expected_renderer_controls)} renderer controls"
        )
    expected_renderer_by_key = {entry["key"]: entry for entry in expected_renderer_controls}
    if renderer_controls and set(renderer_controls) != set(expected_renderer_by_key):
        raise ValueError("settings preset renderer control inventory does not match the canonical schema")

    expected_presentation_controls = schema.get("presentationControls") or []
    presentation_controls = payload.get("presentationControls")
    if presentation_controls is None and not expected_presentation_controls:
        if payload.get("presentationControlCount") not in (None, 0):
            raise ValueError("settings preset presentation control count is invalid")
        presentation_controls = {}
    elif (
        not isinstance(presentation_controls, dict)
        or payload.get("presentationControlCount") != len(expected_presentation_controls)
        or len(presentation_controls) != len(expected_presentation_controls)
    ):
        raise ValueError(
            f"settings preset requires exactly {len(expected_presentation_controls)} presentation controls"
        )
    expected_presentation_by_key = {entry["key"]: entry for entry in expected_presentation_controls}
    if set(presentation_controls) != set(expected_presentation_by_key):
        raise ValueError("settings preset presentation control inventory does not match the canonical schema")

    routed_values = {}
    for key, descriptor in {**dom_controls, **renderer_controls, **presentation_controls}.items():
        expected = expected_by_key.get(key) or expected_renderer_by_key.get(key) or expected_presentation_by_key.get(key)
        _validate_settings_preset_descriptor(key, descriptor, expected)
        routed_values[expected["param"]] = _settings_preset_route_value(
            _settings_preset_descriptor_value(descriptor)
        )

    exclusions = payload.get("stateExclusions") or {}
    if any(exclusions.get(field) is not True for field in schema.get("excludedStateFields") or []):
        raise ValueError("settings preset must explicitly exclude runtime and replay state")
    if any(field in payload for field in schema.get("forbiddenPresetFields") or []):
        raise ValueError("settings preset must not contain runtime, renderer, camera, or replay state")

    route = payload.get("route")
    if not isinstance(route, str) or not route:
        raise ValueError("settings preset requires an exact control route")
    route_entries = parse_qsl(urlparse(route).query, keep_blank_values=True)
    route_values = {}
    for key, value in route_entries:
        if key in route_values:
            raise ValueError(f"settings preset route duplicates parameter {key}")
        route_values[key] = value
    activation = schema.get("activationParam") or {}
    if route_values.pop(activation.get("key"), None) != activation.get("value"):
        raise ValueError("settings preset route omitted the native volume activation gate")
    for key, expected_value in routed_values.items():
        if route_values.pop(key, None) != expected_value:
            raise ValueError(f"settings preset route/control mismatch for {key}")
    for key in schema.get("routeExtraParams") or []:
        if key not in route_values:
            raise ValueError(f"settings preset route omitted metadata parameter {key}")
        route_values.pop(key)
    if route_values:
        raise ValueError(f"settings preset route contains unexpected parameters: {','.join(sorted(route_values))}")
    return True


def _volume_settings_store_path(store_path):
    return Path(store_path).expanduser().resolve()


def _volume_settings_alias_slug(label):
    slug = re.sub(r"[^A-Za-z0-9_.-]+", "-", str(label or "").strip()).strip(".-").lower()[:96]
    return slug or "unnamed-preset"


def _volume_settings_control_values(payload, schema):
    return {
        key: _settings_preset_descriptor_value(descriptor)
        for key, descriptor in (payload.get("domControls") or {}).items()
    }


def _volume_settings_renderer_control_values(payload, schema):
    controls = payload.get("rendererControls")
    if not controls:
        return None
    return {
        key: _settings_preset_descriptor_value(descriptor)
        for key, descriptor in controls.items()
    }


def _volume_settings_presentation_control_values(payload, schema):
    controls = payload.get("presentationControls")
    if not controls:
        return None
    return {
        key: _settings_preset_descriptor_value(descriptor)
        for key, descriptor in controls.items()
    }


def _volume_settings_content_hash(payload, schema):
    canonical = {
        "schemaIdentity": schema["identity"],
        "controls": _volume_settings_control_values(payload, schema),
    }
    if "sourceRadiusSpace" in payload:
        canonical["sourceRadiusSpace"] = payload["sourceRadiusSpace"]
    renderer_controls = _volume_settings_renderer_control_values(payload, schema)
    if renderer_controls is not None:
        canonical["rendererControls"] = renderer_controls
    presentation_controls = _volume_settings_presentation_control_values(payload, schema)
    if presentation_controls is not None:
        canonical["presentationControls"] = presentation_controls
    encoded = json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return hashlib.sha256(encoded).hexdigest()


def _atomic_write_json(path, document):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_path = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as handle:
            json.dump(document, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    except Exception:
        try:
            os.unlink(temporary_path)
        except FileNotFoundError:
            pass
        raise


def _atomic_create_json(path, document):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_path = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as handle:
            json.dump(document, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary_path, path)
        except FileExistsError:
            return False
        directory_descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
        return True
    finally:
        try:
            os.unlink(temporary_path)
        except FileNotFoundError:
            pass


@contextmanager
def _volume_settings_store_lock(store):
    store = _volume_settings_store_path(store)
    store.mkdir(parents=True, exist_ok=True)
    lock_path = store / ".write.lock"
    with lock_path.open("a+") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield store
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _read_json_object(path, role):
    try:
        document = json.loads(Path(path).read_text())
    except FileNotFoundError:
        raise
    except Exception as error:
        raise ValueError(f"volume settings preset {role} is unreadable: {error}") from error
    if not isinstance(document, dict):
        raise ValueError(f"volume settings preset {role} is not a JSON object")
    return document


def _project_volume_cockpit_layout(layout, schema=None, *, allow_declared_retired=False):
    if not isinstance(layout, dict):
        raise ValueError("volume cockpit layout must be a JSON object")
    if set(layout) != {"identity", "layoutId", "label", "groups"}:
        raise ValueError("volume cockpit layout fields do not match the v1 contract")
    if layout.get("identity") != "kaminos.volume.cockpit-layout.v1":
        raise ValueError("volume cockpit layout identity mismatch")
    layout_id = layout.get("layoutId")
    if not isinstance(layout_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,95}", layout_id):
        raise ValueError("volume cockpit layout id is invalid")
    label = layout.get("label")
    if not isinstance(label, str) or not label.strip():
        raise ValueError("volume cockpit layout label is required")
    groups = layout.get("groups")
    if not isinstance(groups, list) or not groups:
        raise ValueError("volume cockpit layout groups are required")

    schema = _validate_settings_preset_schema(
        schema or json.loads(VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
    )
    known_control_ids = {
        descriptor["key"]
        for descriptor in [*schema.get("controls", []), *schema.get("rendererControls", [])]
    }
    retired_control_ids = {
        descriptor["key"]
        for descriptor in schema.get("retiredControls") or []
        if descriptor.get("axis") in {"domControls", "rendererControls"}
    }
    group_ids = set()
    placed_control_ids = set()
    normalized_groups = []
    retired_controls_stripped = []
    for group in groups:
        if not isinstance(group, dict) or set(group) != {"id", "label", "surface", "collapsed", "controlIds"}:
            raise ValueError("volume cockpit layout group fields do not match the v1 contract")
        group_id = group.get("id")
        if not isinstance(group_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,95}", group_id):
            raise ValueError("volume cockpit layout group id is invalid")
        if group_id in group_ids:
            raise ValueError(f"volume cockpit layout duplicate group: {group_id}")
        group_ids.add(group_id)
        group_label = group.get("label")
        if not isinstance(group_label, str) or not group_label.strip():
            raise ValueError(f"volume cockpit layout group label is required: {group_id}")
        if group.get("surface") not in {"primary", "authored-mix"}:
            raise ValueError(f"volume cockpit layout group surface is invalid: {group_id}")
        if not isinstance(group.get("collapsed"), bool):
            raise ValueError(f"volume cockpit layout group collapse state is invalid: {group_id}")
        control_ids = group.get("controlIds")
        if not isinstance(control_ids, list) or any(not isinstance(control_id, str) for control_id in control_ids):
            raise ValueError(f"volume cockpit layout group control ids are invalid: {group_id}")
        admitted_control_ids = known_control_ids | (retired_control_ids if allow_declared_retired else set())
        unknown = sorted(set(control_ids) - admitted_control_ids)
        if unknown:
            raise ValueError(f"volume cockpit layout contains unknown controls: {','.join(unknown)}")
        duplicates = sorted(placed_control_ids.intersection(control_ids))
        if duplicates or len(set(control_ids)) != len(control_ids):
            duplicates = duplicates or sorted(control_id for control_id in set(control_ids) if control_ids.count(control_id) > 1)
            raise ValueError(f"volume cockpit layout contains duplicate controls: {','.join(duplicates)}")
        placed_control_ids.update(control_ids)
        retained_control_ids = []
        for control_id in control_ids:
            if control_id in retired_control_ids:
                retired_controls_stripped.append({"groupId": group_id, "id": control_id})
            else:
                retained_control_ids.append(control_id)
        normalized_groups.append({
            "id": group_id,
            "label": group_label.strip(),
            "surface": group["surface"],
            "collapsed": group["collapsed"],
            "controlIds": retained_control_ids,
        })
    return {
        "identity": "kaminos.volume.cockpit-layout.v1",
        "layoutId": layout_id,
        "label": label.strip(),
        "groups": normalized_groups,
    }, {
        "identity": "kaminos.volume.cockpit-layout-schema-projection.v1",
        "retiredControlsStripped": retired_controls_stripped,
    }


def _normalize_volume_cockpit_layout(layout, schema=None):
    normalized, _ = _project_volume_cockpit_layout(layout, schema)
    return normalized


def _volume_cockpit_layout_hash(layout):
    canonical = json.dumps(layout, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return hashlib.sha256(canonical).hexdigest()


def write_volume_cockpit_layout(store_path, layout, activate=True, schema=None):
    store = _volume_settings_store_path(store_path)
    normalized, schema_projection = _project_volume_cockpit_layout(
        layout,
        schema,
        allow_declared_retired=True,
    )
    content_hash = _volume_cockpit_layout_hash(normalized)
    layout_path = store / "layouts" / f"{normalized['layoutId']}.json"
    written_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    artifact = {
        "identity": "kaminos.volume.cockpit-layout-artifact.v1",
        "layoutId": normalized["layoutId"],
        "contentHash": f"sha256:{content_hash}",
        "writtenAt": written_at,
        "source": volume_settings_server_source(),
        "layout": normalized,
    }
    with _volume_settings_store_lock(store):
        _atomic_write_json(layout_path, artifact)
        if activate:
            _atomic_write_json(store / "active.json", {
                "identity": "kaminos.volume.cockpit-layout-active.v1",
                "layoutId": normalized["layoutId"],
                "contentHash": artifact["contentHash"],
                "updatedAt": written_at,
            })
    return {
        "ok": True,
        "identity": "kaminos.volume.cockpit-layout-write-receipt.v1",
        "requested": {
            "storePath": str(store),
            "layoutId": normalized["layoutId"],
            "activate": bool(activate),
        },
        "effective": {
            "storePath": str(store),
            "layoutPath": str(layout_path),
            "layoutId": normalized["layoutId"],
            "label": normalized["label"],
            "contentHash": artifact["contentHash"],
            "active": bool(activate),
        },
        "schemaProjection": schema_projection,
        "layoutUrl": f"/api/volume-cockpit-layout?id={normalized['layoutId']}",
    }


def activate_volume_cockpit_layout(store_path, layout_id, schema=None):
    store = _volume_settings_store_path(store_path)
    with _volume_settings_store_lock(store):
        artifact = read_volume_cockpit_layout(store, layout_id, schema)
        content_hash = artifact["contentHash"]
        activated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        _atomic_write_json(store / "active.json", {
            "identity": "kaminos.volume.cockpit-layout-active.v1",
            "layoutId": layout_id,
            "contentHash": content_hash,
            "updatedAt": activated_at,
        })
    return {
        "ok": True,
        "identity": "kaminos.volume.cockpit-layout-activation-receipt.v1",
        "requested": {
            "storePath": str(store),
            "layoutId": layout_id,
        },
        "effective": {
            "storePath": str(store),
            "layoutPath": artifact["layoutPath"],
            "layoutId": layout_id,
            "contentHash": content_hash,
            "active": True,
        },
    }


def read_volume_cockpit_layout(store_path, layout_id, schema=None):
    store = _volume_settings_store_path(store_path)
    if not isinstance(layout_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,95}", layout_id):
        raise ValueError("volume cockpit layout id is invalid")
    layout_path = store / "layouts" / f"{layout_id}.json"
    try:
        artifact = _read_json_object(layout_path, "cockpit layout artifact")
    except FileNotFoundError as error:
        raise FileNotFoundError(f"volume cockpit layout not found: {layout_id}") from error
    if artifact.get("identity") != "kaminos.volume.cockpit-layout-artifact.v1" or artifact.get("layoutId") != layout_id:
        raise ValueError("volume cockpit layout artifact identity mismatch")
    source_layout = artifact.get("layout")
    content_hash = f"sha256:{_volume_cockpit_layout_hash(source_layout)}"
    if artifact.get("contentHash") != content_hash:
        raise ValueError("volume cockpit layout artifact content hash mismatch")
    normalized, schema_projection = _project_volume_cockpit_layout(
        source_layout,
        schema,
        allow_declared_retired=True,
    )
    return {
        **artifact,
        "layout": normalized,
        "schemaProjection": schema_projection,
        "layoutPath": str(layout_path),
        "storePath": str(store),
    }


def list_volume_cockpit_layouts(store_path, schema=None):
    store = _volume_settings_store_path(store_path)
    layouts_dir = store / "layouts"
    layouts_dir.mkdir(parents=True, exist_ok=True)
    active_path = store / "active.json"
    active_layout_id = None
    active_content_hash = None
    if active_path.exists():
        active = _read_json_object(active_path, "cockpit layout active pointer")
        if set(active) != {"identity", "layoutId", "contentHash", "updatedAt"}:
            raise ValueError("volume cockpit layout active pointer fields do not match the v1 contract")
        if active.get("identity") != "kaminos.volume.cockpit-layout-active.v1":
            raise ValueError("volume cockpit layout active pointer identity mismatch")
        active_layout_id = active.get("layoutId")
        active_content_hash = active.get("contentHash")
    entries = []
    for layout_path in layouts_dir.glob("*.json"):
        artifact = read_volume_cockpit_layout(store, layout_path.stem, schema)
        entries.append({
            "layoutId": artifact["layoutId"],
            "label": artifact["layout"]["label"],
            "contentHash": artifact["contentHash"],
            "writtenAt": artifact.get("writtenAt"),
            "groupCount": len(artifact["layout"]["groups"]),
            "retiredControlsStripped": (artifact.get("schemaProjection") or {}).get("retiredControlsStripped") or [],
        })
    entries.sort(key=lambda entry: (entry.get("writtenAt") or "", entry["layoutId"]), reverse=True)
    if active_layout_id and active_layout_id not in {entry["layoutId"] for entry in entries}:
        raise ValueError("volume cockpit layout active pointer names a missing layout")
    if active_layout_id:
        active_entry = next(entry for entry in entries if entry["layoutId"] == active_layout_id)
        if active_entry["contentHash"] != active_content_hash:
            raise ValueError("volume cockpit layout active pointer content hash mismatch")
    return {
        "identity": "kaminos.volume.cockpit-layout-index.v1",
        "storePath": str(store),
        "activeLayoutId": active_layout_id,
        "entries": entries,
    }


def _volume_settings_alias_for_label(store, label):
    base = _volume_settings_alias_slug(label)

    def existing_label(alias):
        path = store / "aliases" / f"{alias}.json"
        if not path.exists():
            return None
        document = _read_json_object(path, "alias")
        if document.get("identity") != "kaminos-volume-settings-preset-alias-v1" or document.get("alias") != alias:
            raise ValueError(f"volume settings preset alias identity mismatch: {alias}")
        current_label = document.get("label")
        if not isinstance(current_label, str) or not current_label.strip():
            raise ValueError(f"volume settings preset alias label is invalid: {alias}")
        return current_label

    current_label = existing_label(base)
    if current_label is None or current_label == label:
        return base
    suffix = hashlib.sha256(label.encode("utf-8")).hexdigest()[:12]
    disambiguated = f"{base[:81].rstrip('.-')}--{suffix}"
    current_label = existing_label(disambiguated)
    if current_label is not None and current_label != label:
        raise ValueError("volume settings preset alias hash collision")
    return disambiguated


_NO_LIBRARY_DECISION = object()


def _prepare_volume_settings_preset_write(payload, schema):
    """Validate a payload for writing; return its normalized form, projection, and content hash."""
    for axis, count_field in (("domControls", "controlCount"), ("rendererControls", "rendererControlCount"), ("presentationControls", "presentationControlCount")):
        if axis == "domControls" or axis in payload or schema.get(axis):
            if payload.get(count_field) is None:
                raise ValueError(f"settings preset write requires authored {count_field}")
    normalized_payload, schema_projection = normalize_volume_settings_preset_payload(payload, schema)
    if schema_projection["defaultsApplied"]:
        raise ValueError(
            "settings preset write cannot project missing active controls: "
            + ",".join(schema_projection["defaultsApplied"])
        )
    validate_volume_settings_preset_payload(normalized_payload, schema)
    return normalized_payload, schema_projection, _volume_settings_content_hash(normalized_payload, schema)


def write_volume_settings_preset(store_path, label, payload, source, schema=None, library_hold=_NO_LIBRARY_DECISION, *, publish_alias=True):
    """Write a basin into one store.

    Without a library the store decides alone whether its label follows the new
    basin. With one, the caller passes the library's decision: the label holds
    if the library held, and also if this store's own label points at a basin
    the writer cannot hold (a local-only hold, reported with scope
    "local-store"), so branches still reading this store directly keep it.
    With publish_alias False (a scene snapshot) the basin is stored by id only
    and no label moves.
    """
    if not isinstance(publish_alias, bool):
        raise ValueError("publishAlias must be a boolean")
    schema = schema or json.loads(VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
    normalized_payload, schema_projection, content_hash = _prepare_volume_settings_preset_write(payload, schema)
    store = _volume_settings_store_path(store_path)
    effective_label = str(label or "").strip() or "Unnamed preset"
    preset_id = f"vsp-{content_hash}"
    written_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    document = {
        "identity": VOLUME_SETTINGS_PRESET_ARTIFACT_IDENTITY,
        "presetId": preset_id,
        "contentHash": f"sha256:{content_hash}",
        "schemaIdentity": schema["identity"],
        "controlCount": schema["controlCount"],
        "initialLabel": effective_label,
        "writtenAt": written_at,
        "source": dict(source or {}),
        "preset": normalized_payload,
    }
    with _volume_settings_store_lock(store):
        alias = _volume_settings_alias_for_label(store, effective_label) if publish_alias else None
        preset_path = store / "presets" / f"{preset_id}.json"
        alias_path = store / "aliases" / f"{alias}.json" if publish_alias else None
        created = _atomic_create_json(preset_path, document)
        idempotent = not created
        if idempotent:
            existing = read_volume_settings_preset(store, preset_id, schema)
            if existing.get("contentHash") != document["contentHash"]:
                raise ValueError("volume settings preset content identity collision")

        alias_document = {
            "identity": "kaminos-volume-settings-preset-alias-v1",
            "alias": alias,
            "label": effective_label,
            "presetId": preset_id,
            "contentHash": document["contentHash"],
            "schemaIdentity": schema["identity"],
            "updatedAt": written_at,
            "source": dict(source or {}),
        }
        alias_held = None
        if publish_alias:
            own_hold = _volume_settings_label_hold(
                store, _volume_settings_alias_document(store, alias), preset_id, normalized_payload, schema
            )
            if library_hold is _NO_LIBRARY_DECISION:
                alias_held = own_hold
            elif library_hold:
                alias_held = library_hold
            else:
                alias_held = {**own_hold, "scope": "local-store"} if own_hold else None
            history_row = _volume_settings_label_history_row(alias_document, written_at, source)
            if alias_held:
                history_row["held"] = alias_held
            _append_volume_settings_alias_history(store, alias, history_row)
            if alias_held is None:
                _atomic_write_json(alias_path, alias_document)
    preset_url = f"/volume-settings-preset.html?preset={preset_id}"
    return {
        "ok": True,
        "identity": "kaminos-volume-settings-preset-write-receipt-v1",
        "requested": {
            "label": label,
            "storePath": str(store),
            "schemaIdentity": payload.get("schemaIdentity"),
            "controlCount": payload.get("controlCount"),
        },
        "effective": {
            "alias": alias,
            "publishAlias": publish_alias,
            "label": effective_label,
            "presetId": preset_id,
            "contentHash": document["contentHash"],
            "storePath": str(store),
            "schemaIdentity": schema["identity"],
            "controlCount": schema["controlCount"],
            "rendererControlCount": len(normalized_payload.get("rendererControls") or {}),
            "presentationControlCount": len(normalized_payload.get("presentationControls") or {}),
            "idempotent": idempotent,
            "aliasHeld": alias_held,
        },
        "schemaProjection": schema_projection,
        "presetUrl": preset_url,
        "presetViewUrls": {
            view: f"{preset_url}&view={view}"
            for view in ("splat-only", "raymarch-only", "smoke-hybrid", "full-hybrid-diagnostic")
        },
    }


def read_volume_settings_preset(store_path, preset_ref, schema=None):
    schema = schema or json.loads(VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
    store = _volume_settings_store_path(store_path)
    requested = str(preset_ref or "").strip()
    if not requested:
        raise ValueError("volume settings preset id or alias is required")
    alias_document = None
    if requested.startswith("vsp-"):
        if not re.fullmatch(r"vsp-[0-9a-f]{64}", requested):
            raise ValueError("volume settings preset content id is invalid")
        preset_id = requested
    else:
        alias = _volume_settings_alias_slug(requested)
        if alias != requested:
            raise ValueError("volume settings preset alias is invalid")
        alias_path = store / "aliases" / f"{alias}.json"
        try:
            alias_document = _read_json_object(alias_path, "alias")
        except FileNotFoundError as error:
            raise FileNotFoundError(f"volume settings preset alias not found: {alias}") from error
        if alias_document.get("identity") != "kaminos-volume-settings-preset-alias-v1" or alias_document.get("alias") != alias:
            raise ValueError("volume settings preset alias identity mismatch")
        if alias_document.get("schemaIdentity") != schema.get("identity"):
            raise ValueError("volume settings preset alias schema mismatch")
        if not isinstance(alias_document.get("label"), str) or not alias_document["label"].strip():
            raise ValueError("volume settings preset alias label is invalid")
        preset_id = alias_document.get("presetId")
        if not isinstance(preset_id, str) or not re.fullmatch(r"vsp-[0-9a-f]{64}", preset_id):
            raise ValueError("volume settings preset alias target is invalid")

    preset_path = store / "presets" / f"{preset_id}.json"
    try:
        document = _read_json_object(preset_path, "artifact")
    except FileNotFoundError as error:
        raise FileNotFoundError(f"volume settings preset not found: {preset_id}") from error
    if document.get("identity") != VOLUME_SETTINGS_PRESET_ARTIFACT_IDENTITY or document.get("presetId") != preset_id:
        raise ValueError("volume settings preset artifact identity mismatch")
    raw_payload = document.get("preset") or {}
    if (
        document.get("schemaIdentity") != schema.get("identity")
        or document.get("controlCount") != raw_payload.get("controlCount")
    ):
        raise ValueError("volume settings preset artifact schema mismatch")
    content_hash = _volume_settings_content_hash(raw_payload, schema)
    if document.get("contentHash") != f"sha256:{content_hash}" or preset_id != f"vsp-{content_hash}":
        raise ValueError("volume settings preset artifact content hash mismatch")
    if alias_document and alias_document.get("contentHash") != document.get("contentHash"):
        raise ValueError("volume settings preset alias content hash mismatch")
    normalized_payload, schema_projection = normalize_volume_settings_preset_payload(
        raw_payload, schema, tolerate_foreign_controls=True
    )
    validate_volume_settings_preset_payload(normalized_payload, schema)
    return {
        **document,
        "sourceControlCount": raw_payload.get("controlCount"),
        "sourceRendererControlCount": raw_payload.get("rendererControlCount", 0),
        "sourcePresentationControlCount": raw_payload.get("presentationControlCount", 0),
        "controlCount": normalized_payload.get("controlCount"),
        "preset": normalized_payload,
        "schemaProjection": schema_projection,
        "requestedPresetRef": requested,
        "alias": alias_document.get("alias") if alias_document else None,
        "label": alias_document.get("label") if alias_document else (document.get("initialLabel") or document.get("label")),
        "storePath": str(store),
    }


# The preset index is requested on every page load and reads every preset in
# the local store and the shared basin library. Presets are content-addressed,
# so the hash check, schema projection and validation of an unchanged file are
# kept per (store, reference, schema) and reused while the alias and preset
# files keep their identity (inode, size, mtime). A changed or missing file is
# read again; a read that fails is never cached.
_VOLUME_SETTINGS_PRESET_SUMMARIES = {}


def _volume_settings_schema_key(schema):
    return hashlib.sha256(json.dumps(schema, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _file_identity(path):
    stat = path.stat()
    return (str(path), stat.st_ino, stat.st_size, stat.st_mtime_ns)


def _volume_settings_preset_summary_from_document(document):
    preset = document.get("preset") or {}
    projection = document.get("schemaProjection") or {}
    return {
        "label": document["label"],
        "presetId": document["presetId"],
        "contentHash": document["contentHash"],
        "schemaIdentity": document["schemaIdentity"],
        "controlCount": document["controlCount"],
        "rendererControlCount": len(preset.get("rendererControls") or {}),
        "presentationControlCount": len(preset.get("presentationControls") or {}),
        "schemaProjection": {
            field: list(projection.get(field) or [])
            for field in ("defaultsApplied", "retiredControlsStripped", "carriedControls", "unsupportedValuesDefaulted")
        },
    }


def read_volume_settings_preset_summary(store_path, preset_ref, schema, schema_key=None):
    """The fields the preset index lists, from a cached validated read."""
    store = _volume_settings_store_path(store_path)
    schema_key = schema_key or _volume_settings_schema_key(schema)
    ref = str(preset_ref or "").strip()
    try:
        if ref.startswith("vsp-"):
            paths = [store / "presets" / f"{ref}.json"]
        else:
            alias_path = store / "aliases" / f"{ref}.json"
            preset_id = _read_json_object(alias_path, "alias").get("presetId")
            paths = [alias_path, store / "presets" / f"{preset_id}.json"]
        identity = tuple(_file_identity(path) for path in paths)
    except (OSError, ValueError, TypeError):
        identity = None
    key = (str(store), ref, schema_key)
    cached = _VOLUME_SETTINGS_PRESET_SUMMARIES.get(key)
    if identity is not None and cached is not None and cached[0] == identity:
        summary = cached[1]
    else:
        summary = _volume_settings_preset_summary_from_document(read_volume_settings_preset(store, ref, schema))
        if identity is not None:
            _VOLUME_SETTINGS_PRESET_SUMMARIES[key] = (identity, summary)
    return {**summary, "schemaProjection": copy.deepcopy(summary["schemaProjection"])}


def list_volume_settings_presets(store_path, schema=None):
    schema = schema or json.loads(VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
    store = _volume_settings_store_path(store_path)
    schema_key = _volume_settings_schema_key(schema)
    aliases_dir = store / "aliases"
    aliases_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    unavailable_entries = []
    invalid_aliases = []
    for alias_path in sorted(aliases_dir.glob("*.json")):
        # A malformed alias is reported on its own; it must not fail the index.
        try:
            alias_document = _read_json_object(alias_path, "alias")
            alias = alias_document.get("alias")
            if alias_path.stem != alias:
                raise ValueError(f"volume settings preset alias filename mismatch: {alias_path.name}")
            if alias_document.get("identity") != "kaminos-volume-settings-preset-alias-v1":
                raise ValueError("volume settings preset alias identity mismatch")
            if not isinstance(alias_document.get("label"), str) or not alias_document["label"].strip():
                raise ValueError("volume settings preset alias label is invalid")
            if not isinstance(alias_document.get("presetId"), str) or not re.fullmatch(r"vsp-[0-9a-f]{64}", alias_document["presetId"]):
                raise ValueError("volume settings preset alias target is invalid")
        except (OSError, ValueError) as error:
            invalid_aliases.append({"alias": alias_path.stem, "path": str(alias_path), "error": str(error)})
            continue
        try:
            document = read_volume_settings_preset_summary(store, alias, schema, schema_key)
        except (OSError, ValueError) as error:
            # One unreadable basin is reported on its own entry; it must not
            # take down the picker for every other basin in the store.
            unavailable_entries.append({
                "alias": alias,
                "label": alias_document["label"],
                "presetId": alias_document["presetId"],
                "updatedAt": alias_document.get("updatedAt"),
                "source": alias_document.get("source") or {},
                "reason": (
                    "schema-skew" if isinstance(error, UnsupportedVolumeSettingsControls)
                    else "invalid-artifact"
                ),
                "error": str(error),
            })
            continue
        entries.append({
            "alias": alias,
            "label": document["label"],
            "presetId": document["presetId"],
            "contentHash": document["contentHash"],
            "schemaIdentity": document["schemaIdentity"],
            "controlCount": document["controlCount"],
            "rendererControlCount": document["rendererControlCount"],
            "presentationControlCount": document["presentationControlCount"],
            "defaultsApplied": (document.get("schemaProjection") or {}).get("defaultsApplied") or [],
            "retiredControlsStripped": (document.get("schemaProjection") or {}).get("retiredControlsStripped") or [],
            "carriedControls": (document.get("schemaProjection") or {}).get("carriedControls") or [],
            "unsupportedValuesDefaulted": (document.get("schemaProjection") or {}).get("unsupportedValuesDefaulted") or [],
            "updatedAt": alias_document.get("updatedAt"),
            "source": alias_document.get("source") or {},
        })
    current_by_alias = {entry["alias"]: entry["presetId"] for entry in entries}
    current_by_alias.update({entry["alias"]: entry["presetId"] for entry in unavailable_entries})
    earlier_versions = []
    invalid_history_rows = []
    history_dir = store / "alias-history"
    for history_path in sorted(history_dir.glob("*.jsonl")) if history_dir.exists() else []:
        alias = history_path.stem
        latest_rows = {}
        rows, invalid_rows = _scan_volume_settings_alias_history(store, alias)
        invalid_history_rows.extend(invalid_rows)
        for row in rows:
            latest_rows[row["presetId"]] = row
        for preset_id, row in latest_rows.items():
            if preset_id == current_by_alias.get(alias):
                continue
            try:
                document = read_volume_settings_preset_summary(store, preset_id, schema, schema_key)
            except (OSError, ValueError) as error:
                unavailable_entries.append({
                    "alias": alias,
                    "label": row.get("label") or alias,
                    "presetId": preset_id,
                    "updatedAt": row.get("publishedAt"),
                    "source": row.get("source") or {},
                    "reason": "schema-skew" if isinstance(error, UnsupportedVolumeSettingsControls) else "invalid-artifact",
                    "version": "earlier",
                    "error": str(error),
                })
                continue
            projection = document.get("schemaProjection") or {}
            earlier_versions.append({
                "alias": alias,
                "label": row.get("label") or alias,
                "presetId": preset_id,
                "contentHash": document["contentHash"],
                "publishedAt": row.get("publishedAt"),
                "source": row.get("source") or {},
                # A held save is a version the label did not follow.
                "reason": "held-label" if row.get("held") else "superseded-label",
                "carriedControls": projection.get("carriedControls") or [],
                "unsupportedValuesDefaulted": projection.get("unsupportedValuesDefaulted") or [],
            })
    entries.sort(key=lambda entry: (_volume_settings_timestamp(entry.get("updatedAt")), entry["alias"]), reverse=True)
    earlier_versions.sort(key=lambda entry: (_volume_settings_timestamp(entry.get("publishedAt")), entry["alias"]), reverse=True)
    unavailable_entries.sort(key=lambda entry: (_volume_settings_timestamp(entry.get("updatedAt")), entry["alias"]), reverse=True)
    return {
        "identity": "kaminos-volume-settings-preset-index-v1",
        "storePath": str(store),
        "schemaIdentity": schema["identity"],
        "controlCount": schema["controlCount"],
        "rendererControlCount": len(schema.get("rendererControls") or []),
        "presentationControlCount": len(schema.get("presentationControls") or []),
        "entries": entries,
        "earlierVersions": earlier_versions,
        "unavailableEntries": unavailable_entries,
        "invalidAliases": invalid_aliases,
        "invalidHistoryRows": invalid_history_rows,
    }


def volume_settings_store_layers(local_store, shared_store):
    """Read order for basins: this server's own store, then the shared library."""
    local = _volume_settings_store_path(local_store)
    layers = [("local", local)]
    if shared_store is not None:
        shared = _volume_settings_store_path(shared_store)
        if shared != local:
            layers.append(("shared", shared))
    return layers


def _verify_volume_settings_artifact(document, schema):
    if not isinstance(document, dict) or document.get("identity") != VOLUME_SETTINGS_PRESET_ARTIFACT_IDENTITY:
        raise ValueError("volume settings preset artifact identity mismatch")
    preset_id = document.get("presetId")
    if not isinstance(preset_id, str) or not re.fullmatch(r"vsp-[0-9a-f]{64}", preset_id):
        raise ValueError("volume settings preset content id is invalid")
    raw_payload = document.get("preset")
    if not isinstance(raw_payload, dict) or document.get("schemaIdentity") != schema.get("identity"):
        raise ValueError("volume settings preset artifact schema mismatch")
    content_hash = _volume_settings_content_hash(raw_payload, schema)
    if document.get("contentHash") != f"sha256:{content_hash}" or preset_id != f"vsp-{content_hash}":
        raise ValueError("volume settings preset artifact content hash mismatch")
    return preset_id


def _volume_settings_alias_document(store, alias):
    path = store / "aliases" / f"{alias}.json"
    if not path.exists():
        return None
    document = _read_json_object(path, "alias")
    if document.get("identity") != "kaminos-volume-settings-preset-alias-v1" or document.get("alias") != alias:
        raise ValueError(f"volume settings preset alias identity mismatch: {alias}")
    return document


def _volume_settings_timestamp(value):
    """A stored timestamp for ordering; anything but an ISO string sorts as unknown."""
    return value if isinstance(value, str) else ""


def _volume_settings_newer_alias(current, candidate):
    """A label follows its latest publication; the same basin in two stores keeps the first."""
    if current is None:
        return True
    return (
        candidate.get("presetId") != current.get("presetId")
        and _volume_settings_timestamp(candidate.get("updatedAt")) > _volume_settings_timestamp(current.get("updatedAt"))
    )


def _volume_settings_label_history_row(alias_document, published_at=None, source=None):
    return {
        "identity": "kaminos-volume-settings-preset-alias-history-v1",
        "alias": alias_document["alias"],
        "label": alias_document["label"],
        "presetId": alias_document["presetId"],
        "contentHash": alias_document.get("contentHash"),
        "publishedAt": published_at if published_at is not None else (alias_document.get("updatedAt") or ""),
        "source": dict(source if source is not None else (alias_document.get("source") or {})),
    }


def _scan_volume_settings_alias_history(store, alias):
    """Label-history rows plus the rows that cannot be used (reported, never fatal)."""
    path = store / "alias-history" / f"{alias}.jsonl"
    rows = []
    invalid = []
    if not path.exists():
        return rows, invalid
    for number, line in enumerate(path.read_text().splitlines(), start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as error:
            invalid.append({"alias": alias, "path": str(path), "line": number, "error": str(error)})
            continue
        if (
            not isinstance(row, dict)
            or not isinstance(row.get("presetId"), str)
            or not re.fullmatch(r"vsp-[0-9a-f]{64}", row["presetId"])
            or ("label" in row and (not isinstance(row["label"], str) or not row["label"].strip()))
            or ("source" in row and not isinstance(row["source"], dict))
        ):
            invalid.append({"alias": alias, "path": str(path), "line": number, "error": "label history row is not a basin version"})
            continue
        rows.append(row)
    return rows, invalid


def _read_volume_settings_alias_history(store, alias):
    return _scan_volume_settings_alias_history(store, alias)[0]


def _append_volume_settings_alias_history(store, alias, row):
    """Append-only label log: re-pointing a label never erases where it pointed."""
    path = store / "alias-history" / f"{alias}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    existing_rows = _read_volume_settings_alias_history(store, alias)
    # Keep the pointer being replaced whenever the log lacks it: stores that
    # predate label history, and re-points by writers that do not keep it.
    current = _volume_settings_alias_document(store, alias)
    if (
        current is not None
        and isinstance(current.get("presetId"), str)
        and re.fullmatch(r"vsp-[0-9a-f]{64}", current["presetId"])
        and isinstance(current.get("label"), str)
        and current.get("presetId") != row["presetId"]
        and not any(existing.get("presetId") == current.get("presetId") for existing in existing_rows)
    ):
        with path.open("a") as handle:
            handle.write(json.dumps(_volume_settings_label_history_row(current), sort_keys=True) + "\n")
    if any(existing.get("presetId") == row["presetId"] and existing.get("publishedAt") == row["publishedAt"] for existing in existing_rows):
        return False
    with path.open("a") as handle:
        handle.write(json.dumps(row, sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    return True


def _volume_settings_raw_control_keys(payload):
    keys = set()
    for field in ("domControls", "rendererControls", "presentationControls"):
        controls = payload.get(field)
        if isinstance(controls, dict):
            keys.update(controls)
    return keys


def _volume_settings_label_hold(store, current_alias, new_preset_id, new_payload, schema):
    """Why a label must stay on its current basin rather than move to a new one, or None.

    The writer's schema must represent the current basin exactly: a label never
    moves onto a copy made by a branch that carried some of the current basin's
    controls out, or replaced option values it does not offer.
    """
    current_id = (current_alias or {}).get("presetId")
    if not isinstance(current_id, str) or not re.fullmatch(r"vsp-[0-9a-f]{64}", current_id) or current_id == new_preset_id:
        return None
    current_path = store / "presets" / f"{current_id}.json"
    try:
        current_payload = _read_json_object(current_path, "artifact").get("preset") or {}
    except (OSError, ValueError):
        # A missing or unreadable current basin has nothing left to protect.
        return None
    if not isinstance(current_payload, dict):
        return None
    try:
        _normalized, projection = normalize_volume_settings_preset_payload(
            current_payload, schema, tolerate_foreign_controls=True
        )
    except ValueError:
        projection = None
    if projection is not None:
        carried = [entry["id"] for entry in projection.get("carriedControls") or []]
        replaced = [entry["id"] for entry in projection.get("unsupportedValuesDefaulted") or []]
        if not carried and not replaced:
            return None
        return {
            "reason": "would-drop-controls" if carried else "would-replace-values",
            "controls": sorted(carried or replaced),
            "currentPresetId": current_alias["presetId"],
        }
    # The current basin does not load on this schema at all; hold only if the
    # new basin lacks controls the current one has.
    return _volume_settings_dropped_controls_hold(current_alias, current_payload, new_payload, schema)


def _volume_settings_dropped_controls_hold(current_alias, current_payload, new_payload, schema):
    retired = {descriptor["key"] for descriptor in schema.get("retiredControls") or []}
    dropped = (
        _volume_settings_raw_control_keys(current_payload) - _volume_settings_raw_control_keys(new_payload) - retired
    )
    if not dropped:
        return None
    return {"reason": "would-drop-controls", "controls": sorted(dropped), "currentPresetId": current_alias["presetId"]}


def _publish_volume_settings_artifact_locked(store, document, label, published_at, source, schema, move_alias_only_forward=False,
                                             fallback_hold=None, publish_alias=True):
    preset_id = _verify_volume_settings_artifact(document, schema)
    preset_path = store / "presets" / f"{preset_id}.json"
    created = _atomic_create_json(preset_path, document)
    if not created:
        existing = _read_json_object(preset_path, "artifact")
        if existing.get("contentHash") != document["contentHash"]:
            raise ValueError("volume settings preset content identity collision")
    if not publish_alias:
        # A scene snapshot is shared by id only; no label moves or records it.
        return {"presetId": preset_id, "alias": None, "created": created, "aliasMoved": False,
                "aliasHeld": None, "aliasKeptLive": False, "historyAppended": False}
    alias = _volume_settings_alias_for_label(store, label)
    alias_document = {
        "identity": "kaminos-volume-settings-preset-alias-v1",
        "alias": alias,
        "label": label,
        "presetId": preset_id,
        "contentHash": document["contentHash"],
        "schemaIdentity": schema["identity"],
        "updatedAt": published_at,
        "source": dict(source or {}),
    }
    current_alias = _volume_settings_alias_document(store, alias)
    alias_held = None
    alias_kept_live = False
    if not move_alias_only_forward:
        # A live save: the label follows it unless this branch cannot
        # represent the basin the label points at now.
        # Decided here, under the library lock, against the pointer as it is
        # now. Where the library has no label yet, the caller's hold against
        # the label readers resolved elsewhere applies.
        alias_held = (
            _volume_settings_label_hold(store, current_alias, preset_id, document.get("preset") or {}, schema)
            if current_alias is not None else fallback_hold
        )
        move = alias_held is None and (current_alias or {}).get("presetId") != preset_id
    elif current_alias and current_alias.get("presetId") != preset_id and "importedFrom" not in (current_alias.get("source") or {}):
        # An import never moves a label a live save set; the version is kept.
        alias_kept_live = True
        move = False
    else:
        move = _volume_settings_newer_alias(current_alias, alias_document)
        if move and current_alias:
            # Between imported pointers the importer's schema cannot judge the
            # writers' option values, so only dropped controls hold a label.
            current_path = store / "presets" / f"{current_alias.get('presetId')}.json"
            if isinstance(current_alias.get("presetId"), str) and current_path.exists():
                alias_held = _volume_settings_dropped_controls_hold(
                    current_alias, _read_json_object(current_path, "artifact").get("preset") or {},
                    document.get("preset") or {}, schema,
                )
            move = alias_held is None
    history_row = {
        "identity": "kaminos-volume-settings-preset-alias-history-v1",
        "alias": alias,
        "label": label,
        "presetId": preset_id,
        "contentHash": document["contentHash"],
        "publishedAt": published_at,
        "source": dict(source or {}),
    }
    if alias_held:
        history_row["held"] = alias_held
    elif alias_kept_live:
        history_row["held"] = {"reason": "live-label-kept", "currentPresetId": current_alias.get("presetId")}
    history_appended = _append_volume_settings_alias_history(store, alias, history_row)
    if move:
        _atomic_write_json(store / "aliases" / f"{alias}.json", alias_document)
    return {
        "presetId": preset_id,
        "alias": alias,
        "created": created,
        "aliasMoved": move,
        "aliasHeld": alias_held,
        "aliasKeptLive": alias_kept_live,
        "historyAppended": history_appended,
    }


def publish_volume_settings_preset(shared_store_path, document, label, source, schema=None, fallback_hold=None, publish_alias=True):
    """Publish one hash-verified basin artifact into the shared library."""
    schema = schema or json.loads(VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
    _verify_volume_settings_artifact(document, schema)
    store = _volume_settings_store_path(shared_store_path)
    effective_label = str(label or document.get("initialLabel") or "").strip() or "Unnamed preset"
    published_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with _volume_settings_store_lock(store):
        result = _publish_volume_settings_artifact_locked(
            store, document, effective_label, published_at, source, schema, fallback_hold=fallback_hold,
            publish_alias=publish_alias,
        )
    return {
        "published": True,
        "storePath": str(store),
        "label": effective_label,
        "publishedAt": published_at,
        **result,
    }


class VolumeSettingsLocalPrecheckError(ValueError):
    """This server's own store failed a precondition before anything was published."""


class VolumeSettingsPartialSave(ValueError):
    """The basin reached the shared library but this server's store could not be written."""

    def __init__(self, message, shared_publication, local_error):
        super().__init__(message)
        self.shared_publication = shared_publication
        self.local_error = local_error


def write_volume_settings_preset_to_library(local_store_path, shared_store_path, label, payload, source, schema=None, *,
                                            publish_alias=True):
    """Publish a basin to the shared library, then save it into this server's store.

    With the library on, it is the label authority: the library decides under
    its own lock whether its label follows the new basin (against the local
    store's label where the library has none yet), and the local store follows
    that decision, holding also where its own label points at a basin this
    branch cannot hold. If the library cannot be written, the local store
    decides alone and the receipt says the basin did not reach the library.
    """
    schema = schema or json.loads(VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
    if not isinstance(publish_alias, bool):
        raise ValueError("publishAlias must be a boolean")
    if shared_store_path is None:
        receipt = write_volume_settings_preset(local_store_path, label, payload, source, schema, publish_alias=publish_alias)
        receipt["sharedPublication"] = {"published": False, "reason": "shared basin library disabled"}
        return receipt
    normalized_payload, _projection, content_hash = _prepare_volume_settings_preset_write(payload, schema)
    preset_id = f"vsp-{content_hash}"
    effective_label = str(label or "").strip() or "Unnamed preset"
    local = _volume_settings_store_path(local_store_path)
    shared = _volume_settings_store_path(shared_store_path)
    # The local label is a precondition of the local write: a damaged one fails
    # the save here, before anything reaches the library.
    try:
        local_current = (
            _volume_settings_alias_document(local, _volume_settings_alias_for_label(local, effective_label))
            if publish_alias else None
        )
    except (OSError, ValueError) as error:
        raise VolumeSettingsLocalPrecheckError(f"this server's store {local}: {error}") from error
    document = {
        "identity": VOLUME_SETTINGS_PRESET_ARTIFACT_IDENTITY,
        "presetId": preset_id,
        "contentHash": f"sha256:{content_hash}",
        "schemaIdentity": schema["identity"],
        "controlCount": schema["controlCount"],
        "initialLabel": effective_label,
        "writtenAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": dict(source or {}),
        "preset": normalized_payload,
    }
    try:
        publication = publish_volume_settings_preset(
            shared, document, effective_label, source, schema,
            fallback_hold=_volume_settings_label_hold(local, local_current, preset_id, normalized_payload, schema),
            publish_alias=publish_alias,
        )
        library_hold = publication.get("aliasHeld")
    except (OSError, ValueError) as error:
        # The local save stands; the receipt says the basin did not reach the library.
        publication = {"published": False, "storePath": str(shared), "error": str(error)}
        library_hold = _NO_LIBRARY_DECISION
    try:
        receipt = write_volume_settings_preset(
            local, label, payload, source, schema, library_hold=library_hold, publish_alias=publish_alias
        )
    except (OSError, ValueError) as error:
        if not publication.get("published"):
            raise
        named = f' under "{publication["label"]}"' if publication.get("aliasMoved") else ""
        raise VolumeSettingsPartialSave(
            f"basin {preset_id} is in the shared library at {publication['storePath']}{named}; "
            f"not saved locally: {error}",
            publication, str(error),
        ) from error
    receipt["sharedPublication"] = publication
    return receipt


def volume_settings_store_layer_receipt():
    """The stores this server reads basins from, for error bodies."""
    return [
        {"role": role, "storePath": str(path)}
        for role, path in volume_settings_store_layers(VOLUME_SETTINGS_STORE, SHARED_BASIN_STORE)
    ]


def _volume_settings_authority_order(layers):
    """Layers in label-authority order: the shared library first, then the rest as given."""
    return sorted(layers, key=lambda layer: 0 if layer[0] == "shared" else 1)


def read_volume_settings_preset_layered(layers, preset_ref, schema=None):
    schema = schema or json.loads(VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
    requested = str(preset_ref or "").strip()
    order = list(layers)
    if requested and not requested.startswith("vsp-"):
        alias = _volume_settings_alias_slug(requested)
        if alias != requested:
            raise ValueError("volume settings preset alias is invalid")
        # The library is the label authority; a local label counts only where
        # the library has none.
        order = [
            next(((role, store) for role, store in _volume_settings_authority_order(layers)
                  if _volume_settings_alias_document(store, alias) is not None), None)
        ]
        order = [layer for layer in order if layer is not None]
    for role, store in order:
        try:
            document = read_volume_settings_preset(store, requested, schema)
        except FileNotFoundError:
            continue
        return {**document, "storeRole": role}
    raise FileNotFoundError(f"volume settings preset not found in any basin store: {requested}")


def list_volume_settings_presets_layered(layers, schema=None):
    schema = schema or json.loads(VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
    listings = [(role, list_volume_settings_presets(store, schema)) for role, store in layers]
    # A label's current version is its pointer in the authority store (the
    # library, else the local store) whether or not it loads here: an
    # unreadable current version is reported, never replaced by another
    # store's readable one presented as current.
    current = {}
    displaced = []
    for role, listing in sorted(listings, key=lambda item: 0 if item[0] == "shared" else 1):
        located = {"storeRole": role, "storePath": listing["storePath"]}
        pointers = [{**entry, **located, "available": True} for entry in listing["entries"]]
        pointers += [{**entry, **located, "available": False} for entry in listing["unavailableEntries"]
                     if entry.get("version") != "earlier"]
        for entry in pointers:
            existing = current.get(entry["alias"])
            if existing is None:
                current[entry["alias"]] = entry
            elif existing["presetId"] != entry["presetId"]:
                displaced.append(entry)
    current_keys = {(alias, entry["presetId"]) for alias, entry in current.items()}
    earlier = {}
    unavailable = {}
    for entry in current.values():
        if not entry["available"]:
            unavailable[(entry["alias"], entry["presetId"])] = entry
    for entry in displaced:
        key = (entry["alias"], entry["presetId"])
        if key in current_keys:
            continue
        if entry["available"]:
            earlier.setdefault(key, {
                "alias": entry["alias"], "label": entry["label"], "presetId": entry["presetId"],
                "contentHash": entry["contentHash"], "publishedAt": entry.get("updatedAt"), "source": entry.get("source") or {},
                "reason": "other-store-label", "storeRole": entry["storeRole"], "storePath": entry["storePath"],
                "carriedControls": entry.get("carriedControls") or [],
                "unsupportedValuesDefaulted": entry.get("unsupportedValuesDefaulted") or [],
            })
        else:
            unavailable.setdefault(key, {**entry, "version": "other-store"})
    for role, listing in listings:
        for entry in listing.get("earlierVersions") or []:
            key = (entry["alias"], entry["presetId"])
            if key not in current_keys:
                earlier.setdefault(key, {**entry, "storeRole": role, "storePath": listing["storePath"]})
        for entry in listing["unavailableEntries"]:
            key = (entry["alias"], entry["presetId"])
            if entry.get("version") == "earlier" and key not in current_keys and key not in earlier:
                unavailable.setdefault(key, {**entry, "storeRole": role, "storePath": listing["storePath"]})
    ordering = lambda entry: (
        _volume_settings_timestamp(entry.get("updatedAt")) or _volume_settings_timestamp(entry.get("publishedAt")), entry["alias"]
    )
    strip = lambda entry: {key: value for key, value in entry.items() if key != "available"}
    return {
        **listings[0][1],
        "stores": [{"role": role, "storePath": listing["storePath"]} for role, listing in listings],
        "entries": sorted((strip(entry) for entry in current.values() if entry["available"]), key=ordering, reverse=True),
        "earlierVersions": sorted(earlier.values(), key=ordering, reverse=True),
        "unavailableEntries": sorted((strip(entry) for entry in unavailable.values()), key=ordering, reverse=True),
        "invalidAliases": [
            {**entry, "storeRole": role} for role, listing in listings for entry in listing.get("invalidAliases") or []
        ],
        "invalidHistoryRows": [
            {**entry, "storeRole": role} for role, listing in listings for entry in listing.get("invalidHistoryRows") or []
        ],
    }


def import_volume_settings_stores(shared_store_path, store_paths, schema=None):
    """Additively import existing basin stores into the shared library.

    Every artifact's content hash is verified before it is accepted; labels are
    merged through the append-only history, and a label only moves forward.
    """
    schema = schema or json.loads(VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
    shared = _volume_settings_store_path(shared_store_path)
    report = {
        "identity": "kaminos-volume-settings-store-import-receipt-v1",
        "sharedStorePath": str(shared),
        "sourceStores": [],
        "presetsImported": 0,
        "presetsAlreadyPresent": 0,
        "aliasesMoved": 0,
        "aliasesHeld": 0,
        "aliasesKeptLive": 0,
        "aliasHistoryRowsAppended": 0,
        "skipped": [],
    }
    with _volume_settings_store_lock(shared):
        for store_path in store_paths:
            source_store = _volume_settings_store_path(store_path)
            report["sourceStores"].append(str(source_store))
            if source_store == shared:
                continue
            for preset_path in sorted((source_store / "presets").glob("vsp-*.json")):
                try:
                    document = _read_json_object(preset_path, "artifact")
                    if document.get("presetId") != preset_path.stem:
                        raise ValueError("volume settings preset artifact identity mismatch")
                    preset_id = _verify_volume_settings_artifact(document, schema)
                except (OSError, ValueError) as error:
                    reason = "content-hash-mismatch" if "content hash" in str(error) else "invalid-artifact"
                    report["skipped"].append({"path": str(preset_path), "reason": reason, "error": str(error)})
                    continue
                target = shared / "presets" / preset_path.name
                if _atomic_create_json(target, document):
                    report["presetsImported"] += 1
                elif _read_json_object(target, "artifact").get("contentHash") == document["contentHash"]:
                    report["presetsAlreadyPresent"] += 1
                else:
                    report["skipped"].append({"path": str(preset_path), "reason": "content-identity-collision"})
            for alias_path in sorted((source_store / "aliases").glob("*.json")):
                try:
                    alias_document = _volume_settings_alias_document(source_store, alias_path.stem)
                    label = alias_document.get("label")
                    preset_id = alias_document.get("presetId")
                    if not isinstance(label, str) or not label.strip() or not isinstance(preset_id, str):
                        raise ValueError("volume settings preset alias is invalid")
                    target = shared / "presets" / f"{preset_id}.json"
                    if not target.exists():
                        raise ValueError(f"volume settings preset alias target was not imported: {preset_id}")
                    result = _publish_volume_settings_artifact_locked(
                        shared,
                        _read_json_object(target, "artifact"),
                        label,
                        alias_document.get("updatedAt") or "",
                        {**(alias_document.get("source") or {}), "importedFrom": str(source_store)},
                        schema,
                        move_alias_only_forward=True,
                    )
                except (OSError, ValueError) as error:
                    report["skipped"].append({"path": str(alias_path), "reason": "invalid-alias", "error": str(error)})
                    continue
                report["aliasesMoved"] += int(result["aliasMoved"])
                report["aliasesHeld"] += int(result["aliasHeld"] is not None)
                report["aliasesKeptLive"] += int(result["aliasKeptLive"])
                report["aliasHistoryRowsAppended"] += int(result["historyAppended"])
            history_dir = source_store / "alias-history"
            for history_path in sorted(history_dir.glob("*.jsonl")) if history_dir.exists() else []:
                rows, invalid_rows = _scan_volume_settings_alias_history(source_store, history_path.stem)
                report["skipped"].extend(
                    {"path": row["path"], "reason": "invalid-history-row", "line": row["line"], "error": row["error"]}
                    for row in invalid_rows
                )
                for row in rows:
                    label = row.get("label")
                    preset_id = row.get("presetId")
                    if not isinstance(label, str) or not label.strip() or not isinstance(preset_id, str):
                        continue
                    if not (shared / "presets" / f"{preset_id}.json").exists():
                        report["skipped"].append({"path": str(history_path), "reason": "history-target-not-imported", "presetId": preset_id})
                        continue
                    alias = _volume_settings_alias_for_label(shared, label)
                    appended = _append_volume_settings_alias_history(shared, alias, {
                        **row,
                        "alias": alias,
                        "source": {**(row.get("source") or {}), "importedFrom": str(source_store)},
                    })
                    report["aliasHistoryRowsAppended"] += int(appended)
        current = set()
        for alias_path in (shared / "aliases").glob("*.json"):
            current.add(_read_json_object(alias_path, "alias").get("presetId"))
        in_history = set()
        history_dir = shared / "alias-history"
        for history_path in history_dir.glob("*.jsonl") if history_dir.exists() else []:
            in_history.update(row.get("presetId") for row in _read_volume_settings_alias_history(shared, history_path.stem))
        all_presets = {path.stem for path in (shared / "presets").glob("vsp-*.json")}
        report["presetsWithCurrentLabel"] = len(all_presets & current)
        report["presetsOnlyInLabelHistory"] = len((all_presets & in_history) - current)
        report["presetsWithoutLabel"] = len(all_presets - current - in_history)
    return report


def volume_settings_server_source():
    source = {"repoRoot": str(ROOT), "serverPort": PORT}
    for field, command in (
        ("branch", ["git", "rev-parse", "--abbrev-ref", "HEAD"]),
        ("commit", ["git", "rev-parse", "HEAD"]),
    ):
        try:
            source[field] = subprocess.check_output(command, cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()
        except (OSError, subprocess.SubprocessError):
            source[field] = "unavailable"
    try:
        source["dirty"] = bool(subprocess.check_output(
            ["git", "status", "--porcelain", "--untracked-files=normal"],
            cwd=ROOT,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip())
    except (OSError, subprocess.SubprocessError):
        source["dirty"] = None
    return source


def current_kaminos_source_commit():
    commit = volume_settings_server_source().get("commit")
    if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError(f"invalid Kaminos source commit: {commit}")
    return commit


def write_volume_basin_promotion_package(request):
    if not isinstance(request, dict):
        raise ValueError("basin promotion request must be a JSON object")
    label = request.get("label")
    handle = request.get("handle")
    promotion_root = request.get("promotionRoot")
    preset = request.get("preset")
    effective_state = request.get("effectiveState")
    if not isinstance(label, str) or not label.strip():
        raise ValueError("basin promotion label is required")
    if not isinstance(handle, str) or not handle.strip():
        raise ValueError("basin promotion handle is required")
    if not isinstance(promotion_root, str) or not promotion_root.strip():
        raise ValueError("caller-selected basin promotionRoot is required")
    if not isinstance(preset, dict):
        raise ValueError("basin promotion preset must be a JSON object")
    if not isinstance(effective_state, dict):
        raise ValueError("basin promotion effectiveState must be a JSON object")

    source = {
        **volume_settings_server_source(),
        "promotionRoot": str(Path(promotion_root).expanduser()),
    }
    preset_receipt = write_volume_settings_preset_to_library(VOLUME_SETTINGS_STORE, SHARED_BASIN_STORE, label, preset, source)
    preset_path = VOLUME_SETTINGS_STORE / "presets" / f"{preset_receipt['effective']['presetId']}.json"
    if not preset_path.exists():
        raise FileNotFoundError(f"settings preset artifact was not written: {preset_path}")

    with tempfile.TemporaryDirectory(prefix="kaminos-basin-promotion-") as temporary:
        effective_state_path = Path(temporary) / "effective-state.json"
        effective_state_path.write_text(json.dumps(effective_state, indent=2) + "\n")
        command = [
            "node",
            str(VOLUME_BASIN_PROMOTION_CLI),
            "promote",
            "--handle", handle,
            "--label", label,
            "--root", str(Path(promotion_root).expanduser()),
            "--settings-preset", str(preset_path),
            "--settings-schema", str(VOLUME_SETTINGS_PRESET_SCHEMA_PATH),
            "--effective-state", str(effective_state_path),
            "--source-commit", str(request.get("sourceCommit") or current_kaminos_source_commit()),
        ]
        result = subprocess.run(
            command,
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    if result.returncode != 0:
        raise ValueError(f"basin promotion package export failed: {result.stderr.strip() or result.stdout.strip()}")
    try:
        promotion_receipt = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise ValueError(f"basin promotion exporter returned invalid JSON: {error}") from error
    return {
        "ok": True,
        "identity": "kaminos.volume.basin-promotion-write-receipt.v1",
        "settingsPreset": preset_receipt["effective"],
        "sharedPublication": preset_receipt["sharedPublication"],
        "promotion": promotion_receipt,
    }


def split_shared_basin_store_arguments(argv, default):
    """Take the shared-library flags out of argv; the rest goes to parse_server_arguments."""
    remaining = []
    shared = default
    arguments = list(argv)
    while arguments:
        argument = arguments.pop(0)
        if argument == "--no-shared-basin-store":
            shared = None
        elif argument == "--shared-basin-store":
            if not arguments:
                raise ValueError("--shared-basin-store requires a path")
            shared = _shared_basin_store_path(arguments.pop(0))
        else:
            remaining.append(argument)
    return remaining, shared


def parse_server_arguments(argv):
    port = 8090
    store = VOLUME_SETTINGS_STORE_DEFAULT
    basin_session_store = VOLUME_BASIN_SESSION_STORE_DEFAULT
    cockpit_layout_store = VOLUME_COCKPIT_LAYOUT_STORE_DEFAULT
    arguments = list(argv)
    if arguments and not arguments[0].startswith("-"):
        try:
            port = int(arguments.pop(0))
        except ValueError as error:
            raise ValueError("server port must be an integer") from error
    while arguments:
        argument = arguments.pop(0)
        if argument not in {
            "--volume-settings-store",
            "--volume-basin-session-store",
            "--volume-cockpit-layout-store",
        } or not arguments:
            raise ValueError(f"unsupported server argument: {argument}")
        path = _volume_settings_store_path(arguments.pop(0))
        if argument == "--volume-settings-store":
            store = path
        elif argument == "--volume-basin-session-store":
            basin_session_store = path
        else:
            cockpit_layout_store = path
    return port, store, basin_session_store, cockpit_layout_store

# Directories the browse API can access
SCENES_DIR = Path(os.environ.get("KAMINOS_SCENES_DIR", ROOT / "scenes")).expanduser().resolve()

# Where other Kaminos servers on this machine keep scenes: copied lane stores,
# shared stores, and the scene folders of sibling checkouts beside this one.
# KAMINOS_SCENE_LIBRARY_GLOBS (os.pathsep-separated) replaces the defaults.
SCENE_LIBRARY_DEFAULT_GLOBS = (
    "~/.local/state/kaminos/*/scenes",
    "~/.local/state/kaminos/*/consumer/scenes",
    "~/.local/state/kaminos/*/state/scenes",
    "~/.local/state/kaminos/*/human-authoring-look-*/state/scenes",
    "~/.local/state/kaminos/*/native-consumer/scenes",
    "~/.local/share/kaminos/*/scenes",
    str(ROOT.parent / "*" / "scenes"),
)


def scene_library_import_dependency(source, store):
    """Make one /api/read source of an imported scene resolvable here.

    Generated meshes are named by their SHA-256, so a copy found beside the
    originating store (or in another lane's assets) is verified and copied into
    this server's generated-meshes root. Other sources are reported missing
    when this server cannot read them."""
    query = parse_qs(urlparse(source).query)
    root, path = (query.get("root") or [""])[0], (query.get("path") or [""])[0]
    local_root = BROWSE_ROOTS.get(root)
    if local_root is None or not path:
        return {"source": source, "status": "missing"}
    root_path = Path(local_root).resolve()
    destination = Path(local_root) / path
    # Anything at the destination that leaves the root (a symlink, ..) is
    # neither trusted as present nor written through.
    if destination.is_symlink() or not destination.resolve().is_relative_to(root_path):
        return {"source": source, "status": "missing", "reason": "destination outside this server's root"}
    if destination.is_file():
        return {"source": source, "status": "present"}
    match = re.fullmatch(r"([0-9a-f]{64})\.glb", path)
    if root == "generated-meshes" and match:
        candidates = [store.parent / "assets" / "generated-meshes" / path]
        candidates += [Path(p) for p in glob.glob(os.path.expanduser("~/.local/state/kaminos/*/assets/generated-meshes/" + path))]
        candidates.append(Path(os.path.expanduser("~/.local/state/kaminos/assets/generated-meshes")) / path)
        for candidate in candidates:
            try:
                data = candidate.read_bytes()
            except OSError:
                continue
            if hashlib.sha256(data).hexdigest() == match.group(1):
                root_path.mkdir(parents=True, exist_ok=True)
                staging = root_path / f".{path}.{uuid.uuid4().hex}.tmp"
                staging.write_bytes(data)
                os.replace(staging, root_path / path)
                return {"source": source, "status": "imported", "from": str(candidate)}
    return {"source": source, "status": "missing"}


def scene_library_import_basin(document, scene_store):
    preset_id = ((document.get('composition') or {}).get('flame') or {}).get('presetId')
    if not preset_id:
        return None
    if not re.fullmatch(r'vsp-[0-9a-f]{64}', str(preset_id)):
        raise ValueError('Scene references an invalid fire basin')
    try:
        read_volume_settings_preset_layered(volume_settings_store_layers(VOLUME_SETTINGS_STORE, SHARED_BASIN_STORE), preset_id)
        return {'kind': 'basin', 'presetId': preset_id, 'status': 'present'}
    except FileNotFoundError:
        pass
    # Look beside the scene first (the observed scenes/basins consumer layout),
    # then in this machine's basin library and default preset store, which a
    # lane server with a private store and no shared library cannot otherwise
    # see. Copy only the verified immutable artifact, leaving aliases and
    # source untouched.
    candidates = [Path(scene_store).parent / 'basins', SHARED_BASIN_STORE_DEFAULT, VOLUME_SETTINGS_STORE_DEFAULT]
    searched, rejected = [], []
    for candidate in candidates:
        if candidate is None:
            continue
        source_store = Path(candidate).expanduser()
        if source_store in searched:
            continue
        searched.append(source_store)
        source = source_store / 'presets' / f'{preset_id}.json'
        if not source.is_file():
            continue
        # Verify the exact bytes that will be stored, read once: a source that
        # changes after verification cannot put unverified content here. A
        # copy that fails verification is skipped for the next location.
        data = source.read_bytes()
        try:
            with tempfile.TemporaryDirectory() as staging:
                staged = Path(staging) / 'presets' / source.name
                staged.parent.mkdir(parents=True)
                staged.write_bytes(data)
                read_volume_settings_preset(Path(staging), preset_id)
        except ValueError as error:
            rejected.append(f'{source_store}: {error}')
            continue
        destination = VOLUME_SETTINGS_STORE / 'presets' / source.name
        _atomic_write_json(destination, json.loads(data))
        read_volume_settings_preset(VOLUME_SETTINGS_STORE, preset_id)
        return {'kind': 'basin', 'presetId': preset_id, 'status': 'imported', 'from': str(source_store)}
    if rejected:
        raise ValueError(f'volume settings preset artifact content hash mismatch or invalid for {preset_id}: ' + '; '.join(rejected))
    raise FileNotFoundError(
        f"volume settings preset not found: {preset_id} (looked in this server's stores and "
        + ', '.join(str(store) for store in searched) + ')'
    )


def scene_library_stores():
    configured = os.environ.get("KAMINOS_SCENE_LIBRARY_GLOBS")
    patterns = configured.split(os.pathsep) if configured else SCENE_LIBRARY_DEFAULT_GLOBS
    own = Path(SCENES_DIR).resolve()
    stores = {}
    for pattern in patterns:
        for match in sorted(glob.glob(os.path.expanduser(pattern))):
            path = Path(match).resolve()
            if path == own or not path.is_dir():
                continue
            stores[hashlib.sha1(str(path).encode()).hexdigest()[:12]] = path
    return stores
SCENES_DIR.mkdir(parents=True, exist_ok=True)
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
KAMINOS_IMAGE_PREPARATION_DIR = Path(os.environ.get('KAMINOS_IMAGE_PREPARATION_DIR',
    str(KAMINOS_ASSETS_DIR / 'images' / 'prepared'))).expanduser().resolve()
SAM3_PACKET_ROOT = Path(os.environ['KAMINOS_SAM3_PACKET_ROOT']).expanduser().resolve() if os.environ.get('KAMINOS_SAM3_PACKET_ROOT') else None
# A local FLUX.2 klein weight package (te/, dit/, vae/ with manifests), served at /klein-weights/.
# The browser caches weights per origin, so serving the staged package locally spares each
# Kaminos port a 3 GB download from the published repository.
KLEIN_WEIGHTS_ROOT = Path(os.environ['KAMINOS_KLEIN_WEIGHTS_ROOT']).expanduser().resolve() if os.environ.get('KAMINOS_KLEIN_WEIGHTS_ROOT') else None
# FLUX.3 stays a local package; no hosted-weight fallback is configured.
FLUX3_WEIGHTS_ROOT = Path(os.environ['KAMINOS_FLUX3_WEIGHTS_ROOT']).expanduser().resolve() if os.environ.get('KAMINOS_FLUX3_WEIGHTS_ROOT') else None
PUP_WEIGHTS_ROOT = Path(os.environ['KAMINOS_PUP_WEIGHTS_ROOT']).expanduser().resolve() if os.environ.get('KAMINOS_PUP_WEIGHTS_ROOT') else None
# A local TRELLIS 2 checkpoint package (manifest.json plus tensor files), served at
# /trellis-checkpoints/ for TRELLIS in the page.
TRELLIS_CHECKPOINT_ROOT = Path(os.environ['KAMINOS_TRELLIS_CHECKPOINT_ROOT']).expanduser().resolve() if os.environ.get('KAMINOS_TRELLIS_CHECKPOINT_ROOT') else None
MOUNTED_PACKAGES = {'/pup-weights/': lambda: PUP_WEIGHTS_ROOT, '/klein-weights/': lambda: KLEIN_WEIGHTS_ROOT, '/flux3-weights/': lambda: FLUX3_WEIGHTS_ROOT, '/trellis-checkpoints/': lambda: TRELLIS_CHECKPOINT_ROOT}

BROWSE_ROOTS = {
    "generated-meshes": Path(os.environ.get("KAMINOS_GENERATED_MESH_DIR", str(KAMINOS_ASSETS_DIR / "generated-meshes"))).expanduser(),
    "scratch": ROOT / "scratch",
    "scenes": SCENES_DIR,
    "splat-inbox": KAMINOS_SPLAT_INBOX_DIR,
    "splat-production": KAMINOS_SPLAT_PRODUCTION_DIR,
    "image-inbox": KAMINOS_IMAGE_INBOX_DIR,
    "image-preparations": KAMINOS_IMAGE_PREPARATION_DIR,
    "pipeline-runs": KAMINOS_PIPELINE_RUNS_DIR,
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
PIPELINE_MANIFEST_PATH = ROOT / "pipelines" / "asset-pipelines.json"
PIPELINE_WITNESS_PATH = ROOT / "pipeline-witness.mjs"


def flux3_weights_mounted():
    """Availability is metadata-only: the loader's manifests and payloads must exist.

    The browser loader keys its cache by declared digest and checks byte lengths;
    it does not verify content digests. Reject absent/truncated payloads here before
    model teardown without reading gigabytes during runtime-config requests.
    """
    if not FLUX3_WEIGHTS_ROOT:
        return False
    root = FLUX3_WEIGHTS_ROOT.resolve()

    def component(part, schema):
        manifest = json.loads((root / part / 'manifest.json').read_text())
        if not isinstance(manifest, dict) or manifest.get('schema') != schema:
            raise ValueError('wrong component schema')
        if not isinstance(manifest.get('config'), dict) or not manifest['config']:
            raise ValueError('missing component configuration')
        return manifest

    def payload(part, entry, expected_bytes=None):
        if not isinstance(entry, dict) or not isinstance(entry.get('file'), str) or not entry['file']:
            raise ValueError('missing payload descriptor')
        target = (root / part / entry['file']).resolve()
        if not target.is_relative_to(root / part) or not target.is_file():
            raise ValueError('missing or inaccessible payload')
        size = target.stat().st_size
        required = entry.get('bytes', expected_bytes)
        if size <= 0 or (required is not None and (type(required) is not int or required <= 0 or size != required)):
            raise ValueError('empty or truncated payload')

    def bundles(part, manifest, required_names):
        entries = manifest.get('bundles')
        if not isinstance(entries, dict) or not entries or not set(required_names).issubset(entries):
            raise ValueError('missing required weight bundles')
        for entry in entries.values():
            if not isinstance(entry, dict) or not isinstance(entry.get('tensors'), list) or not entry['tensors']:
                raise ValueError('missing tensor descriptions')
            payload(part, entry)

    try:
        te = component('te', 'kaminos.flux3-klein.text-encoder-weights.v1')
        dit = component('dit', 'kaminos.flux3-klein.transformer-weights.v1')
        vae = component('vae', 'kaminos.flux2-klein.vae-decoder-weights.v0')
        layers = te.get('layers')
        if type(layers) is not int or layers <= 0 or not isinstance(te.get('taps'), list) or not te['taps']:
            return False
        bundles('te', te, (f'layer{i:02d}' for i in range(layers)))
        embedding = te.get('embedding', {})
        shape, row_bytes = embedding.get('shape'), embedding.get('row_bytes')
        if not isinstance(shape, list) or len(shape) != 2 or not all(type(n) is int and n > 0 for n in shape) or type(row_bytes) is not int or row_bytes <= 0:
            return False
        payload('te', embedding, shape[0] * row_bytes)
        payload('te', te.get('tokenizer'))
        cfg = dit['config']
        counts = [cfg.get('num_layers'), cfg.get('num_single_layers')]
        if not all(type(n) is int and n >= 0 for n in counts) or not any(counts):
            return False
        names = ['globals'] + [f'{prefix}{i:02d}' for prefix, count in [('txt', counts[0]), ('img', counts[0]), ('single', counts[1])] for i in range(count)]
        bundles('dit', dit, names)
        bundle = vae.get('bundle')
        if not isinstance(bundle, dict) or not isinstance(bundle.get('tensors'), list) or not bundle['tensors']:
            return False
        payload('vae', bundle)
        return True
    except (OSError, ValueError, TypeError, AttributeError):
        return False


def pup_weights_mounted():
    """Metadata availability for the exercised exact-source ONNX package, not model validation."""
    if not PUP_WEIGHTS_ROOT:
        return False
    root = PUP_WEIGHTS_ROOT.resolve()
    external = {'decoder_model_merged_q4f16.onnx': 3, 'vision_encoder_fp16.onnx': 1, 'embed_tokens_q4f16.onnx': 1}
    try:
        provenance = json.loads((root / 'provenance.json').read_text())
        if provenance.get('status') != 'complete' or not provenance.get('source', '').endswith('/3f3edb52b2c55de0d49feab28598b68f7f8e4830') or provenance.get('external_data') != external:
            return False
        sizes = {entry['path']: entry['bytes'] for entry in provenance['files']}
        def payload(name, expected=None):
            target = (root / name).resolve()
            return (target.is_relative_to(root) and target.is_file() and target.stat().st_size > 0
                    and (expected is None or (type(expected) is int and expected > 0 and target.stat().st_size == expected)))
        for name in ('config.json', 'tokenizer.json', 'tokenizer_config.json', 'preprocessor_config.json', 'chat_template.jinja', 'system_prompts.json'):
            if not payload(name):
                return False
        for graph, count in external.items():
            if not payload('onnx/' + graph):
                return False
            for index in range(count):
                name = 'onnx/' + graph + '_data' + (f'_{index}' if index else '')
                if name not in sizes or not payload(name, sizes[name]):
                    return False
        return True
    except (OSError, ValueError, TypeError, AttributeError, KeyError):
        return False


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
        "sam3": {
            "manifestUrl": "/sam3-packet/tensor-manifest.json",
            "modelRoot": str(SAM3_PACKET_ROOT),
            "mounted": (SAM3_PACKET_ROOT / "tensor-manifest.json").is_file(),
        } if SAM3_PACKET_ROOT else None,
        "klein": {
            "weightsUrl": "/klein-weights",
            "modelRoot": str(KLEIN_WEIGHTS_ROOT),
            "mounted": all((KLEIN_WEIGHTS_ROOT / part / "manifest.json").is_file() for part in ("te", "dit", "vae")),
        } if KLEIN_WEIGHTS_ROOT else None,
        "flux3": {
            "weightsUrl": "/flux3-weights",
            "modelRoot": str(FLUX3_WEIGHTS_ROOT),
            "mounted": flux3_weights_mounted(),
        } if FLUX3_WEIGHTS_ROOT else None,
        "pup": {"modelUrl": "/pup-weights", "modelRoot": str(PUP_WEIGHTS_ROOT), "mounted": pup_weights_mounted()} if PUP_WEIGHTS_ROOT else None,
        "trellisPage": {
            "checkpointUrl": "/trellis-checkpoints",
            "modelRoot": str(TRELLIS_CHECKPOINT_ROOT),
            "mounted": (TRELLIS_CHECKPOINT_ROOT / "manifest.json").is_file(),
            "manifestSha256": hashlib.sha256((TRELLIS_CHECKPOINT_ROOT / "manifest.json").read_bytes()).hexdigest()
                if (TRELLIS_CHECKPOINT_ROOT / "manifest.json").is_file() else None,
        } if TRELLIS_CHECKPOINT_ROOT else None,
        "volumeBasinSessionStore": str(VOLUME_BASIN_SESSION_STORE),
        "volumeCockpitLayoutStore": str(VOLUME_COCKPIT_LAYOUT_STORE),
        "volumeSettingsStore": str(VOLUME_SETTINGS_STORE),
        "sharedBasinStore": str(SHARED_BASIN_STORE) if SHARED_BASIN_STORE else None,
        "source": volume_settings_server_source(),
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


def read_mesh_generation_origins(sha256):
    root = Path(BROWSE_ROOTS['generated-meshes']).resolve()
    path = root / ('.' + sha256 + '.glb.origins.json')
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    if data.get('schema') != 'kaminos.mesh-generation-origins.v1' or data.get('sha256') != sha256 or not isinstance(data.get('origins'), dict):
        raise ValueError('Invalid generated mesh origin record')
    return data


def save_mesh_generation_origin(result):
    sha = result.get('sha256', '')
    if not isinstance(sha, str) or not re.fullmatch(r'[a-f0-9]{64}', sha):
        raise ValueError('Generated mesh requires a content digest')
    root = Path(BROWSE_ROOTS['generated-meshes']).resolve()
    artifact = root / (sha + '.glb')
    if not artifact.is_file():
        raise ValueError('Generated mesh bytes are not stored')
    generation = result.get('generation')
    source = '/api/read?' + urlencode({'root': 'generated-meshes', 'path': sha + '.glb'})
    if result.get('source') != source or not isinstance(generation, dict) or generation.get('schema') != 'kaminos.asset-generation.v1' or generation.get('sha256') != sha or generation.get('bytes') != artifact.stat().st_size:
        raise ValueError('Generation origin does not match the stored mesh')
    run_id = generation.get('runId')
    image = generation.get('input')
    if not isinstance(run_id, str) or not run_id or not isinstance(image, dict) or not isinstance(image.get('sha256'), str) or not re.fullmatch(r'[a-f0-9]{64}', image['sha256']) or not generation.get('route') or generation.get('receiptValidation', {}).get('ok') is not True:
        raise ValueError('Generation input, run and validated route required')
    name = result.get('name')
    if not isinstance(name, str) or not name:
        raise ValueError('Generated asset name required')
    origin = {'name': name, 'generation': generation}
    path = root / ('.' + sha + '.glb.origins.json')
    with (root / ('.' + sha + '.origin.lock')).open('a+b') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        data = read_mesh_generation_origins(sha) or {'schema': 'kaminos.mesh-generation-origins.v1', 'sha256': sha, 'origins': {}}
        previous = data['origins'].get(run_id)
        if previous is not None and previous != origin:
            raise ValueError('Existing generation run origin is immutable')
        if previous is None:
            data['origins'][run_id] = origin
            data['latestRunId'] = run_id
            with tempfile.NamedTemporaryFile(mode='w', dir=root, prefix='.mesh-origin-', delete=False) as handle:
                temporary = Path(handle.name)
                json.dump(data, handle)
            try:
                os.replace(temporary, path)
            finally:
                temporary.unlink(missing_ok=True)
    return {'schema': 'kaminos.mesh-generation-origin.v1', 'result': result}


_SHA256_HEX = re.compile(r'[a-f0-9]{64}')


class MeshLodRecordError(Exception):
    """A stored level-set record that cannot be read: a server-side fault, not a bad request."""


def _lod_set_path(source):
    if not isinstance(source, str) or not _SHA256_HEX.fullmatch(source):
        raise ValueError('Source mesh sha256 required')
    return Path(BROWSE_ROOTS['generated-meshes']).resolve() / ('.' + source + '.glb.lods.json')


def read_mesh_lod_set(source):
    """Coarse levels registered for a stored mesh; an empty set when none exist."""
    path = _lod_set_path(source)
    if not path.exists():
        return {'schema': 'kaminos.lod-set.v0', 'source': source, 'levels': []}
    try:
        data = json.loads(path.read_text())
    except ValueError as error:
        raise MeshLodRecordError(f'Unreadable level-set record {path.name}: {error}') from error
    if data.get('schema') != 'kaminos.lod-set.v0' or data.get('source') != source or not isinstance(data.get('levels'), list):
        raise MeshLodRecordError(f'Invalid level-set record {path.name}')
    return data


def mesh_lod_level_index():
    """Every registered level sha -> {source, faces}, read from the stores' level-set records."""
    root = Path(BROWSE_ROOTS['generated-meshes']).resolve()
    index = {}
    for path in root.glob('.*.glb.lods.json'):
        source = path.name[1:-len('.glb.lods.json')]
        try:
            record = read_mesh_lod_set(source)
            for level in record['levels']:
                index[level['sha256']] = {'source': source, 'faces': level['faces']}
            for level in record.get('retired', []):
                index[level['sha256']] = {'source': source, 'faces': level['faces'], 'retired': True}
        except (ValueError, MeshLodRecordError, KeyError, OSError):
            continue
    return index


def save_mesh_lod_level(payload):
    """Register one coarse level of a stored source mesh. Levels are immutable by sha."""
    source, level = payload.get('source'), payload.get('level')
    path = _lod_set_path(source)
    if not isinstance(level, dict) or not isinstance(level.get('sha256'), str) or not _SHA256_HEX.fullmatch(level['sha256']):
        raise ValueError('Level sha256 required')
    if type(level.get('faces')) is not int or level['faces'] < 1 or not isinstance(level.get('route'), str) or not level['route']:
        raise ValueError('Level faces and route required')
    if 'textureSize' in level and (type(level['textureSize']) is not int or level['textureSize'] < 1):
        raise ValueError('Level textureSize must be a positive integer')
    if level['sha256'] == source:
        raise ValueError('A mesh cannot be its own level')
    if 'error' in level:
        relative = (level['error'] or {}).get('relative') if isinstance(level['error'], dict) else None
        if not isinstance(relative, dict) or any(type(relative.get(k)) not in (int, float) or not math.isfinite(relative[k]) or relative[k] < 0
                                                 for k in ('max', 'p95', 'mean')):
            raise ValueError('Level error needs finite non-negative relative max, p95 and mean')
    root = Path(BROWSE_ROOTS['generated-meshes']).resolve()
    for sha in (source, level['sha256']):
        if not (root / (sha + '.glb')).is_file():
            raise ValueError('Mesh not stored: ' + sha)
    with (root / ('.' + source + '.lods.lock')).open('a+b') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        data = read_mesh_lod_set(source)
        previous = next((l for l in data['levels'] if l['sha256'] == level['sha256']), None)
        if previous is not None and previous != level:
            raise ValueError('Registered level is immutable')
        same_slot = next((l for l in data['levels'] if l['sha256'] != level['sha256']
                          and l['faces'] == level['faces'] and l['route'] == level['route']), None)
        retired_now = []
        if any(r['sha256'] == level['sha256'] for r in data.get('retired', [])):
            raise ValueError('That level was retired from this source')
        if previous is None and same_slot is not None:
            if payload.get('supersede') is not True:
                raise ValueError(f"A {level['faces']}-face {level['route']} level is already registered: {same_slot['sha256']}")
            # Replace with retire: the old level leaves the choice set but its record is kept.
            data['levels'].remove(same_slot)
            data.setdefault('retired', []).append({**same_slot, 'retiredBy': level['sha256'],
                                                   'retiredAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
            retired_now.append(same_slot['sha256'])
        if previous is None:
            data['levels'].append(level)
            data['levels'].sort(key=lambda l: -l['faces'])
            with tempfile.NamedTemporaryFile(mode='w', dir=root, prefix='.mesh-lods-', delete=False) as handle:
                temporary = Path(handle.name)
                json.dump(data, handle)
            try:
                os.replace(temporary, path)
            finally:
                temporary.unlink(missing_ok=True)
    return {'schema': 'kaminos.lod-set.v0', 'source': source, 'level': level, 'retired': retired_now}


def mesh_lod_choice(source, faces=None, max_error=None, stat='max'):
    """All levels plus a choice: by face budget, the largest level within it (else the
    smallest, flagged); by relative geometric error, the coarsest level whose `stat`
    (max, p95 or mean) fits (else the finest measured level, flagged). Levels without a
    measurement are never chosen by error."""
    if faces is not None and max_error is not None:
        raise ValueError('Choose by faces or by maxError, not both')
    if stat not in ('max', 'p95', 'mean'):
        raise ValueError('stat must be max, p95 or mean')
    if max_error is not None and not (math.isfinite(max_error) and max_error >= 0):
        raise ValueError('maxError must be a finite, non-negative relative error')
    data = read_mesh_lod_set(source)
    levels = [{**l, 'source': '/api/read?' + urlencode({'root': 'generated-meshes', 'path': l['sha256'] + '.glb'})} for l in data['levels']]
    choice, within, unmeasured = None, None, None
    if faces is not None and levels:
        fitting = [l for l in levels if l['faces'] <= faces]
        choice, within = (fitting[0], True) if fitting else (levels[-1], False)
    if max_error is not None:
        measured = [l for l in levels if isinstance(((l.get('error') or {}).get('relative') or {}).get(stat), (int, float))]
        unmeasured = len(levels) - len(measured)
        if measured:
            fitting = [l for l in measured if l['error']['relative'][stat] <= max_error]
            choice, within = (min(fitting, key=lambda l: l['faces']), True) if fitting else (max(measured, key=lambda l: l['faces']), False)
    result = {'schema': 'kaminos.lod-set.v0', 'source': source, 'levels': levels, 'choice': choice, 'withinBudget': within,
              'retired': data.get('retired', [])}
    if unmeasured is not None:
        result['unmeasured'] = unmeasured
    return result


def pipeline_manifest_payload():
    document = json.loads(PIPELINE_MANIFEST_PATH.read_text())
    for pipeline in document.get("pipelines", []):
        if pipeline.get("id") == "trellis-image-to-mesh-webgpu-v0":
            pipeline["availability"] = trellis_generation_availability()
            if pipeline["availability"].get("status") == "available":
                pipeline["availability"]["express"] = trellis_express_eligibility(
                    json.loads(Path(os.environ["KAMINOS_TRELLIS_CONFIG"]).read_text())["queueDir"])
    return {
        **document,
        "manifestPath": str(PIPELINE_MANIFEST_PATH),
        "manifestSha256": _sha256_file(PIPELINE_MANIFEST_PATH),
    }


# Where a queued generation stands, in Greenroom's own dispatch order (normal/quick
# alternation included). Read-only: runs gpu_queue from the interpreter beside the
# configured greenroom CLI, so the order cannot drift from what the worker does.
_QUEUE_POSITION_SCRIPT = r"""
import json, sys, time
from pathlib import Path
from gpu_queue import dispatch
root, job = Path(sys.argv[1]), sys.argv[2]
def state(path):
    try: return json.loads((path / 'status.json').read_text())
    except (OSError, ValueError): return None
running = []
for path in sorted((root / 'running').iterdir()) if (root / 'running').is_dir() else []:
    row = state(path)
    if row: running.append({'jobId': row['job_id'], 'startedAt': row.get('started_at')})
config = dispatch.policy(root)
order = [path.name for path in dispatch.pending_order(root, config)]
classes = {}
for name in order:
    request, digest = dispatch.read_request(root / 'pending' / name / 'request.json')
    classes[name] = dispatch.classify(request, config, request_digest=digest)[0]
mine = None
for bucket in ('pending', 'running', 'done', 'failed', 'cancelled'):
    row = state(root / bucket / job)
    if row: mine = {'bucket': bucket, **row}; break
print(json.dumps({'order': order, 'classes': classes, 'running': running, 'mine': mine, 'now': time.time(), 'mode': config['mode']}))
"""


def gpu_queue_position(job_id, *, queue_dir, greenroom_bin):
    job_id = str(job_id or "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{6,64}", job_id):
        raise ValueError("Greenroom job id required")
    python = Path(greenroom_bin).resolve().parent / "python3"
    completed = subprocess.run([str(python), "-c", _QUEUE_POSITION_SCRIPT, str(queue_dir), job_id],
                               capture_output=True, text=True, timeout=30)
    if completed.returncode != 0:
        raise RuntimeError("Greenroom queue read failed: " + completed.stderr.strip()[-400:])
    data = json.loads(completed.stdout)
    mine, now = data["mine"], data["now"]
    report = {"schema": "kaminos.gpu-queue-position.v0", "jobId": job_id, "orderAuthority": "gpu_queue.dispatch.pending_order",
              "dispatchMode": data["mode"], "status": "unknown", "jobsAhead": None, "ahead": [], "serviceClass": None,
              "waitedSeconds": None, "runningSeconds": None, "running": None}
    others = [row for row in data["running"] if row["jobId"] != job_id]
    if others:
        row = others[0]
        report["running"] = {"jobId": row["jobId"], "seconds": max(0.0, now - row["startedAt"]) if row.get("startedAt") else None}
    if not mine:
        return report
    report["status"] = mine["bucket"]
    submitted, started = mine.get("submitted_at"), mine.get("started_at")
    if mine["bucket"] == "pending":
        index = data["order"].index(job_id) if job_id in data["order"] else None
        if index is not None:
            report["jobsAhead"] = index
            report["ahead"] = [{"jobId": name, "serviceClass": data["classes"].get(name)} for name in data["order"][:index]]
            report["serviceClass"] = data["classes"].get(job_id)
        if submitted:
            report["waitedSeconds"] = max(0.0, now - submitted)
    else:
        report["jobsAhead"] = 0
        if submitted and started:
            report["waitedSeconds"] = max(0.0, started - submitted)
        if mine["bucket"] == "running" and started:
            report["runningSeconds"] = max(0.0, now - started)
    return report


# The route identity the TRELLIS adapter submits under (scripts/run-trellis-greenroom-adapter.mjs).
TRELLIS_QUEUE_ROUTE_IDENTITY = "TRELLIS2 queued browser-WebGPU / CPU source finishing"


def trellis_express_eligibility(queue_dir):
    """Whether Greenroom would admit a quick-class TRELLIS submission (dispatch.classify's rule)."""
    try:
        policy = json.loads((Path(queue_dir) / "dispatch-policy.json").read_text())
    except (OSError, ValueError):
        return {"eligible": False, "reason": "The GPU queue has no dispatch policy", "basis": None}
    if policy.get("mode") != "two-class":
        return {"eligible": False, "reason": "The GPU queue is not running a quick lane", "basis": None}
    basis = (policy.get("quick_routes") or {}).get(TRELLIS_QUEUE_ROUTE_IDENTITY)
    if not basis:
        return {"eligible": False, "reason": "TRELLIS is not on the GPU queue's quick list", "basis": None}
    return {"eligible": True, "reason": None, "basis": basis}


def cancel_owned_gpu_job(job_id, *, queue_dir, greenroom_bin, runs_root):
    """Stop a waiting generation this server submitted: Greenroom's own cancel, pending only."""
    job_id = str(job_id or "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{6,64}", job_id):
        raise ValueError("Greenroom job id required")
    pending = Path(queue_dir) / "pending" / job_id
    try:
        request = json.loads((pending / "request.json").read_text())
    except (OSError, ValueError):
        raise ValueError("That job is no longer waiting in the GPU queue")
    output = Path(str(request.get("output_dir") or "")).resolve()
    if request.get("agent_id") != "kaminos-generate" or not output.is_relative_to(Path(runs_root).resolve()):
        raise PermissionError("That GPU queue job was not submitted by this Kaminos server")
    completed = subprocess.run([str(greenroom_bin), "--queue-dir", str(queue_dir), "cancel", job_id],
                               capture_output=True, text=True, timeout=30)
    if completed.returncode != 0:
        raise ValueError((completed.stderr or completed.stdout).strip()[-300:] or "Greenroom cancel failed")
    return {"schema": "kaminos.gpu-job-cancel.v0", "jobId": job_id, "status": "cancelled"}


# A model run in the page (in-page TRELLIS) holds a cooperative Greenroom lease, so queued jobs and
# other lanes' leases wait for it and it waits for them. The server claims for the page (holder pid:
# this server). No page is exempt: an automated witness takes the same lease, outside any queue job.
# Only leases this route issued (kaminos-page-*) can be renewed or released through it.
def greenroom_lease_config():
    """The Greenroom this server's page leases go through, and where that came from: explicit environment,
    else the TRELLIS queue config's Greenroom, else this machine's installed gpu-greenroom with its own
    default queue (the queue the CLI uses with no --queue-dir). None only when nothing is configured and the
    machine has no Greenroom. A configuration that names a Greenroom it cannot use raises ValueError: a page
    must not run unleased because a configured path went stale."""
    def check(bin_path, queue_dir, where):
        if not (bin_path and Path(bin_path).is_file()):
            raise ValueError(f"{where} names no usable gpu-greenroom executable: {bin_path or '(missing)'}")
        if not (queue_dir and Path(queue_dir).is_dir()):
            raise ValueError(f"{where} names no usable Greenroom queue directory: {queue_dir or '(missing)'}")
        return bin_path, queue_dir
    env = os.environ
    if env.get("KAMINOS_GREENROOM_BIN") or env.get("KAMINOS_GREENROOM_QUEUE_DIR"):
        bin_path, queue_dir = check(env.get("KAMINOS_GREENROOM_BIN"), env.get("KAMINOS_GREENROOM_QUEUE_DIR"), "KAMINOS_GREENROOM_BIN/QUEUE_DIR")
        return {"greenroomBin": bin_path, "queueDir": queue_dir, "source": "environment"}
    if env.get("KAMINOS_TRELLIS_CONFIG"):
        try:
            config = json.loads(Path(env["KAMINOS_TRELLIS_CONFIG"]).read_text())
        except (OSError, ValueError) as error:
            raise ValueError(f"KAMINOS_TRELLIS_CONFIG cannot be read: {error}") from error
        if config.get("greenroomBin") or config.get("queueDir"):
            bin_path, queue_dir = check(config.get("greenroomBin"), config.get("queueDir"), "KAMINOS_TRELLIS_CONFIG")
            return {"greenroomBin": bin_path, "queueDir": queue_dir, "source": "trellis-config"}
    installed = shutil.which("gpu-greenroom") or str(Path.home() / ".local/bin/gpu-greenroom")
    # The CLI's own default queue (gpu_queue DEFAULT_QUEUE_DIR): GPU_GREENROOM_DIR, else ~/.local/state/gpu-greenroom.
    default_queue = env.get("GPU_GREENROOM_DIR") or str(Path.home() / ".local/state/gpu-greenroom")
    if Path(installed).is_file() and Path(default_queue).is_dir():
        return {"greenroomBin": installed, "queueDir": default_queue, "source": "installed-default"}
    return None


def greenroom_page_lease(payload, *, greenroom_bin, queue_dir, server_pid, repo_root, ttl_seconds=120):
    action = payload.get("action")
    def cli(*args):
        return subprocess.run([str(greenroom_bin), "--queue-dir", str(queue_dir), "lease", *args],
                              capture_output=True, text=True, timeout=30)
    running = Path(queue_dir) / "running"
    def running_jobs():
        return sorted(p.name for p in running.iterdir() if p.is_dir()) if running.is_dir() else []
    if action == "claim":
        run_id = str(payload.get("runId") or "")
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,96}", run_id):
            raise ValueError("a lease claim needs the run id")
        lease_id = f"kaminos-page-{run_id}"
        done = cli("claim", "--lease-id", lease_id, "--owner", "kaminos-page", "--agent-id", f"kaminos-page:{run_id}",
                   "--repo-root", str(repo_root), "--pid", str(server_pid), "--effective-route", str(payload.get("route") or "kaminos-page"),
                   "--backend", "webgpu", "--device", "apple-gpu", "--profile", "interactive-generation", "--ttl-seconds", str(ttl_seconds))
        if done.returncode == 0:
            return {"status": "held", "leaseId": lease_id, "ttlSeconds": ttl_seconds}
        return {"status": "waiting", "heldBy": running_jobs(), "reason": (done.stderr or done.stdout).strip()[-300:]}
    lease_id = str(payload.get("leaseId") or "")
    if not re.fullmatch(r"kaminos-page-[A-Za-z0-9._-]{1,96}", lease_id):
        raise PermissionError("only a page lease can be renewed or released here")
    if action == "renew":
        done = cli("renew", lease_id, "--ttl-seconds", str(ttl_seconds))
        if done.returncode != 0:
            raise RuntimeError((done.stderr or done.stdout).strip()[-300:] or "lease renew failed")
        try:
            lifecycle = json.loads(done.stdout).get("lifecycle_state")
        except ValueError:
            lifecycle = None
        return {"status": "held", "leaseId": lease_id, "ttlSeconds": ttl_seconds, "lifecycle": lifecycle}
    if action == "release":
        done = cli("release", lease_id, "--released-by", "kaminos-page", "--reason", str(payload.get("reason") or "page run ended")[:200])
        if done.returncode != 0:
            raise RuntimeError((done.stderr or done.stdout).strip()[-300:] or "lease release failed")
        return {"status": "released", "leaseId": lease_id}
    raise ValueError("lease action must be claim, renew or release")


def trellis_generation_availability():
    config_path = os.environ.get("KAMINOS_TRELLIS_CONFIG")
    if not config_path:
        return {"status": "unconfigured", "message": "Local TRELLIS setup required"}
    try:
        config = json.loads(Path(config_path).read_text())
        if config.get("schema") != "trellis2.local-generation-config.v0":
            raise ValueError("Choose a TRELLIS local generation configuration")
        for key in ["repoRoot", "checkpointBase", "sourceRoot", "queueDir"]:
            value = config.get(key)
            if not isinstance(value, str) or not Path(value).is_absolute() or not Path(value).is_dir():
                raise ValueError(f"TRELLIS setup needs {key}")
        for key in ["python", "memoryPython", "chrome", "greenroomBin"]:
            value = config.get(key)
            if not isinstance(value, str) or not Path(value).is_absolute() or not Path(value).is_file():
                raise ValueError(f"TRELLIS setup needs {key}")
        if not (Path(config["checkpointBase"]) / "manifest.json").is_file():
            raise ValueError("TRELLIS setup needs a prepared checkpoint package")
        if not (Path(config["repoRoot"]) / "models/trellis2/generate-image.mjs").is_file():
            raise ValueError("TRELLIS generation tools are missing from the configured checkout")
        for key in ["steps", "targetFaces", "gpuBufferBudgetMiB", "processMemoryBudgetMiB"]:
            if type(config.get(key)) is not int or config[key] < 1:
                raise ValueError(f"TRELLIS setup needs an explicit {key}")
        if config.get("pipelineType") not in ["512", "1024_cascade"] or config.get("decoderActivationStorage") not in ["f32", "f16"]:
            raise ValueError("TRELLIS setup needs a supported profile and storage selection")
        for key in ["expectedCommit", "expectedSourceCommit"]:
            if not re.fullmatch(r"[a-f0-9]{40}", config.get(key, "")):
                raise ValueError(f"TRELLIS setup needs {key}")
        if type(config.get("seed")) is not int or not 0 <= config["seed"] <= 0xffffffff:
            raise ValueError("TRELLIS setup needs an unsigned32 seed")
        metal = config.get("cleanupMode") == "source-metal-remesh"
        if metal:
            options = config.get("metalFinishing")
            if not isinstance(options, dict):
                raise ValueError("Explicit Metal finishing configuration required")
            for key in ["python", "backendManifest"]:
                value = options.get(key)
                if not isinstance(value, str) or not Path(value).is_absolute() or not Path(value).is_file():
                    raise ValueError(f"Metal finishing needs {key}")
            paths = options.get("pythonPath")
            if not isinstance(paths, list) or any(not isinstance(p, str) or not Path(p).is_absolute() or not Path(p).is_dir() for p in paths):
                raise ValueError("Metal finishing needs absolute pythonPath directories")
            band, project = options.get("band"), options.get("projectBack")
            if type(band) not in [int, float] or not 0 < band < float('inf') or type(project) not in [int, float] or not 0 <= project <= 1:
                raise ValueError("Metal finishing needs valid band and projectBack")
            if type(config.get("textureSize")) is not int or config["textureSize"] < 1:
                raise ValueError("Metal finishing needs a positive textureSize")
        elif config.get("textureSize", 1024) != 1024:
            raise ValueError("This TRELLIS finishing route uses 1K textures")
        return {"status": "available", "message": "Queued WebGPU with original Metal remesh finishing" if metal else "Queued WebGPU with local mesh finishing"}
    except (OSError, ValueError, TypeError) as error:
        return {"status": "unavailable", "message": str(error)}


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
    return (KAMINOS_PIPELINE_RUNS_DIR / f"{stamp}-{os.getpid()}-{safe}-{uuid.uuid4().hex}").resolve()


def run_pipeline_witness(payload):
    pipeline_id = str(payload.get("pipelineId") or payload.get("pipeline_id") or "").strip()
    if not pipeline_id:
        raise ValueError("pipelineId required")
    source = resolve_pipeline_source(payload)
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
    # TRELLIS has exercised ten-minute previews. Explicit operator timeouts
    # still apply; the legacy six-minute default cannot silently stop this route.
    timeout_value = os.environ.get("KAMINOS_PIPELINE_WITNESS_TIMEOUT")
    timeout = int(timeout_value) if timeout_value is not None else (
        None if pipeline_id == "trellis-image-to-mesh-webgpu-v0" else 360)
    proc = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    report = json.loads(report_path.read_text()) if report_path.exists() else None
    bundle_path = Path(report["bundleIndex"]["path"]) if report and report.get("bundleIndex") else None
    bundle = json.loads(bundle_path.read_text()) if bundle_path and bundle_path.exists() else None
    return {
        "schema": "kaminos.pipeline-run-result.v0",
        "ok": proc.returncode == 0 and bool(report and report.get("ok")),
        "pipelineId": pipeline_id,
        "source": source,
        "command": command,
        "exitCode": proc.returncode,
        "stdoutTail": proc.stdout[-4000:],
        "stderrTail": proc.stderr[-4000:],
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


def pipeline_child_env(pipeline_id, payload):
    """Per-request settings a route's adapter reads; only TRELLIS's Greenroom class today."""
    env = dict(os.environ)
    service_class = payload.get("serviceClass")
    if service_class is not None:
        if pipeline_id != "trellis-image-to-mesh-webgpu-v0" or service_class not in ("normal", "quick"):
            raise ValueError("serviceClass must be normal or quick for the TRELLIS route")
        env["KAMINOS_TRELLIS_SERVICE_CLASS"] = service_class
    return env


def run_pipeline_witness_stream(handler, payload):
    pipeline_id = str(payload.get("pipelineId") or payload.get("pipeline_id") or "").strip()
    if not pipeline_id:
        raise ValueError("pipelineId required")
    source = resolve_pipeline_source(payload)
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
    timeout_raw = os.environ.get("KAMINOS_PIPELINE_WITNESS_TIMEOUT")
    timeout = int(timeout_raw) if timeout_raw is not None else (
        None if pipeline_id == "trellis-image-to-mesh-webgpu-v0" else 360
    )
    proc = subprocess.Popen(
        command,
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        env={**pipeline_child_env(pipeline_id, payload), "KAMINOS_PIPELINE_PROGRESS_STREAM": "1"},
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
    while proc.poll() is None:
        if timeout is not None and time.monotonic() - started > timeout:
            proc.kill()
            raise subprocess.TimeoutExpired(command, timeout)
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

    report = json.loads(report_path.read_text()) if report_path.exists() else None
    bundle_path = Path(report["bundleIndex"]["path"]) if report and report.get("bundleIndex") else None
    bundle = json.loads(bundle_path.read_text()) if bundle_path and bundle_path.exists() else None
    result = {
        "schema": "kaminos.pipeline-run-result.v0",
        "kind": "pipeline-result",
        "ok": proc.returncode == 0 and bool(report and report.get("ok")),
        "pipelineId": pipeline_id,
        "source": source,
        "command": command,
        "exitCode": proc.returncode,
        "stdoutTail": "".join(stdout_chunks)[-4000:],
        "stderrTail": "".join(stderr_chunks)[-4000:],
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
    image_metadata = None
    if kind == "image" and root_id == "image-inbox":
        sidecar = path.with_name(f'.{path.name}.json')
        if sidecar.is_file():
            image_metadata = json.loads(sidecar.read_text())
    name = image_metadata['name'] if image_metadata else path.name
    correction_document = load_splat_asset_correction(root_id, rel_path) if kind == "splat" else None
    display = build_asset_display_metadata(
        Path(name),
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
        "name": name,
        "path": rel_path,
        "size": size,
        "mtime": path.stat().st_mtime,
        "source": "/api/read?" + urlencode({"root": root_id, "path": rel_path}),
        **({'sha256': image_metadata['sha256']} if image_metadata else {}),
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
    return build_asset_entry(root, target)


def ingest_image_asset(filename, content):
    if Path(filename).name != filename or '/' in filename or '\\' in filename:
        raise ValueError("Path traversal")
    if Path(filename).suffix.lower() not in IMAGE_EXTENSIONS:
        raise ValueError("image must be PNG, JPEG, or WebP")
    if not content:
        raise ValueError("empty image")
    root = next(row for row in ASSET_ROOTS if row['id'] == 'image-inbox')
    root_path = Path(root['path']).expanduser().resolve()
    root_path.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(content).hexdigest()
    directory = (root_path / digest).resolve()
    if not directory.is_relative_to(root_path):
        raise ValueError("Path traversal")
    directory.mkdir(exist_ok=True)
    # Keep the complete display name in metadata, independent of filesystem name limits.
    storage_name = hashlib.sha256(filename.encode('utf-8')).hexdigest() + Path(filename).suffix.lower()
    target = (directory / storage_name).resolve()
    if not target.is_relative_to(directory):
        raise ValueError("Path traversal")
    if target.exists() and target.read_bytes() != content:
        raise ValueError('image asset content identity collision')
    metadata = {'schema': 'kaminos.image-asset.v0', 'name': filename, 'sha256': f'sha256:{digest}'}
    temporary_image = temporary_metadata = None
    try:
        # Keep incomplete pixels hidden from Assets. Publish the image only after
        # its full bytes and display metadata have both been written successfully.
        with tempfile.NamedTemporaryFile(mode='wb', dir=directory, prefix='.image-', delete=False) as handle:
            temporary_image = Path(handle.name)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        with tempfile.NamedTemporaryFile(mode='w', dir=directory, prefix='.image-', delete=False) as handle:
            temporary_metadata = Path(handle.name)
            json.dump(metadata, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_metadata, target.with_name(f'.{target.name}.json'))
        try:
            # link is exclusive: concurrent saves may share an identical asset,
            # but must never replace an existing file with different bytes.
            os.link(temporary_image, target)
        except FileExistsError:
            if target.read_bytes() != content:
                raise ValueError('image asset content identity collision')
    finally:
        for temporary in (temporary_image, temporary_metadata):
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    entry = build_asset_entry(root, target)
    entry['sha256'] = f'sha256:{digest}'
    return entry


def prepare_authoring_image(content, *, source, name, expected_sha256):
    parsed=urlparse(source);params=parse_qs(parsed.query)
    if parsed.scheme or parsed.netloc or not ((parsed.path=='/api/read' and params.get('root') and params.get('path')) or (parsed.path=='/api/job-output' and params.get('job_id') and params.get('file'))):
        raise ValueError('Preparation source must be a mounted image asset')
    if hashlib.sha256(content).hexdigest()!=expected_sha256:
        raise ValueError('Original image digest does not match the requested input')
    original=ingest_image_asset(name,content)
    executable=os.environ.get('KAMINOS_IMAGE_PREPARATION_PYTHON',sys.executable)
    model=Path(os.environ.get('KAMINOS_BACKGROUND_MODEL_PATH','~/.u2net/u2net.onnx')).expanduser().resolve()
    completed=subprocess.run([executable,str(ROOT/'authoring_image_preparation.py'),'--store',str(KAMINOS_IMAGE_PREPARATION_DIR),'--model',str(model)],input=content,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    try: value=json.loads(completed.stdout)
    except (ValueError,UnicodeDecodeError) as error:
        raise RuntimeError('Image preparation runtime did not return a report: '+completed.stderr.decode(errors='replace')) from error
    if completed.returncode or value.get('status')!='complete':
        raise RuntimeError(value.get('error','Image preparation failed'))
    prepared=value.get('prepared',{});target=(KAMINOS_IMAGE_PREPARATION_DIR/prepared.get('path','')).resolve()
    if not target.is_relative_to(KAMINOS_IMAGE_PREPARATION_DIR) or not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest()!=prepared.get('sha256') or value.get('original',{}).get('sha256')!=expected_sha256:
        raise RuntimeError('Prepared image identity does not match retained bytes')
    value['original'].update(source=source,retainedSource=original['source'],name=name)
    value['prepared']['source']='/api/read?'+urlencode({'root':'image-preparations','path':prepared['path']})
    return value


def authoring_asset_catalog(collection):
    from authoring_asset_catalog import read_catalog
    return read_catalog(collection, roots=BROWSE_ROOTS,
        image_entries=lambda: list_asset_entries(kind='image'),
        origins=read_mesh_generation_origins, levels=mesh_lod_level_index,
        output_resolver=resolve_greenroom_output_dir, label=_clean_label)


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
    def refuse_sf3d_source(self, target):
        if Path(target).resolve() != (ROOT / "lib/sf3d/weights.bin").resolve():
            return False
        report = sf3d_source_admission()
        if report["verdict"] != "refused":
            return False
        report["requestedPath"] = self.path
        body = json.dumps(report).encode("utf-8")
        self.send_response(503)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-SF3D-Memory-Authority", report["authority"])
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)
        return True

    def send_head(self):
        # This is shared by actual static GET and HEAD, including decoded
        # aliases and symlinks; refuse before SimpleHTTP opens the source.
        if self.refuse_sf3d_source(self.translate_path(self.path)):
            return None
        return super().send_head()

    def translate_path(self, path):
        parsed = urlparse(path)
        if parsed.path.startswith('/sam3-packet/') and SAM3_PACKET_ROOT:
            from urllib.parse import unquote
            relative = unquote(parsed.path[len('/sam3-packet/'):])
            target = (SAM3_PACKET_ROOT / relative).resolve()
            if not target.is_relative_to(SAM3_PACKET_ROOT):
                return str(ROOT / '.sam3-path-rejected')
            return str(target)
        return super().translate_path(path)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def mounted_package(self, path):
        return next((prefix for prefix in MOUNTED_PACKAGES if path.startswith(prefix)), None)

    def send_klein_weight(self, path):
        # A file from a mounted model package. One byte range or the whole file; klein
        # refuses an embedding row that is not a 206.
        from urllib.parse import unquote
        target = None
        prefix = self.mounted_package(path)
        root = MOUNTED_PACKAGES[prefix]() if prefix else None
        if root:
            candidate = (root / unquote(path[len(prefix):])).resolve()
            if candidate.is_relative_to(root) and candidate.is_file():
                target = candidate
        if target is None:
            self.send_error(404, "model package file not found")
            return
        size = target.stat().st_size
        start, end, status = 0, size - 1, 200
        header = self.headers.get("Range")
        if header:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", header.strip())
            if not match or (match.group(1) == "" and match.group(2) == ""):
                self.send_error(416, "unsupported range")
                return
            if match.group(1) == "":
                start, end = max(0, size - int(match.group(2))), size - 1
            else:
                start = int(match.group(1))
                end = min(size - 1, int(match.group(2))) if match.group(2) else size - 1
            if start >= size or start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            status = 206
        self.send_response(status)
        self.send_header("Content-Type", "application/json" if target.suffix == ".json" else "application/octet-stream")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if self.command == "HEAD":
            return
        with target.open("rb") as source:
            source.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                chunk = source.read(min(remaining, 1 << 20))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def do_HEAD(self):
        if self.mounted_package(urlparse(self.path).path):
            return self.send_klein_weight(urlparse(self.path).path)
        return super().do_HEAD()

    def do_GET(self):
        parsed = urlparse(self.path)
        if self.mounted_package(parsed.path):
            return self.send_klein_weight(parsed.path)
        if parsed.path == "/api/workbench-experiments":
            from workbench_experiments import discover_experiments, experiment_catalogue
            try:
                modules = discover_experiments(ROOT, os.environ.get("KAMINOS_EXPERIMENTS_DIR", "experiments"))
                self.send_json({"modules": modules, "experiments": experiment_catalogue(ROOT, modules), "source": volume_settings_server_source()})
            except (OSError, ValueError) as error:
                self.send_error(500, str(error))
        elif parsed.path == "/api/sf3d-source-admission":
            report = sf3d_source_admission()
            report["requestId"] = parse_qs(parsed.query).get("requestId", [None])[0]
            self.send_json(report)
        elif parsed.path == "/api/preferences":
            self.handle_preferences()
        elif parsed.path == "/api/runtime-config":
            self.handle_runtime_config()
        elif parsed.path == "/api/gpu-queue-position":
            try:
                config = json.loads(Path(os.environ["KAMINOS_TRELLIS_CONFIG"]).read_text())
                self.send_json(gpu_queue_position(parse_qs(parsed.query).get("job", [""])[0],
                                                  queue_dir=config["queueDir"], greenroom_bin=config["greenroomBin"]))
            except KeyError:
                self.send_json({"error": "No configured GPU queue on this server"}, 404)
            except ValueError as error:
                self.send_json({"error": str(error)}, 400)
            except (OSError, RuntimeError, subprocess.SubprocessError) as error:
                self.send_json({"error": str(error)}, 503)
        elif parsed.path == "/api/pipeline-manifest":
            self.handle_pipeline_manifest()
        elif parsed.path == "/api/browse":
            self.handle_browse(parse_qs(parsed.query))
        elif parsed.path == "/api/mesh-lods":
            query = parse_qs(parsed.query)
            try:
                faces, max_error = query.get("faces", [None])[0], query.get("maxError", [None])[0]
                self.send_json(mesh_lod_choice(query.get("source", [None])[0], int(faces) if faces is not None else None,
                                               float(max_error) if max_error is not None else None, query.get("stat", ["max"])[0]))
            except MeshLodRecordError as error:
                self.send_json({"error": str(error), "phase": "mesh-lods-record"}, 500)
            except ValueError as error:
                self.send_json({"error": str(error), "phase": "mesh-lods"}, 400)
        elif parsed.path == "/api/authoring-assets":
            try:
                self.send_json(authoring_asset_catalog(parse_qs(parsed.query).get("collection", ["generated-meshes"])[0]))
            except ValueError as error:
                self.send_json({"error": str(error)}, 400)
            except FileNotFoundError as error:
                self.send_json({"error": str(error)}, 404)
        elif parsed.path == "/api/scene-library":
            self.handle_scene_library(parse_qs(parsed.query))
        elif parsed.path == "/api/scene-library-read":
            self.handle_scene_library_read(parse_qs(parsed.query))
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
        elif parsed.path == "/api/volume-settings-preset":
            self.handle_volume_settings_preset_get(parse_qs(parsed.query))
        elif parsed.path == "/api/volume-settings-presets":
            self.handle_volume_settings_presets_get()
        elif parsed.path == "/api/volume-basin-drive-session":
            self.handle_volume_basin_drive_session_get(parse_qs(parsed.query))
        elif parsed.path == "/api/volume-basin-drive-sessions":
            self.handle_volume_basin_drive_sessions_get()
        elif parsed.path == "/api/volume-cockpit-layout":
            self.handle_volume_cockpit_layout_get(parse_qs(parsed.query))
        elif parsed.path == "/api/volume-cockpit-layouts":
            self.handle_volume_cockpit_layouts_get()
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
        elif parsed.path == "/api/vantage/link":
            self.handle_vantage_link(parse_qs(parsed.query))
        elif parsed.path == "/api/vantage/hub":
            self.handle_vantage_hub(parse_qs(parsed.query))
        elif parsed.path == "/api/vantage/pages":
            self.handle_vantage_pages()
        elif parsed.path == "/api/notes" or parsed.path.startswith("/api/notes/"):
            notes_http().handle(self, "GET", self.path)
        else:
            super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/preferences':
            self.handle_preferences(write=True)
        elif parsed.path == '/api/prepare-image':
            self.handle_prepare_image(parse_qs(parsed.query))
        elif parsed.path == "/api/gpu-lease":
            self.handle_gpu_lease()
        elif parsed.path == "/api/gpu-queue-cancel":
            self.handle_gpu_queue_cancel()
        elif parsed.path == "/api/mesh-generation-origin":
            self.handle_mesh_generation_origin()
        elif parsed.path == "/api/mesh-lods":
            self.handle_mesh_lods_register()
        elif parsed.path == "/api/ingest-mesh":
            self.handle_ingest_mesh()
        elif parsed.path == "/api/scene-library-import":
            self.handle_scene_library_import()
        elif parsed.path == "/api/save-scene":
            self.handle_save_scene()
        elif parsed.path == "/api/run-pipeline":
            self.handle_run_pipeline()
        elif parsed.path == "/api/ingest-splat":
            self.handle_ingest_splat(parse_qs(parsed.query))
        elif parsed.path == "/api/ingest-image":
            self.handle_ingest_image(parse_qs(parsed.query))
        elif parsed.path == "/api/splat-correction":
            self.handle_splat_correction_post(parse_qs(parsed.query))
        elif parsed.path == "/api/volume-capture":
            self.handle_volume_capture()
        elif parsed.path == "/api/volume-settings-presets":
            self.handle_volume_settings_presets_post()
        elif parsed.path == "/api/volume-basin-promotions":
            self.handle_volume_basin_promotions_post()
        elif parsed.path == "/api/volume-basin-drive-sessions":
            self.handle_volume_basin_drive_sessions_post()
        elif parsed.path == "/api/volume-cockpit-layouts":
            self.handle_volume_cockpit_layouts_post()
        elif parsed.path == "/api/volume-cockpit-layout-activation":
            self.handle_volume_cockpit_layout_activation_post()
        elif parsed.path == "/api/vantage/command":
            self.handle_vantage_command()
        elif parsed.path == "/api/vantage/reply":
            self.handle_vantage_reply()
        elif parsed.path == "/api/vantage/presence":
            self.handle_vantage_presence()
        elif parsed.path == "/api/vantage/join":
            self.handle_vantage_join()
        elif parsed.path == "/api/vantage/leave":
            self.handle_vantage_leave()
        elif parsed.path == "/api/notes" or parsed.path.startswith("/api/notes/"):
            notes_http().handle(self, "POST", self.path)
        else:
            self.send_json({"error": "Not found"}, 404)

    def handle_preferences(self, write=False):
        if write and not self._vantage_allowed():
            return self.send_json({"error": "Preferences writes require this server’s local origin"}, 403)
        from user_preferences import read_preferences, write_preferences, PreferencesConflict
        try:
            if write:
                if (self.headers.get("Content-Type") or "").split(";")[0].strip().lower() != "application/json":
                    return self.send_json({"error": "Send preferences as application/json"}, 415)
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0:
                    raise ValueError("Preferences request is empty")
                request = json.loads(self.rfile.read(length))
                if not isinstance(request, dict) or "revision" not in request or "preferences" not in request:
                    raise ValueError("Preferences request needs preferences and revision")
                try:
                    result = write_preferences(request["preferences"], request["revision"])
                except PreferencesConflict as error:
                    return self.send_json({"error": str(error)}, 409)
            else:
                result = read_preferences()
            self.send_json(result)
        except (ValueError, TypeError) as error:
            # Existing malformed files are not request errors and must remain intact.
            self.send_json({"error": str(error)}, 400 if write else 500)
        except OSError as error:
            self.send_json({"error": str(error)}, 500)

    def handle_runtime_config(self):
        self.send_json(runtime_config())

    # The agent vantage drives a live page and returns its pictures, so it
    # answers only this machine at its own address: local tools without an
    # Origin, or this server's own pages. JSON bodies force a CORS preflight on
    # any cross-site attempt.
    def _vantage_allowed(self):
        port = self.server.server_address[1]

        def same_machine(value):
            parsed = urlparse(value if "//" in value else f"//{value}")
            try:
                return parsed.hostname in ("127.0.0.1", "localhost", "::1") and parsed.port == port
            except ValueError:
                return False

        client = (getattr(self, "client_address", None) or ("",))[0]
        if client not in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
            reason = "The agent vantage only answers this machine"
        elif not same_machine(self.headers.get("Host") or ""):
            reason = "The agent vantage only answers its own local address"
        elif self.headers.get("Origin") and not same_machine(self.headers["Origin"]):
            reason = "The agent vantage does not answer other sites"
        else:
            return True
        self.send_json({"ok": False, "phase": "forbidden", "error": reason}, 403)
        return False

    def _vantage_body(self):
        if (self.headers.get("Content-Type") or "").split(";")[0].strip().lower() != "application/json":
            self.send_json({"ok": False, "phase": "request", "error": "Send vantage requests as application/json"}, 415)
            return None
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length)) if 0 < length <= 256 * 1024 * 1024 else None
        except ValueError:
            body = None
        if not isinstance(body, dict):
            self.send_json({"ok": False, "phase": "request", "error": "Vantage requests need a JSON object body"}, 400)
            return None
        return body

    def _vantage_peer_closed(self):
        try:
            readable, _, _ = select.select([self.connection], [], [], 0)
            return bool(readable) and self.connection.recv(1, socket.MSG_PEEK) == b""
        except OSError:
            return True

    def handle_vantage_pages(self):
        if self._vantage_allowed():
            bridge, broker = vantage_bridge()
            # `hub`: pages may share one stream per browser (see handle_vantage_hub).
            self.send_json({"schema": bridge.VANTAGE_SCHEMA, "hub": True, "pages": broker.pages()})

    def handle_vantage_link(self, query):
        if not self._vantage_allowed():
            return
        bridge, broker = vantage_bridge()
        first = lambda key: query.get(key, [None])[0]
        try:
            link = broker.attach(first("page"), {
                "href": first("href"), "title": first("title"),
                "visible": first("visible") == "1", "focused": first("focused") == "1",
            })
        except bridge.VantageError as error:
            self.send_json({"ok": False, "phase": error.phase, "error": str(error)}, error.status)
            return
        self._vantage_stream(bridge, broker, link)

    # One stream for every Kaminos tab of a browser: its shared worker holds it,
    # pages join it, and each command names its page.
    def handle_vantage_hub(self, query):
        if not self._vantage_allowed():
            return
        bridge, broker = vantage_bridge()
        try:
            link = broker.attach_hub(query.get("hub", [None])[0])
        except bridge.VantageError as error:
            self.send_json({"ok": False, "phase": error.phase, "error": str(error)}, error.status)
            return
        self._vantage_stream(bridge, broker, link)

    def handle_vantage_join(self):
        if not self._vantage_allowed():
            return
        body = self._vantage_body()
        if body is None:
            return
        bridge, broker = vantage_bridge()
        try:
            joined = broker.join(str(body.get("hub") or ""), body.get("page"), body, member=body.get("member"))
        except bridge.VantageError as error:
            self.send_json({"ok": False, "phase": error.phase, "error": str(error)}, error.status)
            return
        # ok false: an older membership than the page already has; nothing changed.
        self.send_json({"ok": joined})

    def handle_vantage_leave(self):
        if not self._vantage_allowed():
            return
        body = self._vantage_body()
        if body is not None:
            left = vantage_bridge()[1].leave(str(body.get("hub") or ""), str(body.get("page") or ""), member=body.get("member"))
            self.send_json({"ok": left})

    def _vantage_stream(self, bridge, broker, link):
        self.close_connection = True
        message = None
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"retry: 2000\n\n")
            self.wfile.flush()
            quiet_since = time.monotonic()
            while True:
                message = broker.next_message(link, 1.0)
                if message is not None:
                    data = json.dumps(message, separators=(",", ":"))
                    self.wfile.write(f"id: {message['id']}\nevent: command\ndata: {data}\n\n".encode())
                elif self._vantage_peer_closed():
                    break
                elif time.monotonic() - quiet_since >= broker.heartbeat:
                    self.wfile.write(b": keepalive\n\n")
                else:
                    continue
                self.wfile.flush()
                message = None
                quiet_since = time.monotonic()
        except bridge.LinkClosed:
            pass
        except OSError:
            if message is not None:
                broker.undeliverable(message)
        finally:
            broker.detach(link)

    def handle_vantage_presence(self):
        if not self._vantage_allowed():
            return
        body = self._vantage_body()
        if body is not None:
            known = vantage_bridge()[1].presence(str(body.get("page") or ""), body)
            self.send_json({"ok": known}, 200 if known else 404)

    def handle_vantage_reply(self):
        if not self._vantage_allowed():
            return
        body = self._vantage_body()
        if body is not None:
            accepted = vantage_bridge()[1].reply(str(body.get("page") or ""), str(body.get("id") or ""), body)
            self.send_json({"ok": accepted}, 200 if accepted else 410)

    def handle_vantage_command(self):
        if not self._vantage_allowed():
            return
        body = self._vantage_body()
        if body is None:
            return
        timeout_ms = body.get("timeoutMs", 30000)
        if isinstance(timeout_ms, bool) or not isinstance(timeout_ms, (int, float)) or not 0 < timeout_ms <= 3_600_000:
            self.send_json({"ok": False, "phase": "request", "error": "timeoutMs must be between 1 and 3600000"}, 400)
            return
        bridge, broker = vantage_bridge()
        try:
            result = broker.submit(body.get("command"), body.get("args", {}), page=body.get("page") or None, timeout=timeout_ms / 1000)
        except bridge.VantageError as error:
            message = str(error)
            if error.phase == "select" and not body.get("page"):
                port = self.server.server_address[1]
                message += f". Open http://127.0.0.1:{port}/index.html in a WebGPU browser and keep the tab visible."
            self.send_json({"ok": False, "phase": error.phase, "error": message, **error.details}, error.status)
            return
        self.send_json(result)

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
        stamp = f"{time.strftime('%Y%m%d-%H%M%S')}-{time.time_ns() % 1_000_000:06d}"
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

    def handle_volume_settings_presets_get(self):
        try:
            self.send_json(list_volume_settings_presets_layered(
                volume_settings_store_layers(VOLUME_SETTINGS_STORE, SHARED_BASIN_STORE)
            ))
        except (OSError, ValueError, json.JSONDecodeError) as error:
            self.send_json({
                "error": str(error),
                "storePath": str(VOLUME_SETTINGS_STORE),
                "stores": volume_settings_store_layer_receipt(),
                "failurePhase": "shared-preset-index",
            }, 500)

    def handle_volume_settings_preset_get(self, query):
        preset_ref = (query.get("id") or query.get("preset") or [""])[0]
        try:
            document = read_volume_settings_preset_layered(
                volume_settings_store_layers(VOLUME_SETTINGS_STORE, SHARED_BASIN_STORE), preset_ref
            )
        except FileNotFoundError as error:
            self.send_json({
                "error": str(error),
                "requestedPresetRef": preset_ref,
                "storePath": str(VOLUME_SETTINGS_STORE),
                "stores": volume_settings_store_layer_receipt(),
                "failurePhase": "shared-preset-read",
            }, 404)
            return
        except (OSError, ValueError, json.JSONDecodeError) as error:
            self.send_json({
                "error": str(error),
                "requestedPresetRef": preset_ref,
                "storePath": str(VOLUME_SETTINGS_STORE),
                "stores": volume_settings_store_layer_receipt(),
                "failurePhase": "shared-preset-read",
            }, 400)
            return
        self.send_json(document)

    def handle_volume_settings_presets_post(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_json({"error": "Invalid Content-Length"}, 400)
            return
        try:
            request = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON"}, 400)
            return
        if not isinstance(request, dict) or not {"label", "preset"}.issubset(request) or set(request) - {"label", "preset", "publishAlias"}:
            self.send_json({"error": "settings preset write requires label, preset and optional publishAlias"}, 400)
            return
        if not isinstance(request.get("label"), str) or not request["label"].strip():
            self.send_json({"error": "settings preset label is required"}, 400)
            return
        if not isinstance(request.get("preset"), dict):
            self.send_json({"error": "settings preset payload must be a JSON object"}, 400)
            return
        try:
            receipt = write_volume_settings_preset_to_library(
                VOLUME_SETTINGS_STORE,
                SHARED_BASIN_STORE,
                request["label"],
                request["preset"],
                volume_settings_server_source(),
                publish_alias=request.get("publishAlias", True),
            )
        except VolumeSettingsLocalPrecheckError as error:
            self.send_json({
                "error": str(error),
                "requestedLabel": request.get("label"),
                "storePath": str(VOLUME_SETTINGS_STORE),
                "stores": volume_settings_store_layer_receipt(),
                "failurePhase": "local-preset-precheck",
            }, 400)
            return
        except VolumeSettingsPartialSave as error:
            # The library has the basin; this server's store does not. Say both.
            self.send_json({
                "error": str(error),
                "partial": True,
                "localError": error.local_error,
                "sharedPublication": error.shared_publication,
                "requestedLabel": request.get("label"),
                "storePath": str(VOLUME_SETTINGS_STORE),
                "stores": volume_settings_store_layer_receipt(),
                "failurePhase": "local-preset-write",
            }, 500)
            return
        except (OSError, ValueError, json.JSONDecodeError) as error:
            self.send_json({
                "error": str(error),
                "requestedLabel": request.get("label"),
                "storePath": str(VOLUME_SETTINGS_STORE),
                "stores": volume_settings_store_layer_receipt(),
                "failurePhase": "shared-preset-write",
            }, 400)
            return
        self.send_json(receipt)

    def handle_volume_basin_drive_sessions_get(self):
        try:
            self.send_json(list_volume_basin_drive_sessions(VOLUME_BASIN_SESSION_STORE))
        except (OSError, ValueError, json.JSONDecodeError) as error:
            self.send_json({
                "error": str(error),
                "storePath": str(VOLUME_BASIN_SESSION_STORE),
                "failurePhase": "basin-drive-session-index",
            }, 500)

    def handle_volume_cockpit_layouts_get(self):
        try:
            self.send_json(list_volume_cockpit_layouts(VOLUME_COCKPIT_LAYOUT_STORE))
        except (OSError, ValueError, json.JSONDecodeError) as error:
            self.send_json({
                "error": str(error),
                "storePath": str(VOLUME_COCKPIT_LAYOUT_STORE),
                "failurePhase": "cockpit-layout-index",
            }, 500)

    def handle_volume_cockpit_layout_get(self, query):
        layout_id = (query.get("id") or query.get("layout") or [""])[0]
        try:
            self.send_json(read_volume_cockpit_layout(VOLUME_COCKPIT_LAYOUT_STORE, layout_id))
        except FileNotFoundError as error:
            self.send_json({
                "error": str(error),
                "requestedLayoutId": layout_id,
                "storePath": str(VOLUME_COCKPIT_LAYOUT_STORE),
                "failurePhase": "cockpit-layout-read",
            }, 404)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            self.send_json({
                "error": str(error),
                "requestedLayoutId": layout_id,
                "storePath": str(VOLUME_COCKPIT_LAYOUT_STORE),
                "failurePhase": "cockpit-layout-read",
            }, 400)

    def handle_volume_cockpit_layouts_post(self):
        failure = {
            "storePath": str(VOLUME_COCKPIT_LAYOUT_STORE),
            "failurePhase": "cockpit-layout-write",
        }
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_json({**failure, "error": "Invalid Content-Length"}, 400)
            return
        try:
            request = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json({**failure, "error": "Invalid JSON"}, 400)
            return
        if not isinstance(request, dict) or set(request) != {"layout", "activate"}:
            self.send_json({**failure, "error": "cockpit layout write requires exactly layout and activate inputs"}, 400)
            return
        if not isinstance(request.get("activate"), bool):
            self.send_json({**failure, "error": "cockpit layout activate must be boolean"}, 400)
            return
        try:
            receipt = write_volume_cockpit_layout(
                VOLUME_COCKPIT_LAYOUT_STORE,
                request.get("layout"),
                activate=request["activate"],
            )
        except OSError as error:
            self.send_json({**failure, "error": str(error)}, 500)
            return
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json({**failure, "error": str(error)}, 400)
            return
        self.send_json(receipt)

    def handle_volume_cockpit_layout_activation_post(self):
        failure = {
            "storePath": str(VOLUME_COCKPIT_LAYOUT_STORE),
            "failurePhase": "cockpit-layout-activation",
        }
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_json({**failure, "error": "Invalid Content-Length"}, 400)
            return
        try:
            request = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json({**failure, "error": "Invalid JSON"}, 400)
            return
        if not isinstance(request, dict) or set(request) != {"layoutId"}:
            self.send_json({**failure, "error": "cockpit layout activation requires exactly layoutId"}, 400)
            return
        try:
            receipt = activate_volume_cockpit_layout(
                VOLUME_COCKPIT_LAYOUT_STORE,
                request.get("layoutId"),
            )
        except FileNotFoundError as error:
            self.send_json({**failure, "error": str(error)}, 404)
            return
        except OSError as error:
            self.send_json({**failure, "error": str(error)}, 500)
            return
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json({**failure, "error": str(error)}, 400)
            return
        self.send_json(receipt)

    def handle_volume_basin_drive_session_get(self, query):
        session_ref = (query.get("id") or query.get("session") or [""])[0]
        try:
            document = read_volume_basin_drive_session(VOLUME_BASIN_SESSION_STORE, session_ref)
        except FileNotFoundError as error:
            self.send_json({
                "error": str(error),
                "requestedSessionRef": session_ref,
                "storePath": str(VOLUME_BASIN_SESSION_STORE),
                "failurePhase": "basin-drive-session-read",
            }, 404)
            return
        except (OSError, ValueError, json.JSONDecodeError) as error:
            self.send_json({
                "error": str(error),
                "requestedSessionRef": session_ref,
                "storePath": str(VOLUME_BASIN_SESSION_STORE),
                "failurePhase": "basin-drive-session-read",
            }, 400)
            return
        self.send_json(document)

    def handle_volume_basin_drive_sessions_post(self):
        failure_base = {
            "storePath": str(VOLUME_BASIN_SESSION_STORE),
            "failurePhase": "basin-drive-session-write",
        }
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_json({**failure_base, "error": "Invalid Content-Length", "requestedSessionId": None}, 400)
            return
        try:
            request = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json({**failure_base, "error": "Invalid JSON", "requestedSessionId": None}, 400)
            return
        if not isinstance(request, dict) or set(request) != {"session"}:
            self.send_json({
                "error": "basin drive session write requires exactly session input",
                **failure_base,
            }, 400)
            return
        try:
            receipt = write_volume_basin_drive_session(VOLUME_BASIN_SESSION_STORE, request.get("session"))
        except OSError as error:
            self.send_json({
                **failure_base,
                "error": str(error),
                "requestedSessionId": (request.get("session") or {}).get("sessionId")
                if isinstance(request.get("session"), dict) else None,
            }, 500)
            return
        except (ValueError, json.JSONDecodeError, subprocess.SubprocessError) as error:
            self.send_json({
                "error": str(error),
                "requestedSessionId": (request.get("session") or {}).get("sessionId")
                if isinstance(request.get("session"), dict) else None,
                **failure_base,
            }, 400)
            return
        self.send_json(receipt)

    def handle_volume_basin_promotions_post(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_json({"error": "Invalid Content-Length"}, 400)
            return
        try:
            request = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON"}, 400)
            return
        try:
            receipt = write_volume_basin_promotion_package(request)
        except (OSError, ValueError, json.JSONDecodeError, subprocess.SubprocessError) as error:
            self.send_json({
                "error": str(error),
                "requestedHandle": request.get("handle") if isinstance(request, dict) else None,
                "requestedPromotionRoot": request.get("promotionRoot") if isinstance(request, dict) else None,
                "failurePhase": "basin-promotion-write",
            }, 400)
            return
        self.send_json(receipt)

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

        if payload.get("kind") == "settings-preset":
            self.send_json({"error": "settings presets must use the shared /api/volume-settings-presets store"}, 410)
            return

        if payload.get("kind") == "prototype-basin":
            scene_authority = payload.get("sceneAuthority") or {}
            requested_smoke = payload.get("requestedSmoke") or {}
            exclusions = payload.get("stateExclusions") or {}
            forbidden_runtime_fields = ("href", "camera", "volumeDebugState", "viewport")
            excluded_fields = (
                "fluidField", "frontField", "boundarySidecar", "splatInstances",
                "historyBuffers", "pressureState", "replayState",
            )
            if scene_authority.get("status") != "prototype" or scene_authority.get("effective") != "tall_plume":
                self.send_json({"error": "prototype-basin capture requires tall_plume prototype authority"}, 400)
                return
            if requested_smoke.get("role") != "truthHigh" or requested_smoke.get("composition") != "splat-only-v0" or requested_smoke.get("warmupSteps") != 0:
                self.send_json({"error": "prototype-basin capture requires explicit truthHigh splat-only fresh-smoke identity"}, 400)
                return
            if ((payload.get("domControls") or {}).get("boundarySplatMode", {}).get("value") != "learned"):
                self.send_json({"error": "prototype-basin splat-only smoke requires learned boundary splats"}, 400)
                return
            if str(((payload.get("domControls") or {}).get("resolution", {}).get("value"))) != "160":
                self.send_json({"error": "prototype-basin selective-head smoke requires resolution 160"}, 400)
                return
            if any(exclusions.get(field) is not True for field in excluded_fields):
                self.send_json({"error": "prototype-basin capture must explicitly exclude runtime and replay state"}, 400)
                return
            if any(field in payload for field in forbidden_runtime_fields):
                self.send_json({"error": "prototype-basin capture must not contain runtime, camera, or viewport state"}, 400)
                return

        VOLUME_CAPTURE_DIR.mkdir(parents=True, exist_ok=True)
        capture_id = self.volume_capture_slug(payload)
        path = self.volume_capture_path_for_id(capture_id)
        relative_path = str(path.relative_to(ROOT))
        smoke_url = f"/volume-basin-smoke.html?capture={capture_id}" if payload.get("kind") == "prototype-basin" else None
        preset_url = f"/volume-settings-preset.html?preset={capture_id}" if payload.get("kind") == "settings-preset" else None
        witness_command = (
            f"node volume-settings-preset-witness.mjs --url "
            f"http://127.0.0.1:{PORT}{preset_url}"
            if preset_url else
            f"node volume-witness.mjs --capture {relative_path}"
        )
        document = {
            "identity": "kaminos-volume-agent-capture-artifact-v1",
            "captureId": capture_id,
            "writtenAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "artifactRelativePath": relative_path,
            "witnessCommand": witness_command,
            "capture": payload,
        }
        if smoke_url:
            document["smokeUrl"] = smoke_url
        if preset_url:
            document["presetUrl"] = preset_url
        path.write_text(json.dumps(document, indent=2))
        self.send_json({
            "ok": True,
            "captureId": capture_id,
            "relativePath": relative_path,
            "path": str(path),
            "witnessCommand": document["witnessCommand"],
            "smokeUrl": smoke_url,
            "presetUrl": preset_url,
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

        # Save As with a chosen name: sanitized into the scenes directory, and
        # an existing file is only replaced when the caller confirms it.
        save_as_name = data.pop("_saveAsName", None)
        overwrite = data.pop("_overwrite", False) is True
        if save_as_name is not None:
            stem = Path(str(save_as_name).strip()).name
            if stem.endswith(".kaminos.json"):
                stem = stem[: -len(".kaminos.json")]
            stem = "-".join(stem.split())
            stem = "".join(c for c in stem if c.isalnum() or c in "._-").strip(".-")
            if not stem:
                self.send_json({"error": "Scene name has no usable characters"}, 400)
                return
            filename = f"{stem}.kaminos.json"
            if (SCENES_DIR / filename).exists() and not overwrite:
                self.send_json({"error": f"{filename} already exists", "exists": filename}, 409)
                return
            data.pop("_filename", None)
            hint = filename
        else:
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
            filename = f"{model_name}_{timestamp}_{uuid.uuid4().hex}.kaminos.json"
            filename = "".join(c for c in filename if c.isalnum() or c in "._-")
            if not filename:
                filename = "scene.kaminos.json"

        scene_path = SCENES_DIR / filename
        # Security: ensure under SCENES_DIR
        if not scene_path.resolve().is_relative_to(SCENES_DIR.resolve()):
            self.send_json({"error": "Path traversal"}, 403)
            return

        _atomic_write_json(scene_path, data)
        self.send_json({"saved": filename, "path": str(scene_path)})

    def handle_gpu_lease(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length)) if length > 0 else {}
            config = greenroom_lease_config()
            if config is None:
                self.send_json({"status": "unconfigured", "message": "No Greenroom configured on this server; the run proceeds without a lease"})
                return
            result = greenroom_page_lease(payload, greenroom_bin=config["greenroomBin"], queue_dir=config["queueDir"],
                                          server_pid=os.getpid(), repo_root=str(ROOT))
            self.send_json({**result, "greenroom": {"queueDir": config["queueDir"], "source": config["source"]}})
        except PermissionError as error:
            self.send_json({"error": str(error)}, 403)
        except ValueError as error:
            self.send_json({"error": str(error)}, 400)
        except (OSError, RuntimeError, subprocess.SubprocessError) as error:
            self.send_json({"error": str(error)}, 503)

    def handle_gpu_queue_cancel(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length)) if length > 0 else {}
            config = json.loads(Path(os.environ["KAMINOS_TRELLIS_CONFIG"]).read_text())
            self.send_json(cancel_owned_gpu_job(payload.get("job"), queue_dir=config["queueDir"],
                                                greenroom_bin=config["greenroomBin"], runs_root=KAMINOS_PIPELINE_RUNS_DIR))
        except KeyError:
            self.send_json({"error": "No configured GPU queue on this server"}, 404)
        except PermissionError as error:
            self.send_json({"error": str(error)}, 403)
        except ValueError as error:
            self.send_json({"error": str(error)}, 409)
        except (OSError, subprocess.SubprocessError) as error:
            self.send_json({"error": str(error)}, 503)

    def handle_mesh_lods_register(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            payload = json.loads(self.rfile.read(length)) if length > 0 else None
            if not isinstance(payload, dict):
                raise ValueError('Level registration must be an object')
            self.send_json(save_mesh_lod_level(payload))
        except MeshLodRecordError as error:
            self.send_json({'error': str(error), 'phase': 'mesh-lods-record'}, 500)
        except (ValueError, KeyError, TypeError) as error:
            self.send_json({'error': str(error), 'phase': 'mesh-lods'}, 400)
        except OSError as error:
            self.send_json({'error': str(error), 'phase': 'mesh-lods'}, 500)

    def handle_mesh_generation_origin(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            if length <= 0:
                raise ValueError('Generation origin body required')
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValueError('Incomplete generation origin body')
            payload = json.loads(body)
            if not isinstance(payload, dict):
                raise ValueError('Generation origin must be an object')
            self.send_json(save_mesh_generation_origin(payload))
        except (ValueError, KeyError, TypeError) as error:
            self.send_json({'error': str(error), 'phase': 'origin-persistence'}, 400)
        except OSError as error:
            self.send_json({'error': str(error), 'phase': 'origin-persistence'}, 500)

    def handle_ingest_mesh(self):
        """Persist a generated GLB by content hash for the existing scene loader."""
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length < 20:
                raise ValueError("GLB header and first chunk required")
            content = self.rfile.read(length)
            if (len(content) != length or content[:4] != b"glTF"
                    or int.from_bytes(content[4:8], "little") != 2
                    or int.from_bytes(content[8:12], "little") != length):
                raise ValueError("Invalid GLB version or length")
            # Check container boundaries; GLTFLoader owns semantic mesh validation.
            offset = 12
            while offset < length:
                if offset + 8 > length:
                    raise ValueError("Incomplete GLB chunk header")
                chunk_length = int.from_bytes(content[offset:offset + 4], "little")
                if chunk_length % 4 or offset + 8 + chunk_length > length:
                    raise ValueError("Invalid GLB chunk length")
                if offset == 12 and content[offset + 4:offset + 8] != b"JSON":
                    raise ValueError("First GLB chunk must be JSON")
                offset += 8 + chunk_length
            digest = hashlib.sha256(content).hexdigest()
            root = BROWSE_ROOTS["generated-meshes"].resolve()
            root.mkdir(parents=True, exist_ok=True)
            target = root / f"{digest}.glb"
            # Publish atomically without overwriting another writer's content.
            with tempfile.NamedTemporaryFile(dir=root, delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(content)
            try:
                try:
                    os.link(temporary, target)
                except FileExistsError:
                    if target.is_symlink() or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
                        raise ValueError("Stored GLB content identity conflict")
            finally:
                temporary.unlink()
        except ValueError as error:
            self.send_json({"error": str(error)}, 400)
            return
        except OSError as error:
            self.send_json({"error": str(error), "phase": "mesh-persistence"}, 500)
            return
        self.send_json({"schema": "kaminos.generated-mesh.v0", "sha256": digest,
                        "bytes": length, "source": f"/api/read?root=generated-meshes&path={digest}.glb"})

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

    def handle_prepare_image(self,params):
        try:
            length=int(self.headers.get('Content-Length',0))
            if length<=0:raise ValueError('non-empty image body required')
            content=self.rfile.read(length)
            if len(content)!=length:raise ValueError('incomplete image body')
            result=prepare_authoring_image(content,source=params.get('source',[''])[0],name=params.get('name',[''])[0],expected_sha256=params.get('sha256',[''])[0])
        except (ValueError,PermissionError) as error:
            self.send_json({'error':str(error),'phase':'image-preparation'},400);return
        except (OSError,RuntimeError) as error:
            self.send_json({'error':str(error),'phase':'image-preparation'},503);return
        self.send_json(result)

    def handle_ingest_image(self, params):
        try:
            length = int(self.headers.get('Content-Length', 0))
            if length <= 0:
                raise ValueError('non-empty image body required')
            content = self.rfile.read(length)
            if len(content) != length:
                raise ValueError('incomplete image body')
            entry = ingest_image_asset(params.get('name', [''])[0], content)
        except ValueError as error:
            self.send_json({'error': str(error)}, 400)
            return
        except OSError as error:
            self.send_json({'error': str(error), 'phase': 'image-persistence'}, 500)
            return
        self.send_json({'schema': 'kaminos.asset-ingest.v0', 'kind': 'image', 'entry': entry})

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

    def _scene_library_local_client(self):
        # Other servers' scenes are only offered to this machine itself; the
        # listener may be reachable from the network.
        host = (getattr(self, "client_address", None) or ("",))[0]
        if host in ("127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"):
            return True
        self.send_json({"error": "Scenes from other servers are only available on this machine"}, 403)
        return False

    def _scene_library_scene_path(self, store_id, name):
        store = scene_library_stores().get(store_id)
        if store is None:
            self.send_json({"error": "Unknown scene store"}, 404)
            return None, None
        if Path(name).name != name or not name.endswith(".kaminos.json"):
            self.send_json({"error": "Invalid scene name"}, 400)
            return None, None
        scene_path = (store / name).resolve()
        if not scene_path.is_relative_to(store.resolve()) or not scene_path.is_file():
            self.send_json({"error": "Scene not found"}, 404)
            return None, None
        return store, scene_path

    def handle_scene_library_import(self):
        """Copy another server's scene into this server under a fresh name and
        bring over the generated meshes it needs that only that server had."""
        if not self._scene_library_local_client():
            return
        try:
            request = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        except ValueError:
            self.send_json({"error": "Invalid JSON"}, 400)
            return
        store, scene_path = self._scene_library_scene_path(str(request.get("store") or ""), str(request.get("name") or ""))
        if store is None:
            return
        try:
            document = json.loads(scene_path.read_text())
        except (OSError, ValueError) as error:
            self.send_json({"error": f"Scene unreadable: {error}"}, 400)
            return
        try:
            basin = scene_library_import_basin(document, store)
        except (OSError, ValueError) as error:
            self.send_json({'error': f'Could not retain the scene fire basin: {error}'}, 400)
            return
        dependencies = [scene_library_import_dependency(obj.get("source"), store)
                        for obj in document.get("objects") or [] if isinstance(obj, dict) and str(obj.get("source") or "").startswith("/api/read?")]
        filename = f"{scene_path.name[: -len('.kaminos.json')]}_{uuid.uuid4().hex}.kaminos.json"
        _atomic_write_json(SCENES_DIR / filename, document)
        self.send_json({"saved": filename, "document": document, "dependencies": dependencies, "basin": basin, "from": str(store.parent.name)})

    def handle_scene_library(self, params):
        """List scenes saved by other Kaminos servers on this machine (read-only)."""
        if not self._scene_library_local_client():
            return
        stores = []
        for store_id, path in scene_library_stores().items():
            scenes = []
            for scene_path in sorted(path.glob("*.kaminos.json")):
                entry = {"name": scene_path.name, "label": "", "timestamp": ""}
                try:
                    data = json.loads(scene_path.read_text())
                    entry["label"] = str(data.get("label") or (data.get("capture") or {}).get("label") or "")
                    entry["timestamp"] = str(data.get("timestamp") or "")
                except (OSError, ValueError) as error:
                    entry["error"] = str(error)
                scenes.append(entry)
            if scenes:
                stores.append({"id": store_id, "label": path.parent.parent.name if path.parent.name in ("consumer", "state", "native-consumer") else path.parent.name, "path": str(path), "scenes": scenes})
        self.send_json({"stores": stores})

    def handle_scene_library_read(self, params):
        """Read one scene from another server's store; never writes there."""
        if not self._scene_library_local_client():
            return
        store, scene_path = self._scene_library_scene_path((params.get("store") or [""])[0], (params.get("name") or [""])[0])
        if store is None:
            return
        try:
            self.send_json(json.loads(scene_path.read_text()))
        except (OSError, ValueError) as error:
            self.send_json({"error": f"Scene unreadable: {error}"}, 400)

    def handle_browse(self, params):
        """List directory contents. ?root=scratch&path=subdir"""
        lod_levels = None
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
            if root_name == 'generated-meshes' and entry.is_file() and re.fullmatch(r'[a-f0-9]{64}\.glb', entry.name):
                if lod_levels is None:
                    lod_levels = mesh_lod_level_index()
                if entry.stem in lod_levels:
                    info['lodOf'] = lod_levels[entry.stem]
                try:
                    origins = read_mesh_generation_origins(entry.stem)
                    if origins:
                        origin = origins['origins'][origins['latestRunId']]
                        info['generation'] = origin['generation']
                        info['generationOriginCount'] = len(origins['origins'])
                        info['display']['title'] = origin['name']
                except (ValueError, KeyError, OSError) as error:
                    info['originError'] = str(error)
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

        if self.refuse_sf3d_source(target):
            return

        # For images, serve directly
        ext = target.suffix.lower()
        if ext in (".png", ".jpg", ".jpeg", ".webp", ".exr", ".glb", ".gltf", ".ply", ".spz"):
            body = target.read_bytes()
            self.send_response(200)
            content_types = {
                ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".webp": "image/webp",
                ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
                ".exr": "application/octet-stream", ".ply": "application/octet-stream", ".spz": "application/octet-stream",
            }
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
        if self.refuse_sf3d_source(target):
            return
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
        # Every response is uncacheable: a module kept heuristically fresh by
        # the browser across a plain reload has already broken the operator
        # route once (scene-placement-tools.mjs without addHistoryScope).
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):
        rendered = format % args if args else format
        if "/api/" in rendered:
            return  # quiet API spam
        super().log_message(format, *args)


class KaminosServer(http.server.ThreadingHTTPServer):
    """ThreadingHTTPServer without the fully qualified hostname lookup that
    http.server performs while binding. On macOS that lookup goes to multicast
    DNS and can stall for tens of seconds per process. Nothing here reads
    server_name, so the bound host stands in for it."""

    def server_bind(self):
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = host or "localhost"
        self.server_port = port


if __name__ == "__main__":
    try:
        if SHARED_BASIN_STORE_ERROR and "--no-shared-basin-store" not in sys.argv and "--shared-basin-store" not in sys.argv:
            raise ValueError(SHARED_BASIN_STORE_ERROR)
        server_arguments, SHARED_BASIN_STORE = split_shared_basin_store_arguments(sys.argv[1:], SHARED_BASIN_STORE_DEFAULT)
        PORT, VOLUME_SETTINGS_STORE, VOLUME_BASIN_SESSION_STORE, VOLUME_COCKPIT_LAYOUT_STORE = parse_server_arguments(server_arguments)
    except ValueError as error:
        print(f"serve.py: {error}", file=sys.stderr)
        raise SystemExit(2)
    for path in (BROWSE_ROOTS.get("splat-inbox"), BROWSE_ROOTS.get("splat-production")):
        if path:
            path.mkdir(parents=True, exist_ok=True)
    print(f"Kaminos server at http://localhost:{PORT}")
    print(f"  Scratch: {BROWSE_ROOTS['scratch']}")
    print(f"  Greenroom: {BROWSE_ROOTS['greenroom']}")
    print(f"  Splat inbox: {BROWSE_ROOTS['splat-inbox']}")
    print(f"  Production splats: {BROWSE_ROOTS['splat-production']}")
    print(f"  Volume settings store: {VOLUME_SETTINGS_STORE}")
    print(f"  Shared basin library: {SHARED_BASIN_STORE or 'disabled'}")
    print(f"  Volume basin session store: {VOLUME_BASIN_SESSION_STORE}")
    print(f"  Volume cockpit layout store: {VOLUME_COCKPIT_LAYOUT_STORE}")
    # KAMINOS_BIND_HOST narrows the listening interface, for example to
    # 127.0.0.1 on CI runners that intercept servers listening on all
    # interfaces. The default stays all interfaces for LAN access.
    bind_host = os.environ.get("KAMINOS_BIND_HOST", "")
    server = KaminosServer((bind_host, PORT), KaminosHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
