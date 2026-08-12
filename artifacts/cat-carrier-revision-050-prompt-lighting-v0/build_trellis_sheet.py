#!/usr/bin/env python3
"""Build source-to-FLUX-to-Trellis comparisons for the selected continuation."""

import hashlib
import html
import json
import os
from pathlib import Path

from trellis_contract import validate_result_coverage, validated_orbit_outputs


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "prompt-lighting-trellis-sheet.html"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def relative(path: Path) -> str:
    return Path(os.path.relpath(path.resolve(), ROOT.resolve())).as_posix()


def main() -> None:
    selection_path = ROOT / "trellis-selection.json"
    selection = json.loads(selection_path.read_text())
    flux_ledger_path = ROOT / selection["sourceResultLedger"]
    if selection["sourceResultLedgerSha256"] != digest(flux_ledger_path):
        raise RuntimeError("selection does not bind the current FLUX result ledger")
    flux_ledger = json.loads(flux_ledger_path.read_text())
    flux_cells = {row["id"]: row for row in flux_ledger["cells"]}
    trellis_ledger = json.loads((ROOT / "trellis-result-ledger.json").read_text())
    cell_ids = validate_result_coverage(selection, trellis_ledger, digest(selection_path))
    candidates = {row["cellId"]: row for row in selection["candidates"]}
    source_path = ROOT / "../cat-carrier-revision-050-camera-authority-v0/source/revision-050-matched/plate.png"
    source_path = source_path.resolve()
    source_sha = flux_cells[cell_ids[0]]["sourceSha256"]
    if not source_path.is_file() or digest(source_path) != source_sha:
        raise RuntimeError("authored source plate is missing or stale")
    cards = []
    for cell_id in cell_ids:
        flux = flux_cells[cell_id]
        cast = trellis_ledger["cells"][cell_id]
        flux_output = ROOT / flux["output"]
        glb = ROOT / cast["output"]
        if digest(flux_output) != flux["outputSha256"]:
            raise RuntimeError(f"FLUX output is missing or stale: {cell_id}")
        if cast["input"] != flux["output"] or cast["inputSha256"] != flux["outputSha256"]:
            raise RuntimeError(f"Trellis input does not bind the FLUX output: {cell_id}")
        if digest(glb) != cast["outputSha256"]:
            raise RuntimeError(f"Trellis GLB is missing or stale: {cell_id}")
        manifest = json.loads((glb.parent / "orbit-manifest.json").read_text())
        if manifest.get("glb", {}).get("sha256") != cast["outputSha256"]:
            raise RuntimeError(f"orbit does not bind the Trellis GLB: {cell_id}")
        frames = validated_orbit_outputs(manifest)
        frame_markup = "".join(
            f'<figure><img src="{esc(relative(frame))}" alt="{esc(cell_id)} orbit view {index + 1}">'
            f'<figcaption>{esc(manifest["outputs"][index]["label"])}</figcaption></figure>'
            for index, frame in enumerate(frames)
        )
        candidate = candidates[cell_id]
        cards.append(
            f'<section><header><div><h2>{esc(cell_id)}</h2><p>{esc(candidate["role"])}</p></div>'
            f'<div class="prompt">{esc(flux["prompt"])}</div></header>'
            f'<p class="basis">{esc(candidate["visualBasis"])}</p><div class="chain">'
            f'<article><h3>Authored carrier</h3><img src="{esc(relative(source_path))}" alt="authored revision-050 carrier">'
            f'<code>{esc(source_sha[:12])}</code></article>'
            f'<article><h3>FLUX plate</h3><img src="{esc(relative(flux_output))}" alt="{esc(cell_id)} FLUX output">'
            f'<code>{esc(flux["outputSha256"][:12])} · seed {flux["seed"]}</code></article>'
            f'<article class="orbit"><h3>Trellis six-view cast</h3><div class="frames">{frame_markup}</div>'
            f'<code>GLB {esc(cast["outputSha256"][:12])} · {cast["outputBytes"]:,} bytes · '
            f'{manifest["totalVertexCount"]:,} vertices</code></article></div>'
            f'<p class="route">FLUX job {esc(flux["jobId"])} · Trellis job {esc(cast["jobId"])} · '
            f'{esc(cast["effectiveRoute"])}</p></section>'
        )
    route = selection["route"]
    OUT.write_text(f"""<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Revision 050 prompt and lighting Trellis continuation</title>
<style>
:root{{--bg:#101214;--panel:#191c1f;--line:#363b40;--text:#f0eee9;--muted:#9ba3aa;--accent:#e2b861}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}
main{{max-width:1800px;margin:auto;padding:26px}}h1{{margin:0 0 6px;font-size:28px;letter-spacing:0}}.lead,.basis,.route,header p{{color:var(--muted)}}
section{{border-top:2px solid var(--line);padding:18px 0 27px}}header{{display:grid;grid-template-columns:minmax(280px,.8fr) 2fr;gap:18px;align-items:start}}
h2{{margin:0;color:var(--accent);font-size:18px;letter-spacing:0;overflow-wrap:anywhere}}header p,.basis{{margin:3px 0}}.prompt{{font-size:16px}}
.chain{{display:grid;grid-template-columns:minmax(190px,.62fr) minmax(190px,.62fr) 2fr;gap:10px;margin-top:13px}}
article{{background:var(--panel);border:1px solid var(--line);padding:9px;min-width:0}}h3{{margin:0 0 7px;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:0}}
article>img{{display:block;width:100%;aspect-ratio:1/1;object-fit:contain;background:#0d0f10}}code,.route{{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#929ca3;overflow-wrap:anywhere}}
.frames{{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}}figure{{margin:0;min-width:0}}figure img{{display:block;width:100%;aspect-ratio:1/1;object-fit:contain;background:#0d0f10}}figcaption{{font-size:9px;color:#7e888f;padding-top:2px}}
@media(max-width:980px){{main{{padding:14px}}header,.chain{{grid-template-columns:1fr}}.frames{{grid-template-columns:repeat(2,1fr)}}}}
</style><main><h1>Revision 050: prompt and lighting → Trellis</h1>
<p class="lead">Five selected FLUX plates reconstructed through {esc(route['jobType'])}: seed {route['seed']}, {route['steps']} steps, {route['targetFaces']} target faces, {route['textureSize']} texture. Existing neutral dragon reconstruction remains the lighting control.</p>
{''.join(cards)}</main>""")
    print(json.dumps({"status": "built", "sheet": str(OUT), "rows": len(cards)}, indent=2))


if __name__ == "__main__":
    main()
