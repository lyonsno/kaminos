# kaminos-test: python
"""One stale or corrupt saved cockpit layout must not fail the whole layout index.

A layout saved before a control was removed names a control the current schema
does not know; reading that one record fails. The index skips it, says which
record it skipped and why, and lists every readable layout, so the page's
load-time GET /api/volume-cockpit-layouts answers 200 instead of 500.
"""

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import serve


def layout(layout_id, extra_control=None):
    schema = json.loads((ROOT / "volume-settings-preset-schema-v2.json").read_text())
    control_ids = [entry["key"] for entry in [*schema["controls"], *schema["rendererControls"]]]
    if extra_control:
        control_ids.append(extra_control)
    return {
        "identity": "kaminos.volume.cockpit-layout.v1",
        "layoutId": layout_id,
        "label": layout_id.replace("-", " ").title(),
        "groups": [{"id": "primary-controls", "label": "Primary", "surface": "primary", "collapsed": False, "controlIds": control_ids}],
    }


def write_raw(store, source_layout):
    content_hash = f"sha256:{serve._volume_cockpit_layout_hash(source_layout)}"
    artifact = {
        "identity": "kaminos.volume.cockpit-layout-artifact.v1",
        "layoutId": source_layout["layoutId"],
        "contentHash": content_hash,
        "writtenAt": "2026-10-01T00:00:00Z",
        "source": {"kind": "contract"},
        "layout": source_layout,
    }
    (store / "layouts").mkdir(parents=True, exist_ok=True)
    (store / "layouts" / f"{source_layout['layoutId']}.json").write_text(json.dumps(artifact, indent=2) + "\n")
    return content_hash


def main():
    with tempfile.TemporaryDirectory() as temporary:
        store = Path(temporary) / "layouts-store"
        serve.write_volume_cockpit_layout(store, layout("good-layout"), activate=True)
        write_raw(store, layout("stale-layout", extra_control="volume-control-that-no-longer-exists"))
        (store / "layouts" / "corrupt-layout.json").write_text("{not json")

        index = serve.list_volume_cockpit_layouts(store)
        assert [entry["layoutId"] for entry in index["entries"]] == ["good-layout"], index["entries"]
        assert index["activeLayoutId"] == "good-layout"
        skipped = {entry["layoutId"]: entry["error"] for entry in index["skipped"]}
        assert sorted(skipped) == ["corrupt-layout", "stale-layout"], skipped
        assert "unknown controls" in skipped["stale-layout"] and "volume-control-that-no-longer-exists" in skipped["stale-layout"], skipped

        # An active pointer at a record that can no longer be read leaves no
        # active layout instead of failing the index.
        stale_hash = write_raw(store, layout("stale-layout", extra_control="volume-control-that-no-longer-exists"))
        (store / "active.json").write_text(json.dumps({
            "identity": "kaminos.volume.cockpit-layout-active.v1",
            "layoutId": "stale-layout",
            "contentHash": stale_hash,
            "updatedAt": "2026-10-01T00:00:00Z",
        }))
        index = serve.list_volume_cockpit_layouts(store)
        assert index["activeLayoutId"] is None
        assert index["activeLayoutSkipped"]["layoutId"] == "stale-layout"
        assert [entry["layoutId"] for entry in index["entries"]] == ["good-layout"]

        # A pointer at a layout that does not exist at all is still an error.
        (store / "active.json").write_text(json.dumps({
            "identity": "kaminos.volume.cockpit-layout-active.v1",
            "layoutId": "absent-layout",
            "contentHash": stale_hash,
            "updatedAt": "2026-10-01T00:00:00Z",
        }))
        try:
            serve.list_volume_cockpit_layouts(store)
        except ValueError as error:
            assert "missing layout" in str(error)
        else:
            raise AssertionError("an active pointer at an absent layout was accepted")
    print("volume cockpit layout index skips bad records: ok")


if __name__ == "__main__":
    main()
