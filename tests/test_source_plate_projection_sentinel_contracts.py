import copy
import hashlib
import json
import struct
import unittest
import zlib
from subprocess import CompletedProcess
from pathlib import Path
from tempfile import TemporaryDirectory

from source_plate_projection_sentinel import (
    ProjectionSentinelError,
    build_greenroom_submissions,
    plan_sha256,
    validate_projection_sentinel_plan,
)
from source_plate_projection_sentinel_submit import submit_projection_sentinel
from source_plate_projection_sentinel_results import (
    ProjectionSentinelResultError,
    build_public_projection_sentinel_result,
    build_projection_sentinel_result,
    build_projection_sentinel_result_html,
    result_sha256,
)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _png_bytes() -> bytes:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", 2, 1, 8, 2, 0, 0, 0)
    raw_scanline = b"\x00\xff\x00\x00\x00\xff\x00"
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw_scanline)) + chunk(b"IEND", b"")


def _plan(root: Path) -> dict:
    sources = {}
    for role in ("clay", "depth", "normal", "mask"):
        path = root / f"{role}.png"
        path.write_bytes(f"{role}-pixels".encode())
        sources[role] = {"path": str(path), "sha256": _sha256(path)}
    descriptor = root / "bundle.json"
    descriptor.write_text(json.dumps({
        "effectiveConfig": {
            "projection": "orthographic",
            "view": "front-three-quarter",
            "cameraYawRadians": 0.42,
        }
    }))
    prompt = root / "prompt.txt"
    prompt.write_text("Complete one coherent creature while preserving the source projection.\n")
    fixed = {
        "runnerFamily": "mflux-generate-flux2-edit",
        "model": "flux2-klein-9b",
        "modelRevision": "92196c8e11f7b6cf2b7493e037d8c5345c559216",
        "quantize": 4,
        "width": 512,
        "height": 512,
        "steps": 8,
        "guidance": 1.0,
        "seed": 80401,
        "promptPath": str(prompt),
        "promptSha256": _sha256(prompt),
    }
    topologies = {
        "clay": ["clay"],
        "depth": ["depth"],
        "normal": ["normal"],
        "depth-plus-normal": ["depth", "normal"],
    }
    plan = {
        "schema": "kaminos.source-plate-projection-sentinel-plan.v0",
        "status": "planned",
        "source": {
            "commit": "48c63a0f8b89ce28c308940b0b5c529fac335c67",
            "descriptorPath": str(descriptor),
            "descriptorSha256": _sha256(descriptor),
            "projection": {
                "mode": "orthographic",
                "view": "front-three-quarter",
                "cameraYawRadians": 0.42,
                "cameraSha256": "a" * 64,
                "silhouetteSha256": sources["mask"]["sha256"],
            },
            "images": sources,
        },
        "fixedGenerator": fixed,
        "cells": [
            {
                "id": cell_id,
                "carrierRoles": roles,
                "requestedRoute": (
                    "gpu-greenroom/mflux_flux2_edit_promptfile_2ref"
                    if len(roles) == 2
                    else "gpu-greenroom/mflux_flux2_edit_promptfile"
                ),
                "settings": copy.deepcopy(fixed),
            }
            for cell_id, roles in topologies.items()
        ],
    }
    projection = plan["source"]["projection"]
    projection["cameraSha256"] = hashlib.sha256(json.dumps(
        {key: projection[key] for key in ("mode", "view", "cameraYawRadians")},
        sort_keys=True,
        separators=(",", ":"),
    ).encode()).hexdigest()
    plan["planSha256"] = plan_sha256(plan)
    return plan


def _terminal_inputs(root: Path, plan: dict) -> tuple[dict, dict, dict]:
    jobs = {
        "schema": "kaminos.source-plate-projection-sentinel-jobs.v0",
        "planSha256": plan["planSha256"],
        "jobs": [],
    }
    receipts = {}
    findings = {}
    for index, cell in enumerate(plan["cells"], 1):
        cell_id = cell["id"]
        output_dir = root / "generated" / cell_id
        output_dir.mkdir(parents=True, exist_ok=True)
        output = output_dir / "output.png"
        output.write_bytes(_png_bytes())
        input_paths = [plan["source"]["images"][role]["path"] for role in cell["carrierRoles"]]
        job_type = cell["requestedRoute"].removeprefix("gpu-greenroom/")
        job_id = f"job-{index}"
        job = {
            "cellId": cell_id,
            "jobId": job_id,
            "requestedRoute": cell["requestedRoute"],
            "jobType": job_type,
            "inputPaths": input_paths,
            "outputDir": str(output_dir),
            "effectiveCwd": "/generator",
            "params": {
                "prompt_file": plan["fixedGenerator"]["promptPath"],
                "model": plan["fixedGenerator"]["model"],
                "quantize": "4",
                "width": "512",
                "height": "512",
                "steps": "8",
                "guidance": "1.0",
                "seed": "80401",
                "mlx_cache_limit_gb": "48",
            },
        }
        jobs["jobs"].append(job)
        receipt_path = root / "receipts" / f"{cell_id}.json"
        receipt_path.parent.mkdir(exist_ok=True)
        receipt = {
            "job_id": job_id,
            "job_type": job_type,
            "status": "done",
            "exit_code": 0,
            "failure_phase": None,
            "error_message": None,
            "effective_cwd": "/generator",
            "effective_argv": [
                "mflux-generate-flux2-edit", "--image-paths", *input_paths,
                "--prompt-file", plan["fixedGenerator"]["promptPath"],
                "--output", str(output.resolve()), "--metadata",
                "--model", "flux2-klein-9b", "--quantize", "4",
                "--height", "512", "--width", "512", "--steps", "8",
                "--guidance", "1.0", "--seed", "80401",
                "--mlx-cache-limit-gb", "48",
            ],
            "ignored_params": None,
            "warnings": [],
            "worker": {"commit": "a" * 40, "git_dirty": False},
        }
        receipt_path.write_text(json.dumps(receipt))
        receipts[cell_id] = receipt_path
        findings[cell_id] = {
            "status": "inspected",
            "projectionVerdict": "preserved",
            "description": f"Inspected {cell_id} output against its conditioning plate.",
        }
    return jobs, receipts, findings


class ProjectionSentinelContracts(unittest.TestCase):
    def test_accepts_exact_four_carrier_topologies_and_fixed_controls(self):
        with TemporaryDirectory() as tmp:
            receipt = validate_projection_sentinel_plan(_plan(Path(tmp)))
            self.assertTrue(receipt["ok"])

    def test_rejects_changed_noncarrier_setting(self):
        with TemporaryDirectory() as tmp:
            plan = _plan(Path(tmp))
            plan["cells"][2]["settings"]["guidance"] = 1.1
            plan["planSha256"] = plan_sha256(plan)
            with self.assertRaisesRegex(ProjectionSentinelError, "guidance") as raised:
                validate_projection_sentinel_plan(plan)
            self.assertEqual(raised.exception.phase, "matched-controls")

    def test_rejects_missing_duplicate_or_extra_carrier_topology(self):
        with TemporaryDirectory() as tmp:
            plan = _plan(Path(tmp))
            plan["cells"][3]["carrierRoles"] = ["clay", "normal"]
            plan["planSha256"] = plan_sha256(plan)
            with self.assertRaisesRegex(ProjectionSentinelError, "carrier topology") as raised:
                validate_projection_sentinel_plan(plan)
            self.assertEqual(raised.exception.phase, "carrier-topology")

    def test_rejects_projection_identity_that_disagrees_with_descriptor(self):
        with TemporaryDirectory() as tmp:
            plan = _plan(Path(tmp))
            plan["source"]["projection"]["view"] = "strict-side"
            plan["planSha256"] = plan_sha256(plan)
            with self.assertRaisesRegex(ProjectionSentinelError, "projection identity") as raised:
                validate_projection_sentinel_plan(plan)
            self.assertEqual(raised.exception.phase, "projection-identity")

    def test_rejects_stale_source_or_prompt_bytes(self):
        with TemporaryDirectory() as tmp:
            plan = _plan(Path(tmp))
            Path(plan["fixedGenerator"]["promptPath"]).write_text("changed")
            with self.assertRaisesRegex(ProjectionSentinelError, "prompt SHA-256") as raised:
                validate_projection_sentinel_plan(plan)
            self.assertEqual(raised.exception.phase, "source-freshness")

    def test_compiles_four_explicit_submissions_without_hidden_settings(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan = _plan(root)
            submissions = build_greenroom_submissions(
                plan, output_root=root / "generated"
            )
            self.assertEqual([row["cellId"] for row in submissions], [
                "clay", "depth", "normal", "depth-plus-normal"
            ])
            self.assertEqual(submissions[0]["jobType"], "mflux_flux2_edit_promptfile")
            self.assertEqual(submissions[3]["jobType"], "mflux_flux2_edit_promptfile_2ref")
            self.assertEqual(submissions[0]["inputPaths"], [plan["source"]["images"]["clay"]["path"]])
            self.assertEqual(submissions[3]["inputPaths"], [
                plan["source"]["images"]["depth"]["path"],
                plan["source"]["images"]["normal"]["path"],
            ])
            for submission in submissions:
                self.assertEqual(submission["params"]["guidance"], "1.0")
                self.assertEqual(submission["params"]["seed"], "80401")
                self.assertEqual(set(submission["params"]), {
                    "prompt_file", "model", "quantize", "width", "height",
                    "steps", "guidance", "seed", "mlx_cache_limit_gb",
                })

    def test_submission_adapter_records_every_job_and_terminal_report(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan = _plan(root)
            submissions = build_greenroom_submissions(plan, output_root=root / "generated")
            calls = []

            def fake_runner(args, **kwargs):
                calls.append(args)
                return CompletedProcess(args, 0, stdout=json.dumps({"job_id": f"job-{len(calls)}"}), stderr="")

            jobs_path = root / "jobs.json"
            report_path = root / "submission-report.json"
            report = submit_projection_sentinel(
                submissions,
                jobs_path=jobs_path,
                report_path=report_path,
                greenroom_cli="gpu-greenroom",
                runner=fake_runner,
            )
            self.assertEqual(report["status"], "queued")
            self.assertEqual(len(json.loads(jobs_path.read_text())["jobs"]), 4)
            self.assertEqual(json.loads(report_path.read_text())["queuedCellCount"], 4)

    def test_submission_adapter_preserves_partial_queue_before_failure(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan = _plan(root)
            submissions = build_greenroom_submissions(plan, output_root=root / "generated")
            calls = []

            def failing_runner(args, **kwargs):
                calls.append(args)
                if len(calls) == 2:
                    return CompletedProcess(args, 9, stdout="", stderr="route rejected")
                return CompletedProcess(args, 0, stdout='{"job_id":"job-1"}', stderr="")

            jobs_path = root / "jobs.json"
            report_path = root / "submission-report.json"
            report = submit_projection_sentinel(
                submissions,
                jobs_path=jobs_path,
                report_path=report_path,
                greenroom_cli="gpu-greenroom",
                runner=failing_runner,
            )
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["failurePhase"], "greenroom-submission")
            self.assertEqual(len(json.loads(jobs_path.read_text())["jobs"]), 1)
            self.assertEqual(report["lastTrustworthyEvidence"]["queuedCells"], ["clay"])

    def test_terminal_result_binds_inputs_prompt_effective_routes_outputs_and_visual_findings(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan = _plan(root)
            jobs, receipts, findings = _terminal_inputs(root, plan)

            result = build_projection_sentinel_result(
                plan, jobs=jobs, receipt_paths=receipts, visual_findings=findings
            )
            html = build_projection_sentinel_result_html(result)

            self.assertEqual(result["status"], "complete")
            self.assertEqual(len(result["cells"]), 4)
            self.assertEqual(result["fullPrompt"], Path(plan["fixedGenerator"]["promptPath"]).read_text().strip())
            self.assertIn(result["resultSha256"], html)
            self.assertIn("depth-plus-normal", html)
            self.assertIn("data:image/png;base64,", html)

            public = build_public_projection_sentinel_result(result)
            serialized = json.dumps(public)
            self.assertNotIn("/private/", serialized)
            self.assertEqual(public["cells"][0]["receiptSha256"], result["cells"][0]["receipt"]["sha256"])
            self.assertEqual(public["cells"][0]["output"]["sha256"], result["cells"][0]["output"]["sha256"])

    def test_terminal_result_rejects_fallback_partial_or_uninspected_output(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan = _plan(root)
            jobs, receipts, findings = _terminal_inputs(root, plan)
            receipt = json.loads(receipts["clay"].read_text())
            receipt["job_type"] = "fallback_renderer"
            receipts["clay"].write_text(json.dumps(receipt))
            with self.assertRaisesRegex(ProjectionSentinelResultError, "effective job type"):
                build_projection_sentinel_result(plan, jobs=jobs, receipt_paths=receipts, visual_findings=findings)

            jobs, receipts, findings = _terminal_inputs(root, plan)
            Path(jobs["jobs"][1]["outputDir"], "output.png").unlink()
            with self.assertRaisesRegex(ProjectionSentinelResultError, "output is missing"):
                build_projection_sentinel_result(plan, jobs=jobs, receipt_paths=receipts, visual_findings=findings)

            jobs, receipts, findings = _terminal_inputs(root, plan)
            findings["normal"]["status"] = "pending"
            with self.assertRaisesRegex(ProjectionSentinelResultError, "human visual inspection"):
                build_projection_sentinel_result(plan, jobs=jobs, receipt_paths=receipts, visual_findings=findings)

    def test_terminal_result_rejects_job_inputs_not_derived_from_plan(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan = _plan(root)
            jobs, receipts, findings = _terminal_inputs(root, plan)
            forged = root / "other-clay.png"
            forged.write_bytes(b"other conditioning pixels")
            jobs["jobs"][0]["inputPaths"] = [str(forged)]
            receipt = json.loads(receipts["clay"].read_text())
            input_index = receipt["effective_argv"].index("--image-paths") + 1
            receipt["effective_argv"][input_index] = str(forged)
            receipts["clay"].write_text(json.dumps(receipt))

            with self.assertRaisesRegex(ProjectionSentinelResultError, "plan-derived conditioning inputs"):
                build_projection_sentinel_result(
                    plan, jobs=jobs, receipt_paths=receipts, visual_findings=findings
                )

    def test_terminal_result_rejects_signature_padded_or_truncated_png(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan = _plan(root)
            for corrupt in (
                b"\x89PNG\r\n\x1a\n" + b"padding" * 20,
                _png_bytes()[:-12],
            ):
                jobs, receipts, findings = _terminal_inputs(root, plan)
                Path(jobs["jobs"][0]["outputDir"], "output.png").write_bytes(corrupt)
                with self.subTest(byte_length=len(corrupt)):
                    with self.assertRaisesRegex(ProjectionSentinelResultError, "PNG"):
                        build_projection_sentinel_result(
                            plan, jobs=jobs, receipt_paths=receipts, visual_findings=findings
                        )

    def test_public_result_rejects_host_coordinates_in_freeform_payloads(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan = _plan(root)
            jobs, receipts, findings = _terminal_inputs(root, plan)
            baseline = build_projection_sentinel_result(
                plan, jobs=jobs, receipt_paths=receipts, visual_findings=findings
            )
            mutations = (
                lambda result: result["cells"][0]["visualInspection"].update(
                    description="inspected at /Users/example/output.png"
                ),
                lambda result: result["cells"][0]["receipt"].update(
                    warnings=["file:///Users/example/output.png"]
                ),
                lambda result: result["cells"][0]["receipt"]["worker"].update(
                    capabilities=["read:/Volumes/private-run/output.png"]
                ),
            )
            for mutate in mutations:
                result = copy.deepcopy(baseline)
                mutate(result)
                result["resultSha256"] = result_sha256(result)
                with self.subTest(payload=result["cells"][0]):
                    with self.assertRaisesRegex(ProjectionSentinelResultError, "host coordinate"):
                        build_public_projection_sentinel_result(result)


if __name__ == "__main__":
    unittest.main()
