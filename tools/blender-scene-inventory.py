"""Dump every object in a Blender scene with its visibility and collections.

Diagnostic only. The admitted-surface exporter records what it admitted and what
it skipped, but not what it rejected at classification or why, so a source
object that never reaches export is invisible in its manifest. This closes that
gap without changing admission behaviour.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return parser.parse_args(argv)


def _collection_paths(obj) -> list[str]:
    paths = []
    for collection in obj.users_collection:
        parts, node = [collection.name], collection
        while True:
            parents = [c for c in bpy.data.collections if node.name in [x.name for x in c.children]]
            if not parents:
                break
            node = parents[0]
            parts.insert(0, node.name)
        paths.append("/".join(parts))
    return paths


def main() -> int:
    args = _arguments()
    records = []
    for obj in bpy.context.scene.objects:
        record = {
            "name": obj.name,
            "type": obj.type,
            "collections": _collection_paths(obj),
            "hideViewport": bool(obj.hide_viewport),
            "hideRender": bool(obj.hide_render),
            "visibleGet": bool(obj.visible_get()),
        }
        if obj.type == "MESH":
            record["vertexCount"] = len(obj.data.vertices)
            record["polygonCount"] = len(obj.data.polygons)
        records.append(record)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "source": bpy.data.filepath,
        "blenderVersion": bpy.app.version_string,
        "objectCount": len(records),
        "objects": records,
    }, indent=2), encoding="utf-8")
    print(json.dumps({"status": "completed", "objectCount": len(records)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
