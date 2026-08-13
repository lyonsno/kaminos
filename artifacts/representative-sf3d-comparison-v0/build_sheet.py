#!/usr/bin/env python3
"""Build the adjacent source, SF3D, and Trellis comparison sheet."""

import html
import json
import os
from pathlib import Path

from comparison_contract import validate_campaign, validate_complete_orbits, validate_visual_disposition


ROOT = Path(__file__).resolve().parent


def asset(path: Path) -> str:
    return Path(os.path.relpath(path.resolve(), ROOT)).as_posix()


def main() -> None:
    ledger = json.loads((ROOT / "comparison-ledger.json").read_text())
    validate_complete_orbits(ROOT, ledger)
    campaign = validate_campaign(ROOT, ROOT.parents[1])
    disposition = validate_visual_disposition(ROOT, campaign)
    cells = []
    for cell_id, cell in ledger["cells"].items():
        columns = []
        for route_id in ("sf3d", "trellis"):
            route = cell["routes"][route_id]
            manifest = json.loads(
                (ROOT / "renders" / cell_id / route_id / "orbit-manifest.json").read_text()
            )
            images = "".join(
                f'<img src="{html.escape(asset(Path(item["path"])))}">'
                for item in manifest["outputs"]
            )
            route_note = (
                html.escape(route["effectiveRoute"])
                if route_id == "sf3d"
                else "Existing matched Trellis cast"
            )
            columns.append(f"""
              <section class="route"><h3>{route_id.upper()}</h3>
              <p>{route['outputBytes']:,} bytes · <code>{route['outputSha256'][:12]}</code></p>
              <p class="route-note">{route_note}</p><div class="orbit">{images}</div></section>
            """)
        source = Path(cell["source"]["path"])
        verdict = disposition["cells"][cell_id]
        cells.append(f"""
          <article><header><div><h2>{html.escape(cell_id)}</h2>
          <p><strong>{html.escape(cell['class'])}</strong> · {html.escape(cell['question'])}</p>
          <p class="verdict"><strong>Preferred here: {html.escape(verdict['preferredRoute'].upper())}.</strong> {html.escape(verdict['visibleReason'])}</p>
          <p class="risk"><strong>Boundary:</strong> {html.escape(verdict['residualRisk'])}</p></div>
          <figure><img src="{html.escape(asset(source))}"><figcaption>Exact source</figcaption></figure></header>
          <div class="routes">{''.join(columns)}</div></article>
        """)
    document = f"""<!doctype html><meta charset="utf-8"><title>Representative SF3D comparison</title>
<style>
*{{box-sizing:border-box}}body{{font:15px system-ui;background:#101214;color:#eee;margin:24px}}h1{{margin-bottom:4px}}
p{{color:#b9bdc2}}article{{border-top:1px solid #3a3e43;padding:26px 0}}header{{display:grid;grid-template-columns:1fr 280px;gap:22px;align-items:start}}
.verdict{{color:#e7ebef;max-width:900px}}.risk{{color:#aeb4ba;max-width:900px;font-size:13px}}
figure{{margin:0;background:#1b1e21;padding:10px}}figure img{{width:100%;display:block}}figcaption{{color:#aeb4ba;margin-top:7px}}
.routes{{display:grid;grid-template-columns:1fr 1fr;gap:18px}}.route{{min-width:0}}.orbit{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}}
.orbit img{{width:100%;display:block;background:#202326}}.route-note{{font:12px ui-monospace;overflow-wrap:anywhere;min-height:34px}}code{{color:#ddd}}
@media(max-width:900px){{header,.routes{{grid-template-columns:1fr}}header figure{{max-width:360px}}}}
</style>
<h1>Stable Fast 3D: representative route comparison</h1>
<p>{html.escape(ledger['question'])}</p><p><strong>Claim ceiling:</strong> {html.escape(ledger['claimCeiling'])}</p>
<p><strong>Campaign verdict:</strong> {html.escape(disposition['campaignVerdict'])}</p>
{''.join(cells)}
"""
    (ROOT / "comparison-sheet.html").write_text(document)


if __name__ == "__main__":
    main()
