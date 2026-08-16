#!/usr/bin/env python3
"""Build the one-page operator review for the procedural groom estimation assay."""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path


VIEW_LABELS = {
    "front": "Front",
    "left-three-quarter": "Left three-quarter",
    "right-three-quarter": "Right three-quarter",
}
TRUTH_REGIONS = (
    "short-coat",
    "puffy-coat",
    "ruff",
    "mystacial-pad-left",
    "mystacial-pad-right",
)


def e(value) -> str:
    return html.escape(str(value), quote=True)


def pct(value: float) -> str:
    return f"{100 * value:.1f}%"


def build_page(root: Path, output: Path) -> None:
    inventory = json.loads((root / "vlm-raw/inventory.json").read_text())
    comparison = json.loads((root / "comparison.json").read_text())
    observation = json.loads((root / "observation.json").read_text())
    sam_report = json.loads((root / "sam3-raw/report.json").read_text())
    if len(observation.get("views", [])) != 3:
        raise ValueError("review requires all three sealed observations")
    if len(comparison.get("rows", [])) != 12:
        raise ValueError("review requires all twelve proposal/view comparison rows")
    if sam_report.get("state") != "segmentation_captured":
        raise ValueError("review cannot render a nonterminal SAM report")

    proposal_cards = []
    for system in inventory["systems"]:
        proposal_cards.append(f"""
          <article class="proposal">
            <h3>{e(system['id'])}</h3>
            <p class="phrase">“{e(system['segmenter_phrase'])}”</p>
            <dl><dt>Length</dt><dd>{system['relative_length']:.2f}</dd><dt>Density</dt><dd>{system['density']:.2f}</dd><dt>Puff</dt><dd>{system['outward_puff']:.2f}</dd><dt>Confidence</dt><dd>{system['confidence']:.2f}</dd></dl>
            <p>{e(system['visual_evidence'])}</p>
          </article>""")

    view_sections = []
    for view in observation["views"]:
        view_id = view["id"]
        rows = [row for row in comparison["rows"] if row["viewId"] == view_id]
        row_html = []
        for row in rows:
            metrics = row["bestMetrics"]
            state_class = "nodetect" if row["state"] == "no_detection" else "captured"
            overlay = f"sam3-raw/overlays/{view_id}/{row['proposalSystemId']}.png"
            truth = f"../procedural-groom-truth-v0/generated/truth-masks/{view_id}/{row['bestTruthMatch']}.png"
            row_html.append(f"""
              <article class="comparison-row">
                <div class="row-head">
                  <div><h3>{e(row['proposalSystemId'])}</h3><p>“{e(row['segmenterPhrase'])}”</p></div>
                  <span class="state {state_class}">{e(row['state'])}</span>
                </div>
                <div class="pair">
                  <figure><a href="{e(overlay)}"><img src="{e(overlay)}" alt="SAM overlay for {e(row['proposalSystemId'])} in {e(view_id)}"></a><figcaption>SAM union · {row['detectionCount']} detections</figcaption></figure>
                  <figure><a href="{e(truth)}"><img src="{e(truth)}" alt="Automatically selected authored truth match {e(row['bestTruthMatch'])}"></a><figcaption>Best of all authored regions: <strong>{e(row['bestTruthMatch'])}</strong></figcaption></figure>
                </div>
                <div class="metrics"><span>IoU <strong>{pct(metrics['iou'])}</strong></span><span>precision <strong>{pct(metrics['precision'])}</strong></span><span>recall <strong>{pct(metrics['recall'])}</strong></span><span>predicted pixels <strong>{metrics['predictedPixels']:,}</strong></span></div>
              </article>""")
        view_sections.append(f"""
          <section class="panel view">
            <h2>{e(VIEW_LABELS[view_id])}</h2>
            <figure class="observation"><a href="{e(view['path'])}"><img src="{e(view['path'])}" alt="Sealed neutral {e(view_id)} observation"></a><figcaption>Sealed blind observation · membership colors, labels, and gizmos withheld</figcaption></figure>
            {''.join(row_html)}
          </section>""")

    truth_figures = []
    for view_id in VIEW_LABELS:
        for region_id in TRUTH_REGIONS:
            path = f"../procedural-groom-truth-v0/generated/truth-masks/{view_id}/{region_id}.png"
            truth_figures.append(
                f'<figure><a href="{e(path)}"><img src="{e(path)}" '
                f'alt="{e(view_id)} {e(region_id)} authored truth mask"></a>'
                f'<figcaption>{e(VIEW_LABELS[view_id])} · '
                f'<strong>{e(region_id)}</strong></figcaption></figure>'
            )

    page = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Procedural Groom Estimation v0 — Blind Assay Review</title>
  <style>
    :root {{ color-scheme: dark; --page:#0e1014; --panel:#181c22; --panel2:#222832; --line:#343c49; --ink:#f5f1e8; --muted:#aeb7c5; --bad:#ff745f; --okay:#e9b949; }}
    * {{ box-sizing:border-box }} body {{ margin:0; background:var(--page); color:var(--ink); font:15px/1.48 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif }}
    main {{ width:min(1580px,calc(100% - 28px)); margin:auto; padding:30px 0 72px }} h1 {{ margin:0 0 8px; font-size:clamp(30px,4vw,50px); line-height:1.06 }} h2 {{ margin:0 0 16px; font-size:25px }} h3 {{ margin:0 0 5px; font-size:17px }} p {{ margin:0 0 10px }}
    .lede {{ max-width:1100px; color:var(--muted); font-size:18px }} .verdict {{ margin-top:22px; border:1px solid #7a332d; border-left:8px solid var(--bad); background:#271917; padding:18px 20px; border-radius:12px }} .verdict strong {{ color:#ff9d8f }}
    .panel {{ margin-top:24px; border:1px solid var(--line); border-radius:14px; background:var(--panel); padding:20px }} .method {{ display:grid; grid-template-columns:repeat(3,1fr); gap:12px }} .method div,.proposal {{ background:var(--panel2); padding:15px; border-radius:10px }}
    .proposals {{ display:grid; grid-template-columns:repeat(4,1fr); gap:12px }} .phrase {{ color:#dce8ff }} dl {{ display:grid; grid-template-columns:auto 1fr; gap:3px 10px; margin:10px 0 }} dt {{ color:var(--muted) }} dd {{ margin:0 }}
    figure {{ margin:0; overflow:hidden; border:1px solid var(--line); border-radius:10px; background:#090b0e }} figure img {{ display:block; width:100%; height:auto }} figcaption {{ padding:10px 12px; background:var(--panel2); color:var(--muted) }} .observation {{ max-width:1088px; margin:0 auto 18px }}
    .comparison-row {{ border-top:1px solid var(--line); padding:18px 0 }} .row-head {{ display:flex; justify-content:space-between; align-items:start; gap:18px }} .row-head p {{ color:var(--muted) }} .state {{ border:1px solid var(--line); border-radius:999px; padding:4px 9px; font-size:12px }} .state.nodetect {{ color:var(--bad); border-color:#7a332d }}
    .pair {{ display:grid; grid-template-columns:1fr 1fr; gap:14px }} .metrics {{ display:flex; flex-wrap:wrap; gap:8px; margin-top:10px }} .metrics span {{ background:var(--panel2); border-radius:999px; padding:5px 10px; color:var(--muted) }} .metrics strong {{ color:var(--ink) }}
    .truth-atlas {{ display:grid; grid-template-columns:repeat(5,1fr); gap:10px }} .audit {{ color:var(--muted); font-size:13px; overflow-wrap:anywhere }} code {{ color:#dce8ff }}
    @media(max-width:1000px) {{ .proposals,.truth-atlas {{ grid-template-columns:repeat(2,1fr) }} .method {{ grid-template-columns:1fr }} }} @media(max-width:700px) {{ .pair,.proposals,.truth-atlas {{ grid-template-columns:1fr }} }}
  </style>
</head>
<body><main>
  <header><h1>Procedural Groom Estimation v0</h1><p class="lede">The real blind assay: three membership-neutral observations → one free VLM inventory → literal SAM3 prompts → authored truth revealed only after proposal sealing.</p></header>
  <section class="verdict"><strong>First-pass result: negative.</strong> The VLM noticed broad fiber layering and whisker-origin concepts, but did not isolate the ruff. The literal SAM unions are mostly overbroad, background-contaminated, or semantically misregistered. High recall is frequently caused by engulfing the target, not locating it.</section>
  <section class="panel"><h2>How to read this page</h2><div class="method"><div><strong>1 · Blind input</strong><p>The gray renders are exactly what the VLM received. Membership colors and canonical labels are absent.</p></div><div><strong>2 · Frozen proposal</strong><p>The VLM’s own phrases and parameters were sealed before truth release. Nothing below was renamed to fit the answer.</p></div><div><strong>3 · No hand-map comparison</strong><p>Each SAM mask is compared with every authored region. The shown truth mask is simply maximum IoU, even when that exposes a semantic mismatch.</p></div></section>
  <section class="panel"><h2>Raw VLM inventory</h2><div class="proposals">{''.join(proposal_cards)}</div></section>
  {''.join(view_sections)}
  <section class="panel"><h2>Complete authored truth atlas</h2><p class="lede">All fifteen visible-region masks. These are supporting comparison truth, not recovered semantics and not visual admission.</p><div class="truth-atlas">{''.join(truth_figures)}</div></section>
  <section class="panel audit"><h2>Audit identity</h2><p>Observation digest: <code>{e(observation['digest'])}</code></p><p>SAM route: <code>{e(sam_report['effectiveRoute'])}</code> · model config <code>{e(sam_report['effectiveModelConfigSha256'])}</code> · threshold <code>{e(sam_report['threshold'])}</code></p><p>Comparison report: <code>comparison.json</code> · policy: {e(comparison['matchingPolicy'])}</p><p>Visual admission: false · scientific admission: false.</p></section>
</main></body></html>"""
    output.write_text("\n".join(line.rstrip() for line in page.splitlines()) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build_page(args.root, args.output)
    print(json.dumps({"state": "review_page_written", "output": str(args.output)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
