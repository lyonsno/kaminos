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


if __name__ == "__main__":
    unittest.main()
