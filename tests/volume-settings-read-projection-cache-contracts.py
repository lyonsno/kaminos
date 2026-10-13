#!/usr/bin/env python3
import copy
import json
import runpy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
fixtures = runpy.run_path(str(ROOT / "tests/volume_settings_shared_store_contracts.py"))
serve = fixtures["serve"]


class ReadProjectionContracts(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = Path(self.directory.name)
        self.schema = copy.deepcopy(fixtures["BASE_SCHEMA"])
        payload = fixtures["payload"](self.schema, fixtures["BASE_VALUES"])
        result = serve.write_volume_settings_preset(self.store, "Cache witness", payload, fixtures["SOURCE"], self.schema)
        self.preset = result["effective"]["presetId"]
        self.path = self.store / "presets" / f"{self.preset}.json"
        self.alias = result["effective"]["alias"]
        cache = getattr(serve, "_volume_settings_read_projections", None)
        if cache is not None:
            cache.clear()

    def read(self, schema=None):
        return serve.read_volume_settings_preset(self.store, self.preset, schema or self.schema)

    def test_unchanged_complete_payload_projects_once(self):
        with patch.object(serve, "normalize_volume_settings_preset_payload", wraps=serve.normalize_volume_settings_preset_payload) as project:
            first = self.read()
            second = self.read()
            third = self.read()
        self.assertEqual(first, second)
        self.assertEqual(second, third)
        self.assertEqual(project.call_count, 1, "unchanged verified artifact must not repeat full projection on each index read")

    def test_schema_values_not_only_identity_invalidate_projection(self):
        self.read()
        schema = copy.deepcopy(self.schema)
        schema["controls"][2]["allowedValues"] = ["a"]
        changed = self.read(schema)
        self.assertEqual(changed["preset"]["domControls"]["volume-mode"]["value"], "a")
        self.assertTrue(changed["schemaProjection"]["unsupportedValuesDefaulted"])

    def test_warm_read_still_rejects_bad_route_and_forbidden_state(self):
        self.read()
        original = json.loads(self.path.read_text())
        for change in (lambda p: p.update(route=p["route"] + "&unowned=1"), lambda p: p.update(fluidField=[1])):
            changed = copy.deepcopy(original)
            change(changed["preset"])
            self.path.write_text(json.dumps(changed))
            with self.assertRaises(ValueError):
                self.read()

    def test_warm_read_verifies_corruption_and_reads_current_alias_metadata(self):
        self.read()
        alias_path = self.store / "aliases" / f"{self.alias}.json"
        alias = json.loads(alias_path.read_text())
        alias["label"] = "Renamed witness"
        alias_path.write_text(json.dumps(alias))
        self.assertEqual(serve.read_volume_settings_preset(self.store, self.alias, self.schema)["label"], "Renamed witness")
        document = json.loads(self.path.read_text())
        document["preset"]["domControls"]["volume-detail"]["value"] = 0.1
        self.path.write_text(json.dumps(document))
        with self.assertRaisesRegex(ValueError, "content hash mismatch"):
            self.read()

    def test_callers_cannot_mutate_retained_projection(self):
        first = self.read()
        first["preset"]["domControls"]["volume-detail"]["value"] = -5
        first["schemaProjection"]["carriedControls"].append({"id": "wrong"})
        second = self.read()
        self.assertEqual(second["preset"]["domControls"]["volume-detail"]["value"], fixtures["BASE_VALUES"]["volume-detail"])
        self.assertEqual(second["schemaProjection"]["carriedControls"], [])


if __name__ == "__main__":
    unittest.main()
