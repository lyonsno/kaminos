#!/usr/bin/env python3
"""Build the revision-050 source-to-FLUX-to-Trellis comparison surface."""

import hashlib
import html
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "revision-050-trellis-reconstruction.html"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def relative(path: Path) -> str:
    return Path(os.path.relpath(path.resolve(), ROOT.resolve())).as_posix()


def validate_campaign_bindings(
    selection: dict,
    flux_ledger: dict,
    trellis_ledger: dict,
    campaign_sha256: str,
    selection_sha256: str,
) -> list[str]:
    if flux_ledger.get("campaignSha256") != campaign_sha256:
        raise RuntimeError("FLUX result ledger does not bind the current campaign")
    if trellis_ledger.get("selectionSha256") != selection_sha256:
        raise RuntimeError("Trellis result ledger does not bind the current selection")
    cell_ids = [row["cellId"] for row in selection.get("candidates", [])]
    if len(cell_ids) != len(set(cell_ids)):
        raise RuntimeError("Trellis selection contains duplicate cells")
    if set(trellis_ledger.get("cells", {})) != set(cell_ids):
        raise RuntimeError("Trellis result ledger does not exactly cover the selection")
    if not set(cell_ids).issubset(flux_ledger.get("cells", {})):
        raise RuntimeError("FLUX result ledger does not cover every selected cell")
    return cell_ids


def validate_display_provenance(
    campaign: dict,
    candidate: dict,
    flux_record: dict,
    trellis_record: dict,
) -> tuple[dict, dict]:
    source_id = flux_record.get("sourceId")
    if candidate.get("sourceId", source_id) != source_id:
        raise RuntimeError("selected source does not match the authenticated FLUX source")
    source = campaign.get("sources", {}).get(source_id)
    if source is None:
        raise RuntimeError("authenticated FLUX source is absent from the campaign")
    families = {row["id"]: row for row in campaign.get("promptFamilies", [])}
    family = families.get(flux_record.get("family"))
    if family is None or family.get("prompt") != flux_record.get("prompt"):
        raise RuntimeError("displayed prompt does not match the authenticated FLUX record")
    if trellis_record.get("input") != flux_record.get("output"):
        raise RuntimeError("Trellis input path does not match the FLUX output")
    if trellis_record.get("inputSha256") != flux_record.get("outputSha256"):
        raise RuntimeError("Trellis input hash does not match the FLUX output")
    return source, family


def validated_orbit_outputs(manifest: dict) -> list[Path]:
    if manifest.get("status") != "completed":
        raise RuntimeError("orbit manifest is not completed")
    outputs = manifest.get("outputs") or []
    if len(outputs) != 6:
        raise RuntimeError("orbit manifest must contain exactly six frames")
    paths = []
    for row in outputs:
        path = Path(row.get("path", ""))
        if not path.is_file():
            raise RuntimeError(f"orbit frame is missing: {path}")
        if digest(path) != row.get("sha256"):
            raise RuntimeError(f"orbit frame hash mismatch: {path}")
        paths.append(path)
    return paths


def job_provenance_label(
    flux_route: dict,
    flux_record: dict,
    trellis_record: dict,
    trellis_route: dict,
) -> str:
    return (
        f"FLUX job {flux_record['jobId']} · {flux_route['model']} · seed {flux_record['seed']} · "
        f"{flux_route['steps']} steps · guidance {flux_route['guidance']} · "
        f"Trellis job {trellis_record['jobId']} · seed {trellis_route['seed']} · "
        f"{trellis_route['steps']} steps · {trellis_route['targetFaces']} target faces · "
        f"{trellis_route['textureSize']} texture"
    )


def checked_file(path: Path, expected_sha256: str, label: str) -> None:
    if not path.is_file() or digest(path) != expected_sha256:
        raise RuntimeError(f"{label} is missing or stale: {path}")


def main() -> None:
    campaign_path = ROOT / "campaign.json"
    selection_path = ROOT / "trellis-selection.json"
    flux_ledger_path = ROOT / "result-ledger.json"
    selection = json.loads(selection_path.read_text())
    campaign = json.loads(campaign_path.read_text())
    flux_ledger = json.loads(flux_ledger_path.read_text())
    trellis_ledger = json.loads((ROOT / "trellis-result-ledger.json").read_text())
    if selection.get("sourceCampaignSha256") != digest(campaign_path):
        raise RuntimeError("selection does not bind the current campaign")
    if selection.get("sourceResultLedgerSha256") != digest(flux_ledger_path):
        raise RuntimeError("selection does not bind the current FLUX result ledger")
    cell_ids = validate_campaign_bindings(
        selection,
        flux_ledger,
        trellis_ledger,
        digest(campaign_path),
        digest(selection_path),
    )
    candidates = {row["cellId"]: row for row in selection["candidates"]}
    trellis_route = selection["route"]
    cards = []
    for cell_id in cell_ids:
        candidate = candidates[cell_id]
        flux_record = flux_ledger["cells"][cell_id]
        trellis_record = trellis_ledger["cells"][cell_id]
        source, family = validate_display_provenance(
            campaign, candidate, flux_record, trellis_record
        )
        source_plate = ROOT / source["plate"]
        flux_output = ROOT / flux_record["output"]
        glb = ROOT / trellis_record["output"]
        prompt_file = ROOT / family["promptFile"]
        checked_file(source_plate, source["plateSha256"], "source plate")
        checked_file(flux_output, flux_record["outputSha256"], "FLUX output")
        checked_file(glb, trellis_record["outputSha256"], "Trellis GLB")
        if prompt_file.read_text().strip() != flux_record["prompt"]:
            raise RuntimeError(f"prompt file drifted for {cell_id}")
        manifest = json.loads((glb.parent / "orbit-manifest.json").read_text())
        if manifest.get("glb", {}).get("sha256") != trellis_record["outputSha256"]:
            raise RuntimeError(f"orbit does not bind the authenticated GLB for {cell_id}")
        frames = validated_orbit_outputs(manifest)
        frame_markup = "".join(
            f'<figure><img src="{esc(relative(frame))}" alt="{esc(cell_id)} orbit view {index + 1}">'
            f'<figcaption>{esc(manifest["outputs"][index]["label"])}</figcaption></figure>'
            for index, frame in enumerate(frames)
        )
        settings = job_provenance_label(
            campaign["fluxRoute"], flux_record, trellis_record, trellis_route
        )
        cards.append(
            f'<section><header><div><h2>{esc(cell_id)}</h2>'
            f'<p class="role">{esc(candidate["role"])}</p></div>'
            f'<div><p class="prompt">{esc(flux_record["prompt"])}</p>'
            f'<code>{esc(settings)}</code></div></header>'
            f'<p class="basis">Selection basis: {esc(candidate["visualBasis"])}</p>'
            '<div class="chain">'
            f'<article><h3>Authored source</h3><img src="{esc(relative(source_plate))}" '
            f'alt="{esc(flux_record["sourceId"])} authored source"><code>{esc(source["plateSha256"][:12])}</code></article>'
            f'<article><h3>FLUX elaboration</h3><img src="{esc(relative(flux_output))}" '
            f'alt="{esc(cell_id)} FLUX output"><code>{esc(flux_record["outputSha256"][:12])}</code></article>'
            f'<article class="orbit"><h3>Trellis six-view cast</h3><div class="frames">{frame_markup}</div>'
            f'<code>GLB {esc(trellis_record["outputSha256"][:12])} · {trellis_record["outputBytes"]:,} bytes · '
            f'{manifest["totalVertexCount"]:,} vertices</code></article></div></section>'
        )

    route = campaign["fluxRoute"]
    document = f"""<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Revision 050 FLUX to Trellis reconstruction</title>
<style>
:root{{--bg:#101214;--panel:#191c1f;--line:#363b40;--text:#f0eee9;--muted:#9ba3aa;--accent:#e2b861}}
*{{box-sizing:border-box}} body{{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}
main{{max-width:1800px;margin:auto;padding:26px}} h1{{margin:0 0 6px;font-size:28px;letter-spacing:0}} .lead{{max-width:1250px;color:var(--muted);margin:0 0 24px}}
section{{border-top:2px solid var(--line);padding:18px 0 27px}} header{{display:grid;grid-template-columns:minmax(300px,.8fr) 2fr;gap:18px;align-items:start}}
h2{{margin:0;color:var(--accent);font-size:18px;letter-spacing:0;overflow-wrap:anywhere}} .role,.basis{{color:var(--muted);margin:3px 0}} .prompt{{font-size:16px;margin:0 0 4px}}
code{{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#929ca3}} .chain{{display:grid;grid-template-columns:minmax(190px,.62fr) minmax(190px,.62fr) 2fr;gap:10px;margin-top:13px}}
article{{background:var(--panel);border:1px solid var(--line);padding:9px;min-width:0}} h3{{margin:0 0 7px;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:0}}
article>img{{display:block;width:100%;aspect-ratio:1/1;object-fit:contain;background:#0d0f10}} article>code{{display:block;margin-top:5px}} .frames{{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}}
figure{{margin:0;min-width:0}} figure img{{display:block;width:100%;aspect-ratio:1/1;object-fit:contain;background:#0d0f10}} figcaption{{font-size:9px;color:#7e888f;padding-top:2px}}
@media(max-width:980px){{main{{padding:14px}} header,.chain{{grid-template-columns:1fr}} .frames{{grid-template-columns:repeat(2,1fr)}}}}
</style><main>
<h1>Revision 050: authored carrier → FLUX → Trellis</h1>
<p class="lead">Six selected reconstructions from the species-converged carrier. Every row keeps the authored source, exact prompt, FLUX output, effective settings, and authenticated six-view GLB adjacent. FLUX: {esc(route['model'])}, {route['steps']} steps, guidance {route['guidance']}. Trellis: seed {trellis_route['seed']}, {trellis_route['steps']} steps, {trellis_route['targetFaces']} target faces.</p>
{''.join(cards)}</main>"""
    OUT.write_text(document)
    print(json.dumps({"status": "built", "sheet": str(OUT), "rows": len(cards)}, indent=2))


if __name__ == "__main__":
    main()
