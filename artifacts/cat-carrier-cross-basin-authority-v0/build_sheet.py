#!/usr/bin/env python3
"""Build the adjacent source/prompt/settings/output research surface."""

import hashlib
import html
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "cross-basin-authority.html"


def load(name: str) -> dict:
    return json.loads((ROOT / name).read_text())


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def relative(path: Path) -> str:
    return Path(os.path.relpath(path.resolve(), ROOT.resolve())).as_posix()


def source_ids_for_family(campaign: dict, family_id: str) -> list[str]:
    present = {
        cell["sourceId"]
        for cell in campaign["cells"]
        if cell["family"] == family_id
    }
    return [source_id for source_id in ("revision-029", "revision-048") if source_id in present]


def validate_ledger_freshness(
    ledger: dict,
    campaign_sha256: str,
    submissions_sha256: str,
    state_exists: bool,
) -> None:
    if state_exists:
        raise RuntimeError("collection state still exists; terminal evidence is not complete")
    if ledger.get("campaignSha256") != campaign_sha256:
        raise RuntimeError("result ledger does not bind the current campaign content")
    if ledger.get("submissionsSha256") != submissions_sha256:
        raise RuntimeError("result ledger does not bind the current submission ledger")


def image_cell(path: Path | None, label: str, evidence: str = "") -> str:
    if path is None:
        return '<div class="empty"><span>not run</span></div>'
    if not path.is_file():
        raise FileNotFoundError(path)
    return (
        f'<figure><img src="{esc(relative(path))}" alt="{esc(label)}">'
        f'<figcaption>{esc(label)}<br><code>{esc(digest(path)[:12])}</code>'
        f'{f"<br><span>{esc(evidence)}</span>" if evidence else ""}</figcaption></figure>'
    )


def main() -> None:
    campaign = load("campaign.json")
    precedent = load("historical-precedent.json")
    results = load("result-ledger.json")
    validate_ledger_freshness(
        results,
        digest(ROOT / "campaign.json"),
        digest(ROOT / "submissions.json"),
        (ROOT / "collection-state.json").exists(),
    )
    expected_ids = {cell["id"] for cell in campaign["cells"]}
    if set(results.get("cells", {})) != expected_ids:
        raise RuntimeError("result ledger does not cover the frozen campaign")
    families = {item["id"]: item for item in campaign["promptFamilies"]}
    sources = campaign["sources"]
    route = campaign["fluxRoute"]
    settings = (
        f'{route["model"]} · q{route["quantize"]} · {route["width"]}x{route["height"]} · '
        f'{route["steps"]} steps · guidance {route["guidance"]} · MLX cache {route["mlxCacheLimitGb"]} GiB'
    )
    source_paths = {source_id: ROOT / source["plate"] for source_id, source in sources.items()}
    historical_source = (ROOT / precedent["source"]).resolve()

    sections = []
    for family_id, family in families.items():
        historical = precedent["cells"]
        rows = []
        historical_cells = []
        for seed in campaign["seeds"]:
            record = historical.get(f"{family_id}-seed{seed}")
            path = ROOT / record["output"] if record else None
            evidence = f'job {record["recordedJobId"]}' if record and record["recordedJobId"] else "metadata absent"
            historical_cells.append(image_cell(path, f"seed {seed}", evidence))
        rows.append(
            '<div class="row">'
            '<div class="rowhead"><b>Historical fertile precedent</b><span>Different authored envelope; not a causal control. Route defaults incompletely preserved.</span></div>'
            + image_cell(historical_source, "historical source", "3764 vertices")
            + "".join(historical_cells)
            + "</div>"
        )
        for source_id in source_ids_for_family(campaign, family_id):
            row_label = "Near predecessor control" if source_id == "revision-029" else "Current authored carrier"
            output_cells = []
            for seed in campaign["seeds"]:
                cell_id = f"{source_id}-{family_id}-seed{seed}"
                record = results["cells"].get(cell_id)
                output_cells.append(
                    image_cell(ROOT / record["output"] if record else None, f"seed {seed}", f'job {record["jobId"]}' if record else "")
                )
            rows.append(
                '<div class="row">'
                f'<div class="rowhead"><b>{esc(row_label)}</b><span>{esc(source_id)}</span></div>'
                + image_cell(source_paths[source_id], f"{source_id} source")
                + "".join(output_cells)
                + "</div>"
            )
        sections.append(
            f'<section><header><div><h2>{esc(family_id)}</h2><p>{esc(family["surfaceClass"])}</p></div>'
            f'<div class="prompt"><b>Prompt</b><span>{esc(family["prompt"])}</span><code>{esc(settings)}</code></div></header>'
            f'<div class="labels"><span>comparison class</span><span>source</span><span>seed 80301</span><span>seed 80302</span><span>seed 80413</span></div>'
            + "".join(rows)
            + "</section>"
        )

    document = f"""<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cat carrier cross-basin authority</title>
<style>
  :root{{--bg:#101214;--panel:#181b1e;--line:#32373c;--text:#f0eee9;--muted:#9ba3aa;--accent:#e2b861;--source:#20252a}}
  *{{box-sizing:border-box}} body{{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}
  main{{max-width:1720px;margin:auto;padding:26px}} h1{{font-size:26px;margin:0 0 5px;letter-spacing:0}} .lead{{max-width:1180px;color:var(--muted);margin:0}}
  .summary{{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 28px}} .summary span{{border:1px solid var(--line);padding:5px 9px;border-radius:5px;color:#cbd0d4}}
  section{{border-top:2px solid var(--line);padding:18px 0 24px}} section>header{{display:grid;grid-template-columns:220px 1fr;gap:18px;align-items:start;margin-bottom:12px}}
  h2{{margin:0;color:var(--accent);font-size:20px;letter-spacing:0}} section header p{{margin:2px 0;color:var(--muted)}} .prompt{{display:grid;grid-template-columns:65px 1fr;gap:2px 12px}}
  .prompt code{{grid-column:2;color:#8e989f}} code{{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}}
  .labels,.row{{display:grid;grid-template-columns:210px repeat(4,minmax(0,1fr));gap:9px}} .labels{{color:#737d84;font-size:11px;text-transform:uppercase;margin-bottom:5px}}
  .row{{background:var(--panel);border-top:1px solid var(--line);padding:10px 0;align-items:start}} .rowhead{{padding:8px 10px;display:flex;flex-direction:column;gap:4px}}
  .rowhead b{{font-size:13px}} .rowhead span,figcaption span{{color:var(--muted);font-size:11px}} figure{{margin:0;min-width:0}} figure img{{display:block;width:100%;aspect-ratio:1/1;object-fit:contain;background:#0d0f10}}
  figcaption{{padding:5px 2px 0;color:#c9cdd0;font-size:11px}} figcaption code{{color:#89939a}} .empty{{aspect-ratio:1/1;background:#131619;display:grid;place-items:center;color:#5f686f}}
  .foot{{color:var(--muted);max-width:1200px;margin:20px 0 0}}
  @media(max-width:1000px){{main{{padding:14px}} section>header{{grid-template-columns:1fr}} .labels{{display:none}} .row{{grid-template-columns:1fr 1fr}} .rowhead{{grid-column:1/-1}}}}
</style>
<main>
  <h1>Authored carrier cross-basin authority</h1>
  <p class="lead">Revision 048 is the treatment. Revision 029 is a matched near predecessor only for maquette, dragon, and golem. The earlier 3764-vertex envelope is visual evidence that these basins were fertile, not a causal control. Every new output below binds the source, exact prompt, seed, settings, effective route, and Greenroom job receipt.</p>
  <div class="summary"><span>33 new Flux cells</span><span>8 prompt families</span><span>3 matched seeds</span><span>24 treatment + 9 controls</span></div>
  {''.join(sections)}
  <p class="foot"><b>Claim ceiling:</b> {esc(campaign['claimCeiling'])}</p>
</main>
"""
    OUT.write_text(document)
    print(json.dumps({"status": "built", "sheet": str(OUT), "families": len(families), "newCells": len(results["cells"])}, indent=2))


if __name__ == "__main__":
    main()
