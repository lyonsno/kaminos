"""Finite visual-work cases on Greenroom's existing cooperative boundary."""
import hashlib
import json
from pathlib import Path
import re
import subprocess


def run_visual_cases(cases, *, repo_root, node, out, continuation, on_submitted):
    """Cases contain unique ids and visual-work-run.mjs argument arrays.

    The queue producer supplies its existing successor/registration callbacks.
    Each case owns a new browser. A result is acknowledged only after that
    browser has closed. The output directory is invoker-owned and retained.
    """
    root, output = Path(repo_root).resolve(), Path(out).resolve()
    output.mkdir(parents=True, exist_ok=True)
    report = {"status": "running", "phase": "admission", "cases": []}
    report_path = output / "batch.json"

    def write():
        temporary = report_path.with_suffix(".pending")
        temporary.write_text(json.dumps(report, indent=2) + "\n")
        temporary.replace(report_path)

    write()
    try:
        from gpu_queue.cooperative import run_units
        ids = set()
        for case in cases:
            identifier = case.get("id")
            if not isinstance(identifier, str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]*", identifier) or identifier in ids:
                raise ValueError("case ids must be unique path-safe names")
            ids.add(identifier)
            args = case.get("args")
            if not isinstance(args, list) or not all(isinstance(arg, str) for arg in args):
                raise ValueError("case args must be a string array")
            if any(arg == "--out" or arg.startswith("--out=") for arg in args):
                raise ValueError("case output is assigned by the batch")

        def perform(case):
            destination = output / case["id"]
            # A prior interrupted attempt remains available; reuse requires an
            # explicit new output directory rather than overwriting its evidence.
            destination.mkdir()
            report.update(phase="case", active=case["id"])
            write()
            command = [node, str(root / "visual-work-run.mjs"), *case["args"], "--out", str(destination)]
            with (destination / "stdout.log").open("w") as stdout, (destination / "stderr.log").open("w") as stderr:
                completed = subprocess.run(command, cwd=root, stdout=stdout, stderr=stderr, check=False)
            launch = json.loads((destination / "launch.json").read_text())
            if completed.returncode or launch.get("status") != "passed" or launch.get("browserClosed") is not True:
                raise RuntimeError(f"case {case['id']} failed or did not close its browser; see {destination}")
            raw = (destination / "report.json").read_bytes()
            if json.loads(raw).get("status") != "passed":
                raise RuntimeError(f"case {case['id']} has no passed visual result")
            result = {"id": case["id"], "report": str(destination / "report.json"),
                      "sha256": hashlib.sha256(raw).hexdigest()}
            report["cases"].append(result)
            write()
            return result

        def next_request(checkpoint):
            request = continuation(checkpoint)
            if request is not None:
                # The remaining cases are a different workload. The caller can
                # submit a new estimate in a subsequent invocation; inherited
                # cheap-profile/history claims cannot follow this successor.
                request.runtime_hint = None
                request.runtime_profile = None
            report.update(status="yielded", phase="checkpoint", checkpoint=str(checkpoint))
            write()
            return request

        results = run_units(cases, perform=perform, quiesce=lambda: True,
                            continuation=next_request, on_submitted=on_submitted)
        report.update(status="passed", phase="complete", cases=results)
        return results
    except SystemExit as error:
        if error.code not in (None, 0):
            report.update(status="failed", error=repr(error))
        raise
    except BaseException as error:
        report.update(status="failed", error=repr(error))
        raise
    finally:
        write()
