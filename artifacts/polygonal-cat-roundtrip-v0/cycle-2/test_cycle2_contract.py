import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from cycle2_contract import (
    admit_reconstruction,
    validate_campaign,
    validate_registration_result,
)


ROOT = Path(__file__).resolve().parent


class CampaignContractTests(unittest.TestCase):
    def test_campaign_freezes_second_flux_source_and_matched_routes(self):
        campaign = validate_campaign(ROOT)
        self.assertEqual(
            campaign["source"]["sha256"],
            "d811a766317a6d0ae2e13eb041e2043ef966dec22b920d5d65c8202860de62d9",
        )
        self.assertEqual(
            campaign["referenceCast"]["sha256"],
            "3b048af71064beb0a8051e711bb53830f557ab0ec602e7483fc7f63cb09c1df4",
        )
        routes = {route["id"]: route for route in campaign["routes"]}
        self.assertEqual(set(routes), {"sf3d", "trellis"})
        self.assertEqual(routes["trellis"]["params"]["seed"], 42)
        self.assertEqual(routes["trellis"]["params"]["steps"], 6)
        self.assertEqual(routes["trellis"]["params"]["target_faces"], 200000)
        self.assertEqual(routes["trellis"]["params"]["texture_size"], 1024)

    def test_registration_policy_cannot_hide_morphological_drift(self):
        campaign = validate_campaign(ROOT)
        registration = campaign["registration"]
        self.assertEqual(registration["fixed"], "cycle-1-trellis")
        self.assertEqual(registration["moving"], "cycle-2-trellis")
        self.assertEqual(registration["transformClass"], "global_similarity")
        self.assertTrue(registration["uniformScaleOnly"])
        self.assertFalse(registration["allowsLocalDeformation"])
        self.assertFalse(registration["allowsAnisotropicScale"])
        self.assertEqual(
            set(registration["requiredWitnesses"]),
            {"raw-side-by-side", "registered-overlay"},
        )


class ReconstructionAdmissionTests(unittest.TestCase):
    def make_fixture(self, *, job_type="trellis2mlx_fast", output=True):
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        source = root / "source.png"
        source.write_bytes(b"png-source")
        output_dir = root / "output"
        output_dir.mkdir()
        job = root / "queue" / "done" / "abc123def456"
        job.mkdir(parents=True)
        (job / "receipt.json").write_text(
            json.dumps(
                {
                    "job_id": "abc123def456",
                    "job_type": job_type,
                    "status": "done",
                    "exit_code": 0,
                    "input_path": str(source),
                    "output_dir": str(output_dir),
                    "effective_route": f"effective:{job_type}",
                    "effective_argv": [job_type, "--image", str(source)],
                }
            )
        )
        if output:
            (output_dir / "output.glb").write_bytes(b"glTF-cycle-two")
        return temporary, root, source, output_dir

    def test_admits_exact_terminal_reconstruction(self):
        temporary, root, source, output_dir = self.make_fixture()
        self.addCleanup(temporary.cleanup)
        record = admit_reconstruction(
            queue_root=root / "queue",
            job_id="abc123def456",
            expected_job_type="trellis2mlx_fast",
            expected_input=source,
            output_dir=output_dir,
        )
        self.assertEqual(record["inputSha256"], hashlib.sha256(source.read_bytes()).hexdigest())
        self.assertEqual(record["outputBytes"], len(b"glTF-cycle-two"))

    def test_rejects_wrong_route_identity(self):
        temporary, root, source, output_dir = self.make_fixture(job_type="sf3d")
        self.addCleanup(temporary.cleanup)
        with self.assertRaisesRegex(RuntimeError, "job type"):
            admit_reconstruction(
                queue_root=root / "queue",
                job_id="abc123def456",
                expected_job_type="trellis2mlx_fast",
                expected_input=source,
                output_dir=output_dir,
            )

    def test_rejects_nominal_success_without_primary_output(self):
        temporary, root, source, output_dir = self.make_fixture(output=False)
        self.addCleanup(temporary.cleanup)
        with self.assertRaisesRegex(RuntimeError, "output GLB"):
            admit_reconstruction(
                queue_root=root / "queue",
                job_id="abc123def456",
                expected_job_type="trellis2mlx_fast",
                expected_input=source,
                output_dir=output_dir,
            )


class RegistrationResultTests(unittest.TestCase):
    def test_registration_result_requires_raw_and_registered_views(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixed = root / "fixed.glb"
            moving = root / "moving.glb"
            fixed.write_bytes(b"fixed")
            moving.write_bytes(b"moving")
            raw = root / "raw.png"
            overlay = root / "overlay.png"
            raw.write_bytes(b"raw-view")
            overlay.write_bytes(b"registered-view")
            result = {
                "schema": "kaminos.polygonal-cat-cycle2.registration.v0",
                "fixed": {"path": str(fixed), "sha256": hashlib.sha256(b"fixed").hexdigest()},
                "moving": {"path": str(moving), "sha256": hashlib.sha256(b"moving").hexdigest()},
                "method": {
                    "transformClass": "global_similarity",
                    "uniformScaleOnly": True,
                    "allowsLocalDeformation": False,
                    "allowsAnisotropicScale": False,
                },
                "fit": {
                    "uniformScale": 1.0,
                    "matrix": [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
                    "normalizedMedianDistance": 0.01,
                    "normalizedP90Distance": 0.03,
                },
                "witnesses": {
                    "raw-side-by-side": [str(raw)],
                    "registered-overlay": [str(overlay)],
                },
            }
            validate_registration_result(result)
            result["witnesses"].pop("raw-side-by-side")
            with self.assertRaisesRegex(RuntimeError, "raw-side-by-side"):
                validate_registration_result(result)


if __name__ == "__main__":
    unittest.main()
