import json
import tempfile
import unittest
from pathlib import Path

from roundtrip_contract import admit_flux_result, admit_terminal_result, validate_second_pass


class TerminalAdmissionTests(unittest.TestCase):
    def make_fixture(self, *, status="done", route="sf3d", output=True):
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        job = root / status / "abc123def456"
        job.mkdir(parents=True)
        (job / "request.json").write_text(json.dumps({
            "job_id": "abc123def456",
            "job_type": route,
            "input_path": "/source.png",
            "output_dir": str(root / "output"),
        }))
        (job / "status.json").write_text(json.dumps({
            "job_id": "abc123def456", "status": status,
        }))
        (job / "receipt.json").write_text(json.dumps({
            "job_id": "abc123def456",
            "job_type": route,
            "status": status,
            "input_path": "/source.png",
            "output_dir": str(root / "output"),
            "effective_route": f"effective:{route}",
            "exit_code": 0 if status == "done" else 1,
        }))
        if output:
            output_dir = root / "output"
            output_dir.mkdir()
            (output_dir / "output.glb").write_bytes(b"glTF-fixture")
        return temporary, root

    def test_admits_exact_done_result(self):
        temporary, root = self.make_fixture()
        self.addCleanup(temporary.cleanup)
        record = admit_terminal_result(
            queue_root=root,
            job_id="abc123def456",
            expected_job_type="sf3d",
            expected_input=Path("/source.png"),
            output_dir=root / "output",
        )
        self.assertEqual(record["jobType"], "sf3d")
        self.assertEqual(len(record["outputSha256"]), 64)

    def test_rejects_wrong_effective_route(self):
        temporary, root = self.make_fixture(route="unexpected")
        self.addCleanup(temporary.cleanup)
        with self.assertRaisesRegex(RuntimeError, "job type"):
            admit_terminal_result(
                queue_root=root,
                job_id="abc123def456",
                expected_job_type="sf3d",
                expected_input=Path("/source.png"),
                output_dir=root / "output",
            )

    def test_rejects_nominal_success_without_output(self):
        temporary, root = self.make_fixture(output=False)
        self.addCleanup(temporary.cleanup)
        with self.assertRaisesRegex(RuntimeError, "output GLB"):
            admit_terminal_result(
                queue_root=root,
                job_id="abc123def456",
                expected_job_type="sf3d",
                expected_input=Path("/source.png"),
                output_dir=root / "output",
            )

    def test_rejects_receipt_bound_to_another_output_directory(self):
        temporary, root = self.make_fixture()
        self.addCleanup(temporary.cleanup)
        receipt = root / "done" / "abc123def456" / "receipt.json"
        payload = json.loads(receipt.read_text())
        payload["output_dir"] = str(root / "stale-default")
        receipt.write_text(json.dumps(payload))
        with self.assertRaisesRegex(RuntimeError, "output directory"):
            admit_terminal_result(
                queue_root=root,
                job_id="abc123def456",
                expected_job_type="sf3d",
                expected_input=Path("/source.png"),
                output_dir=root / "output",
            )


class SecondPassContractTests(unittest.TestCase):
    def test_frozen_second_pass_is_exact_matched_cell(self):
        root = Path(__file__).resolve().parent
        record = validate_second_pass(root)
        self.assertEqual(record["selection"]["route"], "trellis")
        self.assertEqual(record["selection"]["view"], "az180-el12")
        self.assertEqual(record["cell"]["prompt"], "This shape as a cat.")
        self.assertEqual(record["cell"]["seed"], 80301)
        self.assertEqual(record["cell"]["jobType"], "mflux_flux2_edit_promptfile")
        self.assertEqual(record["cell"]["model"], "flux2-klein-9b")

    def test_flux_admission_rejects_wrong_effective_input(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            job = root / "done" / "abc123def456"
            output = root / "output"
            job.mkdir(parents=True)
            output.mkdir()
            (output / "output.png").write_bytes(b"png-fixture")
            (job / "receipt.json").write_text(json.dumps({
                "job_id": "abc123def456",
                "job_type": "mflux_flux2_edit_promptfile",
                "status": "done",
                "input_path": "/wrong.png",
                "output_dir": str(output),
                "effective_route": "effective:mflux",
                "effective_defaults": {"seed": "80301"},
                "exit_code": 0,
            }))
            with self.assertRaisesRegex(RuntimeError, "effective input"):
                admit_flux_result(
                    queue_root=root,
                    job_id="abc123def456",
                    expected_input=Path("/selected.png"),
                    output_dir=output,
                    expected_prompt_file=Path("/prompt.txt"),
                    expected_seed=80301,
                )

    def test_flux_admission_rejects_wrong_effective_seed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            job = root / "done" / "abc123def456"
            output = root / "output"
            job.mkdir(parents=True)
            output.mkdir()
            (output / "output.png").write_bytes(b"png-fixture")
            (job / "receipt.json").write_text(json.dumps({
                "job_id": "abc123def456",
                "job_type": "mflux_flux2_edit_promptfile",
                "status": "done",
                "input_path": "/selected.png",
                "output_dir": str(output),
                "effective_route": "effective:mflux",
                "effective_argv": [
                    "mflux", "--prompt-file", "/prompt.txt", "--seed", "42",
                ],
                "exit_code": 0,
            }))
            with self.assertRaisesRegex(RuntimeError, "effective seed"):
                admit_flux_result(
                    queue_root=root,
                    job_id="abc123def456",
                    expected_input=Path("/selected.png"),
                    output_dir=output,
                    expected_prompt_file=Path("/prompt.txt"),
                    expected_seed=80301,
                )

    def test_flux_admission_rejects_nominal_success_without_image(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            job = root / "done" / "abc123def456"
            output = root / "output"
            job.mkdir(parents=True)
            output.mkdir()
            (job / "receipt.json").write_text(json.dumps({
                "job_id": "abc123def456",
                "job_type": "mflux_flux2_edit_promptfile",
                "status": "done",
                "input_path": "/selected.png",
                "output_dir": str(output),
                "effective_route": "effective:mflux",
                "effective_argv": [
                    "mflux", "--prompt-file", "/prompt.txt", "--seed", "80301",
                ],
                "exit_code": 0,
            }))
            with self.assertRaisesRegex(RuntimeError, "output image"):
                admit_flux_result(
                    queue_root=root,
                    job_id="abc123def456",
                    expected_input=Path("/selected.png"),
                    output_dir=output,
                    expected_prompt_file=Path("/prompt.txt"),
                    expected_seed=80301,
                )

if __name__ == "__main__":
    unittest.main()
