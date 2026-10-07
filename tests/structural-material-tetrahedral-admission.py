import importlib.metadata
import json
import pathlib
import runpy
import sys
import tempfile
import types
from unittest.mock import patch

import numpy as np

fixture = json.loads(pathlib.Path(sys.argv[1]).read_text())
observed_return = tuple(np.asarray(field["values"], dtype=field["dtype"]) for field in fixture["bindingReturn"])
script = pathlib.Path(__file__).resolve().parents[1] / "structural-material-shard-tetrahedralize.py"
for volume in [-fixture["admittedSourceVolume"], float("nan"), float("inf"), 0]:
    called = []

    class ReplayMesher:
        def __init__(self, **kwargs):
            called.append(kwargs)

        def set_mesh(self, *args):
            pass

        def tetrahedralize(self):
            pass

        def get_tet_mesh(self, **kwargs):
            return observed_return

    with tempfile.TemporaryDirectory() as directory:
        source = pathlib.Path(directory) / "source.json"
        output = pathlib.Path(directory) / "report.json"
        source.write_text(json.dumps({"status": "passed", "route": "imported-whole-solid-manifold-3.5.4", "sourceSha256": fixture["sourceSha256"], "volume": volume,
                                     "vertices": [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], "triangles": [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]]}))
        original_cwd = pathlib.Path.cwd()
        try:
            with patch.object(sys, "argv", [str(script), str(source), str(output)]), patch.dict(sys.modules, {"wildmeshing": types.SimpleNamespace(Tetrahedralizer=ReplayMesher)}), patch.object(importlib.metadata, "version", return_value="0.4.1"):
                try:
                    runpy.run_path(str(script), run_name="__main__")
                except ValueError:
                    pass
            report = json.loads(output.read_text())
            assert report["status"] == "failed", f"Invalid source volume {volume} admitted: {report.get('relativeVolumeError')}"
            assert report["phase"] == "input" and not called, "Invalid source volume must reject before mesher execution"
            assert "volume" in report["failure"]["message"]
        finally:
            import os
            os.chdir(original_cwd)
print("Invalid source volume fails before meshing; observed binding arrays replayed only for local admission, not backend conformance")
