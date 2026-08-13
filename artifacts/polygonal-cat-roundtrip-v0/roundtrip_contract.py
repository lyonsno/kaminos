"""Evidence checks for the polygonal-cat round-trip reconstruction assay."""

import hashlib
import json
from pathlib import Path


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _argument(argv: list[str], flag: str) -> str | None:
    try:
        return argv[argv.index(flag) + 1]
    except (ValueError, IndexError):
        return None


def validate_second_pass(root: Path) -> dict:
    selection = json.loads((root / "selection.json").read_text())
    contract = json.loads((root / "second-pass.json").read_text())
    cell = contract["cell"]
    plate = root / selection["plate"]
    glb = root / selection["glb"]
    prompt_file = root / cell["promptFile"]
    if digest(plate) != selection["plateSha256"]:
        raise RuntimeError("selected reconstruction plate drifted")
    if digest(glb) != selection["glbSha256"]:
        raise RuntimeError("selected reconstruction GLB drifted")
    if (root / cell["input"]).resolve() != plate.resolve():
        raise RuntimeError("second-pass input does not match selected plate")
    prompt = prompt_file.read_text().strip()
    if prompt != cell["prompt"]:
        raise RuntimeError("second-pass prompt file drifted")
    return {"selection": selection, "cell": cell}


def admit_terminal_result(
    *,
    queue_root: Path,
    job_id: str,
    expected_job_type: str,
    expected_input: Path,
    output_dir: Path,
) -> dict:
    terminal_dir = next(
        (queue_root / state / job_id for state in ("done", "failed", "cancelled")
         if (queue_root / state / job_id).is_dir()),
        None,
    )
    if terminal_dir is None:
        raise RuntimeError(f"job is not terminal: {job_id}")
    receipt_path = terminal_dir / "receipt.json"
    if not receipt_path.is_file():
        raise RuntimeError(f"terminal job has no receipt: {job_id}")
    receipt = json.loads(receipt_path.read_text())
    if receipt.get("job_id") != job_id:
        raise RuntimeError(f"receipt job identity mismatch: {job_id}")
    if receipt.get("job_type") != expected_job_type:
        raise RuntimeError(
            f"effective job type mismatch: expected {expected_job_type}, "
            f"got {receipt.get('job_type')}"
        )
    if Path(receipt.get("input_path", "")).resolve() != expected_input.resolve():
        raise RuntimeError(f"effective input mismatch: {job_id}")
    if Path(receipt.get("output_dir", "")).resolve() != output_dir.resolve():
        raise RuntimeError(f"effective output directory mismatch: {job_id}")
    if receipt.get("status") != "done" or receipt.get("exit_code") != 0:
        raise RuntimeError(
            f"reconstruction failed at {receipt.get('failure_phase')}: "
            f"{receipt.get('error_message')}"
        )
    if not receipt.get("effective_route"):
        raise RuntimeError(f"receipt has no effective route: {job_id}")
    output = output_dir / "output.glb"
    if not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError(f"completed job has no output GLB: {job_id}")
    return {
        "jobId": job_id,
        "jobType": expected_job_type,
        "input": str(expected_input.resolve()),
        "output": str(output.resolve()),
        "outputSha256": digest(output),
        "outputBytes": output.stat().st_size,
        "receipt": str(receipt_path.resolve()),
        "effectiveRoute": receipt["effective_route"],
        "effectiveOutputDir": receipt["output_dir"],
        "effectiveCwd": receipt.get("effective_cwd"),
        "effectiveEnv": receipt.get("effective_env"),
        "effectiveDefaults": receipt.get("effective_defaults"),
    }


def admit_flux_result(
    *,
    queue_root: Path,
    job_id: str,
    expected_input: Path,
    output_dir: Path,
    expected_prompt_file: Path,
    expected_seed: int,
) -> dict:
    terminal_dir = next(
        (queue_root / state / job_id for state in ("done", "failed", "cancelled")
         if (queue_root / state / job_id).is_dir()),
        None,
    )
    if terminal_dir is None:
        raise RuntimeError(f"job is not terminal: {job_id}")
    receipt_path = terminal_dir / "receipt.json"
    if not receipt_path.is_file():
        raise RuntimeError(f"terminal job has no receipt: {job_id}")
    receipt = json.loads(receipt_path.read_text())
    if receipt.get("job_id") != job_id:
        raise RuntimeError(f"receipt job identity mismatch: {job_id}")
    if receipt.get("job_type") != "mflux_flux2_edit_promptfile":
        raise RuntimeError(f"effective job type mismatch: {job_id}")
    if Path(receipt.get("input_path", "")).resolve() != expected_input.resolve():
        raise RuntimeError(f"effective input mismatch: {job_id}")
    if Path(receipt.get("output_dir", "")).resolve() != output_dir.resolve():
        raise RuntimeError(f"effective output directory mismatch: {job_id}")
    if receipt.get("status") != "done" or receipt.get("exit_code") != 0:
        raise RuntimeError(
            f"FLUX job failed at {receipt.get('failure_phase')}: "
            f"{receipt.get('error_message')}"
        )
    argv = receipt.get("effective_argv") or []
    if Path(_argument(argv, "--prompt-file") or "").resolve() != expected_prompt_file.resolve():
        raise RuntimeError(f"effective prompt file mismatch: {job_id}")
    if _argument(argv, "--seed") != str(expected_seed):
        raise RuntimeError(f"effective seed mismatch: {job_id}")
    if not receipt.get("effective_route"):
        raise RuntimeError(f"receipt has no effective route: {job_id}")
    output = output_dir / "output.png"
    if not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError(f"completed job has no output image: {job_id}")
    return {
        "jobId": job_id,
        "jobType": receipt["job_type"],
        "input": str(expected_input.resolve()),
        "inputSha256": digest(expected_input),
        "promptFile": str(expected_prompt_file.resolve()),
        "promptSha256": digest(expected_prompt_file),
        "seed": expected_seed,
        "output": str(output.resolve()),
        "outputSha256": digest(output),
        "receipt": str(receipt_path.resolve()),
        "effectiveRoute": receipt["effective_route"],
    }
