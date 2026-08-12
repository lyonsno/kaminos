"""Render a digest-bound matched-view diagnostic for hidden-carrier evidence."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

import hidden_carrier_assay as assay
from hidden_carrier_fixture import (
    coat_depths,
    load_glb_surface,
    recovery_metrics,
    synthesize_observation,
)


SCHEMA = "kaminos.authored-cat-hidden-carrier-diagnostic.v0"
ROUTE = "cpu-numpy-svg-hidden-carrier-diagnostic-v0"
BACKEND = "python-numpy-stdlib-svg"
ARTIFACT_NAME = "hidden-carrier-diagnostic.svg"
REPORT_NAME = "diagnostic-report.json"


class DiagnosticFailure(RuntimeError):
    pass


def _now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _validate_points(name, value, count=None):
    points = np.asarray(value)
    if points.ndim != 2 or points.shape[1] != 3 or not len(points):
        raise DiagnosticFailure(f"{name} must have non-empty shape (n, 3)")
    if count is not None and len(points) != count:
        raise DiagnosticFailure(f"{name} cardinality mismatch: {len(points)} != {count}")
    if not np.issubdtype(points.dtype, np.number) or not np.isfinite(points).all():
        raise DiagnosticFailure(f"{name} must contain finite numeric values")
    return np.asarray(points, dtype=np.float64)


def _git_identity(repo_root):
    def run(*arguments):
        completed = subprocess.run(
            ["git", *arguments],
            cwd=repo_root,
            check=True,
            capture_output=True,
            text=True,
        )
        return completed.stdout.strip()

    # Durable public evidence must not publish private worktree or agent branch names.
    return {"commit": run("rev-parse", "HEAD"), "branch": "feature-worktree"}


def _color_ramp(values):
    values = np.clip(np.asarray(values, dtype=np.float64), 0.0, 1.0)
    stops = np.array(
        [
            [41, 211, 220],
            [244, 211, 94],
            [244, 112, 61],
            [207, 44, 95],
        ],
        dtype=np.float64,
    )
    scaled = values * (len(stops) - 1)
    low = np.floor(scaled).astype(int)
    high = np.minimum(low + 1, len(stops) - 1)
    mix = (scaled - low)[:, None]
    return np.rint(stops[low] * (1.0 - mix) + stops[high] * mix).astype(np.uint8)


def _point_elements(points, *, view, box, color, values=None, radius=1.35, opacity=0.88):
    u_axis, v_axis, depth_axis, v_sign = view
    u = points[:, u_axis]
    v = points[:, v_axis] * v_sign
    depth = points[:, depth_axis]
    order = np.argsort(depth)
    u_min, u_max, v_min, v_max = box["data"]
    x0, y0, width, height = box["pixel"]
    u_span = max(u_max - u_min, np.finfo(np.float64).eps)
    v_span = max(v_max - v_min, np.finfo(np.float64).eps)
    scale = min(width / u_span, height / v_span)
    x_pad = (width - u_span * scale) * 0.5
    y_pad = (height - v_span * scale) * 0.5
    x = x0 + x_pad + (u - u_min) * scale
    y = y0 + height - y_pad - (v - v_min) * scale
    if values is None:
        colors = [color] * len(points)
    else:
        colors = [f"rgb({r},{g},{b})" for r, g, b in _color_ramp(values)]
    return "".join(
        f'<circle cx="{x[index]:.2f}" cy="{y[index]:.2f}" r="{radius:.2f}" '
        f'fill="{colors[index]}" fill-opacity="{opacity:.3f}"/>'
        for index in order
    )


def _svg_document(carrier, observed, recovered, coat_depth, errors, metrics):
    width = 1800
    height = 1180
    margin_x = 54
    top = 146
    col_gap = 18
    row_gap = 42
    col_width = (width - margin_x * 2 - col_gap * 3) / 4
    row_height = 250
    plot_pad_x = 22
    plot_pad_y = 28
    views = [
        ("LATERAL", (2, 1, 0, -1), "AP  Z →", "DORSAL  -Y ↑"),
        ("ANTERIOR", (0, 1, 2, -1), "ML  X →", "DORSAL  -Y ↑"),
        ("DORSAL", (0, 2, 1, 1), "ML  X →", "POSTERIOR  Z ↑"),
    ]
    columns = (
        "AUTHORED HIDDEN CARRIER",
        "SYNTHETIC OBSERVED COAT",
        "UNIFORM-INSET RECOVERY",
        "CARRIER ERROR",
    )
    all_points = np.concatenate([carrier, observed, recovered], axis=0)
    coat_scale = (coat_depth - float(np.min(coat_depth))) / max(
        float(np.ptp(coat_depth)), np.finfo(np.float64).eps
    )
    error_scale = errors / max(float(np.max(errors)), np.finfo(np.float64).eps)
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        "<style>text{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}</style>",
        f'<rect width="{width}" height="{height}" fill="#071017"/>',
        '<text x="54" y="55" fill="#f4f0e6" font-size="27" font-weight="700">AUTHORED CAT · HIDDEN-CARRIER NEGATIVE CONTROL</text>',
        '<text x="54" y="89" fill="#9bb0bb" font-size="16">Matched projections · same extents per view · 3,764 corresponding vertices</text>',
        '<text x="54" y="117" fill="#e2b869" font-size="15">Question: where does one global 0.94 inset fail when coat depth varies spatially?</text>',
    ]
    for column, label in enumerate(columns):
        x = margin_x + column * (col_width + col_gap) + col_width / 2
        parts.append(
            f'<text x="{x:.1f}" y="137" text-anchor="middle" fill="#d9e2e7" font-size="14" font-weight="700">{label}</text>'
        )
    for row, (view_name, view, x_label, y_label) in enumerate(views):
        u_axis, v_axis, _, v_sign = view
        u = all_points[:, u_axis]
        v = all_points[:, v_axis] * v_sign
        u_pad = max(float(np.ptp(u)) * 0.045, 0.1)
        v_pad = max(float(np.ptp(v)) * 0.045, 0.1)
        data_box = (
            float(np.min(u) - u_pad),
            float(np.max(u) + u_pad),
            float(np.min(v) - v_pad),
            float(np.max(v) + v_pad),
        )
        row_y = top + row * (row_height + row_gap)
        parts.append(
            f'<text x="16" y="{row_y + row_height / 2:.1f}" transform="rotate(-90 16 {row_y + row_height / 2:.1f})" '
            f'text-anchor="middle" fill="#8aa0ac" font-size="14" font-weight="700">{view_name}</text>'
        )
        for column in range(4):
            panel_x = margin_x + column * (col_width + col_gap)
            box = {
                "data": data_box,
                "pixel": (
                    panel_x + plot_pad_x,
                    row_y + plot_pad_y,
                    col_width - plot_pad_x * 2,
                    row_height - plot_pad_y * 2,
                ),
            }
            parts.append(
                f'<rect x="{panel_x:.1f}" y="{row_y:.1f}" width="{col_width:.1f}" height="{row_height}" '
                'rx="5" fill="#0d1a22" stroke="#26404d" stroke-width="1"/>'
            )
            if column == 0:
                parts.append(_point_elements(carrier, view=view, box=box, color="#b7c7cf"))
            elif column == 1:
                parts.append(
                    _point_elements(
                        observed,
                        view=view,
                        box=box,
                        color="#d7a052",
                        values=coat_scale,
                    )
                )
            elif column == 2:
                parts.append(
                    _point_elements(
                        carrier,
                        view=view,
                        box=box,
                        color="#a7bac4",
                        radius=1.15,
                        opacity=0.22,
                    )
                )
                parts.append(
                    _point_elements(
                        recovered,
                        view=view,
                        box=box,
                        color="#c18ae8",
                        radius=1.35,
                        opacity=0.88,
                    )
                )
            else:
                parts.append(
                    _point_elements(
                        carrier,
                        view=view,
                        box=box,
                        color="#8fa4ae",
                        radius=1.05,
                        opacity=0.18,
                    )
                )
                parts.append(
                    _point_elements(
                        recovered,
                        view=view,
                        box=box,
                        color="#ffffff",
                        values=error_scale,
                        radius=1.45,
                        opacity=0.92,
                    )
                )
            parts.extend(
                [
                    f'<text x="{panel_x + col_width / 2:.1f}" y="{row_y + row_height - 8:.1f}" text-anchor="middle" fill="#6f8793" font-size="11">{html.escape(x_label)}</text>',
                    f'<text x="{panel_x + 6:.1f}" y="{row_y + row_height / 2:.1f}" transform="rotate(-90 {panel_x + 6:.1f} {row_y + row_height / 2:.1f})" text-anchor="middle" fill="#6f8793" font-size="11">{html.escape(y_label)}</text>',
                ]
            )
    footer_y = top + 3 * (row_height + row_gap) - row_gap + 36
    parts.extend(
        [
            f'<rect x="54" y="{footer_y}" width="1692" height="104" rx="6" fill="#0d1a22" stroke="#26404d"/>',
            f'<text x="76" y="{footer_y + 28}" fill="#f4f0e6" font-size="15" font-weight="700">RESULT</text>',
            f'<text x="76" y="{footer_y + 54}" fill="#a9bbc4" font-size="14">Global RMSE {metrics["rmse"]:.4f}  ·  short coat {metrics["regionalRmse"]["short-coat"]:.4f}  ·  medium scapular {metrics["regionalRmse"]["medium-scapular"]:.4f}  ·  max {metrics["maxError"]:.4f}</text>',
            f'<text x="76" y="{footer_y + 80}" fill="#e2b869" font-size="14">The global inset is close on short coat and leaves the deeper scapular envelope outside the carrier.</text>',
            f'<text x="1040" y="{footer_y + 28}" fill="#f4f0e6" font-size="13" font-weight="700">COLOR</text>',
            f'<text x="1040" y="{footer_y + 54}" fill="#9bb0bb" font-size="12">cyan → yellow → red = low → high coat depth / recovery error</text>',
            f'<text x="1040" y="{footer_y + 80}" fill="#9bb0bb" font-size="12">gray ghost = authored truth; violet = recovered carrier</text>',
            f'<text x="54" y="{height - 18}" fill="#6f8793" font-size="11">Evaluation-only truth fixture. Observed normals equal authored carrier normals: oracle-strength direction input, not image-derived evidence.</text>',
            "</svg>",
        ]
    )
    return "".join(parts)


def _base_receipt(repo_root, assay_dir, output_dir, expected_report_sha256):
    return {
        "schema": SCHEMA,
        "executionId": str(uuid.uuid4()),
        "status": "running",
        "terminal": False,
        "startedAt": _now(),
        "finishedAt": None,
        "failurePhase": None,
        "reason": None,
        "visualArtifactValidated": False,
        "operatorVisualAdmission": "not-requested",
        "requestedConfig": {
            "route": ROUTE,
            "backend": BACKEND,
            "repoRoot": ".",
            "assayDir": assay._public_path_locator(assay_dir, repo_root),
            "outputDir": assay._public_path_locator(output_dir, repo_root),
            "expectedReportSha256": expected_report_sha256,
        },
        "effectiveConfig": None,
        "inputs": {},
        "artifact": None,
        "claimCeiling": (
            "Matched-view visualization of one authored truth fixture and one uniform-inset "
            "negative control; not hidden-carrier recovery, image-derived normals, anatomical "
            "truth, arbitrary-source behavior, grooming, deformation, or operator visual admission."
        ),
    }


def build_diagnostic(*, repo_root, assay_dir, output_dir, expected_report_sha256):
    repo_root = Path(repo_root).expanduser().resolve()
    assay_dir = Path(assay_dir).expanduser().resolve()
    output_dir = Path(output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / REPORT_NAME
    artifact_path = output_dir / ARTIFACT_NAME
    receipt = _base_receipt(repo_root, assay_dir, output_dir, expected_report_sha256)
    assay._write_json(report_path, receipt)
    phase = "input-validation"
    try:
        if artifact_path.exists():
            raise DiagnosticFailure(f"refusing to overwrite existing visual: {ARTIFACT_NAME}")
        source_report_path = assay_dir / "report.json"
        if not source_report_path.is_file():
            raise DiagnosticFailure("source assay report is missing")
        report_sha256 = _sha256(source_report_path)
        if report_sha256 != expected_report_sha256:
            raise DiagnosticFailure(
                f"report digest mismatch: expected {expected_report_sha256}, got {report_sha256}"
            )
        source_report = json.loads(source_report_path.read_text())
        if source_report.get("status") != "captured" or not source_report.get("terminal"):
            raise DiagnosticFailure("source assay report is not terminal captured evidence")
        source_locator = source_report["effectiveConfig"]["sourcePath"]
        source_path = (repo_root / source_locator).resolve()
        try:
            source_path.relative_to(repo_root)
        except ValueError as error:
            raise DiagnosticFailure("source locator escapes the explicit repo root") from error
        if _sha256(source_path) != source_report["source"]["sha256"]:
            raise DiagnosticFailure("authored source digest mismatch")
        observation_path = assay_dir / source_report["artifacts"]["observation"]["path"]
        recovered_path = assay_dir / source_report["artifacts"]["recoveredCarrier"]["path"]
        if _sha256(observation_path) != source_report["artifacts"]["observation"]["sha256"]:
            raise DiagnosticFailure("observation digest mismatch")
        if _sha256(recovered_path) != source_report["artifacts"]["recoveredCarrier"]["sha256"]:
            raise DiagnosticFailure("recovered carrier digest mismatch")

        phase = "truth-reconstruction"
        surface = load_glb_surface(source_path)
        carrier = _validate_points("authored carrier", surface["positions"])
        normals = _validate_points("authored normals", surface["normals"], len(carrier))
        with np.load(observation_path, allow_pickle=False) as archive:
            observed = _validate_points("observed positions", archive["observedPositions"], len(carrier))
            observed_normals = _validate_points(
                "observed normals", archive["observedNormals"], len(carrier)
            )
        with np.load(recovered_path, allow_pickle=False) as archive:
            recovered = _validate_points("recovered positions", archive["positions"], len(carrier))
        profile = source_report["effectiveConfig"]["profile"]
        coat_depth = coat_depths(carrier, profile)
        expected_observed = synthesize_observation(carrier, normals, coat_depth)
        if not np.array_equal(observed, expected_observed):
            raise DiagnosticFailure("observation does not exactly reconstruct from authored truth")
        if not np.array_equal(observed_normals, normals):
            raise DiagnosticFailure("observation normals do not match declared authored truth normals")
        short_depth = coat_depths(carrier, "short-v0")
        medium = coat_depth > short_depth + np.finfo(np.float64).eps * 32.0
        region_ids = np.where(medium, "medium-scapular", "short-coat")
        metrics = recovery_metrics(carrier, recovered, region_ids)
        if metrics != source_report["metrics"]:
            raise DiagnosticFailure("recomputed carrier metrics do not match the source report")
        errors = np.linalg.norm(recovered - carrier, axis=1)

        phase = "visual-render"
        svg = _svg_document(carrier, observed, recovered, coat_depth, errors, metrics)
        artifact_path.write_text(svg, encoding="utf-8")
        if artifact_path.stat().st_size <= 100_000:
            artifact_path.unlink(missing_ok=True)
            raise DiagnosticFailure("rendered visual is unexpectedly blank or partial")
        phase = "visual-validation"
        body = artifact_path.read_text(encoding="utf-8")
        if not body.endswith("</svg>") or body.count("<circle ") < len(carrier) * 12:
            artifact_path.unlink(missing_ok=True)
            raise DiagnosticFailure("rendered SVG failed completeness validation")

        git_identity = _git_identity(repo_root)
        receipt["status"] = "captured"
        receipt["visualArtifactValidated"] = True
        receipt["effectiveConfig"] = {
            "route": ROUTE,
            "backend": BACKEND,
            "repoRoot": ".",
            "assayDir": assay._public_path_locator(assay_dir, repo_root),
            "outputDir": assay._public_path_locator(output_dir, repo_root),
            "sourcePath": source_locator,
            "profile": profile,
            "recoveryArm": source_report["effectiveConfig"]["recoveryArm"],
            "uniformInset": source_report["effectiveConfig"]["uniformInset"],
            **git_identity,
        }
        receipt["inputs"] = {
            "reportSha256": report_sha256,
            "sourceSha256": source_report["source"]["sha256"],
            "observationSha256": source_report["artifacts"]["observation"]["sha256"],
            "recoveredCarrierSha256": source_report["artifacts"]["recoveredCarrier"]["sha256"],
            "vertexCount": len(carrier),
            "directionalEvidence": "authored-carrier-normals-oracle-strength",
        }
        receipt["artifact"] = {
            "path": ARTIFACT_NAME,
            "sha256": _sha256(artifact_path),
            "byteLength": artifact_path.stat().st_size,
            "width": 1800,
            "height": 1180,
            "format": "image/svg+xml",
        }
        readme = f"""# Authored-Cat Hidden-Carrier Diagnostic\n\nQuestion: where does one global `0.94` inset fail when the authored synthetic coat depth varies spatially?\n\nResult: the recovered carrier remains close in the short-coat region and leaves a large residual across the deeper medium-scapular region. The matched visual makes the same failure visible from lateral, anterior, and dorsal views.\n\nRoute:\n- repo/worktree: `kaminos` / isolated Scrooge worktree\n- branch/head: `{git_identity['branch']}` / `{git_identity['commit']}`\n- command: `python3 artifacts/authored-cat-hidden-carrier-v0/render_hidden_carrier_diagnostic.py --repo-root . --assay-dir {assay._public_path_locator(assay_dir, repo_root)} --output-dir {assay._public_path_locator(output_dir, repo_root)} --expected-report-sha256 {expected_report_sha256}`\n- model/checkpoint: none\n- backend/device: `{BACKEND}` on CPU\n- input: terminal assay report `{report_sha256}`, authored source `{source_report['source']['sha256']}`, `3764` corresponding vertices\n- resolution: `1800 x 1180` SVG\n\nImages:\n- `{ARTIFACT_NAME}`: authored hidden carrier, synthetic observed coat, uniform-inset recovery, and carrier-error heat map under three matched projections.\n\nSafety characterization: deterministic isolated-background cat-envelope point projections; no generated biological corruption, infestation, repeated-orifice, misplaced-growth, or hostile imagery. Agent visual inspection and operator presentation admission remain separate from this renderer receipt.\n\nDoes not prove: image-derived coat depth or normals, volumetric recovery, arbitrary-source or anatomical truth, production grooming, deformation, consumer integration, or operator visual admission.\n"""
        (output_dir / "README.md").write_text(readme, encoding="utf-8")
    except Exception as error:
        artifact_path.unlink(missing_ok=True)
        receipt["status"] = "failed"
        receipt["failurePhase"] = phase
        receipt["reason"] = str(error)
        receipt["visualArtifactValidated"] = False
    receipt["terminal"] = True
    receipt["finishedAt"] = _now()
    assay._write_json(report_path, receipt)
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--assay-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--expected-report-sha256", required=True)
    args = parser.parse_args(argv)
    receipt = build_diagnostic(
        repo_root=args.repo_root,
        assay_dir=args.assay_dir,
        output_dir=args.output_dir,
        expected_report_sha256=args.expected_report_sha256,
    )
    print(json.dumps(receipt, indent=2, sort_keys=True))
    return 0 if receipt["status"] == "captured" else 2


if __name__ == "__main__":
    raise SystemExit(main())
