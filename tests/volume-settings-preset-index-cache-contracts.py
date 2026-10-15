# kaminos-test: python
"""Listing the preset index must not recompute presets that have not changed.

The index is requested on every page load and reads every preset in the local
store and the shared basin library. Presets are content-addressed, so an
unchanged file needs no second hash, normalization or validation; a changed
file, alias or schema must be read again, and a broken file must never be
served from an earlier good read.
"""

import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import serve

import volume_settings_preset_migrate as migrate
from urllib.parse import parse_qsl, urlencode, urlparse

# Build a valid schema-v2 payload from the schema alone, the way the emitter
# migration contract does; no machine-local capture is needed.
spec = importlib.util.spec_from_file_location(
    "emitter_migration_contracts", ROOT / "tests" / "volume-settings-preset-emitter-migration-contracts.py"
)
emitter_contracts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(emitter_contracts)
schema = emitter_contracts.schema
payload, _profile = migrate.migrate_volume_settings_preset_payload(emitter_contracts.legacy_payload(set()), schema)


def set_control(document, key, value):
    document = json.loads(json.dumps(document))
    descriptor = document["domControls"][key]
    descriptor["value"] = value
    descriptor.pop("rawValue", None)
    route = urlparse(document["route"])
    entries = dict(parse_qsl(route.query, keep_blank_values=True))
    entries[descriptor["param"]] = str(value)
    document["route"] = route._replace(query=urlencode(list(entries.items()))).geturl()
    return document


numeric_key = next(
    descriptor["key"] for descriptor in schema["controls"]
    if descriptor["type"] in {"range", "number"} and descriptor["key"] in payload["domControls"]
)

normalize_calls = []
_real_normalize = serve.normalize_volume_settings_preset_payload


def counting_normalize(*args, **kwargs):
    normalize_calls.append(1)
    return _real_normalize(*args, **kwargs)


serve.normalize_volume_settings_preset_payload = counting_normalize


def listing(layers, use_schema=schema):
    return serve.list_volume_settings_presets_layered(layers, use_schema)


def main():
    source = {"repoRoot": "/tmp/worktree", "branch": "branch", "commit": "c" * 40}
    with tempfile.TemporaryDirectory() as temporary:
        shared = Path(temporary) / "shared"
        local = Path(temporary) / "local"
        for index, label in enumerate(("Kiln Hero", "Bowl Wisp", "Arch Plume")):
            serve.write_volume_settings_preset(
                shared, label, set_control(payload, numeric_key, 10 + index), source, schema
            )
        # A second version of one label leaves an earlier version in history.
        serve.write_volume_settings_preset(
            shared, "Kiln Hero", set_control(payload, numeric_key, 42), source, schema
        )
        serve.write_volume_settings_preset(
            local, "Local Draft", set_control(payload, numeric_key, 7), source, schema
        )
        layers = [("shared", shared), ("local", local)]

        normalize_calls.clear()
        first = listing(layers)
        cold = len(normalize_calls)
        assert cold >= 5, f"cold listing should read every preset version, read {cold}"
        assert len(first["entries"]) == 4, first["entries"]
        assert len(first["earlierVersions"]) == 1, first["earlierVersions"]

        normalize_calls.clear()
        second = listing(layers)
        assert len(normalize_calls) == 0, f"unchanged presets were recomputed {len(normalize_calls)} times"
        assert second == first, "a repeated listing must return the same index"

        # Touching one preset file (same content, new size) re-reads only it.
        touched = next(entry for entry in first["entries"] if entry["storeRole"] == "shared")
        target = Path(touched["storePath"]) / "presets" / f"{touched['presetId']}.json"
        target.write_text(target.read_text() + "\n")
        normalize_calls.clear()
        third = listing(layers)
        assert len(normalize_calls) == 1, f"one changed file should be re-read once, read {len(normalize_calls)}"
        assert third == first

        # A preset whose content no longer matches its id is reported
        # unavailable, not served from the earlier good read.
        document = json.loads(target.read_text())
        document["preset"]["domControls"][numeric_key]["value"] = 999
        target.write_text(json.dumps(document))
        broken = listing(layers)
        broken_ids = {entry["presetId"] for entry in broken["unavailableEntries"]}
        assert touched["presetId"] in broken_ids, broken["unavailableEntries"]
        assert touched["presetId"] not in {entry["presetId"] for entry in broken["entries"]}

        # Repointing an alias to another preset is seen immediately.
        alias_path = local / "aliases" / "local-draft.json"
        alias_document = json.loads(alias_path.read_text())
        alias_document["presetId"] = "vsp-" + "0" * 64
        alias_path.write_text(json.dumps(alias_document))
        repointed = listing(layers)
        assert "local-draft" not in {entry["alias"] for entry in repointed["entries"] if entry["storeRole"] == "local"}

        # A different schema document re-reads everything.
        changed_schema = json.loads(json.dumps(schema))
        changed_schema["cacheContractProbe"] = True
        normalize_calls.clear()
        listing(layers, changed_schema)
        assert len(normalize_calls) >= 4, f"schema change should re-read presets, read {len(normalize_calls)}"

        # Returned lists are copies: a caller mutating one cannot alter the next listing.
        fresh = listing(layers)
        fresh["entries"][0]["carriedControls"].append("mutated-by-caller")
        assert "mutated-by-caller" not in listing(layers)["entries"][0]["carriedControls"]

    print("volume settings preset index cache contracts passed")


if __name__ == "__main__":
    main()
