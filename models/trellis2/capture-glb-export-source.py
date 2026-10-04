"""Capture the effective pinned source GLB export, without importing any model."""
import argparse
import ast
import hashlib
import io
import json
from pathlib import Path
import struct
import subprocess
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source-root", type=Path, required=True)
parser.add_argument("--expected-source-commit", required=True)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--report", type=Path, required=True)
args = parser.parse_args()
report = {"status": "running", "phase": "package-import", "modelCalls": 0,
          "requestedSourceCommit": args.expected_source_commit, "output": str(args.output)}

def publish():
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")

def failed(kind, error, trace):
    report.update(status="failed", error={"name": kind.__name__, "message": str(error)})
    publish()
    sys.__excepthook__(kind, error, trace)

sys.excepthook = failed
publish()
import numpy as np
from PIL import Image
import trimesh
from trimesh.visual.material import PBRMaterial

report.update(phase="source-admission", trimeshVersion=trimesh.__version__)
publish()
commit = subprocess.check_output(["git", "-C", str(args.source_root), "rev-parse", "HEAD"], text=True).strip()
report["effectiveSourceCommit"] = commit
if commit != args.expected_source_commit or subprocess.check_output(
    ["git", "-C", str(args.source_root), "status", "--porcelain"], text=True
).strip():
    raise RuntimeError("exact clean source revision required")
source = (args.source_root / "generate.py").read_bytes()
tree = ast.parse(source)
report.update(phase="source-export", sourceSha256=hashlib.sha256(source).hexdigest())
publish()

def assigns(node, name):
    return isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets)

# Execute the actual fresh-export statements through textured_mesh construction;
# omit its file output, logging and checkpoint side effects. No MLX import.
blocks = [n for n in ast.walk(tree) if isinstance(n, ast.If)
          and any(assigns(s, "export_verts") for s in n.body)
          and any(assigns(s, "textured_mesh") for s in n.body)]
block = max(blocks, key=lambda n: n.lineno)
end = next(i for i, n in enumerate(block.body) if assigns(n, "textured_mesh"))
vertices = np.array([[.1, .2, .3], [.4, .7, .2], [-.2, .1, .9]], dtype=np.float32)
faces = np.array([[0, 1, 2]], dtype=np.int32)
uvs = np.array([[.125, .25], [.75, .25], [.125, .875]], dtype=np.float32)
pixels = np.array([[[255, 0, 0, 255], [0, 255, 0, 255]],
                   [[0, 0, 255, 255], [255, 255, 0, 255]]], dtype=np.uint8)
scope = dict(np=np, trimesh=trimesh, Image=Image, PBRMaterial=PBRMaterial,
             uv_verts=vertices, uv_faces=faces, uvs=uvs, base_color=pixels,
             metallic_roughness=pixels, alpha_mode="OPAQUE")
exec(compile(ast.Module(body=block.body[:end + 1], type_ignores=[]), "generate.py", "exec"), scope)
glb = scope["textured_mesh"].export(file_type="glb")
json_length = struct.unpack_from("<I", glb, 12)[0]
document = json.loads(glb[20:20 + json_length])
binary_start = 28 + json_length
expected = {}
for name, index in document["meshes"][0]["primitives"][0]["attributes"].items():
    accessor = document["accessors"][index]
    view = document["bufferViews"][accessor["bufferView"]]
    width = {"VEC2": 2, "VEC3": 3}[accessor["type"]]
    expected[name] = np.frombuffer(glb, dtype="<f4", count=accessor["count"] * width,
        offset=binary_start + view.get("byteOffset", 0) + accessor.get("byteOffset", 0)).reshape(-1, width).tolist()
view = document["bufferViews"][document["images"][0]["bufferView"]]
png = glb[binary_start + view.get("byteOffset", 0):binary_start + view.get("byteOffset", 0) + view["byteLength"]]
expected["baseColorPixels"] = np.array(Image.open(io.BytesIO(png)).convert("RGBA")).tolist()
result = {"source": {"repo": "trellis2mlx", "commit": commit, "file": "generate.py",
    "sha256": hashlib.sha256(source).hexdigest(), "firstLine": block.body[0].lineno,
    "lastLine": block.body[end].end_lineno, "modelCalls": 0,
    "route": "actual fresh-export AST plus trimesh GLB exporter", "trimeshVersion": trimesh.__version__,
    "numpyVersion": np.__version__, "glbSha256": hashlib.sha256(glb).hexdigest()},
    "input": {"vertices": vertices.tolist(), "triangles": faces.tolist(), "uvs": uvs.tolist(), "pixels": pixels.tolist()},
    "expected": expected}
args.output.parent.mkdir(parents=True, exist_ok=True)
report["phase"] = "fixture-write"
publish()
args.output.write_text(json.dumps(result, indent=2) + "\n")
report.update(status="succeeded", phase=None, fixtureSha256=hashlib.sha256(args.output.read_bytes()).hexdigest())
publish()
print(json.dumps({"output": str(args.output), "source": result["source"]}))
