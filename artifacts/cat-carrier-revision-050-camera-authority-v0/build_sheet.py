#!/usr/bin/env python3
"""Build the adjacent revision-048/050 morphology and camera authority sheet."""

import hashlib
import html
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "revision-050-camera-authority.html"


def load(path: Path) -> dict:
    return json.loads(path.read_text())


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def relative(path: Path) -> str:
    return Path(os.path.relpath(path.resolve(), ROOT.resolve())).as_posix()


def image(path: Path, label: str, evidence: str, attributes: str = "") -> str:
    if not path.is_file():
        raise FileNotFoundError(path)
    return (
        f'<figure {attributes}><img src="{esc(relative(path))}" alt="{esc(label)}">'
        f'<figcaption><b>{esc(label)}</b><span>{esc(evidence)}</span>'
        f'<code>{esc(digest(path))}</code></figcaption></figure>'
    )


def validate_effective_route(results: dict, route: dict) -> str:
    expected = {
        "model": str(route["model"]),
        "quantize": str(route["quantize"]),
        "width": str(route["width"]),
        "height": str(route["height"]),
        "steps": str(route["steps"]),
        "guidance": str(route["guidance"]),
        "mlx_cache_limit_gb": str(route["mlxCacheLimitGb"]),
    }
    for cell_id, record in results["cells"].items():
        params = record.get("effectiveParams") or {}
        mismatches = {
            key: (params.get(key), value)
            for key, value in expected.items()
            if params.get(key) != value
        }
        if mismatches:
            raise RuntimeError(f"{cell_id} carries mixed settings: {mismatches}")
    return (
        f'{expected["model"]} · q{expected["quantize"]} · '
        f'{expected["width"]}x{expected["height"]} · {expected["steps"]} steps · '
        f'guidance {expected["guidance"]} · MLX cache {expected["mlx_cache_limit_gb"]} GiB'
    )


def main() -> None:
    campaign_path = ROOT / "campaign.json"
    submissions_path = ROOT / "submissions.json"
    ledger_path = ROOT / "result-ledger.json"
    if (ROOT / "collection-state.json").exists():
        raise RuntimeError("collection state still exists; terminal evidence is incomplete")
    campaign = load(campaign_path)
    submissions = load(submissions_path)
    results = load(ledger_path)
    if results.get("campaignSha256") != digest(campaign_path):
        raise RuntimeError("result ledger does not bind the current campaign")
    if results.get("submissionsSha256") != digest(submissions_path):
        raise RuntimeError("result ledger does not bind the current submissions")
    expected_ids = {cell["id"] for cell in campaign["cells"]}
    if set(results.get("cells", {})) != expected_ids:
        raise RuntimeError("result ledger does not cover all 20 new cells")

    families = {row["id"]: row for row in campaign["promptFamilies"]}
    settings = validate_effective_route(results, campaign["fluxRoute"])
    sources = campaign["sources"]
    source_paths = {
        source_id: ROOT / source["plate"] for source_id, source in sources.items()
    }
    for source_id, path in source_paths.items():
        if digest(path) != sources[source_id]["plateSha256"]:
            raise RuntimeError(f"{source_id} source plate drifted")

    control_rows = campaign["comparisonControls"]
    prior_root = (ROOT / control_rows[0]["campaignRoot"]).resolve()
    prior_ledger_path = prior_root / "result-ledger.json"
    if any(row["campaignLedgerSha256"] != digest(prior_ledger_path) for row in control_rows):
        raise RuntimeError("revision-048 control ledger drifted")
    prior_campaign = load(prior_root / "campaign.json")
    prior_source = prior_root / prior_campaign["sources"]["revision-048"]["plate"]
    prior_source_hash = prior_campaign["sources"]["revision-048"]["plateSha256"]
    if digest(prior_source) != prior_source_hash:
        raise RuntimeError("revision-048 control source drifted")

    controls = {row["cellId"]: row for row in control_rows}
    interpretations = {
        "dragon": (
            "Across matched seeds, revision 050 materially increases source authority over neck, "
            "back, pelvis, and limb spacing, although the dragon prior still applies the strongest "
            "body regularization of these four basins. Camera sign survives both oblique directions."
        ),
        "golem": (
            "Revision 050 materially increases source authority under heavy stone restyling: the long "
            "back, lifted neck, tapered head, tail, and limb organization remain authored rather than "
            "being replaced by a generic golem. Camera sign survives both oblique directions."
        ),
        "maquette": (
            "Revision 050 materially increases source authority most cleanly in this structure-led "
            "basin; all three seeds preserve the carrier's proportions and stance while adding local "
            "finish. Camera sign survives both oblique directions with tight limb-overlap correspondence."
        ),
        "cat": (
            "Revision 050 materially increases source authority over revision 048, especially in neck "
            "length, back line, pelvic height, and stance. The literal class prompt still regularizes "
            "toward an ordinary cat more than the structure-led prompts. Camera sign survives both "
            "oblique directions."
        ),
    }
    sections = []
    for family_id, family in families.items():
        control_cells = []
        matched_cells = []
        for seed in campaign["seeds"]:
            control_id = f"revision-048-{family_id}-seed{seed}"
            control = controls[control_id]
            control_output = prior_root / control["output"]
            if digest(control_output) != control["outputSha256"]:
                raise RuntimeError(f"{control_id} output drifted")
            control_cells.append(
                image(
                    control_output,
                    f"seed {seed}",
                    "frozen prior result",
                    f'data-control-cell-id="{esc(control_id)}"',
                )
            )
            current_id = f"revision-050-matched-{family_id}-seed{seed}"
            current = results["cells"][current_id]
            current_output = ROOT / current["output"]
            if digest(current_output) != current["outputSha256"]:
                raise RuntimeError(f"{current_id} output drifted")
            matched_cells.append(
                image(
                    current_output,
                    f"seed {seed}",
                    f'job {current["jobId"]}',
                    f'data-new-cell-id="{esc(current_id)}"',
                )
            )

        camera_cells = []
        matched_id = f"revision-050-matched-{family_id}-seed80301"
        matched = results["cells"][matched_id]
        camera_cells.append(
            image(
                ROOT / matched["output"],
                "near profile",
                f'reuse job {matched["jobId"]}',
                f'data-reuse-cell-id="{esc(matched_id)}"',
            )
        )
        for source_id, label in (
            ("revision-050-oblique-negative-35", "front-biased oblique"),
            ("revision-050-oblique-positive-35", "rear-biased oblique"),
        ):
            cell_id = f"{source_id}-{family_id}-seed80301"
            record = results["cells"][cell_id]
            camera_cells.append(
                image(
                    ROOT / record["output"],
                    label,
                    f'job {record["jobId"]}',
                    f'data-new-cell-id="{esc(cell_id)}"',
                )
            )

        sections.append(
            f"""
<section>
  <header><div><h2>{esc(family_id)}</h2><p>{esc(interpretations[family_id])}</p></div>
    <div class="prompt"><b>Prompt</b><span>{esc(family['prompt'])}</span><code>{esc(settings)}</code></div>
  </header>
  <h3>Morphology delta <span>same camera, prompt, and seeds</span></h3>
  <div class="comparison morphology">
    <div class="rowhead"><b>Frozen revision 048 control</b><span>Independent frozen plate and prior authenticated outputs.</span></div>
    {image(prior_source, 'revision 048 source', f'sha256 {prior_source_hash}')}
    {''.join(control_cells)}
    <div class="rowhead"><b>Current revision 050</b><span>More species-specific authored carrier.</span></div>
    {image(source_paths['revision-050-matched'], 'revision 050 source', f"sha256 {sources['revision-050-matched']['plateSha256']}")}
    {''.join(matched_cells)}
  </div>
  <h3>Camera authority <span>revision 050, seed 80301</span></h3>
  <div class="comparison camera">
    <div class="rowhead"><b>Conditioning views</b><span>Exact frozen source plates.</span></div>
    {image(source_paths['revision-050-matched'], 'near profile source', f"sha256 {sources['revision-050-matched']['plateSha256']}")}
    {image(source_paths['revision-050-oblique-negative-35'], 'front-biased source', f"sha256 {sources['revision-050-oblique-negative-35']['plateSha256']}")}
    {image(source_paths['revision-050-oblique-positive-35'], 'rear-biased source', f"sha256 {sources['revision-050-oblique-positive-35']['plateSha256']}")}
    <div class="rowhead"><b>Generated outputs</b><span>Same prompt, settings, and seed.</span></div>
    {''.join(camera_cells)}
  </div>
</section>"""
        )

    document = f"""<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Revision 050 morphology and camera authority</title>
<style>
:root{{--bg:#101214;--panel:#191c1f;--line:#343a3f;--text:#f1eee8;--muted:#9ca5ac;--accent:#e1b65d}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}
main{{max-width:1740px;margin:auto;padding:26px}}h1{{font-size:27px;margin:0 0 6px;letter-spacing:0}}.lead{{color:var(--muted);max-width:1120px;margin:0}}
.summary{{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 30px}}.summary span{{border:1px solid var(--line);border-radius:5px;padding:5px 9px;color:#cbd0d4}}
section{{border-top:2px solid var(--line);padding:18px 0 30px}}section>header{{display:grid;grid-template-columns:300px 1fr;gap:20px;align-items:start}}
h2{{font-size:21px;color:var(--accent);margin:0;letter-spacing:0}}header p{{color:var(--muted);margin:3px 0}}.prompt{{display:grid;grid-template-columns:65px 1fr;gap:3px 12px}}
.prompt code{{grid-column:2;color:#8f999f}}code{{font:10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}}
h3{{font-size:14px;margin:18px 0 7px}}h3 span{{font-weight:400;color:var(--muted);margin-left:8px}}
.comparison{{display:grid;gap:9px;background:var(--panel);border-top:1px solid var(--line);padding:10px}}
.comparison.morphology{{grid-template-columns:210px repeat(4,minmax(0,1fr))}}.comparison.camera{{grid-template-columns:210px repeat(3,minmax(0,1fr))}}
.rowhead{{padding:8px;display:flex;flex-direction:column;gap:4px}}.rowhead span{{font-size:11px;color:var(--muted)}}figure{{margin:0;min-width:0}}
figure img{{display:block;width:100%;aspect-ratio:1/1;object-fit:contain;background:#0d0f10}}figcaption{{padding:5px 2px 0;display:flex;flex-direction:column;gap:2px;font-size:11px}}
figcaption span{{color:var(--muted)}}figcaption code{{color:#7f8990}}.foot{{max-width:1180px;color:var(--muted);margin:22px 0 0}}
@media(max-width:1000px){{main{{padding:14px}}section>header{{grid-template-columns:1fr}}.comparison.morphology,.comparison.camera{{grid-template-columns:1fr 1fr}}.rowhead{{grid-column:1/-1}}}}
</style>
<main>
<h1>Revision 050: morphology and camera authority</h1>
<p class="lead">The morphology comparison reuses twelve frozen revision-048 outputs as controls and runs revision 050 under the same prompts and seeds. The camera comparison holds revision 050, prompt, seed, and route constant while changing only the rendered source view.</p>
<div class="summary"><span>20 new FLUX cells</span><span>12 frozen controls</span><span>4 prompt basins</span><span>3 views</span><span>3 matched seeds</span></div>
{''.join(sections)}
<p class="foot"><b>Claim ceiling:</b> {esc(campaign['claimCeiling'])}</p>
</main>"""
    OUT.write_text(document)
    print(json.dumps({"status": "built", "sheet": str(OUT), "newCells": 20, "controls": 12}, indent=2))


if __name__ == "__main__":
    main()
