import json
import tempfile
import unittest
from pathlib import Path

from roundtrip_contract import admit_terminal_result


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


if __name__ == "__main__":
    unittest.main()
