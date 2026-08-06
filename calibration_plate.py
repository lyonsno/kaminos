"""Build an operator-readable assay plate from a cell manifest.

The presentation contract is operator-sourced: for every cell, the input
thumbnail, input SHA-256, the *full* prompt text, every effective setting, the
job id, the effective route, and the output image must be visually adjacent.
The stated rationale is "if it doesn't show up there, then I just don't learn
it." A field that is missing from the manifest renders as a loud MISSING marker
rather than being silently omitted, because a quiet gap in an evidence surface
reads as "nothing to report" when it actually means "not recorded".

Inputs are caller-addressed: the manifest path and the output path are
arguments, never hardcoded singletons.
"""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path
from typing import Any

MANIFEST_SCHEMA = "kaminos.carrier-class-calibration-plate.v0"

MISSING = '<span class="missing">MISSING</span>'


def _text(value: Any) -> str:
    """Escape a value for HTML, marking absent values loudly."""
    if value is None or value == "":
        return MISSING
    return html.escape(str(value))


def _settings_rows(settings: dict[str, Any]) -> str:
    return "".join(
        f"<dt>{_text(key)}</dt><dd>{_text(value)}</dd>"
        for key, value in settings.items()
    )


def _route_block(cell: dict[str, Any]) -> str:
    """Render requested vs effective route identity.

    Divergence is displayed, not smoothed over: a route that silently fell back
    invalidates the matched comparison, so it must be visible on the plate
    itself rather than only in a receipt the operator will not open.
    """
    requested = cell.get("requestedRoute")
    effective = cell.get("effectiveRoute")
    diverged = requested is not None and effective is not None and requested != effective
    klass = " route-mismatch" if diverged else ""
    note = (
        '<div class="route-warning">requested route != effective route; '
        "this cell is not a clean matched comparison</div>"
        if diverged
        else ""
    )
    return (
        f'<dl class="route{klass}">'
        f"<dt>Requested route</dt><dd>{_text(requested)}</dd>"
        f"<dt>Effective route</dt><dd>{_text(effective)}</dd>"
        f"<dt>Job</dt><dd>{_text(cell.get('jobId'))}</dd>"
        f"</dl>{note}"
    )


def _cell_section(cell: dict[str, Any]) -> str:
    input_meta = "".join(
        f"<dt>{_text(k)}</dt><dd>{_text(v)}</dd>"
        for k, v in (cell.get("inputMeta") or {}).items()
    )
    observation = cell.get("observation")
    observation_html = (
        f'<p class="observation">{_text(observation)}</p>' if observation else ""
    )
    return f"""
  <section class="assay">
    <div class="cell">
      <h2>Input: {_text(cell.get('inputLabel'))}</h2>
      <img src="{_text(cell.get('inputImage'))}" alt="{_text(cell.get('inputLabel'))}">
      <dl><dt>Input SHA</dt><dd>{_text(cell.get('inputSha256'))}</dd>{input_meta}</dl>
    </div>
    <div class="cell">
      <h2>Exact Prompt and Settings</h2>
      <pre>{_text(cell.get('promptText'))}</pre>
      <dl><dt>Prompt SHA</dt><dd>{_text(cell.get('promptSha256'))}</dd>{_settings_rows(cell.get('settings') or {})}</dl>
      {_route_block(cell)}
    </div>
    <div class="cell">
      <h2>Output: {_text(cell.get('outputLabel'))}</h2>
      <img src="{_text(cell.get('outputImage'))}" alt="{_text(cell.get('outputLabel'))}">
      <dl><dt>Output SHA</dt><dd>{_text(cell.get('outputSha256'))}</dd></dl>
      {observation_html}
    </div>
  </section>"""


STYLE = """
    :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background: #111411; color: #e9ede7; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #111411; }
    header { padding: 24px 28px 20px; border-bottom: 1px solid #465048; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    h2 { margin: 0 0 8px; font-size: 18px; color: #f0c96d; }
    h3 { margin: 24px 28px 0; font-size: 19px; color: #f0c96d; }
    p { max-width: 1180px; margin: 7px 0; line-height: 1.5; color: #cbd2cb; }
    .verdict { color: #9dd8b7; font-weight: 700; }
    .assay { display: grid; grid-template-columns: minmax(300px, 1fr) minmax(390px, .95fr) minmax(300px, 1fr); border-bottom: 1px solid #465048; }
    .cell { min-width: 0; padding: 20px; border-right: 1px solid #465048; }
    .cell:last-child { border-right: 0; }
    img { display: block; width: 100%; height: auto; background: #202520; border: 1px solid #5a655d; }
    pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: 12px; line-height: 1.45; color: #d7ddd7; }
    dl { margin: 14px 0 0; display: grid; grid-template-columns: max-content 1fr; gap: 6px 12px; font-size: 12px; }
    dt { color: #8f9a91; }
    dd { margin: 0; overflow-wrap: anywhere; }
    .observation { margin-top: 14px; padding-top: 12px; border-top: 1px solid #465048; color: #b9dfc8; }
    .missing { color: #ff9d8a; font-weight: 700; }
    .route-mismatch dd { color: #ff9d8a; }
    .route-warning { margin-top: 8px; font-size: 12px; color: #ff9d8a; font-weight: 700; }
    .frozen { margin: 0 28px 4px; padding: 14px 18px; border: 1px solid #465048; background: #161a16; font-size: 12px; }
    .frozen dl { margin: 0; }
    footer { padding: 20px 28px 28px; color: #aab3ab; line-height: 1.5; }
    @media (max-width: 980px) { .assay { grid-template-columns: 1fr; } .cell { border-right: 0; border-bottom: 1px solid #465048; } }
"""


def build_plate(manifest: dict[str, Any]) -> str:
    if manifest.get("schema") != MANIFEST_SCHEMA:
        raise ValueError(f"unsupported manifest schema: {manifest.get('schema')!r}")
    cells = manifest.get("cells")
    if not isinstance(cells, list) or not cells:
        raise ValueError("manifest carries no cells")

    comparison = manifest.get("comparisonClass") or {}
    frozen = ", ".join(comparison.get("matched", [])) or "UNRECORDED"
    varied = ", ".join(comparison.get("varied", [])) or "UNRECORDED"
    coupling = comparison.get("knownCoupling")

    groups: dict[str, list[str]] = {}
    order: list[str] = []
    for cell in cells:
        group = cell.get("group") or ""
        if group not in groups:
            groups[group] = []
            order.append(group)
        groups[group].append(_cell_section(cell))

    body = []
    for group in order:
        if group:
            body.append(f"\n  <h3>{_text(group)}</h3>")
        body.extend(groups[group])

    coupling_html = (
        f"<dt>Known coupling</dt><dd>{_text(coupling)}</dd>" if coupling else ""
    )

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{_text(manifest.get('title'))}</title>
  <style>{STYLE}</style>
</head>
<body>
  <header>
    <h1>{_text(manifest.get('title'))}</h1>
    <p class="verdict">{_text(manifest.get('verdict'))}</p>
    <p>{_text(manifest.get('description'))}</p>
  </header>
  <div class="frozen"><dl>
    <dt>Frozen across cells</dt><dd>{_text(frozen)}</dd>
    <dt>Varied</dt><dd>{_text(varied)}</dd>
    {coupling_html}
  </dl></div>
{"".join(body)}
  <footer>{_text(manifest.get('claimCeiling'))}</footer>
</body>
</html>
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(build_plate(manifest), encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
