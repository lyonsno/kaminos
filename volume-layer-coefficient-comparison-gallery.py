#!/usr/bin/env python3
"""Build a truthful full-resolution exact/baseline/flow coefficient gallery."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image


SCHEMA = "kaminos.volume.layer-coefficient-comparison-gallery.v0"
EXACT_AUTHORITY = "exact-local-layer-emission-extinction-v0"
LEARNED_AUTHORITY = "learned-post-admission-coefficient-prediction-v0"
ADMISSION_AUTHORITY = "external-native-cell-index-list-v0"
ORDER_APPROXIMATION = "camera-depth-96-bin-one-running-transmittance-v0"
DELTA_AUTHORITY = "flow-vs-baseline-absolute-delta-8x"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exact-report", type=Path)
    parser.add_argument("--baseline-report", type=Path)
    parser.add_argument("--flow-report", type=Path)
    parser.add_argument("--out-dir", type=Path)
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def load_report(path: Path) -> dict:
    report = json.loads(path.read_text())
    if report.get("status") != "complete":
        raise ValueError(f"report is not complete: {path}")
    return report


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def camera_metrics(report: dict) -> dict[int, dict]:
    cameras = report.get("metrics", {}).get("cameras")
    if not isinstance(cameras, list) or not cameras:
        raise ValueError("report has no camera metrics")
    return {int(camera["cameraIndex"]): camera for camera in cameras}


def validate_reports(exact: dict, baseline: dict, flow: dict) -> list[int]:
    reports = {"exact": exact, "baseline": baseline, "flow": flow}
    expected_authorities = {
        "exact": EXACT_AUTHORITY,
        "baseline": LEARNED_AUTHORITY,
        "flow": LEARNED_AUTHORITY,
    }
    frozen_bindings = []
    camera_sets = []
    for label, report in reports.items():
        effective = report.get("effective", {})
        if effective.get("coefficientSourceAuthority") != expected_authorities[label]:
            raise ValueError(f"{label} coefficientSourceAuthority is not trustworthy")
        if effective.get("candidateAdmissionAuthority") != ADMISSION_AUTHORITY:
            raise ValueError(f"{label} did not use exact external admission")
        if effective.get("orderApproximation") != ORDER_APPROXIMATION:
            raise ValueError(f"{label} order approximation changed")
        if effective.get("sampleCap") is not None or effective.get("droppedRowCount") != 0:
            raise ValueError(f"{label} silently capped or dropped rows")
        binding = report.get("frozenStateBinding", {})
        if binding.get("hashMatch") is not True:
            raise ValueError(f"{label} frozen-state hashMatch is not true")
        frozen_bindings.append((binding.get("sameStateCaptureId"), binding.get("fluidSha256"), binding.get("frontSha256")))
        camera_sets.append(set(camera_metrics(report)))
    if len(set(frozen_bindings)) != 1:
        raise ValueError("exact, baseline, and flow reports do not share one frozen state")
    if len({tuple(sorted(indices)) for indices in camera_sets}) != 1:
        raise ValueError("exact, baseline, and flow reports do not share camera coverage")
    return sorted(camera_sets[0])


def read_rgb(path: Path) -> np.ndarray:
    if not path.exists():
        raise FileNotFoundError(path)
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.uint8)


def write_rgb(path: Path, pixels: np.ndarray) -> None:
    Image.fromarray(pixels.astype(np.uint8), mode="RGB").save(path)


def camera_source_paths(camera_index: int, report_paths: dict[str, Path]) -> dict[str, Path]:
    prefix = f"camera-{camera_index:02d}"
    return {
        "target": report_paths["exact"].parent / f"{prefix}-shared-transport-target.png",
        "exact": report_paths["exact"].parent / f"{prefix}-expanded-shared-transport.png",
        "baseline": report_paths["baseline"].parent / f"{prefix}-expanded-shared-transport.png",
        "flow": report_paths["flow"].parent / f"{prefix}-expanded-shared-transport.png",
    }


def gallery_html(manifest: dict) -> str:
    payload = json.dumps(manifest, separators=(",", ":"))
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>State-120 coefficient comparison</title>
<style>
:root {{ color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: #07090d; color: #e8edf5; }}
header {{ position: sticky; top: 0; z-index: 5; padding: 12px 16px; background: rgba(7,9,13,.94); border-bottom: 1px solid #273040; backdrop-filter: blur(10px); }}
.row {{ display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }}
button, select, input {{ font: inherit; }}
button {{ color: #dce8ff; background: #182131; border: 1px solid #33445f; border-radius: 5px; padding: 6px 10px; cursor: pointer; }}
button.active {{ background: #285b99; border-color: #68a8f2; }}
.authority {{ margin-top: 8px; color: #9fb0c9; font-size: 12px; line-height: 1.45; }}
.metrics {{ color: #ffd37a; }}
main {{ padding: 16px; }}
.stage {{ position: relative; width: min(100%, 1348px); margin: 0 auto; background: #000; overflow: auto; border: 1px solid #273040; }}
.stage img {{ display: block; width: 100%; height: auto; image-rendering: auto; }}
.overlay {{ position: absolute; inset: 0; overflow: hidden; pointer-events: none; }}
.overlay img {{ width: min(100vw - 34px, 1348px); max-width: none; }}
.divider {{ position: absolute; top: 0; bottom: 0; width: 2px; background: #fff; box-shadow: 0 0 8px #000; pointer-events: none; }}
.legend {{ width: min(100%, 1348px); margin: 10px auto 0; color: #aebbd0; line-height: 1.5; }}
kbd {{ background: #202a3a; border: 1px solid #41516b; border-radius: 3px; padding: 1px 5px; }}
</style>
</head>
<body>
<header>
  <div class="row">
    <button id="prev">← camera</button>
    <select id="camera"></select>
    <button id="next">camera →</button>
    <button data-mode="target">1 target</button>
    <button data-mode="exact">2 exact</button>
    <button data-mode="baseline">3 baseline</button>
    <button data-mode="flow">4 flow</button>
    <button data-mode="delta">5 flow−baseline Δ×8</button>
    <label>split <input id="split" type="range" min="0" max="100" value="50"></label>
  </div>
  <div class="authority" id="authority"></div>
</header>
<main>
  <div class="stage">
    <img id="base" alt="comparison base">
    <div class="overlay" id="overlay"><img id="top" alt="comparison overlay"></div>
    <div class="divider" id="divider"></div>
  </div>
  <div class="legend" id="legend"></div>
</main>
<script>
const manifest = {payload};
let cameraPosition = Math.min(10, manifest.cameras.length - 1);
let mode = 'flow';
const cameraSelect = document.querySelector('#camera');
const split = document.querySelector('#split');
for (const [position, camera] of manifest.cameras.entries()) {{
  const option = document.createElement('option');
  option.value = position;
  option.textContent = `camera ${{String(camera.cameraIndex).padStart(2,'0')}} · ${{camera.split}} · ${{camera.cameraAngle.toFixed(3)}} rad`;
  cameraSelect.append(option);
}}
function render() {{
  const camera = manifest.cameras[cameraPosition];
  const source = mode === 'delta' ? camera.images.delta : camera.images[mode];
  document.querySelector('#base').src = camera.images.target;
  document.querySelector('#top').src = source;
  document.querySelector('#overlay').style.width = `${{split.value}}%`;
  document.querySelector('#divider').style.left = `${{split.value}}%`;
  cameraSelect.value = cameraPosition;
  document.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
  document.querySelector('#authority').innerHTML = `<span class="metrics">exact MAE ${{camera.mae.exact.toFixed(6)}} · baseline ${{camera.mae.baseline.toFixed(6)}} · flow ${{camera.mae.flow.toFixed(6)}} · flow improvement ${{camera.flowRelativeImprovementPercent.toFixed(3)}}%</span><br>left: selected ${{mode === 'delta' ? manifest.authority.delta : manifest.authority[mode]}} · right: raymarch shared-transmittance target`;
  document.querySelector('#legend').innerHTML = `<b>${{manifest.schema}}</b><br>Frozen ${{manifest.frozenState.sameStateCaptureId}} · admission ${{manifest.authority.admission}} · ordering ${{manifest.authority.orderApproximation}} · no sample cap · zero dropped rows.<br><kbd>←</kbd>/<kbd>→</kbd> camera · <kbd>1</kbd> target · <kbd>2</kbd> exact · <kbd>3</kbd> baseline · <kbd>4</kbd> flow · <kbd>5</kbd> amplified causal delta. The Δ×8 view is diagnostic, not beauty output.`;
}}
document.querySelector('#prev').onclick = () => {{ cameraPosition = (cameraPosition - 1 + manifest.cameras.length) % manifest.cameras.length; render(); }};
document.querySelector('#next').onclick = () => {{ cameraPosition = (cameraPosition + 1) % manifest.cameras.length; render(); }};
cameraSelect.onchange = () => {{ cameraPosition = Number(cameraSelect.value); render(); }};
split.oninput = render;
document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => {{ mode = button.dataset.mode; render(); }});
addEventListener('keydown', event => {{
  if (event.key === 'ArrowLeft') document.querySelector('#prev').click();
  if (event.key === 'ArrowRight') document.querySelector('#next').click();
  const keyModes = {{'1':'target','2':'exact','3':'baseline','4':'flow','5':'delta'}};
  if (keyModes[event.key]) {{ mode = keyModes[event.key]; render(); }}
}});
render();
</script>
</body>
</html>
"""


def build_gallery(report_paths: dict[str, Path], out_dir: Path) -> dict:
    reports = {label: load_report(path) for label, path in report_paths.items()}
    camera_indices = validate_reports(reports["exact"], reports["baseline"], reports["flow"])
    out_dir.mkdir(parents=True, exist_ok=True)
    image_dir = out_dir / "images"
    image_dir.mkdir(exist_ok=True)
    metrics = {label: camera_metrics(report) for label, report in reports.items()}
    cameras = []
    for camera_index in camera_indices:
        sources = camera_source_paths(camera_index, report_paths)
        arrays = {label: read_rgb(path) for label, path in sources.items()}
        shapes = {pixels.shape for pixels in arrays.values()}
        if len(shapes) != 1:
            raise ValueError(f"camera {camera_index} image dimensions differ")
        images = {}
        for label, source in sources.items():
            destination = image_dir / f"camera-{camera_index:02d}-{label}.png"
            shutil.copy2(source, destination)
            images[label] = destination.relative_to(out_dir).as_posix()
        delta = np.clip(np.abs(arrays["flow"].astype(np.int16) - arrays["baseline"].astype(np.int16)) * 8, 0, 255)
        delta_path = image_dir / f"camera-{camera_index:02d}-flow-vs-baseline-delta-8x.png"
        write_rgb(delta_path, delta)
        images["delta"] = delta_path.relative_to(out_dir).as_posix()
        exact_mae = float(metrics["exact"][camera_index]["expanded"]["mae"])
        baseline_mae = float(metrics["baseline"][camera_index]["expanded"]["mae"])
        flow_mae = float(metrics["flow"][camera_index]["expanded"]["mae"])
        cameras.append({
            "cameraIndex": camera_index,
            "cameraAngle": float(metrics["exact"][camera_index]["cameraAngle"]),
            "split": metrics["exact"][camera_index]["split"],
            "images": images,
            "mae": {"exact": exact_mae, "baseline": baseline_mae, "flow": flow_mae},
            "flowRelativeImprovementPercent": 100.0 * (baseline_mae - flow_mae) / baseline_mae,
        })
    exact_binding = reports["exact"]["frozenStateBinding"]
    held = {label: report["metrics"]["heldOutMean"]["expandedMae"] for label, report in reports.items()}
    manifest = {
        "schema": SCHEMA,
        "status": "complete",
        "frozenState": exact_binding,
        "authority": {
            "target": "same-frozen-state-shared-transmittance-raymarch-target-v0",
            "exact": EXACT_AUTHORITY,
            "baseline": "baseline-8192-parameter-learned-post-admission-coefficient-prediction-v0",
            "flow": "flow-only-8192-parameter-learned-post-admission-coefficient-prediction-v0",
            "delta": DELTA_AUTHORITY,
            "admission": ADMISSION_AUTHORITY,
            "orderApproximation": ORDER_APPROXIMATION,
        },
        "reports": {
            label: {"path": str(path), "sha256": sha256_file(path)}
            for label, path in report_paths.items()
        },
        "heldOutMeanMae": held,
        "flowVsBaselineRelativeImprovementPercent": 100.0 * (held["baseline"] - held["flow"]) / held["baseline"],
        "exactVsCurrentBrowserRelativeImprovementPercent": 100.0 * (
            reports["exact"]["metrics"]["heldOutMean"]["currentMae"] - held["exact"]
        ) / reports["exact"]["metrics"]["heldOutMean"]["currentMae"],
        "cameras": cameras,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (out_dir / "index.html").write_text(gallery_html(manifest))
    return manifest


def fixture_report(authority: str, camera_count: int) -> dict:
    return {
        "status": "complete",
        "effective": {
            "coefficientSourceAuthority": authority,
            "candidateAdmissionAuthority": ADMISSION_AUTHORITY,
            "orderApproximation": ORDER_APPROXIMATION,
            "sampleCap": None,
            "droppedRowCount": 0,
        },
        "frozenStateBinding": {
            "sameStateCaptureId": "self-test-state",
            "fluidSha256": "a" * 64,
            "frontSha256": "b" * 64,
            "hashMatch": True,
        },
        "metrics": {
            "cameras": [
                {
                    "cameraIndex": index,
                    "cameraAngle": index * 0.1,
                    "split": "heldOut",
                    "expanded": {"mae": 0.1 + index * 0.01},
                }
                for index in range(camera_count)
            ],
            "heldOutMean": {"expandedMae": 0.1, "currentMae": 0.2},
        },
    }


def self_test() -> None:
    with tempfile.TemporaryDirectory(prefix="kaminos-coefficient-gallery-") as temp:
        root = Path(temp)
        report_paths = {}
        for label, authority in (("exact", EXACT_AUTHORITY), ("baseline", LEARNED_AUTHORITY), ("flow", LEARNED_AUTHORITY)):
            directory = root / label
            directory.mkdir()
            report_path = directory / "report.json"
            report_path.write_text(json.dumps(fixture_report(authority, 2)))
            report_paths[label] = report_path
            for camera_index in range(2):
                expanded = np.full((8, 12, 3), 30 + camera_index * 10 + len(label), dtype=np.uint8)
                write_rgb(directory / f"camera-{camera_index:02d}-expanded-shared-transport.png", expanded)
                if label == "exact":
                    write_rgb(directory / f"camera-{camera_index:02d}-shared-transport-target.png", expanded + 3)
        manifest = build_gallery(report_paths, root / "gallery")
        if manifest["status"] != "complete" or len(manifest["cameras"]) != 2:
            raise AssertionError("self-test gallery is incomplete")
        if not (root / "gallery" / "images" / "camera-01-flow-vs-baseline-delta-8x.png").exists():
            raise AssertionError("self-test delta image is missing")
    print("coefficient comparison gallery self-test passed")


def main() -> None:
    args = parse_args()
    if args.self_test:
        self_test()
        return
    required = (args.exact_report, args.baseline_report, args.flow_report, args.out_dir)
    if any(value is None for value in required):
        raise SystemExit("--exact-report, --baseline-report, --flow-report, and --out-dir are required")
    manifest = build_gallery(
        {"exact": args.exact_report, "baseline": args.baseline_report, "flow": args.flow_report},
        args.out_dir,
    )
    print(json.dumps({"status": manifest["status"], "outDir": str(args.out_dir), "cameras": len(manifest["cameras"])}, indent=2))


if __name__ == "__main__":
    main()
