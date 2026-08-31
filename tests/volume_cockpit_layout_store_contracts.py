#!/usr/bin/env python3

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import serve


def sample_layout():
    schema = json.loads((ROOT / "volume-settings-preset-schema-v2.json").read_text())
    control_ids = [entry["key"] for entry in [*schema["controls"], *schema["rendererControls"]]]
    return {
        "identity": "kaminos.volume.cockpit-layout.v1",
        "layoutId": "operator-layout",
        "label": "Operator Layout",
        "groups": [{
            "id": "primary-controls",
            "label": "Primary Controls",
            "surface": "primary",
            "collapsed": False,
            "controlIds": control_ids,
        }],
    }


def main():
    for name in (
        "write_volume_cockpit_layout",
        "read_volume_cockpit_layout",
        "list_volume_cockpit_layouts",
    ):
        assert callable(getattr(serve, name, None)), f"volume cockpit layout store API is missing: {name}"

    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        layout_store = root / "layouts"
        parsed = serve.parse_server_arguments([
            "18420",
            "--volume-settings-store", str(root / "settings"),
            "--volume-basin-session-store", str(root / "sessions"),
            "--volume-cockpit-layout-store", str(layout_store),
        ])
        assert len(parsed) == 4
        port, _, _, effective_layout_store = parsed
        assert port == 18420
        assert effective_layout_store == layout_store.resolve()

        first = serve.write_volume_cockpit_layout(layout_store, sample_layout(), activate=True)
        assert first["identity"] == "kaminos.volume.cockpit-layout-write-receipt.v1"
        assert first["requested"]["layoutId"] == "operator-layout"
        assert first["effective"]["storePath"] == str(layout_store.resolve())
        assert first["effective"]["layoutPath"].startswith(str(layout_store.resolve()))
        assert first["effective"]["contentHash"].startswith("sha256:")

        loaded = serve.read_volume_cockpit_layout(layout_store, "operator-layout")
        assert loaded["layout"] == sample_layout()
        index = serve.list_volume_cockpit_layouts(layout_store)
        assert index["activeLayoutId"] == "operator-layout"
        assert [entry["layoutId"] for entry in index["entries"]] == ["operator-layout"]

        changed = sample_layout()
        changed["label"] = "Operator Layout Renamed"
        second = serve.write_volume_cockpit_layout(layout_store, changed, activate=True)
        assert second["effective"]["layoutId"] == "operator-layout"
        assert serve.read_volume_cockpit_layout(layout_store, "operator-layout")["layout"]["label"] == changed["label"]

        bad = sample_layout()
        bad["groups"][0]["controlIds"].append("volume-not-in-schema")
        try:
            serve.write_volume_cockpit_layout(layout_store, bad, activate=True)
        except ValueError as error:
            assert "unknown" in str(error).lower()
        else:
            raise AssertionError("layout store accepted an unknown canonical control")

    print("volume cockpit layout store contracts passed")


if __name__ == "__main__":
    main()
