#!/usr/bin/env python3
"""Build the adjacent source and reconstruction orbit sheet."""

import html
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def relative_asset(path: Path) -> str:
    return Path(os.path.relpath(path.resolve(), ROOT)).as_posix()


def main() -> None:
    ledger = json.loads((ROOT / "reconstruction-ledger.json").read_text())
    source = Path(ledger["source"])
    columns = []
    for route_id, row in ledger["routes"].items():
        manifest_path = ROOT / "reconstructions" / route_id / "orbit-manifest.json"
        manifest = json.loads(manifest_path.read_text())
        images = "".join(
            f'<img src="{html.escape(relative_asset(Path(item["path"])))}">'
            for item in manifest["outputs"]
        )
        columns.append(f"""
          <section><h2>{html.escape(route_id.upper())}</h2>
          <p>{row['outputBytes']:,} bytes · <code>{html.escape(row['outputSha256'][:12])}</code></p>
          <div class="orbit">{images}</div></section>
        """)
    document = f"""<!doctype html><meta charset="utf-8"><title>Polygonal cat round trip</title>
<style>
body{{font:16px system-ui;background:#111;color:#eee;margin:28px}}h1{{margin-bottom:6px}}p{{color:#bbb}}
.source{{display:flex;gap:24px;align-items:center;margin:24px 0;padding:18px;background:#1b1d20}}
.source img{{width:384px;max-width:42vw}}section{{margin:28px 0}}.orbit{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}}
.orbit img{{width:100%;background:#202326}}code{{color:#ddd}}@media(max-width:800px){{.orbit{{grid-template-columns:1fr 1fr}}}}
</style>
<h1>Polygonal cat: matched spatial reconstruction</h1>
<p>Selection priority: naturalistic cat fidelity, coherent anatomy, then comparable visible tessellation scale.</p>
<div class="source"><img src="{html.escape(relative_asset(source))}"><div><h2>Exact FLUX source</h2>
<p><code>{html.escape(ledger['sourceSha256'])}</code></p><p>Prompt: “This shape as a cat.” · seed 80301</p></div></div>
{''.join(columns)}
"""
    (ROOT / "reconstruction-sheet.html").write_text(document)


if __name__ == "__main__":
    main()
