import json
import tempfile
import unittest
from pathlib import Path

from comparison_contract import (
    admit_sf3d_result,
    validate_campaign,
    validate_complete_orbits,
    validate_visual_disposition,
)


class CampaignTests(unittest.TestCase):
    def test_live_campaign_binds_three_distinct_source_classes(self):
        root = Path(__file__).resolve().parent
        campaign = validate_campaign(root, root.parents[1])
        self.assertEqual(len(campaign["cells"]), 3)
        self.assertEqual(
            {cell["class"] for cell in campaign["cells"]},
            {
                "rigid-separable-assembly",
                "ornate-organic-appendages",
                "continuous-organic-anatomy",
            },
        )

    def test_visual_disposition_covers_every_campaign_cell(self):
        root = Path(__file__).resolve().parent
        campaign = validate_campaign(root, root.parents[1])
        disposition = validate_visual_disposition(root, campaign)
        self.assertEqual(
            set(disposition["cells"]),
            {cell["id"] for cell in campaign["cells"]},
        )


class AdmissionTests(unittest.TestCase):
    def make_fixture(self, *, status="done", job_type="sf3d", output=True):
        temporary = tempfile.TemporaryDirectory()
        queue = Path(temporary.name)
        output_dir = queue / "output"
        terminal = queue / status / "abc123def456"
        terminal.mkdir(parents=True)
        output_dir.mkdir()
        receipt = {
            "job_id": "abc123def456",
            "job_type": job_type,
            "status": status,
            "exit_code": 0 if status == "done" else 1,
            "input_path": "/source.png",
            "output_dir": str(output_dir),
            "effective_route": "/Users/noahlyons/dev/sf3d/.venv/bin/python -u run_greenroom.py --image /source.png --output-dir " + str(output_dir) + " --texture-resolution 1024 --remesh none --dtype float16",
            "effective_cwd": "/Users/noahlyons/dev/sf3d",
            "effective_env": {"PYTORCH_ENABLE_MPS_FALLBACK": "1"},
            "effective_defaults": {
                "texture_resolution": "1024",
                "remesh": "none",
                "dtype": "float16",
            },
        }
        (terminal / "receipt.json").write_text(json.dumps(receipt))
        if output:
            (output_dir / "output.glb").write_bytes(b"glTF-fixture")
        return temporary, queue, output_dir

    def test_rejects_nominal_success_without_glb(self):
        temporary, queue, output_dir = self.make_fixture(output=False)
        self.addCleanup(temporary.cleanup)
        with self.assertRaisesRegex(RuntimeError, "output GLB"):
            admit_sf3d_result(
                queue_root=queue,
                job_id="abc123def456",
                expected_input=Path("/source.png"),
                output_dir=output_dir,
            )

    def test_rejects_wrong_effective_job_type(self):
        temporary, queue, output_dir = self.make_fixture(job_type="fallback")
        self.addCleanup(temporary.cleanup)
        with self.assertRaisesRegex(RuntimeError, "job type"):
            admit_sf3d_result(
                queue_root=queue,
                job_id="abc123def456",
                expected_input=Path("/source.png"),
                output_dir=output_dir,
            )

    def test_rejects_wrong_effective_input(self):
        temporary, queue, output_dir = self.make_fixture()
        self.addCleanup(temporary.cleanup)
        with self.assertRaisesRegex(RuntimeError, "input"):
            admit_sf3d_result(
                queue_root=queue,
                job_id="abc123def456",
                expected_input=Path("/other.png"),
                output_dir=output_dir,
            )

    def test_rejects_incomplete_orbit_surface(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "renders" / "rigid-stone-slabs" / "sf3d").mkdir(parents=True)
            (root / "renders" / "rigid-stone-slabs" / "sf3d" / "orbit-manifest.json").write_text(
                json.dumps({"status": "completed", "outputs": []})
            )
            ledger = {"cells": {"rigid-stone-slabs": {"routes": {"sf3d": {}}}}}
            with self.assertRaisesRegex(RuntimeError, "six-view orbit"):
                validate_complete_orbits(root, ledger)


if __name__ == "__main__":
    unittest.main()
