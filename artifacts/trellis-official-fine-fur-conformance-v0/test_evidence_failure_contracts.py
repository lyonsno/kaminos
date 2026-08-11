#!/usr/bin/env python3
import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BLENDER = Path("/Applications/Blender.app/Contents/MacOS/Blender")


def test_failed_render_invalidates_prior_success() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        temp = Path(temporary)
        glb = temp / "invalid.glb"
        output = temp / "render.png"
        manifest = temp / "render.json"
        failure = temp / "failure.json"
        glb.write_bytes(b"not a glb")
        output.write_bytes(b"stale rendered frame")
        manifest.write_text('{"status":"completed","stale":true}\n')

        completed = subprocess.run(
            [
                str(BLENDER),
                "--background",
                "--python",
                str(ROOT / "render_dense_glb_cpu.py"),
                "--",
                "--glb",
                str(glb),
                "--expected-sha256",
                "0" * 64,
                "--output",
                str(output),
                "--manifest",
                str(manifest),
                "--failure",
                str(failure),
            ],
            capture_output=True,
            text=True,
        )

        assert completed.returncode != 0
        assert not manifest.exists(), "failed rerun retained a stale success manifest"
        assert not output.exists(), "failed rerun retained a stale rendered frame"
        report = json.loads(failure.read_text())
        assert report["status"] == "failed"


def test_mps_preflight_failure_writes_terminal_report() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        output_dir = Path(temporary) / "result"
        completed = subprocess.run(
            [
                sys.executable,
                str(ROOT / "run_mps_geometry_control.py"),
                "--source",
                str(ROOT / "source" / "official-dwarf-fur-cloak.webp"),
                "--output-dir",
                str(output_dir),
                "--trellis-root",
                str(Path(temporary) / "missing-trellis-root"),
            ],
            capture_output=True,
            text=True,
        )

        assert completed.returncode != 0
        report = json.loads((output_dir / "run-report.json").read_text())
        assert report["status"] == "failed"
        assert report["failurePhase"] == "trellis-route-preflight"
        assert report["lastTrustworthyEvidence"] == "invocation-recorded"


def main() -> None:
    assert BLENDER.is_file()
    test_failed_render_invalidates_prior_success()
    test_mps_preflight_failure_writes_terminal_report()


if __name__ == "__main__":
    main()
