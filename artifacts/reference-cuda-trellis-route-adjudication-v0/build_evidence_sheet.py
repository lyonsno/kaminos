#!/usr/bin/env python3
"""Build the reference-CUDA route adjudication evidence surface."""

from __future__ import annotations

import html
import hashlib
import json
import os
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def _asset(path: Path) -> str:
    return Path(os.path.relpath(path.resolve(), ROOT)).as_posix()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_launch_attempts(path: Path) -> dict[str, Any]:
    payload = _read_json(path)
    attempts = payload.get("attempts")
    if not isinstance(attempts, list) or not attempts:
        raise RuntimeError("launch attempts must be a non-empty list")
    for attempt in attempts:
        if attempt.get("status", "").startswith("rejected-pre-"):
            if attempt.get("jobId") is not None:
                raise RuntimeError("a pre-provisioning rejection cannot carry a jobId")
            if attempt.get("charged") is not False:
                raise RuntimeError("a pre-provisioning rejection must record charged=false")
        if not attempt.get("failurePhase"):
            raise RuntimeError("every failed launch must name its failurePhase")
    return payload


def validate_route_evidence(root: Path) -> dict[str, dict[str, Any]]:
    control = _read_json(root / "runs/official-T-seed0-res1024/run-report.json")
    stone = _read_json(root / "runs/stone-seed80301-res1024/run-report.json")
    authenticated_retry = _read_json(
        root / "runs/stone-seed80301-res1024-authenticated/run-report.json"
    )
    if control.get("status") != "completed" or not control.get("output"):
        raise RuntimeError("the official CUDA control must carry a completed GLB")
    control_output = Path(control["output"]["path"])
    if not control_output.is_file() or control_output.stat().st_size != control["output"]["bytes"]:
        raise RuntimeError("the official CUDA control GLB is missing or partial")
    if not control.get("previewReturned"):
        raise RuntimeError("the official CUDA control must record its model preview")
    if stone.get("status") != "failed":
        raise RuntimeError("the unresolved stone cell must not look completed")
    if stone.get("failurePhase") != "space-glb-extraction":
        raise RuntimeError("the stone failure must remain bound to GLB extraction")
    if not stone.get("previewReturned") or stone.get("output") is not None:
        raise RuntimeError("the stone cell must distinguish preview return from absent GLB")
    if authenticated_retry.get("status") != "failed":
        raise RuntimeError("the authenticated retry must remain an explicit failed attempt")
    if authenticated_retry.get("failurePhase") != "space-inference":
        raise RuntimeError("the authenticated retry must remain bound to its inference admission")
    if authenticated_retry.get("previewReturned"):
        raise RuntimeError("the authenticated retry must not inherit the earlier model preview")
    if authenticated_retry.get("source", {}).get("sha256") != stone.get("source", {}).get("sha256"):
        raise RuntimeError("the authenticated retry source drifted from the admitted stone input")
    return {
        "control": control,
        "stone": stone,
        "authenticatedRetry": authenticated_retry,
    }


def validate_comparison_sources(path: Path) -> dict[str, Any]:
    payload = _read_json(path)
    routes = payload.get("routes")
    if not isinstance(routes, dict) or set(routes) != {"sf3d", "trellis2mlx_fast"}:
        raise RuntimeError("comparison sources must bind SF3D and TRELLIS.2 MLX")
    for route_id, route in routes.items():
        frames = route.get("frames")
        if not isinstance(frames, list) or len(frames) != 6:
            raise RuntimeError(f"{route_id} must bind exactly six vendored frames")
        for frame in frames:
            frame_path = path.parent / frame["path"]
            if not frame_path.is_file() or _sha256(frame_path) != frame["sha256"]:
                raise RuntimeError(f"{route_id} comparison frame is missing or drifted")
    return payload


def _orbit(prefix: Path) -> str:
    images = sorted(prefix.glob("*.png"))
    if len(images) != 6:
        raise RuntimeError(f"expected six orbit frames under {prefix}, found {len(images)}")
    return "".join(f'<img src="{html.escape(_asset(path))}">' for path in images)


def main() -> None:
    evidence = validate_route_evidence(ROOT)
    launches = validate_launch_attempts(ROOT / "launch-attempts.json")
    comparison = validate_comparison_sources(ROOT / "comparison-sources.json")
    control = evidence["control"]
    stone = evidence["stone"]
    authenticated_retry = evidence["authenticatedRetry"]

    sf3d_orbit = ROOT / "comparison/sf3d"
    mlx_orbit = ROOT / "comparison/trellis2mlx_fast"
    control_orbit = ROOT / "runs/official-T-seed0-res1024/orbit"
    source = ROOT / "inputs/stone-thick-overlapping-slabs-seed80301.png"
    preprocessed = ROOT / "runs/stone-seed80301-res1024/preprocessed.png"
    control_source = ROOT / "inputs/official-T.png"

    attempts = "".join(
        f"<li><strong>{html.escape(item['route'])}</strong>: {html.escape(item['status'])} at "
        f"<code>{html.escape(item['failurePhase'])}</code>. {html.escape(item['message'])} "
        f"No job id; charged={str(item['charged']).lower()}.</li>"
        for item in launches["attempts"]
    )
    sampler = stone["effectiveRoute"]["sampler"]
    document = f"""<!doctype html><meta charset="utf-8"><title>Reference CUDA TRELLIS adjudication</title>
<style>
*{{box-sizing:border-box}}body{{font:15px system-ui;background:#111315;color:#eceff1;margin:26px;line-height:1.45}}
h1{{font-size:30px;margin:0 0 6px}}h2{{font-size:22px;margin:0 0 12px}}h3{{font-size:16px;margin:0 0 8px}}
p,li{{color:#bcc2c7}}strong{{color:#f3f5f6}}code{{color:#dce1e5;overflow-wrap:anywhere}}
.lede{{font-size:17px;max-width:1100px}}.verdict{{border-left:5px solid #68c78c;padding:2px 16px;margin:24px 0;max-width:1150px}}
.warning{{border-left-color:#e8ad55}}article{{border-top:1px solid #3b4045;padding:25px 0}}
.pair{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;max-width:900px}}.pair img{{width:100%;background:#202326}}
.routes{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}}.route{{min-width:0}}
.orbit{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}}.orbit img{{width:100%;display:block;background:#202326}}
.status{{display:inline-block;padding:3px 8px;border-radius:4px;background:#315b3d;color:#dff4e5;font-weight:700}}
.blocked{{background:#694d24;color:#ffedc7}}.meta{{font:12px ui-monospace;color:#9fa6ac;overflow-wrap:anywhere}}
@media(max-width:950px){{.routes,.pair{{grid-template-columns:1fr}}}}
</style>
<h1>Reference CUDA TRELLIS route adjudication</h1>
<p class="lede">Does the weak rigid-stone reconstruction indict TRELLIS.2 itself, or only the current Mac routes?</p>
<div class="verdict"><strong>What changed:</strong> stock Microsoft CUDA is now a witnessed healthy route. The exact stone input reached a returned model preview in 30.75 seconds, but the public Space refused the separate GLB extraction call after its free ZeroGPU quota was consumed. That is evidence of successful inference and absent export, not a stone reconstruction verdict.</div>
<article><h2>Exact disputed source</h2><div class="pair"><figure><img src="{html.escape(_asset(source))}"><figcaption>FLUX output supplied to every reconstruction route</figcaption></figure><figure><img src="{html.escape(_asset(preprocessed))}"><figcaption>Official Microsoft <code>/preprocess_image</code> return supplied to CUDA</figcaption></figure></div>
<p class="meta">source sha256 {stone['source']['sha256']} · preprocessed sha256 {stone['preprocessed']['sha256']} · seed {stone['effectiveRoute']['seed']} · resolution {stone['effectiveRoute']['resolution']} · sparse/shape/texture steps {sampler['ssSamplingSteps']}/{sampler['shapeSlatSamplingSteps']}/{sampler['texSlatSamplingSteps']}</p></article>
<article><h2>Official CUDA positive control</h2><p><span class="status">HEALTHY GLB</span> Microsoft Space revision <code>{control['effectiveRoute']['spaceIdentityAfter']['sha']}</code>; model plus export completed in {control['timingsSeconds']['total']:.2f}s. This clears route health before interpreting the disputed source.</p><div class="pair"><figure><img src="{html.escape(_asset(control_source))}"><figcaption>Canonical Microsoft T input</figcaption></figure><div class="orbit">{_orbit(control_orbit)}</div></div><p class="meta">GLB {control['output']['bytes']:,} bytes · sha256 {control['output']['sha256']}</p></article>
<article><h2>Existing stone reconstructions, adjacent</h2><div class="routes"><section class="route"><h3>Stable Fast 3D</h3><div class="orbit">{_orbit(sf3d_orbit)}</div><p>Closer stocky silhouette and mass placement; locally fused and softened plate structure.</p><p class="meta">{html.escape(comparison['routes']['sf3d']['sourceArtifact'])}</p></section><section class="route"><h3>TRELLIS.2 MLX</h3><div class="orbit">{_orbit(mlx_orbit)}</div><p>Sharper separable components, but a stronger learned-basin rewrite into a lean articulated object.</p><p class="meta">{html.escape(comparison['routes']['trellis2mlx_fast']['sourceArtifact'])}</p></section><section class="route"><h3>Official CUDA, exact stone</h3><p><span class="status blocked">EXPORT UNRESOLVED</span></p><p>The anonymous public run returned its 48-view model preview. The subsequent 300k-face, 2K-texture GLB extraction was rejected by ZeroGPU quota. The initial runner did not retain the HTML preview; that preservation bug is fixed for replay.</p><p>The later authenticated retry was a separate same-source attempt and was rejected before inference; it produced no preview and carries no counter-result.</p><p class="meta">first attempt: inference {stone['timingsSeconds']['space-inference']:.2f}s · failurePhase {stone['failurePhase']} · last trustworthy evidence {stone['lastTrustworthyEvidence']}<br>authenticated retry: failurePhase {authenticated_retry['failurePhase']} · previewReturned={str(authenticated_retry['previewReturned']).lower()}</p></section></div></article>
<article><h2>Continuation boundary</h2><p>The exact paid replay is already pinned to the official Space image and app hash, model revision, exact preprocessed source, A10G 24 GB, seed 80301, official 12/12/12 sampler, 300k-face export, and 2K texture. Its 15-minute cost ceiling is $0.2505.</p><ul>{attempts}</ul><p><strong>Default:</strong> add positive Hugging Face prepaid credit and launch the exact A10G job immediately. Cost to learn is bounded; waiting for the public quota resets the same experiment for free after roughly 24 hours.</p></article>
<article><h2>Claim ceiling</h2><p>This evidence establishes that stock Microsoft CUDA can produce a healthy complex GLB and that the disputed stone input completed official model inference. It does <strong>not</strong> establish what official CUDA reconstructs for the stone source until a GLB is exported and visually inspected across views. It also rejects the campaign-wide claim that one reconstruction backend is uniformly superior.</p></article>
"""
    (ROOT / "evidence-sheet.html").write_text(document)


if __name__ == "__main__":
    main()
