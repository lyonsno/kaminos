#!/usr/bin/env python3
"""Build one adjacent visual record of the second reconstruction cycle."""

import html
import json
import os
from pathlib import Path

from cycle2_contract import validate_campaign, validate_registration_result


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "cycle-2-sheet.html"


def relative(path: Path) -> str:
    return Path(os.path.relpath(path.resolve(), ROOT)).as_posix()


def image(path: Path, label: str) -> str:
    return (
        f'<figure><img src="{html.escape(relative(path))}">' 
        f'<figcaption>{html.escape(label)}</figcaption></figure>'
    )


def orbit(route_id: str, manifest: dict) -> str:
    figures = "".join(
        image(ROOT / row["path"], f'{route_id.upper()} · {row["label"]}')
        for row in manifest["outputs"]
    )
    return f'<div class="orbit">{figures}</div>'


def main() -> int:
    campaign = validate_campaign(ROOT)
    ledger = json.loads((ROOT / "reconstruction-ledger.json").read_text())
    registration = json.loads((ROOT / "registration-result.json").read_text())
    validate_registration_result(registration, ROOT)
    manifests = {
        route_id: json.loads(
            (ROOT / "reconstructions" / route_id / "orbit-manifest.json").read_text()
        )
        for route_id in ("trellis", "sf3d")
    }
    for route_id, manifest in manifests.items():
        if manifest.get("status") != "completed" or len(manifest.get("outputs", [])) != 6:
            raise RuntimeError(f"incomplete orbit cannot enter cycle-2 sheet: {route_id}")

    original_source = ROOT.parents[1] / "authored-envelope-v0" / "gen-sp-cat" / "output.png"
    first_trellis = ROOT.parent / "reconstructions" / "trellis" / "orbit" / "az180-el12.png"
    second_source = (ROOT / campaign["source"]["path"]).resolve()
    source_sequence = "".join(
        (
            image(original_source, "Cycle 0 · authored-envelope FLUX cat"),
            image(first_trellis, "Cycle 1 · selected Trellis reconstruction view"),
            image(second_source, "Cycle 1.5 · second FLUX cat, exact cycle-2 input"),
        )
    )
    registration_raw = "".join(
        image(ROOT / path, f"Unregistered side-by-side · {Path(path).stem}")
        for path in registration["witnesses"]["raw-side-by-side"]
    )
    registration_overlay = "".join(
        image(ROOT / path, f"Registered overlay · {Path(path).stem}")
        for path in registration["witnesses"]["registered-overlay"]
    )
    trellis_route = ledger["routes"]["trellis"]
    sf3d_route = ledger["routes"]["sf3d"]
    fit = registration["fit"]
    moving_to_fixed = fit["movingToFixed"]
    fixed_to_moving = fit["fixedToMoving"]
    settings = campaign["source"]

    document = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Polygonal cat cycle 2</title>
<style>
:root {{ color-scheme: dark; }}
body {{ margin:0; padding:28px; background:#0d1011; color:#edf2ef; font:15px/1.45 system-ui,sans-serif; }}
h1 {{ margin:0 0 6px; font-size:30px; }} h2 {{ margin:32px 0 10px; font-size:21px; }}
p {{ color:#b7c0bb; max-width:1100px; }} code {{ color:#d7dfdb; font-family:ui-monospace,monospace; }}
.contract,.metric {{ border:1px solid #38413d; background:#161a18; padding:15px 17px; }}
.contract {{ margin:20px 0; }} .prompt {{ font-size:19px; font-weight:700; color:#fff; }}
.sequence,.registration {{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }}
.orbit {{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }}
figure {{ margin:0; border:1px solid #303834; background:#171b19; padding:9px; min-width:0; }}
img {{ width:100%; aspect-ratio:1; object-fit:contain; background:#222725; display:block; }}
figcaption {{ color:#aeb8b3; margin-top:7px; }}
.metrics {{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin:14px 0; }}
.metric b {{ display:block; font-size:21px; color:#fff; }} .legend {{ color:#b5c1bb; }}
@media(max-width:900px) {{ .sequence,.registration,.orbit,.metrics {{ grid-template-columns:1fr 1fr; }} }}
</style></head><body>
<h1>Polygonal cat: matched second reconstruction cycle</h1>
<p>{html.escape(campaign['question'])}</p>
<div class="contract"><div class="prompt">“{html.escape(settings['prompt'])}”</div>
<div><code>seed {settings['seed']} · {settings['model']} q{settings['quantize']} · {settings['width']}×{settings['height']} · {settings['steps']} steps · guidance {settings['guidance']}</code></div>
<p>Second-cycle reconstruction routes are matched to cycle 1. The Blender fit permits only translation, rotation, and one uniform scale. It cannot bend limbs, resize one axis independently, or locally deform either cast.</p></div>

<h2>Causal sequence</h2><div class="sequence">{source_sequence}</div>

<h2>Cycle-2 Trellis complete orbit</h2>
<p><code>{html.escape(trellis_route['outputSha256'])}</code> · {trellis_route['outputBytes']:,} bytes · {manifests['trellis']['totalVertexCount']:,} rendered vertices</p>
{orbit('trellis', manifests['trellis'])}

<h2>Cycle-2 SF3D complete orbit</h2>
<p><code>{html.escape(sf3d_route['outputSha256'])}</code> · {sf3d_route['outputBytes']:,} bytes · {manifests['sf3d']['totalVertexCount']:,} rendered vertices</p>
{orbit('sf3d', manifests['sf3d'])}

<h2>Cycle-1 versus cycle-2 Trellis</h2>
<p class="legend"><b style="color:#35b7ca">Cyan:</b> cycle 1. <b style="color:#f3692d">Orange:</b> cycle 2. Raw views retain each cast’s native scale and orientation, with translation only for side-by-side display. Registered views apply the one fitted global similarity transform to cycle 2.</p>
<div class="metrics">
  <div class="metric">Uniform scale<b>{fit['uniformScale']:.4f}</b></div>
  <div class="metric">Cycle 2 → 1 nearest-vertex median / diagonal<b>{moving_to_fixed['normalizedMedianDistance']:.4f}</b></div>
  <div class="metric">Cycle 2 → 1 nearest-vertex p90 / diagonal<b>{moving_to_fixed['normalizedP90Distance']:.4f}</b></div>
  <div class="metric">Cycle 1 → 2 nearest-vertex p90 / diagonal<b>{fixed_to_moving['normalizedP90Distance']:.4f}</b></div>
</div>
<h2>Unregistered side-by-side</h2><div class="registration">{registration_raw}</div>
<h2>Registered overlay</h2><div class="registration">{registration_overlay}</div>

<h2>Claim ceiling</h2><p>{html.escape(campaign['claimCeiling'])}</p>
</body></html>"""
    OUTPUT.write_text(document)
    print(str(OUTPUT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
