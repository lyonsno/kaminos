"""Enumerate a bauplan .blend's objects without modifying it.

Read-only census so exclusion decisions are made against the actual object set
rather than against a guess. Reports name, collection path, visibility, material
names, vertex count, and world-space bounds/centroid for every mesh, so
off-skeleton strays are identifiable by position as well as by name.

Never saves. Re-hashes the source afterwards and fails loud on any change.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

import bpy
from mathutils import Vector

SCHEMA = "kaminos.bauplan-inventory.v0"


def _sha256(path: str | Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _collection_paths(obj: bpy.types.Object) -> list[str]:
    return sorted(c.name for c in obj.users_collection)


def _arguments() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--expected-source-sha256", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--failure", required=True)
    return parser.parse_args(argv)


def main() -> int:
    args = _arguments()
    phase = "source-verify"
    Path(args.failure).unlink(missing_ok=True)
    try:
        source = Path(args.source)
        before = _sha256(source)
        if before != args.expected_source_sha256:
            raise ValueError(f"source identity mismatch: expected {args.expected_source_sha256}, found {before}")

        phase = "open"
        bpy.ops.wm.open_mainfile(filepath=str(source))
        scene = bpy.context.scene

        phase = "census"
        rows: list[dict[str, Any]] = []
        for obj in scene.objects:
            row: dict[str, Any] = {
                "name": obj.name,
                "type": obj.type,
                "visible": bool(obj.visible_get()),
                "hideViewport": bool(obj.hide_viewport),
                "hideRender": bool(obj.hide_render),
                "collections": _collection_paths(obj),
                "parent": obj.parent.name if obj.parent else None,
            }
            if obj.type == "MESH":
                row["vertexCount"] = len(obj.data.vertices)
                row["materials"] = sorted({m.name for m in obj.data.materials if m})
                # WORKBENCH renders MATERIAL colour, which for un-materialed
                # objects falls back to the object's viewport display colour.
                # That is what actually distinguishes red muscle from grey bone
                # in the operator's own renders, so it is the honest role signal
                # here — names and collections carry no role information.
                row["displayColor"] = [round(c, 3) for c in obj.color]
                pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
                lo = [min(p[i] for p in pts) for i in range(3)]
                hi = [max(p[i] for p in pts) for i in range(3)]
                row["boundsMin"] = [round(v, 3) for v in lo]
                row["boundsMax"] = [round(v, 3) for v in hi]
                row["centroid"] = [round((lo[i] + hi[i]) / 2, 3) for i in range(3)]
            rows.append(row)

        phase = "non-mutation-verify"
        after = _sha256(source)
        if after != before:
            raise ValueError(f"SOURCE MUTATED during inventory: {before} -> {after}")

        phase = "write"
        payload = {
            "schema": SCHEMA,
            "source": {"path": str(source), "sha256Before": before, "sha256After": after, "mutated": False},
            "blenderVersion": bpy.app.version_string,
            "sceneName": scene.name,
            "collectionNames": sorted(c.name for c in bpy.data.collections),
            "objectCount": len(rows),
            "meshCount": sum(1 for r in rows if r["type"] == "MESH"),
            "visibleMeshCount": sum(1 for r in rows if r["type"] == "MESH" and r["visible"]),
            "objects": rows,
        }
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"status": "complete", "objects": len(rows)}))
        return 0
    except Exception as exc:  # noqa: BLE001
        Path(args.failure).parent.mkdir(parents=True, exist_ok=True)
        Path(args.failure).write_text(
            json.dumps({"schema": SCHEMA, "status": "failed", "failurePhase": phase, "message": str(exc)}, indent=2) + "\n",
            encoding="utf-8",
        )
        print(json.dumps({"status": "failed", "failurePhase": phase, "message": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
