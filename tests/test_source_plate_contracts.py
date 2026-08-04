from __future__ import annotations

import copy
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import re
import sys
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from source_plate_core import (  # noqa: E402
    SCHEMA_ID,
    SourcePlateContractError,
    descriptor_sha256,
    read_descriptor,
    require_effective_renderer,
    validate_complete_outputs,
    verify_source_freshness,
    write_descriptor,
)


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


@contextmanager
def _raises(error_type: type[BaseException], *, match: str):
    try:
        yield None
    except error_type as error:
        assert re.search(match, str(error)), f"{error!r} did not match {match!r}"
        yield_value = error
    else:
        raise AssertionError(f"expected {error_type.__name__} matching {match!r}")
    _raises.last_error = yield_value


_raises.last_error = None


def _descriptor(source: Path, *, plate_name: str = "cat-ecorche-right-sagittal-raw-v0") -> dict:
    source_bytes = source.read_bytes()
    return {
        "schema": SCHEMA_ID,
        "plate": {"name": plate_name, "label": "Right sagittal raw ecorche"},
        "source": {
            "kind": "blend",
            "requestedPath": str(source),
            "expectedSha256": _sha256_bytes(source_bytes),
            "loadPolicy": "read_only",
            "selection": {
                "collections": ["Constructional Model"],
                "objects": ["Raw Ecorche"],
            },
        },
        "camera": {
            "projection": "orthographic",
            "location": [4.0, 0.0, 0.0],
            "quaternion": [0.70710678, 0.0, 0.70710678, 0.0],
            "target": [0.0, 0.0, 0.0],
            "clipStart": 0.01,
            "clipEnd": 100.0,
            "orthoScale": 4.0,
            "framing": {"mode": "manual", "renderAspect": 1.0},
        },
        "render": {
            "width": 64,
            "height": 64,
            "requestedRenderer": "BLENDER_EEVEE_NEXT",
            "fallbackPolicy": "forbid",
        },
        "lighting": {
            "preset": "restrained-studio",
            "lights": [
                {
                    "name": "key",
                    "type": "AREA",
                    "energy": 500.0,
                    "rotation": [0.4, 0.0, -0.7],
                }
            ],
        },
        "presentation": {
            "materialMode": "object_color",
            "floor": {"enabled": True},
            "shadow": {"enabled": True},
            "background": {"mode": "color", "color": [0.02, 0.02, 0.025, 1.0]},
        },
        "channels": [
            {"name": "rgb", "encoding": "png"},
            {"name": "silhouette", "encoding": "png"},
            {"name": "depth", "encoding": "openexr"},
            {"name": "normal", "encoding": "openexr"},
        ],
    }


def _output_records(root: Path, descriptor: dict) -> dict[str, dict]:
    identity = descriptor_sha256(descriptor)
    records: dict[str, dict] = {}
    for channel in descriptor["channels"]:
        name = channel["name"]
        path = root / f"{name}.{'png' if channel['encoding'] == 'png' else 'exr'}"
        payload = f"fixture-{name}".encode()
        path.write_bytes(payload)
        records[name] = {
            "status": "complete",
            "path": str(path),
            "encoding": channel["encoding"],
            "width": descriptor["render"]["width"],
            "height": descriptor["render"]["height"],
            "byteLength": len(payload),
            "sha256": _sha256_bytes(payload),
            "descriptorSha256": identity,
        }
    return records


def test_descriptor_identity_is_canonical_and_binds_authored_state():
    with TemporaryDirectory() as tmp:
        source = Path(tmp) / "source.blend"
        source.write_bytes(b"operator-authored-source")
        descriptor = _descriptor(source)
        reordered = json.loads(json.dumps(descriptor, sort_keys=True))

        identity = descriptor_sha256(descriptor)

        assert identity == descriptor_sha256(reordered)
        with_embedded_identity = copy.deepcopy(descriptor)
        with_embedded_identity["plate"]["descriptorSha256"] = identity
        assert descriptor_sha256(with_embedded_identity) == identity
        changed_camera = copy.deepcopy(descriptor)
        changed_camera["camera"]["orthoScale"] = 4.25
        assert descriptor_sha256(changed_camera) != identity


def test_caller_addressed_sibling_descriptors_do_not_stomp_each_other():
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        source = root / "source.blend"
        source.write_bytes(b"operator-authored-source")
        right_path = root / "plates" / "right-sagittal.json"
        rear_path = root / "plates" / "rear-three-quarter.json"
        right = _descriptor(source, plate_name="right-sagittal")
        rear = _descriptor(source, plate_name="rear-three-quarter")

        write_descriptor(right_path, right)
        write_descriptor(rear_path, rear)
        rear_bytes = rear_path.read_bytes()
        right["camera"]["orthoScale"] = 3.5
        write_descriptor(right_path, right)

        assert rear_path.read_bytes() == rear_bytes
        assert read_descriptor(rear_path)["plate"]["name"] == "rear-three-quarter"
        assert read_descriptor(right_path)["camera"]["orthoScale"] == 3.5


def test_source_freshness_binds_requested_path_and_bytes():
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        source = root / "source.blend"
        source.write_bytes(b"operator-authored-source")
        descriptor = _descriptor(source)

        receipt = verify_source_freshness(descriptor, source)

        assert receipt["status"] == "fresh"
        assert receipt["effectiveSha256"] == descriptor["source"]["expectedSha256"]
        duplicate = root / "stale-selection.blend"
        duplicate.write_bytes(source.read_bytes())
        with _raises(SourcePlateContractError, match="effective source path"):
            verify_source_freshness(descriptor, duplicate)
        assert _raises.last_error.phase == "source-freshness"
        source.write_bytes(b"mutated-source")
        with _raises(SourcePlateContractError, match="SHA-256"):
            verify_source_freshness(descriptor, source)
        assert _raises.last_error.phase == "source-freshness"


def test_renderer_fallback_is_rejected():
    with TemporaryDirectory() as tmp:
        source = Path(tmp) / "source.blend"
        source.write_bytes(b"operator-authored-source")
        descriptor = _descriptor(source)

        receipt = require_effective_renderer(descriptor, "BLENDER_EEVEE_NEXT")

        assert receipt == {
            "requestedRenderer": "BLENDER_EEVEE_NEXT",
            "effectiveRenderer": "BLENDER_EEVEE_NEXT",
            "fallbackPolicy": "forbid",
        }
        with _raises(SourcePlateContractError, match="fallback"):
            require_effective_renderer(descriptor, "BLENDER_WORKBENCH")
        assert _raises.last_error.phase == "renderer-identity"


def test_partial_output_set_cannot_complete():
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        source = root / "source.blend"
        source.write_bytes(b"operator-authored-source")
        descriptor = _descriptor(source)
        outputs = _output_records(root, descriptor)
        outputs.pop("normal")

        with _raises(SourcePlateContractError, match="missing requested channels"):
            validate_complete_outputs(descriptor, outputs)
        assert _raises.last_error.phase == "output-validation"


def test_zero_byte_or_cross_descriptor_output_cannot_complete():
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        source = root / "source.blend"
        source.write_bytes(b"operator-authored-source")
        descriptor = _descriptor(source)
        outputs = _output_records(root, descriptor)
        Path(outputs["depth"]["path"]).write_bytes(b"")

        with _raises(SourcePlateContractError, match="zero-byte"):
            validate_complete_outputs(descriptor, outputs)

        outputs = _output_records(root, descriptor)
        outputs["normal"]["descriptorSha256"] = "0" * 64
        with _raises(SourcePlateContractError, match="another descriptor"):
            validate_complete_outputs(descriptor, outputs)


def test_one_artifact_cannot_impersonate_a_complete_channel_set():
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        source = root / "source.blend"
        source.write_bytes(b"operator-authored-source")
        descriptor = _descriptor(source)
        outputs = _output_records(root, descriptor)
        rgb = outputs["rgb"]
        for record in outputs.values():
            record["path"] = rgb["path"]
            record["byteLength"] = rgb["byteLength"]
            record["sha256"] = rgb["sha256"]

        with _raises(SourcePlateContractError, match="share one artifact"):
            validate_complete_outputs(descriptor, outputs)


def test_missing_dimensions_metadata_cannot_complete():
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        source = root / "source.blend"
        source.write_bytes(b"operator-authored-source")
        descriptor = _descriptor(source)
        outputs = _output_records(root, descriptor)
        descriptor["render"].pop("width")
        descriptor["render"].pop("height")
        missing_dimensions_identity = descriptor_sha256(descriptor)
        for record in outputs.values():
            record.pop("width")
            record.pop("height")
            record["descriptorSha256"] = missing_dimensions_identity

        with _raises(SourcePlateContractError, match="positive integer dimensions"):
            validate_complete_outputs(descriptor, outputs)


def test_complete_output_set_returns_identity_bound_receipt():
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        source = root / "source.blend"
        source.write_bytes(b"operator-authored-source")
        descriptor = _descriptor(source)
        outputs = _output_records(root, descriptor)

        receipt = validate_complete_outputs(descriptor, outputs)

        assert receipt["status"] == "complete"
        assert receipt["descriptorSha256"] == descriptor_sha256(descriptor)
        assert [item["channel"] for item in receipt["outputs"]] == [
            "rgb",
            "silhouette",
            "depth",
            "normal",
        ]


if __name__ == "__main__":
    test_descriptor_identity_is_canonical_and_binds_authored_state()
    test_caller_addressed_sibling_descriptors_do_not_stomp_each_other()
    test_source_freshness_binds_requested_path_and_bytes()
    test_renderer_fallback_is_rejected()
    test_partial_output_set_cannot_complete()
    test_zero_byte_or_cross_descriptor_output_cannot_complete()
    test_one_artifact_cannot_impersonate_a_complete_channel_set()
    test_missing_dimensions_metadata_cannot_complete()
    test_complete_output_set_returns_identity_bound_receipt()
