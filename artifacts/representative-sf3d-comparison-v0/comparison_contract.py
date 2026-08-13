"""Contract helpers for the representative SF3D comparison."""

import hashlib
import json
from pathlib import Path


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_campaign(root: Path, repo: Path) -> dict:
    campaign = json.loads((root / "campaign.json").read_text())
    if campaign.get("schema") != "kaminos.representative-sf3d-comparison.campaign.v0":
        raise RuntimeError("unexpected campaign schema")
    cells = campaign.get("cells") or []
    if len(cells) != 3:
        raise RuntimeError("campaign must contain exactly three representative cells")
    ids = [cell.get("id") for cell in cells]
    classes = [cell.get("class") for cell in cells]
    if len(set(ids)) != len(ids) or len(set(classes)) != len(classes):
        raise RuntimeError("campaign cells must have distinct ids and source classes")
    for cell in cells:
        source = repo / cell["source"]["path"]
        trellis = repo / cell["trellis"]["path"]
        if not source.is_file() or digest(source) != cell["source"]["sha256"]:
            raise RuntimeError(f"source drifted or is absent: {cell['id']}")
        if not trellis.is_file() or digest(trellis) != cell["trellis"]["sha256"]:
            raise RuntimeError(f"Trellis control drifted or is absent: {cell['id']}")
        ledger_path = repo / cell["trellis"]["ledger"]
        ledger = json.loads(ledger_path.read_text())
        row = (ledger.get("cells") or {}).get(cell["trellis"]["cell"])
        if row is None:
            raise RuntimeError(f"Trellis control is absent from its ledger: {cell['id']}")
        if row.get("inputSha256") and row["inputSha256"] != cell["source"]["sha256"]:
            raise RuntimeError(f"Trellis ledger input mismatch: {cell['id']}")
        if row.get("outputSha256") and row["outputSha256"] != cell["trellis"]["sha256"]:
            raise RuntimeError(f"Trellis ledger output mismatch: {cell['id']}")
    return campaign


def admit_sf3d_result(
    *, queue_root: Path, job_id: str, expected_input: Path, output_dir: Path
) -> dict:
    terminal_dir = next(
        (
            queue_root / state / job_id
            for state in ("done", "failed", "cancelled")
            if (queue_root / state / job_id).is_dir()
        ),
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
    if receipt.get("job_type") != "sf3d":
        raise RuntimeError(f"effective job type is not sf3d: {job_id}")
    if Path(receipt.get("input_path", "")).resolve() != expected_input.resolve():
        raise RuntimeError(f"effective input mismatch: {job_id}")
    if Path(receipt.get("output_dir", "")).resolve() != output_dir.resolve():
        raise RuntimeError(f"effective output directory mismatch: {job_id}")
    if receipt.get("status") != "done" or receipt.get("exit_code") != 0:
        raise RuntimeError(
            f"SF3D failed at {receipt.get('failure_phase')}: "
            f"{receipt.get('error_message')}"
        )
    effective_route = receipt.get("effective_route") or ""
    if "run_greenroom.py" not in effective_route:
        raise RuntimeError(f"effective SF3D runner is unproven: {job_id}")
    expected_defaults = {
        "dtype": "float16",
        "remesh": "none",
        "texture_resolution": "1024",
    }
    effective_defaults = receipt.get("effective_defaults") or {}
    if any(str(effective_defaults.get(key)) != value for key, value in expected_defaults.items()):
        raise RuntimeError(f"effective SF3D configuration mismatch: {job_id}")
    output = output_dir / "output.glb"
    if not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError(f"completed job has no output GLB: {job_id}")
    return {
        "jobId": job_id,
        "jobType": "sf3d",
        "input": str(expected_input.resolve()),
        "inputSha256": digest(expected_input),
        "output": str(output.resolve()),
        "outputSha256": digest(output),
        "outputBytes": output.stat().st_size,
        "receipt": str(receipt_path.resolve()),
        "effectiveRoute": effective_route,
        "effectiveCwd": receipt.get("effective_cwd"),
        "effectiveEnv": receipt.get("effective_env"),
        "effectiveDefaults": effective_defaults,
    }


def validate_complete_orbits(root: Path, ledger: dict) -> None:
    for cell_id, cell in ledger.get("cells", {}).items():
        for route_id in ("sf3d", "trellis"):
            if route_id not in cell.get("routes", {}):
                raise RuntimeError(f"missing route in evidence ledger: {cell_id}/{route_id}")
            manifest_path = root / "renders" / cell_id / route_id / "orbit-manifest.json"
            if not manifest_path.is_file():
                raise RuntimeError(f"missing six-view orbit: {cell_id}/{route_id}")
            manifest = json.loads(manifest_path.read_text())
            outputs = manifest.get("outputs") or []
            if manifest.get("status") != "completed" or len(outputs) != 6:
                raise RuntimeError(f"incomplete six-view orbit: {cell_id}/{route_id}")
            for item in outputs:
                output = Path(item["path"])
                if not output.is_file() or output.stat().st_size == 0:
                    raise RuntimeError(f"blank six-view orbit output: {cell_id}/{route_id}")
