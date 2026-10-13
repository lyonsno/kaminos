"""Reference fixtures for the browser rig importer: UniMate's own preprocessing on rigged GLBs.

Runs ``data_process.rig_preprocess.pipeline.preprocess`` unchanged (offline 'rule' labels,
profile 'general', keep_intermediate) on each input, inside Blender, and writes for each asset
``<out>/<name>/fixture.json``: the export stage's rest arrays (joint names in export order,
parents, rest_local_pos, rest_local_rot w x y z), the clean labels and facing pair of the
annotation stage, and the cond.npy entry the model reads (parents, joint names, clean labels,
tpos_first_frame, joint_depths, joint_relations, joint_graph_dists, spectral_feats). The full
pipeline output stays in ``<out>/<name>/asset``.

Run with Blender's Python, the UniMate checkout and its dependencies on the path:
  Blender --background --python tests/export-rig-fixtures.py -- \\
    --unimate-root <UniMate> --deps <dir> --site <venv site-packages> --out <dir> a.glb b.glb ...
"""
import json
import sys
import traceback
from pathlib import Path

argv = sys.argv[sys.argv.index("--") + 1:]
opt = lambda n: argv[argv.index(n) + 1]
unimate, deps, site, out = Path(opt("--unimate-root")), Path(opt("--deps")), Path(opt("--site")), Path(opt("--out"))
inputs = [Path(a) for a in argv if a.endswith(".glb")]
rest_rotation = opt("--rest-rotation") if "--rest-rotation" in argv else None
sys.path[:0] = [str(deps), str(unimate)]
sys.path.append(str(site))

import numpy as np  # noqa: E402
from data_process.rig_preprocess.pipeline import preprocess  # noqa: E402

out.mkdir(parents=True, exist_ok=True)
summary = {}
for glb in inputs:
    name = glb.stem.lower().replace('-', '_').replace(' ', '_')   # upstream asset names hold no '-'
    dest = out / name
    try:
        if dest.exists():
            raise ValueError(f"{dest} exists; choose a fresh output directory")
        preprocess([str(glb)], str(dest / "asset"), profile="general", annotate_mode="rule", name=name,
                   keep_intermediate=True, review=False, preview=False, rest_rotation=rest_rotation)
        work = dest / "asset" / "work"
        npz = sorted((work / "export" / "motions").glob(f"{name}-*.npz"))[0]
        with np.load(npz, allow_pickle=True) as d:
            export = {"names": [str(n) for n in d["names"]], "parents": d["parents"].tolist(),
                      "rest_local_pos": d["rest_local_pos"].tolist(), "rest_local_rot": d["rest_local_rot"].tolist(),
                      "source_npz": npz.name}
        cond = np.load(dest / "asset" / "cond.npy", allow_pickle=True).item()[name]
        face = json.loads((work / "export" / "face_joint_names.json").read_text()).get(name)
        fixture = {
            "asset": glb.name, "rest_rotation": rest_rotation, "export": export,
            "annotation": {"clean": json.loads((work / "export" / "clean_joint_names.json").read_text()).get(name), "face": face},
            "cond": {k: (np.asarray(cond[k]).tolist() if not isinstance(cond[k], (list, str)) else list(cond[k]))
                     for k in ("parents", "joint_names", "clean_joint_names", "tpos_first_frame", "joint_depths",
                               "joint_relations", "joint_graph_dists", "spectral_feats")},
        }
        (dest / "fixture.json").write_text(json.dumps(fixture))
        summary[name] = {"status": "ok", "joints": len(cond["parents"]), "exported": len(export["names"])}
    except Exception as exc:  # noqa: BLE001 - every asset reports
        summary[name] = {"status": "failed", "error": repr(exc), "trace": traceback.format_exc()[-1500:]}
    print(json.dumps({name: summary[name]}), flush=True)
(out / "summary.json").write_text(json.dumps(summary, indent=1))
