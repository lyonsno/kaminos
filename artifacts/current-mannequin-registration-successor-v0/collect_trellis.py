#!/usr/bin/env python3
"""Freeze Trellis receipts, render authenticated orbits, and build the cast sheet."""

import hashlib
import html
import json
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
LEDGER = json.loads((ROOT / "trellis-submission-ledger.json").read_text())
GREENROOM = Path("/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom")
QUEUE = Path.home() / ".local/state/gpu-greenroom"
BLENDER = Path("/Applications/Blender.app/Contents/MacOS/Blender")
ORBIT_SCRIPT = ROOT.parent / "triradial-skeleton-proposal-fan-v0/trellis/render-glb-orbit.py"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def make_manifest_portable(manifest_path: Path) -> dict:
    manifest = json.loads(manifest_path.read_text())
    for record in [manifest["glb"], *manifest["outputs"]]:
        path = Path(record["path"])
        record["path"] = str(path.relative_to(ROOT)) if path.is_absolute() else str(path)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main() -> None:
    receipts = ROOT / "trellis-receipts"
    receipts.mkdir(exist_ok=True)
    casts = []
    for job in LEDGER["jobs"]:
        status = json.loads(subprocess.check_output([str(GREENROOM), "status", job["jobId"]], text=True))
        if status["status"] != "done":
            raise RuntimeError(f"{job['jobId']} is {status['status']}, not done")
        receipt = receipts / f"{job['jobId']}.json"
        shutil.copyfile(QUEUE / "done" / job["jobId"] / "receipt.json", receipt)
        glb = ROOT / job["outputDir"] / "output.glb"
        glb_hash = sha256(glb)
        orbit_dir = ROOT / job["outputDir"] / "orbit"
        manifest = ROOT / job["outputDir"] / "orbit-manifest.json"
        failure = ROOT / job["outputDir"] / "orbit-failure.json"
        command = [
            str(BLENDER), "--background", "--python", str(ORBIT_SCRIPT), "--",
            "--glb", str(glb), "--expected-sha256", glb_hash,
            "--out-dir", str(orbit_dir), "--manifest", str(manifest),
            "--failure", str(failure),
        ]
        subprocess.run(command, check=True)
        make_manifest_portable(manifest)
        casts.append(
            {
                "promptId": job["promptId"],
                "seed": job["seed"],
                "jobId": job["jobId"],
                "sourceImagePath": job["inputPath"],
                "glbPath": str(glb.relative_to(ROOT)),
                "glbSha256": glb_hash,
                "receiptPath": str(receipt.relative_to(ROOT)),
                "orbitManifestPath": str(manifest.relative_to(ROOT)),
            }
        )

    payload = {"campaign": "current-mannequin-registration-successor-v0", "casts": casts}
    (ROOT / "trellis-results.json").write_text(json.dumps(payload, indent=2) + "\n")
    columns = []
    for cast in casts:
        manifest = json.loads((ROOT / cast["orbitManifestPath"]).read_text())
        images = "".join(
            f'<figure><img src="{html.escape(view["path"])}"><figcaption>{html.escape(view["label"])}</figcaption></figure>'
            for view in manifest["outputs"]
        )
        columns.append(
            f'<section><h2>{html.escape(cast["promptId"])} · seed {cast["seed"]}</h2><p>{cast["glbSha256"]}</p><div class="orbit">{images}</div></section>'
        )
    sheet = f'''<!doctype html><html><head><meta charset="utf-8"><title>Trellis registration screen</title>
    <style>body{{margin:0;background:#151817;color:#eef1ed;font:14px system-ui}}main{{max-width:1800px;margin:auto;padding:24px}}.casts{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}}section{{border:1px solid #39423d;background:#1c211f;padding:12px;border-radius:6px}}h2{{font-size:17px}}p{{font:11px ui-monospace;color:#8f9993;overflow-wrap:anywhere}}.orbit{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}}figure{{margin:0}}img{{display:block;width:100%;background:#0d100f}}figcaption{{padding:4px;color:#aeb7b1}}</style></head>
    <body><main><h1>Authenticated six-view Trellis casts</h1><div class="casts">{''.join(columns)}</div></main></body></html>'''
    (ROOT / "trellis-screen.html").write_text(sheet)


if __name__ == "__main__":
    main()
