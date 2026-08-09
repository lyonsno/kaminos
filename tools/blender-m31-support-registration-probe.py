"""Export authenticated M31 support geometry for cross-frame registration."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy


SUPPORT_NAMES = ("Cube.002", "Cube.003")
EXPECTED_SOURCE_SHA256 = "a6a4650f0114f7bb56ffcc6a336b6fd6f2db756e3a137857d92ff6571f9568e3"


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return parser.parse_args(argv)


def _matrix_rows(matrix) -> list[list[float]]:
    return [[float(value) for value in row] for row in matrix]


def main() -> int:
    args = _arguments()
    source = Path(bpy.data.filepath).resolve()
    actual_sha256 = hashlib.sha256(source.read_bytes()).hexdigest()
    if actual_sha256 != EXPECTED_SOURCE_SHA256:
        raise RuntimeError(
            f"source blend identity mismatch: {actual_sha256} != {EXPECTED_SOURCE_SHA256}"
        )

    supports = []
    for name in SUPPORT_NAMES:
        obj = bpy.data.objects.get(name)
        if obj is None or obj.type != "MESH":
            raise RuntimeError(f"required mesh support {name} is missing")
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
        try:
            positions = []
            for vertex in mesh.vertices:
                point = evaluated.matrix_world @ vertex.co
                positions.extend(float(value) for value in point)
            supports.append(
                {
                    "name": name,
                    "matrixWorld": _matrix_rows(evaluated.matrix_world),
                    "objectOriginWorld": [float(value) for value in evaluated.matrix_world.translation],
                    "positionsWorld": positions,
                    "vertexCount": len(mesh.vertices),
                }
            )
        finally:
            evaluated.to_mesh_clear()

    output = {
        "schema": "kaminos.m31-support-registration-probe.v0",
        "source": str(source),
        "sourceSha256": actual_sha256,
        "blenderVersion": bpy.app.version_string,
        "supports": supports,
    }
    output_path = Path(args.out)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")
    print(
        json.dumps(
            {
                "status": "completed",
                "sourceSha256": actual_sha256,
                "supports": [
                    {"name": support["name"], "vertexCount": support["vertexCount"]}
                    for support in supports
                ],
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
