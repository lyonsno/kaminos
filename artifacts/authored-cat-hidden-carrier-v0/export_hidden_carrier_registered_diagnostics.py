"""Export registered causal geometry for the authored-cat offset fixture.

The outputs answer two questions that separated beauty meshes cannot:
where the procedural depth support actually lands, and how each corresponding
vertex moves relative to authored truth.
"""

from __future__ import annotations

import argparse
import json
import os
import struct
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from export_hidden_carrier_surfaces import (
    BACKEND,
    SurfaceExportFailure,
    _append_blob,
    _oriented_indices,
    _public_locator,
    _read_json,
    _source_topology,
    _vertex_normals,
    _write_json,
)
from hidden_carrier_fixture import SOURCE_SHA256, _glb_chunks, _sha256, coat_depths, load_glb_surface


SCHEMA = "kaminos.authored-cat-hidden-carrier-registered-diagnostic.v0"
ROUTE = "registered-corresponding-vertex-displacement-v0"
REPORT_NAME = "registered-diagnostic-report.json"
OUTPUT_NAMES = (
    "procedural-support-mask.glb",
    "registered-coat-vectors.glb",
    "registered-recovery-vectors.glb",
)
HONEST_REGION_LABEL = "bounded-dorsal-ap-procedural-support-v0"


def _now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _load_npz_array(path, name, *, count):
    try:
        with np.load(path) as payload:
            if name not in payload.files:
                raise SurfaceExportFailure(f"{Path(path).name} is missing array {name}")
            array = np.asarray(payload[name], dtype=np.float64)
    except SurfaceExportFailure:
        raise
    except Exception as error:
        raise SurfaceExportFailure(f"could not read {Path(path).name}: {error}") from error
    if array.shape != (count, 3) or not np.isfinite(array).all():
        raise SurfaceExportFailure(f"{Path(path).name}:{name} must be finite shape ({count}, 3)")
    return array


def _append_accessor(document, binary, array, *, component_type, accessor_type, target=None):
    packed = np.ascontiguousarray(array)
    offset, byte_length = _append_blob(binary, packed.tobytes(order="C"))
    view = {"buffer": 0, "byteOffset": offset, "byteLength": byte_length}
    if target is not None:
        view["target"] = target
    view_index = len(document["bufferViews"])
    document["bufferViews"].append(view)
    accessor = {
        "bufferView": view_index,
        "componentType": component_type,
        "count": int(len(packed)),
        "type": accessor_type,
    }
    if accessor_type == "VEC3" and component_type == 5126 and len(packed):
        accessor["min"] = [float(value) for value in packed.min(axis=0)]
        accessor["max"] = [float(value) for value in packed.max(axis=0)]
    accessor_index = len(document["accessors"])
    document["accessors"].append(accessor)
    return accessor_index


def _pbr_material(name, color, *, alpha_mode="OPAQUE", vertex_colors=False):
    material = {
        "name": name,
        "doubleSided": True,
        "pbrMetallicRoughness": {
            "baseColorFactor": list(color),
            "metallicFactor": 0.0,
            "roughnessFactor": 0.8,
        },
    }
    if alpha_mode != "OPAQUE":
        material["alphaMode"] = alpha_mode
    if vertex_colors:
        material["extras"] = {"colorAuthority": "COLOR_0 exact procedural-support membership"}
    return material


def _unlit_material(name, color):
    return {
        "name": name,
        "doubleSided": True,
        "extensions": {"KHR_materials_unlit": {}},
        "pbrMetallicRoughness": {
            "baseColorFactor": list(color),
            "metallicFactor": 0.0,
            "roughnessFactor": 1.0,
        },
    }


def _base_document(*, description):
    return {
        "asset": {
            "version": "2.0",
            "generator": "Kaminos registered hidden-carrier diagnostic exporter",
            "extras": {
                "schema": SCHEMA,
                "route": ROUTE,
                "description": description,
                "presentation": "rigid center plus 180-degree Z rotation; no shape change",
            },
        },
        "extensionsUsed": ["KHR_materials_unlit"],
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [
            {
                "name": description,
                "mesh": 0,
                "rotation": [0.0, 0.0, 1.0, 0.0],
            }
        ],
        "meshes": [{"name": description, "primitives": []}],
        "materials": [],
        "accessors": [],
        "bufferViews": [],
        "buffers": [],
    }


def _triangle_accessors(document, binary, positions, normals, triangles, *, colors=None):
    position_accessor = _append_accessor(
        document, binary, np.asarray(positions, dtype="<f4"), component_type=5126, accessor_type="VEC3", target=34962
    )
    normal_accessor = _append_accessor(
        document, binary, np.asarray(normals, dtype="<f4"), component_type=5126, accessor_type="VEC3", target=34962
    )
    index_dtype = np.dtype("<u2") if len(positions) <= 65535 else np.dtype("<u4")
    index_component = 5123 if index_dtype.itemsize == 2 else 5125
    index_accessor = _append_accessor(
        document,
        binary,
        np.asarray(triangles.reshape(-1), dtype=index_dtype),
        component_type=index_component,
        accessor_type="SCALAR",
        target=34963,
    )
    attributes = {"POSITION": position_accessor, "NORMAL": normal_accessor}
    if colors is not None:
        attributes["COLOR_0"] = _append_accessor(
            document,
            binary,
            np.asarray(colors, dtype="<f4"),
            component_type=5126,
            accessor_type="VEC4",
            target=34962,
        )
    return attributes, index_accessor


def _line_positions(starts, ends, selected=None):
    starts = np.asarray(starts, dtype=np.float64)
    ends = np.asarray(ends, dtype=np.float64)
    if selected is not None:
        selected = np.asarray(selected, dtype=bool)
        starts, ends = starts[selected], ends[selected]
    lines = np.empty((len(starts) * 2, 3), dtype=np.float32)
    lines[0::2] = starts
    lines[1::2] = ends
    return lines


def _finish_glb(path, document, binary):
    binary.extend(b"\0" * ((-len(binary)) % 4))
    document["buffers"] = [{"byteLength": len(binary)}]
    json_bytes = json.dumps(document, separators=(",", ":"), sort_keys=True).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    payload_length = 12 + 8 + len(json_bytes) + 8 + len(binary)
    payload = (
        struct.pack("<III", 0x46546C67, 2, payload_length)
        + struct.pack("<II", len(json_bytes), 0x4E4F534A)
        + json_bytes
        + struct.pack("<II", len(binary), 0x004E4942)
        + bytes(binary)
    )
    path = Path(path)
    handle = tempfile.NamedTemporaryFile(mode="w+b", dir=path.parent, prefix=f".{path.name}.", delete=False)
    temporary = Path(handle.name)
    try:
        with handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _write_mask_glb(path, *, carrier, normals, triangles, selected):
    document = _base_document(description="PROCEDURAL SUPPORT MASK — RED IS SELECTED")
    document["extensionsUsed"] = []
    binary = bytearray()
    colors = np.tile(np.array([0.30, 0.42, 0.48, 1.0]), (len(carrier), 1))
    colors[selected] = np.array([1.0, 0.08, 0.02, 1.0])
    attributes, index_accessor = _triangle_accessors(
        document, binary, carrier, normals, triangles, colors=colors
    )
    document["materials"].append(
        _pbr_material("gray unselected / red procedural support", (1.0, 1.0, 1.0, 1.0), vertex_colors=True)
    )
    document["meshes"][0]["primitives"].append(
        {"attributes": attributes, "indices": index_accessor, "material": 0, "mode": 4}
    )
    _finish_glb(path, document, binary)


def _write_vector_glb(
    path,
    *,
    carrier,
    normals,
    triangles,
    line_groups,
    description,
):
    document = _base_document(description=description)
    binary = bytearray()
    attributes, index_accessor = _triangle_accessors(
        document, binary, carrier, normals, triangles
    )
    document["materials"].append(
        _pbr_material("authored carrier x-ray", (0.48, 0.60, 0.66, 0.26), alpha_mode="BLEND")
    )
    document["meshes"][0]["primitives"].append(
        {"attributes": attributes, "indices": index_accessor, "material": 0, "mode": 4}
    )
    for label, color, line_positions in line_groups:
        material_index = len(document["materials"])
        document["materials"].append(_unlit_material(label, color))
        line_accessor = _append_accessor(
            document,
            binary,
            np.asarray(line_positions, dtype="<f4"),
            component_type=5126,
            accessor_type="VEC3",
            target=34962,
        )
        document["meshes"][0]["primitives"].append(
            {"attributes": {"POSITION": line_accessor}, "material": material_index, "mode": 1}
        )
    _finish_glb(path, document, binary)


def _failure_receipt(*, repo_root, source_path, assay_dir, output_dir, expected_report_sha256, reason):
    return {
        "schema": SCHEMA,
        "status": "failed",
        "terminal": True,
        "failurePhase": "input-validation",
        "reason": str(reason),
        "route": {"requested": ROUTE, "effective": None, "backend": BACKEND},
        "requestedInputs": {
            "repoRoot": ".",
            "sourcePath": _public_locator(source_path, repo_root),
            "assayDir": _public_locator(assay_dir, repo_root),
            "outputDir": _public_locator(output_dir, repo_root),
            "expectedReportSha256": expected_report_sha256,
        },
        "visualArtifactsValidated": False,
        "operatorVisualAdmission": "not-requested",
        "completedAt": _now(),
    }


def export_registered_diagnostics(
    *, repo_root, source_path, assay_dir, output_dir, expected_report_sha256
):
    repo_root = Path(repo_root).resolve()
    source_path = Path(source_path).resolve()
    assay_dir = Path(assay_dir).resolve()
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    for name in (*OUTPUT_NAMES, REPORT_NAME, "README.md"):
        (output_dir / name).unlink(missing_ok=True)

    try:
        report_path = assay_dir / "report.json"
        report_sha256 = _sha256(report_path)
        if report_sha256 != expected_report_sha256:
            raise SurfaceExportFailure(
                f"report digest mismatch: expected {expected_report_sha256}, observed {report_sha256}"
            )
        report = _read_json(report_path)
        if report.get("status") != "captured":
            raise SurfaceExportFailure("assay report is not captured evidence")
        if _sha256(source_path) != SOURCE_SHA256 or report.get("source", {}).get("sha256") != SOURCE_SHA256:
            raise SurfaceExportFailure("authenticated source digest mismatch")

        observation_path = assay_dir / report["artifacts"]["observation"]["path"]
        recovery_path = assay_dir / report["artifacts"]["recoveredCarrier"]["path"]
        if _sha256(observation_path) != report["artifacts"]["observation"]["sha256"]:
            raise SurfaceExportFailure("observation digest mismatch")
        if _sha256(recovery_path) != report["artifacts"]["recoveredCarrier"]["sha256"]:
            raise SurfaceExportFailure("recovered carrier digest mismatch")

        source = load_glb_surface(source_path)
        carrier_world = source["positions"]
        reference_normals = source["normals"]
        count = len(carrier_world)
        observed_world = _load_npz_array(observation_path, "observedPositions", count=count)
        recovered_world = _load_npz_array(recovery_path, "positions", count=count)
        triangles = _source_topology(source_path, expected_vertex_count=count)
        triangles, winding_flipped = _oriented_indices(triangles, carrier_world, reference_normals)

        short_depths = coat_depths(carrier_world, "short-v0")
        full_depths = coat_depths(carrier_world, "short-with-medium-scapular-v0")
        bump = full_depths - short_depths
        selected = bump > np.finfo(np.float64).eps * 32.0
        signed_recovery = np.einsum(
            "ij,ij->i", recovered_world - carrier_world, reference_normals
        )
        outward = signed_recovery > 0.0
        inward = signed_recovery < 0.0
        zero = ~(outward | inward)

        center = (carrier_world.min(axis=0) + carrier_world.max(axis=0)) * 0.5
        carrier = carrier_world - center
        observed = observed_world - center
        recovered = recovered_world - center
        normals = _vertex_normals(carrier_world, triangles, reference_normals)

        _write_mask_glb(
            output_dir / OUTPUT_NAMES[0],
            carrier=carrier,
            normals=normals,
            triangles=triangles,
            selected=selected,
        )
        _write_vector_glb(
            output_dir / OUTPUT_NAMES[1],
            carrier=carrier,
            normals=normals,
            triangles=triangles,
            line_groups=[
                (
                    "truth-to-coat exact outward vectors",
                    (1.0, 0.42, 0.02, 1.0),
                    _line_positions(carrier, observed),
                )
            ],
            description="REGISTERED TRUTH-TO-COAT VECTORS — EXACT LENGTH",
        )
        _write_vector_glb(
            output_dir / OUTPUT_NAMES[2],
            carrier=carrier,
            normals=normals,
            triangles=triangles,
            line_groups=[
                (
                    "recovery remains outward of truth",
                    (1.0, 0.05, 0.55, 1.0),
                    _line_positions(carrier, recovered, outward),
                ),
                (
                    "recovery passes inward of truth",
                    (0.05, 0.85, 1.0, 1.0),
                    _line_positions(carrier, recovered, inward),
                ),
            ],
            description="REGISTERED RECOVERY RESIDUALS — MAGENTA OUTWARD / CYAN INWARD",
        )

        unit = (carrier_world - carrier_world.min(axis=0)) / (
            carrier_world.max(axis=0) - carrier_world.min(axis=0)
        )
        artifacts = {}
        for name in OUTPUT_NAMES:
            path = output_dir / name
            document, _ = _glb_chunks(path)
            if path.stat().st_size <= 10_000 or not document.get("meshes"):
                raise SurfaceExportFailure(f"registered diagnostic validation failed: {name}")
            artifacts[Path(name).stem] = {
                "path": name,
                "sha256": _sha256(path),
                "byteLength": path.stat().st_size,
            }

        selected_unit = unit[selected]
        receipt = {
            "schema": SCHEMA,
            "status": "captured",
            "terminal": True,
            "route": {"requested": ROUTE, "effective": ROUTE, "backend": BACKEND},
            "inputs": {
                "repoRoot": ".",
                "sourcePath": _public_locator(source_path, repo_root),
                "sourceSha256": SOURCE_SHA256,
                "assayDir": _public_locator(assay_dir, repo_root),
                "reportSha256": report_sha256,
                "observationSha256": _sha256(observation_path),
                "recoveredCarrierSha256": _sha256(recovery_path),
            },
            "region": {
                "fixtureProfileId": "short-with-medium-scapular-v0",
                "honestLabel": HONEST_REGION_LABEL,
                "anatomicalInterpretation": "unverified",
                "selectionRule": "normalized AP z in [0.45,0.85] and normalized dorsal support 1-y >= 0.45; positive sinusoidal bump only",
                "selectedVertexCount": int(np.count_nonzero(selected)),
                "selectedFraction": float(np.mean(selected)),
                "selectedNormalizedBoundsMin": [float(value) for value in selected_unit.min(axis=0)],
                "selectedNormalizedBoundsMax": [float(value) for value in selected_unit.max(axis=0)],
                "bumpDepthMin": float(bump[selected].min()),
                "bumpDepthMedian": float(np.median(bump[selected])),
                "bumpDepthMax": float(bump[selected].max()),
            },
            "coatVectors": {
                "count": count,
                "minimumLength": float(full_depths.min()),
                "medianLength": float(np.median(full_depths)),
                "maximumLength": float(full_depths.max()),
            },
            "recoveryVectors": {
                "outwardCount": int(np.count_nonzero(outward)),
                "inwardCount": int(np.count_nonzero(inward)),
                "zeroCount": int(np.count_nonzero(zero)),
                "signedMinimum": float(signed_recovery.min()),
                "signedMedian": float(np.median(signed_recovery)),
                "signedMaximum": float(signed_recovery.max()),
                "windingFlippedOnWorldSpaceExport": winding_flipped,
            },
            "presentationTransform": {
                "contract": "rigid-translation-and-rotation-only-no-shape-change",
                "sourceWorldCenter": [float(value) for value in center],
                "exportTranslation": [float(value) for value in -center],
                "viewerRotationQuaternion": [0.0, 0.0, 1.0, 0.0],
            },
            "artifacts": artifacts,
            "visualArtifactsValidated": True,
            "operatorVisualAdmission": "not-requested",
            "claimCeiling": (
                "Exact procedural support membership and corresponding-vertex displacement vectors "
                "under the authored fixture. No anatomical shoulder/scapular interpretation is established."
            ),
            "safetyCharacterization": (
                "Deterministic isolated faceted cat geometry and diagnostic lines only; no generator or TRELLIS output."
            ),
            "completedAt": _now(),
        }
        _write_json(output_dir / REPORT_NAME, receipt)
        (output_dir / "README.md").write_text(
            "# Registered hidden-carrier diagnostics\n\n"
            "These GLBs replace the rejected separated beauty comparison with causal geometry in one "
            "coordinate frame. The support-mask surface colors the exact procedural selection red. "
            "The coat-vector file draws exact truth-to-observation segments. The recovery-vector file "
            "draws exact truth-to-recovery residuals: magenta remains outward and cyan passes inward.\n\n"
            "The fixture profile name `short-with-medium-scapular-v0` is not anatomical evidence. Its "
            "honest current label is `bounded-dorsal-ap-procedural-support-v0`.\n"
        )
        return receipt
    except Exception as error:
        for name in (*OUTPUT_NAMES, "README.md"):
            (output_dir / name).unlink(missing_ok=True)
        receipt = _failure_receipt(
            repo_root=repo_root,
            source_path=source_path,
            assay_dir=assay_dir,
            output_dir=output_dir,
            expected_report_sha256=expected_report_sha256,
            reason=error,
        )
        _write_json(output_dir / REPORT_NAME, receipt)
        return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--assay-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--expected-report-sha256", required=True)
    args = parser.parse_args(argv)
    receipt = export_registered_diagnostics(
        repo_root=args.repo_root,
        source_path=args.source,
        assay_dir=args.assay_dir,
        output_dir=args.output_dir,
        expected_report_sha256=args.expected_report_sha256,
    )
    print(json.dumps(receipt, indent=2, sort_keys=True))
    return 0 if receipt["status"] == "captured" else 1


if __name__ == "__main__":
    raise SystemExit(main())
