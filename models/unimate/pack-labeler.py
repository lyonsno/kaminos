"""Pack UniMate's rule-based joint labeller for the browser (Pyodide).

The browser rig importer labels joints and picks the facing pair with UniMate's own
``data_process.rig_preprocess.annotate`` in its offline 'rule' mode, run unchanged under
Pyodide. This writes ``<out>/unimate-labeler.zip`` holding:

- the upstream modules that path imports, copied verbatim from a UniMate checkout, with its
  two data files (learned vocabulary and reviewed name map) and its MIT LICENSE;
- ``data_process/utils/skeleton.py`` replaced by a shim exporting only ``FACING_EPS`` (the one
  name the labeller uses; the full module needs the Motion library's Quaternions/Animation);
- minimal ``loguru`` and ``tqdm`` stand-ins (logging and progress only);
- ``unimate_browser_annotate.py``, the entry point: it writes the rest-pose export NPZ the
  labeller reads and returns ``annotate('rule', 'general', ...)``'s labels and facing pair.

and ``<out>/unimate-labeler.json`` naming the UniMate revision, every file and the zip's SHA-256.
"""

import argparse
import hashlib
import io
import json
import os
import subprocess
import zipfile

MODULES = [
    "data_process/__init__.py",
    "data_process/rig_preprocess/annotate.py",
    "data_process/joint_annotation/__init__.py",
    "data_process/joint_annotation/face_select_rule.py",
    "data_process/joint_annotation/name_map.py",
    "data_process/joint_annotation/learn_vocab.py",
    "data_process/joint_annotation/names_clean_rule.py",
    "data_process/joint_annotation/vocab.py",
    "data_process/joint_annotation/structure_rule.py",
    "data_process/joint_annotation/skeleton_parse.py",
    "data_process/joint_annotation/names_clean_llm.py",
    "data_process/joint_annotation/face_select_llm.py",
    "data_process/joint_annotation/llm.py",
    "data_process/joint_annotation/learned_vocab.json",
    "data_process/joint_annotation/learned_name_map.json.gz",
    "data_process/tools/__init__.py",
    "data_process/tools/patch_annotations.py",
    "data_process/utils/__init__.py",
    "data_process/utils/kinematics.py",
]

SKELETON_SHIM = '''"""Browser shim: the labeller needs only FACING_EPS from data_process.utils.skeleton."""
FACING_EPS = 1e-6
'''

LOGURU_STUB = '''"""Browser stand-in for loguru: collects messages instead of printing them."""
messages = []


class _Logger:
    def _log(self, level, message, *args, **kwargs):
        messages.append((level, str(message)))

    def debug(self, m, *a, **k): self._log("debug", m)
    def info(self, m, *a, **k): self._log("info", m)
    def warning(self, m, *a, **k): self._log("warning", m)
    def error(self, m, *a, **k): self._log("error", m)
    def success(self, m, *a, **k): self._log("success", m)
    def exception(self, m, *a, **k): self._log("error", m)
    def add(self, *a, **k): return 0
    def remove(self, *a, **k): pass
    def bind(self, *a, **k): return self
    def opt(self, *a, **k): return self


logger = _Logger()
'''

TQDM_STUB = '''"""Browser stand-in for tqdm: no progress bars."""


def tqdm(iterable=None, *args, **kwargs):
    return iterable if iterable is not None else []
'''

ENTRY = '''"""Browser entry point: label a rig's joints and pick its facing pair with UniMate's rule mode."""
import json
import os
import shutil
import tempfile

import numpy as np

from data_process.rig_preprocess.annotate import annotate
from data_process.utils.kinematics import fk


def label_rig(request_json):
    """request: {name, names, parents, rest_local_pos (J x 3), rest_local_rot (J x 4, w x y z)}.
    Returns {clean, face, notes} as JSON: clean labels in joint order, the face entry."""
    req = json.loads(request_json)
    name, raw = req["name"], list(req["names"])
    parents = np.asarray(req["parents"], dtype=np.int32)
    pos = np.asarray(req["rest_local_pos"], dtype=np.float64)
    rot = np.asarray(req["rest_local_rot"], dtype=np.float64)
    root = tempfile.mkdtemp()
    try:
        os.makedirs(os.path.join(root, "motions"))
        np.savez(os.path.join(root, "motions", f"{name}-rest_pose.npz"), parents=parents,
                 rest_local_pos=pos, rest_local_rot=rot, names=np.asarray(raw))
        clean, face, notes = annotate("rule", "general", name, raw, root, rest_pos=fk(pos, rot, parents))
    finally:
        shutil.rmtree(root, ignore_errors=True)
    return json.dumps({"clean": list(clean), "face": face, "notes": list(notes)})
'''


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--unimate-root", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    rev = subprocess.check_output(["git", "-C", args.unimate_root, "rev-parse", "HEAD"], text=True).strip()
    files = {}
    for rel in MODULES + ["LICENSE"]:
        path = os.path.join(args.unimate_root, rel)
        if rel.endswith("__init__.py") and not os.path.exists(path):
            files[rel] = b""
            continue
        with open(path, "rb") as f:
            files[rel] = f.read()
    files["data_process/utils/skeleton.py"] = SKELETON_SHIM.encode()
    files["loguru/__init__.py"] = LOGURU_STUB.encode()
    files["tqdm/__init__.py"] = TQDM_STUB.encode()
    files["unimate_browser_annotate.py"] = ENTRY.encode()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in sorted(files):
            info = zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, files[rel])
    data = buf.getvalue()
    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "unimate-labeler.zip"), "wb") as f:
        f.write(data)
    manifest = {
        "schema": "kaminos.unimate.labeler.v0",
        "file": "unimate-labeler.zip",
        "bytes": len(data),
        "sha256": sha256(data),
        "unimate_rev": rev,
        "entry": "unimate_browser_annotate.label_rig",
        "files": {rel: sha256(body) for rel, body in sorted(files.items())},
        "license": "UniMate code: MIT (LICENSE in the zip)",
    }
    with open(os.path.join(args.out, "unimate-labeler.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    print(f"{len(files)} files, {len(data)} bytes, UniMate {rev[:8]}")


if __name__ == "__main__":
    main()
