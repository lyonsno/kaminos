#!/usr/bin/env python3
import html
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SOURCE = "../nonlinear-basin-threshold-assay-v0/resolution-ladder/lod-00-r1.00.png"


def load_json(name):
    return json.loads((ROOT / name).read_text())


def require_file(relative_path, label):
    path = ROOT / relative_path
    if not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError(f"{label} is missing or blank: {relative_path}")
    return relative_path


def image(relative_path, alt):
    require_file(relative_path, alt)
    return f'<img src="{html.escape(relative_path)}" alt="{html.escape(alt)}">'


def main():
    campaign = load_json("campaign.json")
    flux = load_json("flux-results.json")
    trellis = load_json("trellis-results.json")
    registration = load_json("registration-results.json")
    require_file(SOURCE, "authenticated source plate")

    cells = sorted(
        flux["cells"],
        key=lambda item: ({"mannequin": 0, "armature": 1, "fur": 2}[item["promptId"]], item["seed"]),
    )
    casts = {item["name"]: item for item in registration["casts"]}

    flux_cards = []
    for cell in cells:
        route = campaign["fluxRoute"]
        flux_cards.append(
            f"""
            <article class="cell">
              <div class="cell-head"><strong>{html.escape(cell['promptId'])}</strong><span>seed {cell['seed']}</span></div>
              <div class="pair">
                <figure>{image(SOURCE, 'authored source plate')}<figcaption>Authenticated source</figcaption></figure>
                <figure>{image(cell['outputPath'], f"FLUX {cell['promptId']} seed {cell['seed']}")}<figcaption>FLUX output</figcaption></figure>
              </div>
              <p class="prompt">{html.escape(cell['prompt'])}</p>
              <p class="meta"><code>{route['jobType']}</code> · {route['model']} q{route['quantize']} · {route['dimensions'][0]}×{route['dimensions'][1]} · {route['steps']} steps · guidance {route['guidance']}</p>
              <p class="hash">output {cell['outputSha256'][:16]}… · job {cell['jobId']}</p>
            </article>
            """
        )

    promoted_rows = []
    for promoted in trellis["casts"]:
        name = f"{promoted['promptId']}-seed{promoted['seed']}"
        registered = casts.get(name)
        if registered is None:
            raise RuntimeError(f"promoted cast lacks registration evidence: {name}")
        orbit_manifest_path = Path(promoted["orbitManifestPath"])
        orbit = load_json(orbit_manifest_path.as_posix())
        metadata = load_json(f"trellis/{name}/metadata.json")
        orbit_views = [(view["path"], view["label"]) for view in orbit["outputs"]]
        fit = registered["fit"]
        treatment = (
            "Dense jagged outer shell: explicit fur-like microgeometry, not clean strands."
            if promoted["promptId"] == "fur"
            else "Smooth reconstructed creature surface."
        )
        promoted_rows.append(
            f"""
            <article class="promotion">
              <header>
                <div><strong>{html.escape(name)}</strong><span>{treatment}</span></div>
                <p><code>trellis2mlx_fast</code> · {metadata['duration_s']:.1f}s · {orbit['totalVertexCount']:,} vertices</p>
              </header>
              <div class="evidence-grid">
                <figure>{image(SOURCE, 'authored source plate')}<figcaption>Source</figcaption></figure>
                <figure>{image(promoted['sourceImagePath'], f"FLUX input to Trellis for {name}")}<figcaption>Exact Trellis input</figcaption></figure>
                {''.join(f'<figure>{image(view, f"Trellis orbit {name} {label}")}<figcaption>Orbit {html.escape(label)}</figcaption></figure>' for view, label in orbit_views)}
                {''.join(f'<figure>{image(view, f"registration overlay {name}")}<figcaption>Global-fit overlay</figcaption></figure>' for view in registered['views'])}
              </div>
              <div class="fit">
                <strong>Global similarity only</strong>
                <span>median {fit['normalizedMedianDistance'] * 100:.2f}% · p90 {fit['normalizedP90Distance'] * 100:.2f}% of cast diagonal</span>
                <span>No local deformation or anatomical landmark edits</span>
              </div>
              <p class="hash">cast {promoted['glbSha256']} · job {promoted['jobId']}</p>
            </article>
            """
        )

    document = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Current mannequin registration successor</title>
<style>
  :root {{ color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #111412; color: #edf0eb; }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; background: #111412; }}
  main {{ width: min(1700px, calc(100% - 32px)); margin: 0 auto; padding: 34px 0 64px; }}
  h1 {{ margin: 0; font-size: 30px; letter-spacing: 0; }}
  h2 {{ margin: 42px 0 14px; font-size: 21px; letter-spacing: 0; }}
  .lede {{ max-width: 1100px; color: #b9c0b9; line-height: 1.55; }}
  .verdict {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-block: 1px solid #354039; margin-top: 24px; }}
  .verdict div {{ padding: 18px 22px 18px 0; }}
  .verdict strong {{ display: block; color: #96d4a5; margin-bottom: 6px; }}
  .verdict span {{ color: #c5cbc5; line-height: 1.4; }}
  .flux-grid {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }}
  .cell, .promotion {{ border: 1px solid #303832; background: #191d1a; border-radius: 6px; }}
  .cell {{ padding: 14px; }}
  .cell-head, .promotion header, .fit {{ display: flex; justify-content: space-between; gap: 16px; align-items: baseline; }}
  .cell-head span, .promotion header span {{ color: #aab2aa; margin-left: 10px; }}
  .pair {{ display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }}
  figure {{ margin: 0; min-width: 0; }}
  img {{ width: 100%; aspect-ratio: 1 / 1; object-fit: contain; display: block; background: #202521; }}
  figcaption {{ color: #8f988f; font-size: 12px; padding-top: 5px; }}
  .prompt {{ min-height: 44px; font-size: 15px; line-height: 1.4; }}
  .meta, .hash {{ color: #8f988f; font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }}
  code {{ color: #d5b56e; }}
  .promotion {{ margin-bottom: 14px; padding: 16px; }}
  .promotion header p {{ color: #9ea69e; margin: 0; font-size: 13px; }}
  .evidence-grid {{ display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 7px; margin-top: 14px; }}
  .fit {{ margin-top: 14px; padding-top: 12px; border-top: 1px solid #303832; color: #aab2aa; font-size: 13px; }}
  .fit strong {{ color: #96d4a5; }}
  @media (max-width: 1000px) {{ .verdict, .flux-grid {{ grid-template-columns: 1fr; }} .evidence-grid {{ grid-template-columns: repeat(2, 1fr); }} .fit, .promotion header {{ align-items: flex-start; flex-direction: column; }} }}
</style>
</head>
<body><main>
  <h1>Current mannequin registration successor</h1>
  <p class="lede">One authenticated operator-authored envelope, three concise prompt classes, two matched seeds, and three Trellis promotions. Every row keeps the exact conditioning image, wording, effective route, generated image, reconstructed cast, and registration witness visually adjacent.</p>
  <section class="verdict">
    <div><strong>Campaign state</strong><span>The anatomically stronger envelope remains highly legible under concise neutral elaboration and reconstructs into spatially compatible casts.</span></div>
    <div><strong>Best current cast</strong><span><code>mannequin-seed80413</code>: 0.93% median and 2.67% p90 envelope-to-cast distance after one global fit.</span></div>
    <div><strong>Claim ceiling</strong><span>Candidate-specific registration evidence. Cannot establish general production reliability or historically improved registration without a matched prior metric.</span></div>
  </section>
  <h2>FLUX elaboration matrix</h2>
  <section class="flux-grid">{''.join(flux_cards)}</section>
  <h2>Promoted Trellis casts and registration</h2>
  <section>{''.join(promoted_rows)}</section>
</main></body></html>"""
    (ROOT / "campaign-screen.html").write_text(document)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        (ROOT / "campaign-screen-failure.json").write_text(
            json.dumps({"status": "failed", "phase": "build_campaign_screen", "error": str(exc)}, indent=2) + "\n"
        )
        raise
