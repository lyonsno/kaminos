#!/usr/bin/env python3
"""Build the single-page diagnostic/source-like groom comparison surface."""

from __future__ import annotations

import argparse
import html
import importlib.util
import json
from pathlib import Path


CORE_PATH = Path(__file__).with_name("procedural-groom-source-like-core.py")
SPEC = importlib.util.spec_from_file_location("procedural_groom_source_like_core", CORE_PATH)
CORE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(CORE)

VIEW_LABELS = {
    "front": "Front",
    "left-three-quarter": "Left three-quarter",
    "right-three-quarter": "Right three-quarter",
}


def e(value: object) -> str:
    return html.escape(str(value), quote=True)


def build(observation_path: Path, repo_root: Path, output_path: Path) -> dict:
    observation = json.loads(observation_path.read_text())
    report = CORE.evaluate_source_like_observation(
        observation,
        observation_dir=observation_path.parent,
        repo_root=repo_root,
    )
    if report["state"] != "presentation_pair_bound_for_visual_inspection":
        raise ValueError("source-like observation preflight failed: " + "; ".join(report["failures"]))

    view_base = observation_path.parent.relative_to(output_path.parent)
    view_rows = []
    for view in observation["views"]:
        view_id = view["id"]
        diagnostic_path = (view_base / view["diagnostic"]["path"]).as_posix()
        source_like_path = (view_base / view["sourceLike"]["path"]).as_posix()
        view_rows.append(f"""
        <section class="view panel">
          <h2>{e(VIEW_LABELS[view_id])}</h2>
          <div class="pair">
            <figure>
              <a href="{e(diagnostic_path)}"><img src="{e(diagnostic_path)}" alt="{e(view_id)} diagnostic geometry observation"></a>
              <figcaption><strong>Diagnostic arm</strong><span>Thick explicit tubes, faceted carrier, viewer lighting</span></figcaption>
            </figure>
            <figure>
              <a href="{e(source_like_path)}"><img src="{e(source_like_path)}" alt="{e(view_id)} source-like groom observation"></a>
              <figcaption><strong>Source-like arm</strong><span>Dense tapered fibers, shared coat palette, carrier landmarks, studio shading</span></figcaption>
            </figure>
          </div>
          <p class="camera">Sealed camera: <code>{e(view['cameraPosition'])}</code> → <code>{e(view['cameraTarget'])}</code></p>
        </section>""")

    approximation = observation["targetDistributionApproximation"]
    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Procedural Groom Presentation Pair v0</title>
<style>
:root{{--bg:#0c0f13;--panel:#171c22;--line:#35404c;--text:#f5f0e8;--muted:#aeb8c5;--accent:#e7a95d;--green:#82d3ae}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}main{{width:min(1540px,calc(100% - 30px));margin:auto;padding:34px 0 70px}}h1{{font-size:clamp(34px,5vw,60px);line-height:1.02;margin:0 0 12px}}h2{{margin:0 0 16px;font-size:27px}}p{{margin:0 0 12px}}.lede{{max-width:1080px;font-size:19px;color:var(--muted)}}.panel{{margin-top:24px;background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:20px}}.predicate{{border-left:8px solid var(--accent)}}.predicate strong{{color:#ffd291}}.constants{{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}}.constants div{{background:#202832;border-radius:10px;padding:13px}}.constants span{{display:block;color:var(--muted);font-size:13px;margin-top:3px}}.pair{{display:grid;grid-template-columns:1fr 1fr;gap:16px}}figure{{margin:0;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#080b0e}}figure img{{width:100%;height:auto;display:block}}figcaption{{display:flex;justify-content:space-between;gap:15px;padding:11px 13px;background:#202832;color:var(--muted)}}figcaption strong{{color:var(--text)}}.camera{{color:var(--muted);font-size:13px;margin-top:11px}}code{{color:#d7e8ff}}.truth{{display:grid;grid-template-columns:1fr 1.4fr;gap:18px;align-items:center}}.truth img{{display:block;width:100%;border:1px solid var(--line);border-radius:10px}}.audit{{color:var(--muted);font-size:13px;overflow-wrap:anywhere}}.pass{{color:var(--green)}}@media(max-width:900px){{.constants{{grid-template-columns:1fr 1fr}}.pair,.truth{{grid-template-columns:1fr}}}}@media(max-width:560px){{.constants{{grid-template-columns:1fr}}}}
</style></head><body><main>
<header><h1>Same hair truth, friendlier eyes</h1><p class="lede">A paired observation assay over one frozen procedural groom. The left arm is the exact diagnostic imagery used by the failed first VLM→SAM run. The right arm changes presentation only so the fibers integrate into the kind of coherent creature material the target pipeline normally sees.</p></header>
<section class="panel predicate"><h2>Inspection predicate</h2><p><strong>Does the right arm read as an ordinary groomed creature rather than a line-covered debugging sculpture?</strong></p><p>The required signal is coat integration, recognizable carrier context, and perceptual separation among short, puffy, ruff, and whisker systems. Production beauty and anatomical authority are outside this assay.</p></section>
<section class="panel"><h2>What is held fixed</h2><div class="constants">
<div>Authored truth<span>Same carrier, memberships, guide field, and whisker preset</span></div>
<div>Projection<span>Same three cameras and truth masks</span></div>
<div>Estimator<span>Same prompt, VLM, SAM, and score policy when rerun</span></div>
<div>Only variable<span>Diagnostic viewer presentation versus source-like groom presentation</span></div>
</div></section>
{''.join(view_rows)}
<section class="panel truth"><a href="../procedural-groom-truth-v0/generated/neutral-dense.png"><img src="../procedural-groom-truth-v0/generated/neutral-dense.png" alt="Membership-colored procedural groom truth"></a><div><h2>Hidden membership reference</h2><p>This color-coded plate remains truth-only and is never sent to the estimator. Cyan is short coat, orange is puffy coat, purple is ruff, and cream is whiskers.</p><p>The source-like arm deliberately uses one randomized tawny palette across all coat systems so color cannot carry membership.</p></div></section>
<section class="panel audit"><h2>Audit</h2><p class="pass">Preflight: {e(report['state'])}</p><p>Observation: <code>{e(observation['observationId'])}</code> · route <code>{e(observation['effectiveRoute'])}</code></p><p>Renderer: <code>{e(approximation['renderer'])}</code> · Blender <code>{e(approximation['blenderVersion'])}</code> · rendered fiber curves <code>{e(approximation['fiberCurveCount'])}</code></p><p>Claim ceiling: {e(observation['claimCeiling'])}</p><p>Visual admission: false · scientific admission: false.</p></section>
</main></body></html>"""
    output_path.write_text("\n".join(line.rstrip() for line in page.splitlines()) + "\n")
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--observation", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    try:
        report = build(args.observation.resolve(), args.repo_root.resolve(), args.output.resolve())
        args.report.write_text(json.dumps(report, indent=2) + "\n")
        return 0
    except Exception as error:
        failure = {
            "schema": CORE.REPORT_SCHEMA,
            "state": "review_build_failed",
            "failures": [str(error)],
            "visualAdmission": False,
            "scientificAdmission": False,
            "lastTrustworthyEvidence": None,
        }
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(failure, indent=2) + "\n")
        raise


if __name__ == "__main__":
    raise SystemExit(main())
