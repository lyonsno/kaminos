"""Bind SAM reference evidence to the effective imported, pinned Python sources."""
import hashlib
import json
import os
import subprocess
from pathlib import Path


def capture_reference_source(source_file, expected_root=None):
    source = Path(source_file).resolve()
    root = Path(subprocess.check_output(["git", "-C", str(source.parent), "rev-parse", "--show-toplevel"], text=True).strip()).resolve()
    def git(*args):
        return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()
    requested_root = expected_root or os.environ.get("KAMINOS_MLX_VLM_ROOT")
    if requested_root and root != Path(requested_root).resolve():
        raise ValueError("SAM reference effective source root mismatch")
    pin = json.loads(Path(__file__).with_name("sam-mlx-reference-pin.json").read_text())
    commit = git("rev-parse", "HEAD")
    if commit != pin["commit"]:
        raise ValueError("SAM reference source commit mismatch")
    scope = ["mlx_vlm/models/sam3", "mlx_vlm/models/base.py", "mlx_vlm/utils.py"]
    paths = sorted(path for path in git("ls-files", "--", *scope).splitlines() if path.endswith(".py"))
    if str(source.relative_to(root)) not in paths:
        raise ValueError("SAM reference imported source is not tracked")
    dirty = [path for path in git("diff", "HEAD", "--name-only", "--", *scope).splitlines() if path.endswith(".py")]
    dirty += [path for path in git("ls-files", "--others", "--exclude-standard", "--", *scope).splitlines() if path.endswith(".py")]
    if dirty:
        raise ValueError(f"SAM reference Python source is dirty: {dirty}")
    hashes = {path: hashlib.sha256((root / path).read_bytes()).hexdigest() for path in paths}
    if hashes != pin["files"]:
        raise ValueError("SAM reference source hashes mismatch")
    return {"root": str(root), "commit": commit, "clean": True, "files": hashes}
