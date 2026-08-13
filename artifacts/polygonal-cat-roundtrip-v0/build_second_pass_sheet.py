#!/usr/bin/env python3
"""Build the adjacent source/reconstruction/round-trip review sheet."""

import html
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "roundtrip-second-pass-sheet.html"


def main() -> int:
    contract = json.loads((ROOT / "second-pass.json").read_text())
    selection = json.loads((ROOT / "selection.json").read_text())
    result = json.loads((ROOT / "second-pass-result.json").read_text())
    cell = contract["cell"]
    prompt = html.escape(cell["prompt"])
    generated = Path(result["evidence"]["output"]).relative_to(ROOT)
    source = "../authored-envelope-v0/gen-sp-cat/output.png"
    selected = selection["plate"]
    settings = (
        f"seed {cell['seed']} · {cell['model']} q{cell['quantize']} · "
        f"{cell['width']}×{cell['height']} · {cell['steps']} steps · guidance {cell['guidance']}"
    )
    document = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Polygonal cat closed loop</title>
<style>
body {{ margin: 0; padding: 30px; background: #101313; color: #e8ece9; font: 16px/1.45 system-ui, sans-serif; }}
h1 {{ margin: 0 0 8px; }} .question {{ color: #aeb8b3; max-width: 1100px; }}
.contract {{ margin: 24px 0; padding: 16px 18px; border: 1px solid #3b4641; background: #181d1b; }}
.prompt {{ font-size: 20px; font-weight: 700; }} .settings {{ color: #9aa7a0; font-family: ui-monospace, monospace; }}
.grid {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }}
.card {{ border: 1px solid #343d39; background: #181d1b; padding: 12px; }}
.card h2 {{ font-size: 17px; margin: 0 0 9px; }} img {{ width: 100%; aspect-ratio: 1; object-fit: contain; background: #252a28; }}
.note {{ color: #aeb8b3; margin-top: 9px; }}
</style></head><body>
<h1>Polygonal cat: image → Trellis → image</h1>
<p class="question">{html.escape(contract['causalQuestion'])}</p>
<div class="contract"><div class="prompt">“{prompt}”</div><div class="settings">{settings}</div></div>
<div class="grid">
  <section class="card"><h2>Original FLUX source</h2><img src="{source}"><p class="note">Authored carrier elaborated by the matched original cell.</p></section>
  <section class="card"><h2>Selected Trellis reconstruction view</h2><img src="{selected}"><p class="note">az180/el12; selected for cross-view feline coherence, not privileged-view resemblance alone.</p></section>
  <section class="card"><h2>Second FLUX pass</h2><img src="{generated}"><p class="note">Same prompt, seed, model, quantization, resolution, steps, and guidance as the original cat cell.</p></section>
</div></body></html>"""
    OUTPUT.write_text(document)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
