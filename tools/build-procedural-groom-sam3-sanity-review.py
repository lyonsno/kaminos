#!/usr/bin/env python3
"""Build one digest-bound review page for the direct SAM3 sanity matrix."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
from pathlib import Path
from typing import Any


REPORT_SCHEMA = "kaminos.procedural-groom-sam3-sanity-report.v0"
REVIEW_SCHEMA = "kaminos.procedural-groom-sam3-sanity-review.v0"


def e(value: object) -> str:
    return html.escape(str(value), quote=True)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def relative(path: Path, output_dir: Path) -> str:
    return Path(os.path.relpath(path.resolve(), output_dir.resolve())).as_posix()


def bound_product(run_root: Path, record: dict[str, Any], label: str) -> Path:
    path = (run_root / str(record.get("path", ""))).resolve()
    try:
        path.relative_to(run_root.resolve())
    except ValueError as error:
        raise ValueError(f"{label}: path escapes run root") from error
    if not path.is_file() or path.stat().st_size <= 0:
        raise ValueError(f"{label}: missing or blank")
    if path.stat().st_size != record.get("byteLength"):
        raise ValueError(f"{label}: byte length mismatch")
    if sha256(path) != record.get("sha256"):
        raise ValueError(f"{label}: digest mismatch")
    return path


def load(report_path: Path, repo_root: Path) -> dict[str, Any]:
    report_path = report_path.resolve()
    repo_root = repo_root.resolve()
    run_root = report_path.parent
    report = json.loads(report_path.read_text())
    if report.get("schema") != REPORT_SCHEMA:
        raise ValueError("sanity report schema mismatch")
    if report.get("state") != "sanity_matrix_captured" or report.get("phase") != "complete":
        raise ValueError("sanity report is not terminal captured evidence")
    if report.get("requestedModel") != report.get("effectiveModel"):
        raise ValueError("requested/effective model drift")
    if report.get("requestedBackend") != report.get("effectiveBackend"):
        raise ValueError("requested/effective backend drift")
    if report.get("candidateCustody") != "individual-raw-candidates-preserved":
        raise ValueError("individual raw candidate custody is missing")
    if report.get("visualAdmission") is not False or report.get("scientificAdmission") is not False:
        raise ValueError("sanity report cannot admit itself")

    source = report.get("source") or {}
    source_path = (repo_root / str(source.get("path", ""))).resolve()
    try:
        source_path.relative_to(repo_root)
    except ValueError as error:
        raise ValueError("source path escapes repo root") from error
    if not source_path.is_file() or source_path.stat().st_size <= 0:
        raise ValueError("source image is missing or blank")
    if sha256(source_path) != source.get("sha256"):
        raise ValueError("source image digest mismatch")

    prompts = report.get("prompts")
    if not isinstance(prompts, list) or not prompts:
        raise ValueError("sanity report has no prompts")
    loaded_prompts = []
    for prompt in prompts:
        candidates = prompt.get("candidates") or []
        if prompt.get("rawCandidateCount") != len(candidates):
            raise ValueError(f"{prompt.get('id')}: raw candidate count mismatch")
        loaded_candidates = []
        for candidate in candidates:
            loaded_candidates.append({
                **candidate,
                "maskPath": bound_product(run_root, candidate.get("mask") or {}, f"{prompt.get('id')} candidate mask"),
                "overlayPath": bound_product(run_root, candidate.get("overlay") or {}, f"{prompt.get('id')} candidate overlay"),
            })
        selection_views = prompt.get("selectionViews") or []
        if not selection_views:
            raise ValueError(f"{prompt.get('id')}: no derived selection views")
        loaded_views = []
        for view in selection_views:
            indices = view.get("candidateIndices") or []
            if view.get("candidateCount") != len(indices):
                raise ValueError(f"{prompt.get('id')} {view.get('id')}: candidate count mismatch")
            if any(not isinstance(index, int) or not 0 <= index < len(candidates) for index in indices):
                raise ValueError(f"{prompt.get('id')} {view.get('id')}: candidate index escapes raw set")
            loaded_views.append({
                **view,
                "maskPath": bound_product(run_root, view.get("mask") or {}, f"{prompt.get('id')} selection mask"),
                "overlayPath": bound_product(run_root, view.get("overlay") or {}, f"{prompt.get('id')} selection overlay"),
            })
        loaded_prompts.append({**prompt, "candidates": loaded_candidates, "selectionViews": loaded_views})
    return {**report, "sourcePath": source_path, "prompts": loaded_prompts}


def build(report_path: Path, repo_root: Path, output_path: Path) -> dict[str, Any]:
    output_path = output_path.resolve()
    report = load(report_path, repo_root)
    prompt_index = {prompt["id"]: prompt for prompt in report["prompts"]}
    summary_specs = [
        ("whole-cat", "default-0p3-nms-0p5", "Whole cat · documented default"),
        ("cat-nose", "default-0p3-nms-0p5", "Nose · documented default"),
        ("cat-eye", "raw-0p1", "Eye · old raw 0.1"),
        ("cat-eye", "default-0p3-nms-0p5", "Eye · documented default"),
        ("gemma-main-fur-text-only", "raw-0p1", "Gemma phrase, text-only · old raw 0.1"),
        ("gemma-main-fur-text-only", "default-0p3-nms-0p5", "Gemma phrase, text-only · documented default"),
        ("gemma-main-fur-box-guided", "raw-0p1", "Gemma phrase + box · old raw 0.1"),
        ("gemma-main-fur-box-guided", "default-0p3-nms-0p5", "Gemma phrase + box · documented default"),
        ("negative-car", "default-0p3-nms-0p5", "Negative car control"),
    ]
    summary_cards = []
    for prompt_id, view_id, label in summary_specs:
        prompt = prompt_index.get(prompt_id)
        if prompt is None:
            continue
        view = next((item for item in prompt["selectionViews"] if item.get("id") == view_id), None)
        if view is None:
            continue
        summary_cards.append(f"""
<figure><img src="{e(relative(view['overlayPath'], output_path.parent))}" alt="{e(label)}"><figcaption><strong>{e(label)}</strong><span>{e(view['candidateCount'])} candidate(s) · {e(view['positivePixels'])} px</span></figcaption></figure>""")
    prompt_sections = []
    for prompt in report["prompts"]:
        selection_cards = []
        for view in prompt["selectionViews"]:
            selection_cards.append(f"""
<figure><img src="{e(relative(view['overlayPath'], output_path.parent))}" alt="{e(prompt['id'])} {e(view['id'])} selection overlay"><figcaption><strong>{e(view['id'])}</strong><span>{e(view['candidateCount'])} candidate(s) · {e(view['positivePixels'])} px</span></figcaption></figure>""")
        ranked_candidates = sorted(
            prompt["candidates"],
            key=lambda candidate: (-float(candidate.get("score", 0)), int(candidate.get("index", 0))),
        )[:6]
        candidate_cards = []
        for candidate in ranked_candidates:
            candidate_cards.append(f"""
<figure><img src="{e(relative(candidate['overlayPath'], output_path.parent))}" alt="{e(prompt['id'])} candidate {e(candidate['index'])}"><figcaption><strong>candidate {e(candidate['index'])}</strong><span>score {float(candidate['score']):.3f} · {e(candidate['positivePixels'])} px</span></figcaption></figure>""")
        prompt_sections.append(f"""
<section class="panel prompt"><h2>{e(prompt['id'])}</h2><p class="prompt-text"><code>{e(prompt['text'])}</code> · {e(prompt['mode'])} · {e(prompt['rawCandidateCount'])} candidate(s) above raw threshold</p>
<h3>Selection views</h3><div class="selection-grid">{''.join(selection_cards)}</div>
<h3>Highest-scoring individual raw candidates</h3><div class="candidate-grid">{''.join(candidate_cards) if candidate_cards else '<p>No candidates.</p>'}</div></section>""")

    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SAM3 Literal Prompt Sanity Matrix</title>
<style>:root{{--bg:#0b0f13;--panel:#171d23;--line:#36414d;--text:#f4efe7;--muted:#aeb9c6;--accent:#62b6cb}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}main{{width:min(1600px,calc(100% - 28px));margin:auto;padding:34px 0 70px}}h1{{font-size:clamp(34px,5vw,62px);line-height:1.02;margin:0 0 12px}}h2{{font-size:29px;margin:0 0 4px}}h3{{margin:20px 0 10px;color:var(--muted)}}p{{margin:0 0 12px}}.lede{{font-size:19px;color:var(--muted);max-width:1120px}}.panel{{margin-top:24px;background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:20px}}.predicate{{border-left:8px solid var(--accent)}}.source{{max-width:850px}}.source img,figure img{{display:block;width:100%;height:auto}}.summary-grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}}.selection-grid{{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}}.candidate-grid{{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}}figure{{margin:0;border:1px solid var(--line);border-radius:11px;overflow:hidden;background:#070a0d}}figcaption{{padding:9px;background:#212a33;color:var(--muted);font-size:12px}}figcaption strong,figcaption span{{display:block}}figcaption strong{{color:var(--text)}}code{{color:#d5edff}}.audit{{color:var(--muted);font-size:13px}}@media(max-width:1200px){{.selection-grid{{grid-template-columns:repeat(3,1fr)}}.candidate-grid{{grid-template-columns:repeat(3,1fr)}}}}@media(max-width:750px){{.summary-grid,.selection-grid,.candidate-grid{{grid-template-columns:1fr 1fr}}}}</style></head><body><main>
<header><h1>SAM3 literal-prompt sanity matrix</h1><p class="lede">One frozen cat image, one effective SAM3 route, and literal prompts with no Gemma involvement. Every individual raw candidate is preserved. The derived views expose what thresholding, the documented image default, NMS, and top-1 selection actually change.</p></header>
<section class="panel predicate"><h2>Diagnostic predicate</h2><p>If obvious prompts are polite under <code>0.3 + NMS 0.5</code> but spray under raw <code>0.1</code>, our wrapper manufactured the weirdness. If the documented-default view still sprays, inspect the prompt/image/model route rather than merely changing aggregation.</p></section>
<section class="panel"><h2>Observed result</h2><p><strong>The ordinary text-only route is polite. Our wrapper manufactured the spray.</strong></p><p>At <code>0.3 + NMS 0.5</code>, whole cat and nose each reduce to one legible mask, eye and ear each reduce to their two visible instances, and the negative car control returns none. <code>Dense, rounded fur</code> reduces from nine raw candidates at <code>0.1</code> to one coherent coat mask when used text-only.</p><p>Adding Gemma's broad box to that same phrase expands the raw return to twenty-six candidates; even the documented-default view retains a spurious exterior halo. In this predictor API the box is a positive geometry prompt, not the post-hoc region filter our wrapper needed. The old result therefore combines three wrapper errors: an abnormally low threshold, skipped NMS, and misuse of box guidance.</p><p>The direct phrase <code>long fur on the lower half of the cat head</code> returns one lower-coat/ruff mask under the documented default, which is encouraging prompt-level evidence but not yet a multiview semantic admission.</p></section>
<section class="panel"><h2>Decisive comparisons</h2><div class="summary-grid">{''.join(summary_cards)}</div></section>
<section class="panel source"><h2>Frozen source</h2><img src="{e(relative(report['sourcePath'], output_path.parent))}" alt="Frozen procedural cat front view"></section>
{''.join(prompt_sections)}
<section class="panel audit"><h2>Audit</h2><p>Model: <code>{e(report['effectiveModel'])}</code> · backend: <code>{e(report['effectiveBackend'])}</code> · raw threshold <code>{e(report['rawThreshold'])}</code> · report thresholds <code>{e(report['reportThresholds'])}</code> · NMS IoU <code>{e(report['nmsIouThreshold'])}</code>.</p><p>Candidate custody: <code>{e(report['candidateCustody'])}</code>. Visual admission false. Scientific admission false.</p><p>Claim ceiling: {e(report.get('claimCeiling'))}</p></section>
</main></body></html>"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(line.rstrip() for line in page.splitlines()) + "\n")
    return {
        "schema": REVIEW_SCHEMA,
        "state": "sanity_review_bound_for_visual_inspection",
        "promptCount": len(report["prompts"]),
        "visualAdmission": False,
        "scientificAdmission": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--review-report", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = build(args.report, args.repo_root, args.output)
    except Exception as error:
        result = {
            "schema": REVIEW_SCHEMA,
            "state": "sanity_review_build_failed",
            "failures": [str(error)],
            "visualAdmission": False,
            "scientificAdmission": False,
        }
        args.review_report.parent.mkdir(parents=True, exist_ok=True)
        args.review_report.write_text(json.dumps(result, indent=2) + "\n")
        raise
    args.review_report.parent.mkdir(parents=True, exist_ok=True)
    args.review_report.write_text(json.dumps(result, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
