import argparse
import hashlib
import importlib.metadata
import json
import pathlib
import time

parser = argparse.ArgumentParser()
parser.add_argument("source")
parser.add_argument("output")
parser.add_argument("--edge-length", type=float, default=0.12)
parser.add_argument("--envelope", type=float, default=0.0001)
args = parser.parse_args()
output = pathlib.Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
report = {"status": "running", "phase": "input", "source": str(pathlib.Path(args.source).resolve()), "output": str(output.resolve()), "requested": vars(args)}

def save():
    output.write_text(json.dumps(report, indent=2))

save()
try:
    import numpy as np
    import wildmeshing as wm

    source_bytes = pathlib.Path(args.source).read_bytes()
    source = json.loads(source_bytes)
    if source.get("status") != "passed" or source.get("route") != "imported-whole-solid-manifold-3.5.4":
        raise ValueError("Positive admitted imported solid required")
    vertices = np.asarray(source["vertices"], dtype=np.float64)
    faces = np.asarray(source["triangles"], dtype=np.int32)
    if vertices.ndim != 2 or vertices.shape[1] != 3 or not np.isfinite(vertices).all():
        raise ValueError("Finite source vertices required")
    if faces.ndim != 2 or faces.shape[1] != 3 or faces.min() < 0 or faces.max() >= len(vertices):
        raise ValueError("Valid source triangles required")
    diagonal = float(np.linalg.norm(np.ptp(vertices, axis=0)))
    if not (np.isfinite(args.edge_length) and args.edge_length > 0 and np.isfinite(args.envelope) and args.envelope > 0 and diagonal > 0):
        raise ValueError("Positive edge length, envelope and source extent required")
    version = importlib.metadata.version("wildmeshing")
    if version != "0.4.1":
        raise ValueError(f"Unexpected mesher version: {version}")
    report.update(sourceSha256=source["sourceSha256"], inputSha256=hashlib.sha256(source_bytes).hexdigest(), route="ftetwild-cpu-wildmeshing-0.4.1", version=version,
                  effective={"epsilon_relative": args.envelope, "edge_length_relative": args.edge_length / diagonal, "stop_quality": 10, "max_its": 80, "max_threads": 0, "coarsen": True, "use_input_for_wn": True}, phase="meshing")
    save()
    start = time.perf_counter()
    mesher = wm.Tetrahedralizer(epsilon=args.envelope, edge_length_r=args.edge_length / diagonal)
    mesher.set_mesh(vertices, faces)
    mesher.tetrahedralize()
    positions, tetrahedra = mesher.get_tet_mesh(use_input_for_wn=True)
    positions = np.asarray(positions, dtype=np.float64)
    tetrahedra = np.asarray(tetrahedra, dtype=np.int64)
    report["meshingSeconds"] = time.perf_counter() - start
    report["phase"] = "admission"
    if positions.ndim != 2 or positions.shape[1] != 3 or not np.isfinite(positions).all() or tetrahedra.ndim != 2 or tetrahedra.shape[1] != 4 or not len(tetrahedra):
        raise ValueError("Incomplete mesher output")
    if tetrahedra.min() < 0 or tetrahedra.max() >= len(positions):
        raise ValueError("Mesher indices out of range")
    corners = positions[tetrahedra]
    matrices = np.stack([corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0], corners[:, 3] - corners[:, 0]], axis=2)
    volumes = np.abs(np.linalg.det(matrices)) / 6
    if not np.isfinite(volumes).all() or (volumes <= 0).any():
        raise ValueError("Degenerate material tetrahedra")
    total = float(volumes.sum())
    relative_error = abs(total - source["volume"]) / source["volume"]
    report.update(volume=total, admittedSourceVolume=source["volume"], relativeVolumeError=relative_error, minimumTetVolume=float(volumes.min()),
                  positions=positions.tolist(), tetrahedra=tetrahedra.tolist(), tetVolumes=volumes.tolist())
    if relative_error > 0.01:
        raise ValueError("Mesher volume differs from admitted solid by over one percent; do not substitute this interior")
    report.update(status="passed", phase="complete", claim="Provisional exterior-derived tetrahedral sampling within recorded envelope; no elastic/fracture claim")
except Exception as error:
    report.update(status="failed", failure={"type": type(error).__name__, "message": str(error)})
    raise
finally:
    save()
