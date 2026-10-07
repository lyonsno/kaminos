"""Capture real source postprocess observations, without importing MLX/models."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import numpy as np


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = args.source_root.resolve()
    commit = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
    if commit != "34a7a570d5d6d8b9c99bbddb1d52bd414600d5c6":
        raise ValueError("exact pinned source required")
    if subprocess.check_output(["git", "-C", str(root), "status", "--porcelain"], text=True).strip():
        raise ValueError("clean observed source required")
    source = root / "trellmlx/texture_bake.py"
    raw = source.read_bytes()
    tree = ast.parse(raw)
    functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ("rasterize_uv", "sample_voxel_attrs")]
    if len(functions) != 2:
        raise ValueError("complete canonical source functions required")
    scope = {"np": np}
    exec(compile(ast.fix_missing_locations(ast.Module(body=functions, type_ignores=[])), str(source), "exec"), scope)
    corners = [[z, y, x] for z in range(2) for y in range(2) for x in range(2)]
    cases = []
    for name, coords, features, positions in [
        ("complete-corners", corners, [[-.8 + i*.2, -.6, .4, -.2, .6, 1] for i in range(8)],
         [[-.125, -.0625, 0], [-.25, -.25, -.25]]),
        ("sparse-renormalization", [[0, 0, 0], [0, 0, 1]], [[-1, 0, 1, -.5, .5, 1], [1, 0, -1, .5, -.5, -1]],
         [[-.25, -.25, 0], [0, -.125, -.0625]]),
        ("nearest-outside-support", [[0, 0, 0], [1, 1, 1]], [[-.9, -.8, -.7, -.6, -.5, -.4], [.9, .8, .7, .6, .5, .4]],
         [[-.9, -.8, -.7], [.9, .8, .7]]),
    ]:
        p, c, f = np.asarray(positions, dtype=np.float32), np.asarray(coords, dtype=np.int32), np.asarray(features, dtype=np.float32)
        attrs = f * np.float32(.5) + np.float32(.5)
        sampled = scope["sample_voxel_attrs"](p, c, attrs, 2)
        cases.append({"name": name, "resolution": 2, "positions": p.ravel().tolist(),
                      "coordinates": c.ravel().tolist(), "features": f.ravel().tolist(),
                      "expected": sampled.ravel().tolist(), "expectedF32Sha256": hashlib.sha256(sampled.tobytes()).hexdigest()})
    uvs = np.asarray([[0, 0], [1, 0], [0, 1], [.25, .25], [.75, .25], [.25, .75]], dtype=np.float32)
    faces = np.asarray([[0, 1, 2], [3, 4, 5]], dtype=np.uint32)
    mask, face_idx, bary = scope["rasterize_uv"](uvs, faces, 4)
    result = {"schema": "trellis2.material-postprocess-source.v1", "source": {"commit": commit, "repo": "TRELLIS2MLX",
              "file": "trellmlx/texture_bake.py", "sha256": hashlib.sha256(raw).hexdigest(),
              "functions": [n.name for n in functions], "numpyVersion": np.__version__, "modelCalls": 0,
              "backend": "isolated unchanged source NumPy/SciPy CPU postprocess"},
              "normalization": "source generate.py decoded attributes * .5 + .5; separate F32 operations",
              "samples": cases, "raster": {"textureSize": 4, "uvs": uvs.ravel().tolist(), "triangles": faces.ravel().tolist(),
              "mask": mask.ravel().tolist(), "faces": face_idx.ravel().tolist(), "bary": bary.ravel().tolist()}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"output": str(args.output), "sourceRoot": str(root), "sourceCommit": commit, "modelCalls": 0,
                      "sampleCases": len(cases), "rasterPixels": int(mask.size)}))


if __name__ == "__main__":
    main()
