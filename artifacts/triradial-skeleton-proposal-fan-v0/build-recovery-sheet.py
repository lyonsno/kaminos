"""Build adjacent source/prompt/output sheets for the tripodal recovery assay."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ASSAY = Path(__file__).resolve().parent


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rel(path: Path) -> str:
    return path.resolve().relative_to(ASSAY.resolve()).as_posix()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--classification", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--safe-only", action="store_true")
    parser.add_argument("--include-extension", action="store_true")
    args = parser.parse_args()

    contract = json.loads((ASSAY / "tripodal-recovery-contract.json").read_text())
    extensions = []
    if args.include_extension:
        extensions = [
            json.loads((ASSAY / name).read_text())
            for name in (
                "tripodal-biological-basin-extension.json",
                "tripodal-tissue-wrap-extension.json",
            )
        ]
    classification = json.loads(Path(args.classification).read_text())
    cells = classification["cells"]
    expected = {
        f"{source['id']}/{prompt['id']}-seed{seed}"
        for source in contract["sources"]
        for prompt in contract["prompts"]
        for seed in contract["seeds"]
    }
    for extension in extensions:
        expected.update(
            f"{extension['source']['id']}/{prompt['id']}-seed{seed}"
            for prompt in extension["prompts"]
            for seed in extension["seeds"]
        )
    if set(cells) != expected:
        missing = sorted(expected - set(cells))
        extra = sorted(set(cells) - expected)
        raise ValueError(f"classification key mismatch; missing={missing}, extra={extra}")

    route = contract["effectiveRoute"]
    css = """
body{margin:0;padding:24px;background:#141618;color:#e7e8e9;font:13px/1.45 system-ui,sans-serif}
h1{font-size:22px;margin:0 0 5px}.sub{color:#a5abb2;margin:0 0 20px;max-width:1100px}
section{margin:24px 0 38px}h2{font-size:17px;margin:0 0 10px}
.source{display:grid;grid-template-columns:220px minmax(300px,720px);gap:14px;align-items:start;margin-bottom:14px}
.source img,.cell img{width:100%;display:block;background:#090a0b;border-radius:6px}
.meta,.prompt,.cell{background:#1b1e21;border:1px solid #30353a;border-radius:7px;padding:10px}
.grid{display:grid;grid-template-columns:220px repeat(3,minmax(210px,1fr));gap:10px;margin-bottom:10px;max-width:1220px}
.prompt-text{font-weight:700;font-size:14px;margin:0 0 7px}.settings,.hash{color:#838a92;font:11px/1.5 ui-monospace,monospace}
.label{display:inline-block;margin-top:8px;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:800}
.admitted{background:#1d3a24;color:#82e394}.rejected{background:#3b2222;color:#ef9999}.boundary{background:#3b3520;color:#e3cb80}
.note{color:#bec3c8;font-size:11px;margin-top:6px}.omitted{color:#656b72;padding:38px 8px;text-align:center}
"""
    body = [
        "<!doctype html><meta charset='utf-8'>",
        "<title>Tripodal recovery assay</title>",
        f"<style>{css}</style>",
        "<h1>Tripodal recovery assay</h1>",
        "<p class='sub'>Two source projections, concise semantic priors, three matched seeds. "
        f"Effective route: {html.escape(route['model'])} Q{route['quantization']}, "
        f"{route['width']}×{route['height']}, {route['steps']} steps, guidance {route['guidance']}. "
        "A cell is reconstruction-eligible only when it visibly contains exactly three continuous grounded biological support chains.</p>",
    ]

    visible_count = 0
    for source in contract["sources"]:
        source_path = ROOT / source["path"]
        if not source_path.is_file() or sha256(source_path) != source["sha256"]:
            raise ValueError(f"source identity mismatch: {source_path}")
        source_rows = []
        prompts = list(contract["prompts"])
        for extension in extensions:
            if source["id"] == extension["source"]["id"]:
                prompts.extend(extension["prompts"])
        for prompt in prompts:
            prompt_path = ROOT / prompt["path"]
            prompt_text = prompt_path.read_text().strip()
            cards = []
            for seed in contract["seeds"]:
                key = f"{source['id']}/{prompt['id']}-seed{seed}"
                verdict = cells[key]
                run = ASSAY / "recovery-runs" / source["id"] / f"{prompt['id']}-seed{seed}"
                output = run / "output.png"
                metadata = run / "metadata.json"
                if not output.is_file() or output.stat().st_size < 4096 or not metadata.is_file():
                    raise ValueError(f"incomplete run: {key}")
                if args.safe_only and not verdict["operatorSafe"]:
                    cards.append("<div class='cell omitted'>classified outside operator-safe surface</div>")
                    continue
                visible_count += 1
                status = verdict["status"]
                cards.append(
                    "<div class='cell'>"
                    f"<img src='{html.escape(rel(output))}' alt='{html.escape(key)}'>"
                    f"<span class='label {html.escape(status)}'>{html.escape(status.upper())}</span>"
                    f"<div class='note'>{html.escape(verdict['note'])}</div>"
                    f"<div class='hash'>seed {seed} · {sha256(output)[:12]}…</div>"
                    "</div>"
                )
            source_rows.append(
                "<div class='grid'>"
                "<div class='prompt'>"
                f"<div class='prompt-text'>{html.escape(prompt_text)}</div>"
                f"<div class='settings'>{html.escape(prompt['class'])}<br>{len(prompt_text.split())} words</div>"
                "</div>"
                + "".join(cards)
                + "</div>"
            )
        body.extend(
            [
                "<section>",
                f"<h2>{html.escape(source['id'])}: {html.escape(source['role'])}</h2>",
                "<div class='source'>",
                f"<img src='{html.escape(rel(source_path))}' alt='{html.escape(source['id'])}'>",
                "<div class='meta'>",
                f"<div class='prompt-text'>{html.escape(source['path'])}</div>",
                f"<div class='hash'>sha256 {source['sha256']}<br>projection held fixed within this section</div>",
                "</div></div>",
                *source_rows,
                "</section>",
            ]
        )

    if args.safe_only and visible_count == 0:
        body.append("<p class='sub'>No cell passed the operator-safe exposure gate.</p>")
    Path(args.out).write_text("\n".join(body) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
