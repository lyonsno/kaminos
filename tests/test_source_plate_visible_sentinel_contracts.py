import hashlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from source_plate_visible_sentinel import (
    SENTINEL_OUTPUT_NAMES,
    VisibleSentinelError,
    build_visible_sentinel_bundle,
    read_png_dimensions,
    validate_visible_evidence_ledger,
    validate_visible_sentinel_manifest,
)


def _write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def _rehash_manifest(path, manifest):
    payload = dict(manifest)
    payload.pop("manifestSha256", None)
    manifest["manifestSha256"] = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    _write_json(path, manifest)


class VisibleSourceSentinelContracts(unittest.TestCase):
    def test_builds_native_square_carriers_and_pixel_visible_evidence(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = build_visible_sentinel_bundle(root)

            self.assertEqual(manifest["schema"], "kaminos.visible-source-sentinel.v0")
            self.assertEqual(manifest["status"], "complete")
            self.assertEqual(manifest["sentinelId"], "asymmetric-projection-truth-a")
            self.assertEqual(set(manifest["outputs"]), set(SENTINEL_OUTPUT_NAMES))
            for output in manifest["outputs"].values():
                path = root / output["path"]
                self.assertEqual(read_png_dimensions(path), (512, 512))
                self.assertEqual(output["dimensions"], [512, 512])
                self.assertEqual(len(output["sha256"]), 64)
                self.assertGreater(output["byteLength"], 100)

            receipt = validate_visible_sentinel_manifest(root / "manifest.json")
            self.assertTrue(receipt["ok"])
            self.assertEqual(receipt["outputCount"], len(SENTINEL_OUTPUT_NAMES))

    def test_ledger_predeclares_exact_categorical_and_continuous_gates(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            build_visible_sentinel_bundle(root)
            ledger = json.loads((root / "visible-evidence-ledger.json").read_text())

            self.assertEqual(ledger["orientation"]["headSide"], "image-right")
            self.assertEqual(ledger["orientation"]["markerSide"], "image-right")
            self.assertEqual(ledger["orientation"]["projectionClass"], "orthographic")
            self.assertEqual(
                ledger["supportOrder"],
                ["rear-outer", "rear-inner", "front-inner", "front-outer"],
            )
            self.assertGreater(ledger["landmarks"]["head-marker-tip"]["normalized"][0], 0.5)
            self.assertGreater(
                abs(ledger["landmarks"]["dorsal-offset-tip"]["normalized"][0] - 0.5),
                0.04,
            )
            self.assertEqual(ledger["thresholds"]["categoricalPolicy"], "exact")
            self.assertEqual(ledger["thresholds"]["maxLandmarkDriftFrameDiagonal"], 0.05)
            self.assertEqual(ledger["thresholds"]["minProtectedContourIoU"], 0.80)
            self.assertTrue(ledger["thresholds"]["predeclared"])
            self.assertTrue(validate_visible_evidence_ledger(ledger)["ok"])

    def test_records_identity_transform_for_native_square_preprocessing(self):
        with TemporaryDirectory() as tmp:
            manifest = build_visible_sentinel_bundle(Path(tmp))
            preprocessing = manifest["preprocessing"]

            self.assertEqual(preprocessing["requestedPolicy"], "native-square")
            self.assertEqual(preprocessing["effectivePolicy"], "native-square")
            self.assertEqual(preprocessing["sourceDimensions"], [512, 512])
            self.assertEqual(preprocessing["encodedDimensions"], [512, 512])
            self.assertEqual(preprocessing["scale"], [1.0, 1.0])
            self.assertEqual(preprocessing["pad"], [0, 0, 0, 0])
            self.assertIsNone(preprocessing["crop"])
            self.assertEqual(len(preprocessing["transformSha256"]), 64)

    def test_records_requested_and_effective_producer_route_without_fallback(self):
        with TemporaryDirectory() as tmp:
            manifest = build_visible_sentinel_bundle(Path(tmp))
            route = manifest["producerRoute"]

            self.assertEqual(route["requested"], "python-stdlib-analytic-raster-v0")
            self.assertEqual(route["effective"], "python-stdlib-analytic-raster-v0")
            self.assertEqual(route["renderer"], "deterministic-cpu-raster")
            self.assertEqual(route["device"], "cpu")
            self.assertFalse(route["fallbackUsed"])

    def test_descriptor_only_roles_cannot_impersonate_visible_claims(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            build_visible_sentinel_bundle(root)
            ledger = json.loads((root / "visible-evidence-ledger.json").read_text())
            ledger["visibleClaims"].append({
                "id": "semantic-head-role",
                "kind": "categorical",
                "sourceValue": "image-right",
                "evidenceSource": "descriptor-only",
                "measurementArtifact": "descriptor.json",
                "predeclared": True,
            })

            with self.assertRaisesRegex(VisibleSentinelError, "descriptor-only") as raised:
                validate_visible_evidence_ledger(ledger)
            self.assertEqual(raised.exception.phase, "visible-evidence-authority")

    def test_manifest_rejects_stale_or_dimension_mismatched_output(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            build_visible_sentinel_bundle(root)
            (root / "depth.png").write_bytes(b"stale")

            with self.assertRaisesRegex(VisibleSentinelError, "depth.*SHA-256") as raised:
                validate_visible_sentinel_manifest(root / "manifest.json")
            self.assertEqual(raised.exception.phase, "output-freshness")

    def test_failure_before_complete_bundle_writes_terminal_report(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaisesRegex(VisibleSentinelError, "forced failure") as raised:
                build_visible_sentinel_bundle(root, fail_after="depth")
            self.assertEqual(raised.exception.phase, "write-normal")

            report = json.loads((root / "build-report.json").read_text())
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["failurePhase"], "write-normal")
            self.assertEqual(report["lastTrustworthyEvidence"]["completedOutputs"], [
                "clay", "depth"
            ])
            self.assertEqual(
                set(report["lastTrustworthyEvidence"]["outputSha256"]),
                {"clay", "depth"},
            )
            self.assertFalse((root / "manifest.json").exists())

    def test_validator_rejects_manifest_claiming_nonidentity_preprocessing(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            build_visible_sentinel_bundle(root)
            manifest_path = root / "manifest.json"
            manifest = json.loads(manifest_path.read_text())
            manifest["preprocessing"]["scale"] = [1.0, 1.25]
            manifest_path.write_text(json.dumps(manifest))

            with self.assertRaisesRegex(VisibleSentinelError, "preprocessing") as raised:
                validate_visible_sentinel_manifest(manifest_path)
            self.assertEqual(raised.exception.phase, "preprocessing-identity")

    def test_validator_rejects_drift_inside_fixed_consumer_cell_ids(self):
        mutations = {
            "carrier-kind": lambda manifest: manifest["consumerExercise"]["cells"][0][
                "references"
            ][0].__setitem__("carrierKind", "clay"),
            "role": lambda manifest: manifest["consumerExercise"]["cells"][1][
                "references"
            ][1].__setitem__("role", "target-projection"),
            "path": lambda manifest: manifest["consumerExercise"]["cells"][0][
                "references"
            ][0].__setitem__("path", "clay.png"),
            "sha": lambda manifest: manifest["consumerExercise"]["cells"][1][
                "references"
            ][1].__setitem__("sha256", "0" * 64),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label), TemporaryDirectory() as tmp:
                root = Path(tmp)
                build_visible_sentinel_bundle(root)
                manifest_path = root / "manifest.json"
                manifest = json.loads(manifest_path.read_text())
                mutate(manifest)
                _rehash_manifest(manifest_path, manifest)

                with self.assertRaises(VisibleSentinelError) as raised:
                    validate_visible_sentinel_manifest(manifest_path)
                self.assertEqual(raised.exception.phase, "consumer-contract")

    def test_validator_rejects_structurally_incomplete_png_when_metadata_is_rehashed(self):
        def signature_padding(payload):
            return payload[:24] + b"not-a-png-stream" * 8

        def truncate_iend(payload):
            return payload[:-12]

        def corrupt_ihdr_crc(payload):
            corrupted = bytearray(payload)
            corrupted[32] ^= 0x01
            return bytes(corrupted)

        def remove_idat(payload):
            return payload[:33] + payload[-12:]

        def append_trailing_bytes(payload):
            return payload + b"trailing"

        mutations = {
            "signature-padding": signature_padding,
            "truncated-iend": truncate_iend,
            "bad-crc": corrupt_ihdr_crc,
            "missing-idat": remove_idat,
            "trailing-bytes": append_trailing_bytes,
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label), TemporaryDirectory() as tmp:
                root = Path(tmp)
                build_visible_sentinel_bundle(root)
                manifest_path = root / "manifest.json"
                manifest = json.loads(manifest_path.read_text())
                depth_path = root / manifest["outputs"]["depth"]["path"]
                depth_path.write_bytes(mutate(depth_path.read_bytes()))
                manifest["outputs"]["depth"]["sha256"] = hashlib.sha256(
                    depth_path.read_bytes()
                ).hexdigest()
                manifest["outputs"]["depth"]["byteLength"] = depth_path.stat().st_size
                _rehash_manifest(manifest_path, manifest)

                with self.assertRaises(VisibleSentinelError) as raised:
                    validate_visible_sentinel_manifest(manifest_path)
                self.assertEqual(raised.exception.phase, "output-freshness")

    def test_validator_binds_exact_visible_claims_to_measurement_artifacts(self):
        def remove_claim(ledger):
            ledger["visibleClaims"].pop()

        def rename_claim(ledger):
            ledger["visibleClaims"][0]["id"] = "semantic-head-role"

        def change_kind(ledger):
            ledger["visibleClaims"][1]["kind"] = "descriptor-order"

        def change_source_value(ledger):
            ledger["visibleClaims"][0]["sourceValue"] = "image-left"

        def point_at_descriptor(ledger):
            ledger["visibleClaims"][0]["measurementArtifact"] = "descriptor.json"

        def point_contour_at_clay(ledger):
            ledger["visibleClaims"][2]["measurementArtifact"] = "clay.png"

        mutations = {
            "missing-claim": remove_claim,
            "wrong-id": rename_claim,
            "wrong-kind": change_kind,
            "wrong-source-value": change_source_value,
            "descriptor-impersonation": point_at_descriptor,
            "wrong-pixel-artifact": point_contour_at_clay,
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label), TemporaryDirectory() as tmp:
                root = Path(tmp)
                build_visible_sentinel_bundle(root)
                ledger_path = root / "visible-evidence-ledger.json"
                ledger = json.loads(ledger_path.read_text())
                mutate(ledger)
                _write_json(ledger_path, ledger)
                manifest_path = root / "manifest.json"
                manifest = json.loads(manifest_path.read_text())
                manifest["visibleEvidenceLedger"]["sha256"] = hashlib.sha256(
                    ledger_path.read_bytes()
                ).hexdigest()
                _rehash_manifest(manifest_path, manifest)

                with self.assertRaises(VisibleSentinelError) as raised:
                    validate_visible_sentinel_manifest(manifest_path)
                self.assertEqual(raised.exception.phase, "visible-evidence-authority")

    def test_visible_claim_artifacts_require_authoritative_png_output_records(self):
        mutations = {
            "media-type": lambda record: record.__setitem__("mediaType", "text/plain"),
            "incomplete": lambda record: record.__setitem__("complete", False),
            "stale": lambda record: record.__setitem__("fresh", False),
            "cached": lambda record: record.__setitem__("cached", True),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label), TemporaryDirectory() as tmp:
                root = Path(tmp)
                build_visible_sentinel_bundle(root)
                manifest_path = root / "manifest.json"
                manifest = json.loads(manifest_path.read_text())
                mutate(manifest["outputs"]["landmark-overlay"])
                _rehash_manifest(manifest_path, manifest)

                with self.assertRaises(VisibleSentinelError) as raised:
                    validate_visible_sentinel_manifest(manifest_path)
                self.assertEqual(raised.exception.phase, "output-freshness")

    def test_failed_rerun_removes_stale_terminal_authority(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            build_visible_sentinel_bundle(root)
            self.assertTrue((root / "manifest.json").is_file())
            self.assertTrue((root / "index.html").is_file())

            with self.assertRaises(VisibleSentinelError):
                build_visible_sentinel_bundle(root, fail_after="depth")

            self.assertFalse((root / "manifest.json").exists())
            self.assertFalse((root / "index.html").exists())
            report = json.loads((root / "build-report.json").read_text())
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["lastTrustworthyEvidence"]["completedOutputs"], [
                "clay", "depth"
            ])


if __name__ == "__main__":
    unittest.main()
