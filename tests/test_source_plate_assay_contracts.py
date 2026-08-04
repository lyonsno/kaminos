import copy
import hashlib
import json
import unittest
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from source_plate_assay import (
    SourcePlateAssayError,
    build_experiment_manifest,
    build_experiment_plate_html,
    manifest_sha256,
    validate_experiment_manifest,
)


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _spec(root: Path) -> dict:
    source = root / "source.png"
    source.write_bytes(b"source-pixels")
    output = root / "output.png"
    output.write_bytes(b"output-pixels")
    receipt = root / "receipt.json"
    receipt.write_text('{"status":"done"}\n')
    descriptor = root / "plate.json"
    descriptor.write_text('{"plate":"sentinel"}\n')
    return {
        "schema": "kaminos.source-plate-assay-spec.v0",
        "id": "projection-sentinel--concise-structural--seed-80301",
        "status": "complete",
        "comparison": {
            "trancheId": "projection-fidelity-t1",
            "cellId": "projection-sentinel--concise-structural--seed-80301",
            "matchedFactors": ["source", "seed", "settings"],
            "variableFactors": ["promptGrammar"],
        },
        "conditioningInputs": [
            {
                "slot": 0,
                "role": "source-plate-rgb",
                "requestedPath": str(source),
                "effectivePath": str(source.resolve()),
                "sha256": _sha256(source.read_bytes()),
                "mediaType": "image/png",
                "descriptor": {
                    "requestedPath": str(descriptor),
                    "effectivePath": str(descriptor.resolve()),
                    "sha256": _sha256(descriptor.read_bytes()),
                },
                "projection": {
                    "mode": "orthographic",
                    "cameraSha256": "a" * 64,
                    "silhouetteSha256": "b" * 64,
                },
            }
        ],
        "promptClauses": {
            "sourceAuthority": "Treat the supplied plate as the authoritative body plan.",
            "completion": "Complete one coherent living quadruped around it.",
            "aesthetic": "Use neutral clay material and restrained studio light.",
            "projection": "Preserve the exact source projection, framing, and silhouette.",
            "structural": "Retain the pelvis, folded hind limb, support spacing, and direction of travel.",
            "exclusion": "",
        },
        "requestedSettings": {
            "routeId": "gpu-greenroom/mflux_flux2_edit_promptfile",
            "model": "flux2-klein-9b",
            "modelRevision": "92196c8e11f7b6cf2b7493e037d8c5345c559216",
            "steps": 8,
            "guidance": 1.0,
            "seed": 80301,
            "width": 512,
            "height": 512,
            "quantize": 4,
        },
        "effectiveSettings": {
            "routeId": "gpu-greenroom/mflux_flux2_edit_promptfile",
            "runner": "mflux-generate-flux2-edit",
            "runnerVersion": "mflux-0.16.9",
            "model": "flux2-klein-9b",
            "modelRevision": "92196c8e11f7b6cf2b7493e037d8c5345c559216",
            "steps": 8,
            "guidance": 1.0,
            "seed": 80301,
            "width": 512,
            "height": 512,
            "quantize": 4,
            "settingAuthority": {
                "guidance": "fixed-distilled-1.0",
                "steps": "effective-scheduler-iterations",
                "seed": "effective-generation-latent-seed",
                "dimensions": "effective-generation-latent-shape",
                "quantize": "effective-weight-precision",
            },
            "receiptPath": str(receipt.resolve()),
            "receiptSha256": _sha256(receipt.read_bytes()),
            "ignoredParams": [],
            "fallback": False,
        },
        "requestedChannels": ["rgb"],
        "outputs": [
            {
                "channel": "rgb",
                "status": "complete",
                "path": str(output.resolve()),
                "sha256": _sha256(output.read_bytes()),
                "byteLength": len(output.read_bytes()),
                "nonblank": True,
                "cached": False,
            }
        ],
        "failure": None,
    }


class SourcePlateAssayContractTests(unittest.TestCase):
    def test_manifest_identity_binds_full_prompt_effective_route_and_outputs(self):
        with TemporaryDirectory() as tmp:
            manifest = build_experiment_manifest(_spec(Path(tmp)))
            identity = manifest["manifestSha256"]

            self.assertEqual(identity, manifest_sha256(manifest))
            changed_prompt = copy.deepcopy(manifest)
            changed_prompt["prompt"]["clauses"]["structural"] += " Preserve the dorsal arc."
            changed_prompt["prompt"]["fullText"] = " ".join(
                clause for clause in changed_prompt["prompt"]["clauses"].values() if clause
            )
            changed_prompt["prompt"]["sha256"] = _sha256(
                changed_prompt["prompt"]["fullText"].encode()
            )
            self.assertNotEqual(identity, manifest_sha256(changed_prompt))
            changed_route = copy.deepcopy(manifest)
            changed_route["effectiveSettings"]["steps"] = 4
            self.assertNotEqual(identity, manifest_sha256(changed_route))

    def test_prompt_grammar_is_ordered_and_cannot_hide_historical_exclusions(self):
        with TemporaryDirectory() as tmp:
            spec = _spec(Path(tmp))
            manifest = build_experiment_manifest(spec)

            self.assertEqual(
                list(manifest["prompt"]["clauses"]),
                ["sourceAuthority", "structural", "completion", "aesthetic", "projection", "exclusion"],
            )
            self.assertNotIn("no exposed anatomy", manifest["prompt"]["fullText"].lower())
            spec["promptClauses"]["exclusion"] = (
                "Keep the body continuous and clean, with no exposed anatomy, wounds, "
                "clustered apertures, repeated holes, extra limbs, duplicate body, text, interface, or logo."
            )
            historical = build_experiment_manifest(spec)
            self.assertIn("no exposed anatomy", historical["prompt"]["fullText"].lower())
            self.assertNotEqual(manifest["prompt"]["sha256"], historical["prompt"]["sha256"])

    def test_distilled_guidance_and_route_fallback_fail_loud(self):
        with TemporaryDirectory() as tmp:
            spec = _spec(Path(tmp))
            spec["effectiveSettings"]["guidance"] = 2.5
            with self.assertRaisesRegex(SourcePlateAssayError, "guidance") as raised:
                build_experiment_manifest(spec)
            self.assertEqual(raised.exception.phase, "effective-settings")

            spec = _spec(Path(tmp))
            spec["effectiveSettings"]["routeId"] = "fallback/unknown"
            spec["effectiveSettings"]["fallback"] = True
            with self.assertRaisesRegex(SourcePlateAssayError, "fallback") as raised:
                build_experiment_manifest(spec)
            self.assertEqual(raised.exception.phase, "route-identity")

    def test_complete_status_rejects_partial_blank_stale_or_cached_output(self):
        with TemporaryDirectory() as tmp:
            spec = _spec(Path(tmp))
            spec["outputs"] = []
            with self.assertRaisesRegex(SourcePlateAssayError, "missing requested channels"):
                build_experiment_manifest(spec)

            spec = _spec(Path(tmp))
            spec["outputs"][0]["cached"] = True
            with self.assertRaisesRegex(SourcePlateAssayError, "cached"):
                build_experiment_manifest(spec)

            spec = _spec(Path(tmp))
            Path(spec["outputs"][0]["path"]).write_bytes(b"changed-after-receipt")
            with self.assertRaisesRegex(SourcePlateAssayError, "output .* SHA-256"):
                build_experiment_manifest(spec)

    def test_failed_manifest_preserves_phase_and_last_trustworthy_identity(self):
        with TemporaryDirectory() as tmp:
            spec = _spec(Path(tmp))
            spec["status"] = "failed"
            spec["outputs"] = []
            spec["failure"] = {
                "phase": "generation",
                "message": "worker exited before image output",
                "lastTrustworthyIdentity": {
                    "sourceSha256": spec["conditioningInputs"][0]["sha256"],
                    "promptSha256": "pending-build",
                    "receiptPath": spec["effectiveSettings"]["receiptPath"],
                },
            }

            manifest = build_experiment_manifest(spec)

            self.assertEqual(manifest["status"], "failed")
            self.assertEqual(manifest["failure"]["phase"], "generation")
            self.assertEqual(manifest["outputs"], [])

    def test_noncomplete_manifest_rejects_output_cards_that_could_look_authoritative(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            for status in ("planned", "running", "failed"):
                spec = _spec(root)
                spec["status"] = status
                if status == "failed":
                    spec["failure"] = {
                        "phase": "generation",
                        "message": "worker exited after an untrusted preview",
                        "lastTrustworthyIdentity": {"sourceSha256": spec["conditioningInputs"][0]["sha256"]},
                    }
                with self.subTest(status=status):
                    with self.assertRaisesRegex(SourcePlateAssayError, "non-complete manifests cannot carry outputs"):
                        build_experiment_manifest(spec)

    def test_visual_plate_embeds_verified_inputs_prompt_settings_and_outputs(self):
        with TemporaryDirectory() as tmp:
            manifest = build_experiment_manifest(_spec(Path(tmp)))
            html = build_experiment_plate_html(manifest)

            self.assertIn(f'data-manifest-sha256="{manifest["manifestSha256"]}"', html)
            self.assertIn("Treat the supplied plate as the authoritative body plan.", html)
            self.assertIn("fixed-distilled-1.0", html)
            self.assertIn("data:image/png;base64,", html)
            self.assertIn("source-plate-rgb", html)
            self.assertIn("output · rgb", html)
            self.assertIn("complete", html)
            self.assertTrue(validate_experiment_manifest(manifest)["ok"])


if __name__ == "__main__":
    unittest.main()
