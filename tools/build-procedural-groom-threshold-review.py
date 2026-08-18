#!/usr/bin/env python3
"""Build one visual page for the subtle-versus-constitutive ruff pair."""

from __future__ import annotations

import argparse
import hashlib
import html
import importlib.util
import json
import math
import os
from pathlib import Path
from typing import Any


CORE_PATH = Path(__file__).with_name("procedural-groom-source-like-core.py")
SPEC = importlib.util.spec_from_file_location("procedural_groom_source_like_core", CORE_PATH)
CORE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(CORE)

REPORT_SCHEMA = "kaminos.procedural-groom-threshold-review.v0"
VIEW_LABELS = {
    "front": "Front",
    "left-three-quarter": "Left three-quarter",
    "right-three-quarter": "Right three-quarter",
}


def e(value: object) -> str:
    return html.escape(str(value), quote=True)


def relative(path: Path, output_dir: Path) -> str:
    return Path(os.path.relpath(path.resolve(), output_dir.resolve())).as_posix()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_estimator_run(run_root: Path) -> dict[str, Any]:
    run_root = run_root.resolve()
    manifest = json.loads((run_root / "run-manifest.json").read_text())
    inventory = json.loads((run_root / "vlm-raw" / "inventory.json").read_text())
    vlm_report = json.loads((run_root / "vlm-raw" / "report.json").read_text())
    sam_report = json.loads((run_root / "sam3-raw" / "report.json").read_text())
    comparison = json.loads((run_root / "comparison.json").read_text())
    if manifest.get("schema") != "kaminos.procedural-groom-estimation-assay-run.v0":
        raise ValueError("estimator run manifest schema mismatch")
    if vlm_report.get("state") != "raw_inventory_captured" or vlm_report.get("phase") != "complete":
        raise ValueError("VLM report is not terminal parsed evidence")
    if sam_report.get("state") != "segmentation_captured" or sam_report.get("phase") != "complete":
        raise ValueError("SAM report is not terminal mask evidence")
    requested_vlm = manifest.get("requestedVlm") or {}
    requested_sam = manifest.get("requestedSam") or {}
    if any(vlm_report.get(field) != expected for field, expected in (
        ("requestedModel", requested_vlm.get("model")),
        ("effectiveModel", requested_vlm.get("model")),
        ("requestedBackend", requested_vlm.get("backend")),
        ("effectiveBackend", requested_vlm.get("backend")),
    )):
        raise ValueError("VLM requested/effective route drift")
    if any(sam_report.get(field) != expected for field, expected in (
        ("requestedModel", requested_sam.get("model")),
        ("effectiveModel", requested_sam.get("model")),
        ("requestedBackend", requested_sam.get("backend")),
        ("effectiveBackend", requested_sam.get("backend")),
        ("threshold", requested_sam.get("threshold")),
    )):
        raise ValueError("SAM requested/effective route drift")
    comparison_rows = {
        (row.get("viewId"), row.get("proposalSystemId")): row
        for row in comparison.get("rows") or []
    }
    rows = []
    for mask_record in sam_report.get("masks") or []:
        key = (mask_record.get("viewId"), mask_record.get("proposalSystemId"))
        comparison_row = comparison_rows.get(key)
        if comparison_row is None:
            raise ValueError(f"{key}: SAM mask lacks a comparison row")
        for product_name in ("mask", "overlay"):
            product = mask_record.get(product_name) or {}
            path = (run_root / "sam3-raw" / str(product.get("path", ""))).resolve()
            try:
                path.relative_to((run_root / "sam3-raw").resolve())
            except ValueError as error:
                raise ValueError(f"{key}: {product_name} path escapes run root") from error
            if not path.is_file() or path.stat().st_size <= 0:
                raise ValueError(f"{key}: {product_name} is missing or blank")
            if path.stat().st_size != product.get("byteLength"):
                raise ValueError(f"{key}: {product_name} byte length mismatch")
            if sha256(path) != product.get("sha256"):
                raise ValueError(f"{key}: {product_name} digest mismatch")
        rows.append({
            **mask_record,
            "overlayPath": (run_root / "sam3-raw" / mask_record["overlay"]["path"]).resolve(),
            "bestTruthMatch": comparison_row.get("bestTruthMatch"),
            "bestMetrics": comparison_row.get("bestMetrics") or {},
        })
    return {
        "armId": manifest["armId"],
        "requestedVlm": requested_vlm,
        "requestedSam": requested_sam,
        "inventory": inventory,
        "rows": rows,
        "claimCeiling": manifest.get("claimCeiling"),
        "modelFailureInterpretation": manifest.get("modelFailureInterpretation"),
    }


def estimator_section(label: str, run: dict[str, Any], output_dir: Path) -> str:
    systems = run["inventory"].get("systems") or []
    has_ruff = any(
        "ruff" in f"{system.get('id', '')} {system.get('segmenter_phrase', '')}".lower()
        for system in systems
    )
    system_rows = []
    for system in systems:
        system_rows.append(
            "<tr>"
            f"<td><code>{e(system.get('id'))}</code></td>"
            f"<td>{e(system.get('segmenter_phrase'))}</td>"
            f"<td>{e(system.get('relative_length'))}</td>"
            f"<td>{e(system.get('density'))}</td>"
            f"<td>{e(system.get('outward_puff'))}</td>"
            f"<td>{e(system.get('confidence'))}</td>"
            "</tr>"
        )
    overlay_cards = []
    for row in run["rows"]:
        metrics = row["bestMetrics"]
        overlay_cards.append(f"""
<figure class="overlay-card"><img src="{e(relative(row['overlayPath'], output_dir))}" alt="{e(label)} {e(row['viewId'])} {e(row['proposalSystemId'])} SAM overlay"><figcaption><strong>{e(row['viewId'])} · {e(row['proposalSystemId'])}</strong><span>best {e(row['bestTruthMatch'])} · IoU {e(f"{float(metrics.get('iou', 0)):.3f}")} · P {e(f"{float(metrics.get('precision', 0)):.3f}")} · R {e(f"{float(metrics.get('recall', 0)):.3f}")}</span></figcaption></figure>""")
    return f"""
<section class="panel estimator"><h2>{e(label)} estimator return</h2>
<p>VLM: <code>{e(run['requestedVlm']['model'])}</code> · SAM: <code>{e(run['requestedSam']['model'])}</code> · threshold <code>{e(run['requestedSam']['threshold'])}</code> · explicit ruff proposal: <strong>{'yes' if has_ruff else 'no'}</strong></p>
<table><thead><tr><th>System</th><th>Literal SAM phrase</th><th>Length</th><th>Density</th><th>Puff</th><th>Confidence</th></tr></thead><tbody>{''.join(system_rows)}</tbody></table>
<div class="overlay-grid">{''.join(overlay_cards)}</div></section>"""


def has_explicit_ruff_proposal(run: dict[str, Any]) -> bool:
    return any(
        "ruff" in f"{system.get('id', '')} {system.get('segmenter_phrase', '')}".lower()
        for system in run["inventory"].get("systems") or []
    )


def validate_pair(
    baseline: dict[str, Any],
    successor: dict[str, Any],
    baseline_path: Path,
    successor_path: Path,
    repo_root: Path,
) -> dict[str, Any]:
    failures: list[str] = []
    reports = []
    for label, observation, path in (
        ("baseline", baseline, baseline_path),
        ("successor", successor, successor_path),
    ):
        report = CORE.evaluate_source_like_observation(
            observation,
            observation_dir=path.parent,
            repo_root=repo_root,
        )
        reports.append(report)
        if report["state"] != "presentation_pair_bound_for_visual_inspection":
            failures.extend(f"{label}: {failure}" for failure in report["failures"])
    for field in ("fixtureId", "requestedRoute", "effectiveRoute", "heldConstant", "source"):
        if baseline.get(field) != successor.get(field):
            failures.append(f"paired observations drift on {field}")
    baseline_approx = baseline.get("targetDistributionApproximation") or {}
    successor_approx = successor.get("targetDistributionApproximation") or {}
    for field in (
        "fiberCurveCount",
        "fiberCountsByRegime",
        "baselineFiberCountsByRegime",
        "baselineCoatFiberCurveCount",
        "coatFiberCurveCount",
        "requestedDensityMultiplier",
        "effectiveDensityMultiplier",
        "renderer",
        "blenderVersion",
        "coatPalettePolicy",
    ):
        if baseline_approx.get(field) != successor_approx.get(field):
            failures.append(f"paired observations drift on {field}")
    baseline_lengths = baseline_approx.get("effectiveFiberLengths") or {}
    baseline_length_authority = "observation-bound-effective-fiber-lengths"
    if not baseline_lengths:
        if baseline.get("observationId") != "procedural-groom-source-like-v0-density-12x":
            failures.append("legacy baseline lacks effective lengths and does not match the frozen density-12x identity")
        baseline_lengths = successor_approx.get("baselineFiberLengths") or {}
        baseline_length_authority = "legacy-density12x-identity-plus-successor-bound-baseline-lengths"
    successor_lengths = successor_approx.get("effectiveFiberLengths") or {}
    if any(baseline_lengths.get(regime) != successor_lengths.get(regime) for regime in ("short", "puffy")):
        failures.append("short or puffy length drifted in the ruff-only pair")
    multiplier = successor_approx.get("effectiveRuffLengthMultiplier")
    if not isinstance(multiplier, (int, float)) or not math.isclose(float(multiplier), 2.5):
        failures.append("successor does not bind the selected 2.5x ruff multiplier")
    baseline_views = {view["id"]: view for view in baseline.get("views") or []}
    successor_views = {view["id"]: view for view in successor.get("views") or []}
    if set(baseline_views) != set(successor_views):
        failures.append("paired view identities differ")
    else:
        for view_id in baseline_views:
            left = baseline_views[view_id]
            right = successor_views[view_id]
            for field in ("cameraPosition", "cameraTarget", "blenderCameraPosition", "blenderCameraTarget"):
                if left.get(field) != right.get(field):
                    failures.append(f"{view_id}: paired camera drift on {field}")
            if left["diagnostic"].get("sha256") != right["diagnostic"].get("sha256"):
                failures.append(f"{view_id}: diagnostic control drifted")
            if left["sourceLike"].get("sha256") == right["sourceLike"].get("sha256"):
                failures.append(f"{view_id}: subtle and constitutive images are identical")
    return {
        "schema": REPORT_SCHEMA,
        "state": "threshold_pair_bound_for_visual_inspection" if not failures else "invalid_threshold_pair",
        "failures": failures,
        "baselinePreflight": reports[0]["state"] if reports else None,
        "successorPreflight": reports[1]["state"] if len(reports) > 1 else None,
        "baselineLengthAuthority": baseline_length_authority,
        "visualAdmission": False,
        "scientificAdmission": False,
    }


def build(
    baseline_path: Path,
    successor_path: Path,
    repo_root: Path,
    output_path: Path,
    baseline_run_root: Path | None = None,
    successor_run_root: Path | None = None,
) -> dict[str, Any]:
    baseline_path = baseline_path.resolve()
    successor_path = successor_path.resolve()
    output_path = output_path.resolve()
    baseline = json.loads(baseline_path.read_text())
    successor = json.loads(successor_path.read_text())
    report = validate_pair(baseline, successor, baseline_path, successor_path, repo_root.resolve())
    if report["state"] != "threshold_pair_bound_for_visual_inspection":
        raise ValueError("threshold pair preflight failed: " + "; ".join(report["failures"]))

    baseline_views = {view["id"]: view for view in baseline["views"]}
    successor_views = {view["id"]: view for view in successor["views"]}
    rows = []
    for view_id in VIEW_LABELS:
        baseline_image = baseline_path.parent / baseline_views[view_id]["sourceLike"]["path"]
        successor_image = successor_path.parent / successor_views[view_id]["sourceLike"]["path"]
        rows.append(f"""
<section class="view panel"><h2>{e(VIEW_LABELS[view_id])}</h2><div class="pair">
<figure><img src="{e(relative(baseline_image, output_path.parent))}" alt="{e(view_id)} subtle ruff arm"><figcaption><strong>Subtle ruff</strong><span>Ruff 0.34 · puffy 0.19</span></figcaption></figure>
<figure><img src="{e(relative(successor_image, output_path.parent))}" alt="{e(view_id)} constitutive ruff arm"><figcaption><strong>Constitutive ruff</strong><span>Ruff 0.85 · exact 2.5× perturbation</span></figcaption></figure>
</div></section>""")
    result_section = ""
    estimator_sections = ""
    if (baseline_run_root is None) != (successor_run_root is None):
        raise ValueError("both estimator run roots are required together")
    if baseline_run_root is not None and successor_run_root is not None:
        baseline_run = load_estimator_run(baseline_run_root)
        successor_run = load_estimator_run(successor_run_root)
        baseline_has_ruff = has_explicit_ruff_proposal(baseline_run)
        successor_has_ruff = has_explicit_ruff_proposal(successor_run)
        proposal_verdict = (
            "At least one arm produced an explicit ruff proposal."
            if baseline_has_ruff or successor_has_ruff
            else "Neither arm produced an explicit ruff proposal. The 2.5× arm therefore records a Gemma 3 4B miss on a visually constitutive length region."
        )
        result_section = f"""
<section class="panel result"><h2>Observed paired result</h2><p><strong>{e(proposal_verdict)}</strong></p>
<p>The SAM overlays below are the unadmitted raw result of the current candidate policy: union every returned detection above <code>{e(successor_run['requestedSam']['threshold'])}</code>. Broad background or whole-head spill is failure evidence, not a usable semantic region.</p>
<p>This result is specific to <code>{e(successor_run['requestedVlm']['model'])}</code>. It does not reject VLM-guided regional decomposition or justify changing the groom fixture before testing a more capable observer.</p></section>"""
        estimator_sections = (
            estimator_section("Subtle ruff", baseline_run, output_path.parent)
            + estimator_section("Constitutive ruff", successor_run, output_path.parent)
        )

    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Procedural Groom Ruff Threshold Pair</title>
<style>:root{{--bg:#0c0f13;--panel:#171c22;--line:#35404c;--text:#f5f0e8;--muted:#aeb8c5;--accent:#e7a95d}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}main{{width:min(1500px,calc(100% - 30px));margin:auto;padding:34px 0 70px}}h1{{font-size:clamp(34px,5vw,60px);line-height:1.02;margin:0 0 12px}}h2{{margin:0 0 16px;font-size:27px}}p{{margin:0 0 12px}}.lede{{max-width:1080px;font-size:19px;color:var(--muted)}}.panel{{margin-top:24px;background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:20px}}.predicate{{border-left:8px solid var(--accent)}}.pair{{display:grid;grid-template-columns:1fr 1fr;gap:16px}}figure{{margin:0;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#080b0e}}figure img{{width:100%;height:auto;display:block}}figcaption{{display:flex;justify-content:space-between;gap:15px;padding:11px 13px;background:#202832;color:var(--muted)}}figcaption strong{{color:var(--text)}}code{{color:#d7e8ff}}.audit{{color:var(--muted);font-size:13px}}table{{width:100%;border-collapse:collapse;margin:14px 0 20px}}th,td{{border-bottom:1px solid var(--line);padding:8px;text-align:left;vertical-align:top}}th{{color:var(--muted)}}.overlay-grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}}.overlay-card img{{aspect-ratio:4/3;object-fit:cover}}.overlay-card figcaption{{display:block;font-size:12px}}.overlay-card figcaption span{{display:block;margin-top:4px}}@media(max-width:1100px){{.overlay-grid{{grid-template-columns:repeat(3,1fr)}}}}@media(max-width:900px){{.pair{{grid-template-columns:1fr}}.overlay-grid{{grid-template-columns:repeat(2,1fr)}}}}</style></head><body><main>
<header><h1>Ruff threshold pair</h1><p class="lede">The same dense procedural cat, cameras, lighting, fibers, palette, and estimator contract. Only lower-ruff length changes: <code>0.34 → 0.85</code>. The second arm makes the region constitutive enough that collapsing it into the neighboring puffy field is an obvious residual.</p></header>
<section class="panel predicate"><h2>Inspection predicate</h2><p>Does the right arm make materially longer lower hair legible at first glance without changing the upper coat or whisker system?</p><p>This is a controlled assay fixture, not a production groom beauty target.</p></section>
{''.join(rows)}
{result_section}
{estimator_sections}
<section class="panel audit"><h2>Audit</h2><p>Baseline: <code>{e(baseline['observationId'])}</code></p><p>Successor: <code>{e(successor['observationId'])}</code></p><p>Fiber count: <code>{e(successor['targetDistributionApproximation']['fiberCurveCount'])}</code> · density: <code>{e(successor['targetDistributionApproximation']['effectiveDensityMultiplier'])}×</code> · ruff multiplier: <code>2.5×</code></p><p>Preflight: <code>{e(report['state'])}</code> · visual admission false · scientific admission false.</p><p>Claim ceiling: {e(successor['claimCeiling'])}</p></section>
</main></body></html>"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(line.rstrip() for line in page.splitlines()) + "\n")
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--successor", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--baseline-run-root", type=Path)
    parser.add_argument("--successor-run-root", type=Path)
    args = parser.parse_args()
    try:
        report = build(
            args.baseline,
            args.successor,
            args.repo_root,
            args.output,
            args.baseline_run_root,
            args.successor_run_root,
        )
    except Exception as error:
        report = {
            "schema": REPORT_SCHEMA,
            "state": "review_build_failed",
            "failures": [str(error)],
            "visualAdmission": False,
            "scientificAdmission": False,
        }
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n")
        raise
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
