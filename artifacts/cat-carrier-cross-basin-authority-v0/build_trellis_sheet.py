#!/usr/bin/env python3
"""Build the source-adjacent Flux-to-Trellis reconstruction surface."""

import hashlib
import html
import json
import os
from pathlib import Path

from collect_trellis import effective_route_errors


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "trellis-reconstruction.html"
VERDICTS = {
    "revision-048-dragon-seed80301": (
        "Strong admitted reconstruction. The high neck, shoulder and hindquarter masses, "
        "stance, tail, horns, and dorsal ridge remain coherent through a full orbit."
    ),
    "revision-048-golem-seed80301": (
        "Strong admitted reconstruction. Rigid plates become coherent three-dimensional "
        "components while the authored carrier remains legible from every side."
    ),
    "revision-048-phantom-seed80302": (
        "Admitted geometry with a caveat: the carrier remains coherent and tendril-like "
        "surface structure survives, but several image-borne flank details become arbitrary volume."
    ),
    "revision-048-maquette-seed80301": (
        "Admitted neutral reconstruction. It closes into a coherent quadruped and retains the "
        "carrier's angular mass organization rather than replacing it with a generic animal."
    ),
    "revision-048-skin-seed80302": (
        "Admitted continuous-surface reconstruction. It is coherent across the orbit, but Trellis "
        "smooths the authored planes into a heavier bear-like body."
    ),
    "revision-048-fur-seed80302": (
        "Macro-volume only. The body remains recognizable, but the MLX route decodes the coat as "
        "dense shard geometry; this is not admitted as usable hair or production surface."
    ),
}


def load(name: str) -> dict:
    return json.loads((ROOT / name).read_text())


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def relative(path: Path) -> str:
    return Path(os.path.relpath(path.resolve(), ROOT.resolve())).as_posix()


def validate_reconstruction_bindings(selection: dict, ledger: dict, selection_sha256: str) -> list[str]:
    if ledger.get("selectionSha256") != selection_sha256:
        raise RuntimeError("Trellis result ledger does not bind the current selection")
    candidate_ids = [candidate["cellId"] for candidate in selection.get("candidates", [])]
    if len(candidate_ids) != len(set(candidate_ids)):
        raise RuntimeError("Trellis selection contains duplicate candidate ids")
    if set(ledger.get("cells", {})) != set(candidate_ids):
        raise RuntimeError("Trellis result ledger does not exactly cover the selected candidates")
    return candidate_ids


def validate_flux_ledger_binding(flux_ledger: dict, campaign_sha256: str) -> None:
    if flux_ledger.get("campaignSha256") != campaign_sha256:
        raise RuntimeError("Flux result ledger does not bind the current campaign")


def validate_display_provenance(
    campaign: dict,
    flux_record: dict,
    trellis_record: dict,
    route: dict,
    expected_input: str,
    expected_output: str,
) -> dict:
    families = {family["id"]: family for family in campaign.get("promptFamilies", [])}
    family = families.get(flux_record.get("family"))
    if family is None or family.get("prompt") != flux_record.get("prompt"):
        raise RuntimeError("displayed prompt does not match the authenticated Flux record and current campaign")
    if trellis_record.get("input") != flux_record.get("output"):
        raise RuntimeError("Trellis input path does not match the authenticated Flux output")
    if trellis_record.get("inputSha256") != flux_record.get("outputSha256"):
        raise RuntimeError("Trellis input hash does not match the authenticated Flux output")
    expected = {
        "input": expected_input,
        "output": expected_output,
        "seed": route["seed"],
        "steps": route["steps"],
        "targetFaces": route["targetFaces"],
        "textureSize": route["textureSize"],
    }
    if effective_route_errors(trellis_record.get("effectiveRoute") or "", expected):
        raise RuntimeError("displayed Trellis route does not match the authenticated effective route")
    return family


def job_provenance_label(flux_record: dict, trellis_record: dict, route: dict) -> str:
    return (
        f"Flux job {flux_record['jobId']} · Trellis job {trellis_record['jobId']} · "
        f"Trellis seed {route['seed']} · {route['steps']} steps · "
        f"{route['targetFaces']} target faces · {route['textureSize']} texture"
    )


def validated_orbit_outputs(manifest: dict) -> list[Path]:
    if manifest.get("status") != "completed":
        raise RuntimeError("orbit manifest is not completed")
    outputs = manifest.get("outputs") or []
    if len(outputs) != 6:
        raise RuntimeError("orbit manifest must contain exactly six views")
    paths = []
    for output in outputs:
        path = Path(output.get("path", ""))
        if not path.is_file():
            raise RuntimeError(f"orbit frame is missing: {path}")
        if sha256(path) != output.get("sha256"):
            raise RuntimeError(f"orbit frame hash does not match its manifest: {path}")
        paths.append(path)
    return paths


def main() -> None:
    selection_path = ROOT / "trellis-selection.json"
    campaign_path = ROOT / "campaign.json"
    selection = load("trellis-selection.json")
    ledger = load("trellis-result-ledger.json")
    campaign = load("campaign.json")
    flux_ledger = load("result-ledger.json")
    validate_flux_ledger_binding(flux_ledger, sha256(campaign_path))
    cell_ids = validate_reconstruction_bindings(selection, ledger, sha256(selection_path))
    selected = {candidate["cellId"]: candidate for candidate in selection["candidates"]}
    route = selection["route"]
    cards = []
    for cell_id in cell_ids:
        record = ledger["cells"][cell_id]
        flux_record = flux_ledger["cells"].get(cell_id)
        if flux_record is None:
            raise RuntimeError(f"Flux result ledger does not contain {cell_id}")
        candidate = selected[cell_id]
        family_id = cell_id.removeprefix("revision-048-").rsplit("-seed", 1)[0]
        flux_input = ROOT / record["input"]
        glb = ROOT / record["output"]
        family = validate_display_provenance(
            campaign,
            flux_record,
            record,
            route,
            str(flux_input.resolve()),
            str(glb.resolve()),
        )
        prompt_path = ROOT / family["promptFile"]
        if (
            not prompt_path.is_file()
            or hashlib.sha256(prompt_path.read_text().strip().encode()).hexdigest()
            != flux_record.get("promptSha256")
        ):
            raise RuntimeError(f"current prompt file does not match the authenticated Flux record for {cell_id}")
        if prompt_path.read_text().strip() != flux_record["prompt"]:
            raise RuntimeError(f"current prompt text does not match the authenticated Flux record for {cell_id}")
        manifest_path = glb.parent / "orbit-manifest.json"
        if not flux_input.is_file() or sha256(flux_input) != record["inputSha256"]:
            raise RuntimeError(f"Flux input is missing or stale for {cell_id}")
        if not glb.is_file() or sha256(glb) != record["outputSha256"]:
            raise RuntimeError(f"Trellis GLB is missing or stale for {cell_id}")
        manifest = json.loads(manifest_path.read_text())
        if manifest.get("glb", {}).get("sha256") != record["outputSha256"]:
            raise RuntimeError(f"orbit manifest does not bind the authenticated GLB for {cell_id}")
        frames = validated_orbit_outputs(manifest)
        frame_markup = "".join(
            f'<figure><img src="{esc(relative(frame))}" alt="{esc(cell_id)} orbit view {index + 1}">'
            f'<figcaption>{esc(manifest["outputs"][index]["label"])}</figcaption></figure>'
            for index, frame in enumerate(frames)
        )
        cards.append(
            f'<section><header><div><h2>{esc(family_id)}</h2><p>{esc(candidate["role"])}</p></div>'
            f'<div class="prompt"><b>Flux prompt</b><span>{esc(flux_record["prompt"])}</span>'
            f'<code>{esc(job_provenance_label(flux_record, record, route))}</code></div></header>'
            f'<p class="verdict">{esc(VERDICTS[cell_id])}</p>'
            '<div class="comparison">'
            f'<div class="input"><h3>Flux input to Trellis</h3><img src="{esc(relative(flux_input))}" alt="{esc(cell_id)} Flux input">'
            f'<code>{esc(record["inputSha256"][:12])}</code></div>'
            f'<div class="orbit"><h3>Authenticated six-view reconstruction</h3><div class="frames">{frame_markup}</div>'
            f'<p><code>GLB {esc(record["outputSha256"][:12])} · {record["outputBytes"]:,} bytes · {manifest["totalVertexCount"]:,} vertices</code></p></div>'
            '</div></section>'
        )

    document = f"""<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Flux to Trellis reconstruction comparison</title>
<style>
  :root{{--bg:#101214;--panel:#191c1f;--line:#353a3f;--text:#f0eee9;--muted:#9ba3aa;--accent:#e2b861}}
  *{{box-sizing:border-box}} body{{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}
  main{{max-width:1700px;margin:auto;padding:26px}} h1{{margin:0 0 6px;font-size:27px;letter-spacing:0}} .lead{{max-width:1150px;color:var(--muted);margin:0 0 25px}}
  section{{border-top:2px solid var(--line);padding:19px 0 27px}} section>header{{display:grid;grid-template-columns:210px 1fr;gap:18px}}
  h2{{margin:0;color:var(--accent);font-size:20px;letter-spacing:0}} header p{{margin:2px 0;color:var(--muted)}} .prompt{{display:grid;grid-template-columns:90px 1fr;gap:3px 12px}}
  .prompt code{{grid-column:2}} code{{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#929ca3}} .verdict{{max-width:1150px;color:#d6dadd;margin:10px 0 13px}}
  .comparison{{display:grid;grid-template-columns:minmax(220px,.68fr) 2fr;gap:12px;align-items:start}} .input,.orbit{{background:var(--panel);border:1px solid var(--line);padding:10px}}
  h3{{margin:0 0 8px;font-size:12px;text-transform:uppercase;color:var(--muted);letter-spacing:0}} .input img{{display:block;width:100%;aspect-ratio:1/1;object-fit:contain;background:#0d0f10}}
  .input code{{display:block;margin-top:6px}} .frames{{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}} figure{{margin:0;min-width:0}} figure img{{display:block;width:100%;aspect-ratio:1/1;object-fit:contain;background:#0d0f10}}
  figcaption{{font-size:10px;color:#848e95;padding-top:3px}} .orbit>p{{margin:7px 0 0}}
  @media(max-width:900px){{main{{padding:14px}} section>header,.comparison{{grid-template-columns:1fr}} .frames{{grid-template-columns:repeat(2,1fr)}}}}
</style>
<main>
  <h1>Flux-to-Trellis reconstruction comparison</h1>
  <p class="lead">Six visually distinct revision-048 completion mechanisms were reconstructed through one authenticated route and one fixed Trellis seed. The orbit is evidence of three-dimensional coherence, not merely agreement with the conditioning view. Effective route: {esc(route['jobType'])}, seed {route['seed']}, {route['steps']} steps, {route['targetFaces']} target faces, {route['textureSize']} texture.</p>
  {''.join(cards)}
</main>
"""
    OUT.write_text(document)
    print(json.dumps({"status": "built", "sheet": str(OUT), "reconstructions": len(cards)}, indent=2))


if __name__ == "__main__":
    main()
