#!/usr/bin/env python3
"""Build an operator-readable source -> FLUX -> TRELLIS causal sheet."""

import hashlib
import html
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "latest-envelope-basin-reconstruction.html"


def load(name: str) -> dict:
    return json.loads((ROOT / name).read_text())


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def pill(value: str) -> str:
    css = value.replace("_", "-").replace(" ", "-")
    return f'<span class="pill {esc(css)}">{esc(value)}</span>'


def main() -> None:
    campaign = load("campaign.json")
    flux = load("flux-ledger.json")
    admission = load("visual-admission.json")
    trellis = load("trellis-ledger.json")
    review = load("trellis-visual-review.json")

    source = ROOT / campaign["source"]["plate"]
    prompts = {item["id"]: item for item in campaign["promptFamilies"]}
    cells = {item["id"]: item for item in campaign["cells"]}
    missing_reviews = sorted(set(trellis["cells"]) - set(review["cells"]))
    if missing_reviews:
        raise SystemExit(f"visual review missing TRELLIS cells: {', '.join(missing_reviews)}")

    sections = []
    for family in campaign["promptFamilies"]:
        rows = []
        for seed in campaign["seeds"]:
            cell_id = f'{family["id"]}-seed{seed}'
            cell = cells[cell_id]
            flux_cell = flux["cells"][cell_id]
            trellis_cell = trellis["cells"][cell_id]
            admitted = admission["cells"][cell_id]
            reviewed = review["cells"][cell_id]
            flux_image = ROOT / flux_cell["output"]
            orbit = ROOT / "trellis" / cell_id / "orbit"
            elevation = campaign["trellisPolicy"]["orbitElevation"]
            views = [
                orbit / f"az{azimuth:03d}-el{elevation}.png"
                for azimuth in campaign["trellisPolicy"]["orbitAzimuths"]
            ]
            for view in views:
                if not view.is_file():
                    raise SystemExit(f"missing orbit view: {view}")

            settings = (
                f'FLUX {cell["model"]} q{cell["quantize"]}; {cell["width"]}x{cell["height"]}; '
                f'{cell["steps"]} steps; guidance {cell["guidance"]}; seed {seed}. '
                f'TRELLIS {trellis_cell["jobType"]}; seed {trellis_cell["params"].get("seed", seed)}; '
                f'route receipt {trellis_cell["jobId"]}.'
            )
            review_axes = " · ".join(
                [
                    f'macro {reviewed["macrostructure"]}',
                    f'supports {reviewed["supportSeparation"]}',
                    f'backside {reviewed["backsideCompletion"]}',
                    f'surface {reviewed["surfaceGeometry"]}',
                ]
            )
            rows.append(
                f"""
                <article class="cell">
                  <header><h3>{esc(cell_id)}</h3><div>{pill(admitted['sourceAdherence'])}{pill(reviewed['reuseDisposition'])}</div></header>
                  <div class="flow">
                    <figure><img src="{esc(rel(source))}"><figcaption>Authored source<br><code>{esc(digest(source)[:12])}</code></figcaption></figure>
                    <div class="arrow">→</div>
                    <figure><img src="{esc(rel(flux_image))}"><figcaption>FLUX output<br><code>{esc(flux_cell['jobId'])}</code></figcaption></figure>
                    <div class="arrow">→</div>
                    <div class="orbits">{''.join(f'<img src="{esc(rel(view))}">' for view in views)}<div class="orbit-label">TRELLIS orbit · <code>{esc(trellis_cell['jobId'])}</code></div></div>
                  </div>
                  <p class="settings">{esc(settings)}</p>
                  <p class="axes">{esc(review_axes)}</p>
                  <p class="note"><b>Interpretation:</b> {esc(reviewed['note'])}</p>
                </article>
                """
            )
        sections.append(
            f"""
            <section>
              <div class="family"><h2>{esc(family['id'])}</h2><p class="prompt">{esc(family['prompt'])}</p><p>{esc(family['surfaceClass'])}</p></div>
              {''.join(rows)}
            </section>
            """
        )

    document = f"""<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Latest envelope basin reconstruction</title>
<style>
  :root{{--bg:#111416;--panel:#191d20;--line:#30363b;--text:#ece9e4;--muted:#9ca4aa;--accent:#e3b85d}}
  *{{box-sizing:border-box}} body{{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}
  main{{max-width:1480px;margin:auto;padding:28px}} h1{{font-size:24px;margin:0 0 6px}} .lead{{color:var(--muted);max-width:1000px;margin:0 0 26px}}
  section{{border-top:2px solid var(--line);padding-top:18px;margin-top:26px}} .family{{display:grid;grid-template-columns:150px minmax(280px,1fr) 180px;gap:18px;align-items:start;margin-bottom:12px}}
  h2{{margin:0;color:var(--accent);font-size:19px}} .family p{{margin:0;color:var(--muted)}} .prompt{{color:var(--text)!important;font-weight:650}}
  .cell{{background:var(--panel);border:1px solid var(--line);border-radius:7px;padding:14px;margin:10px 0}}
  header{{display:flex;justify-content:space-between;gap:12px;align-items:center}} h3{{font-size:14px;margin:0}} .pill{{display:inline-block;border-radius:999px;background:#293036;color:#c6cdd2;padding:3px 8px;margin-left:6px;font-size:11px;font-weight:700}}
  .candidate{{background:#193722;color:#83de94}} .appearance-only{{background:#3b3020;color:#efc875}} .conditional{{background:#2a3040;color:#aebcf2}} .control{{background:#3a2424;color:#e49b9b}}
  .flow{{display:grid;grid-template-columns:180px 24px 240px 24px minmax(520px,1fr);gap:10px;align-items:center;margin-top:12px}}
  figure{{margin:0}} figure img{{width:100%;display:block;background:#0d1011;border-radius:5px;aspect-ratio:1/1;object-fit:contain}} figcaption,.orbit-label{{color:var(--muted);font-size:11px;margin-top:5px}}
  .arrow{{font-size:24px;color:#677078;text-align:center}} .orbits{{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px}} .orbits img{{width:100%;display:block;border-radius:5px;background:#0d1011;aspect-ratio:1/1;object-fit:contain}} .orbit-label{{grid-column:1/-1}}
  code{{font:11px ui-monospace,SFMono-Regular,Menlo,monospace}} .settings,.axes,.note{{margin:8px 0 0}} .settings{{color:#8f989e;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}} .axes{{color:#b9c0c5}} .note{{color:#d7d4cf}}
  @media(max-width:980px){{main{{padding:16px}} .family{{grid-template-columns:1fr}} .flow{{grid-template-columns:1fr}} .arrow{{transform:rotate(90deg)}}}}
</style>
<main>
  <h1>Latest envelope basin reconstruction</h1>
  <p class="lead">One authored source, six exact prompts, three matched seeds, and receipt-backed FLUX → TRELLIS outputs. This sheet distinguishes source adherence from reconstruction quality and deformation reuse. Campaign safety: {esc(admission['operatorSafety']['summary'])}</p>
  {''.join(sections)}
</main>
"""
    OUT.write_text(document)
    print(json.dumps({"status": "completed", "sheet": str(OUT), "cells": len(cells)}, indent=2))


if __name__ == "__main__":
    main()
