#!/usr/bin/env python3
"""Measure and visualize where a learned render differs from its causal control."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.render-visible-delta-concentration.v0"
ROUTE = "ffmpeg-rgb24-srgb-visible-delta-v0"
CONTROL_ROLE = "deterministicMaterializedControl"
TREATMENT_ROLE = "nativeLowSelectivePredicted"

GLYPHS = {
    " ": ("00000",) * 7,
    "%": ("11001", "11010", "00100", "01000", "10110", "00110", "00000"),
    "0": ("01110", "10001", "10011", "10101", "11001", "10001", "01110"),
    "1": ("00100", "01100", "00100", "00100", "00100", "00100", "01110"),
    "2": ("01110", "10001", "00001", "00010", "00100", "01000", "11111"),
    "5": ("11111", "10000", "11110", "00001", "00001", "10001", "01110"),
    "A": ("01110", "10001", "10001", "11111", "10001", "10001", "10001"),
    "C": ("01110", "10001", "10000", "10000", "10000", "10001", "01110"),
    "D": ("11110", "10001", "10001", "10001", "10001", "10001", "11110"),
    "E": ("11111", "10000", "10000", "11110", "10000", "10000", "11111"),
    "G": ("01110", "10001", "10000", "10111", "10001", "10001", "01110"),
    "L": ("10000", "10000", "10000", "10000", "10000", "10000", "11111"),
    "N": ("10001", "11001", "10101", "10011", "10001", "10001", "10001"),
    "O": ("01110", "10001", "10001", "10001", "10001", "10001", "01110"),
    "P": ("11110", "10001", "10001", "11110", "10000", "10000", "10000"),
    "R": ("11110", "10001", "10001", "11110", "10100", "10010", "10001"),
    "T": ("11111", "00100", "00100", "00100", "00100", "00100", "00100"),
    "Y": ("10001", "10001", "01010", "00100", "00100", "00100", "00100"),
}


class AnalysisFailure(Exception):
    def __init__(self, phase: str, message: str) -> None:
        super().__init__(message)
        self.phase = phase


def require(condition: bool, phase: str, message: str) -> None:
    if not condition:
        raise AnalysisFailure(phase, message)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_path(value: str, manifest_path: Path) -> Path:
    path = Path(value).expanduser()
    return (path if path.is_absolute() else manifest_path.parent / path).resolve()


def atomic_json(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def parse_csv_floats(value: str) -> list[float]:
    try:
        parsed = [float(item.strip()) for item in value.split(",") if item.strip()]
    except ValueError as error:
        raise AnalysisFailure("argument-validation", f"invalid fraction: {error}") from error
    require(bool(parsed), "argument-validation", "at least one fraction is required")
    require(all(np.isfinite(item) and 0.0 < item <= 1.0 for item in parsed), "argument-validation", "fractions must be finite in (0, 1]")
    require(parsed == sorted(set(parsed)), "argument-validation", "fractions must be unique and ascending")
    return parsed


def parse_csv_ints(value: str) -> list[int]:
    try:
        parsed = [int(item.strip()) for item in value.split(",") if item.strip()]
    except ValueError as error:
        raise AnalysisFailure("argument-validation", f"invalid representative frame index: {error}") from error
    require(bool(parsed), "argument-validation", "at least one representative frame index is required")
    require(len(parsed) == len(set(parsed)) and all(item >= 0 for item in parsed), "argument-validation", "representative frame indexes must be unique and nonnegative")
    return parsed


def image_dimensions(path: Path) -> tuple[int, int]:
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=width,height", "-of", "json", str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        stream = json.loads(result.stdout)["streams"][0]
        width, height = int(stream["width"]), int(stream["height"])
    except Exception as error:
        raise AnalysisFailure("image-decode", f"ffprobe failed for {path}: {error}") from error
    require(width > 0 and height > 0, "image-decode", f"invalid image dimensions for {path}")
    return width, height


def decode_rgb(path: Path, width: int, height: int) -> np.ndarray:
    try:
        result = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", str(path), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
            check=True,
            capture_output=True,
        )
    except Exception as error:
        raise AnalysisFailure("image-decode", f"ffmpeg failed for {path}: {error}") from error
    expected = width * height * 3
    require(len(result.stdout) == expected, "image-decode", f"decoded byte length mismatch for {path}")
    return np.frombuffer(result.stdout, dtype=np.uint8).reshape(height, width, 3)


def downsample_for_contact(image: np.ndarray, maximum_width: int = 360) -> np.ndarray:
    step = max(1, int(np.ceil(image.shape[1] / maximum_width)))
    return image[::step, ::step].copy()


def labeled_contact(rows: list[np.ndarray], labels: list[str], panel_width: int, spacer_width: int = 2) -> np.ndarray:
    require(bool(rows) and all(row.shape == rows[0].shape for row in rows), "artifact-write", "contact rows must have one stable shape")
    expected_width = panel_width * len(labels) + spacer_width * (len(labels) - 1)
    require(rows[0].shape[1] == expected_width, "artifact-write", "contact label geometry does not match panel geometry")
    scale = 2
    glyph_width = 5 * scale
    glyph_gap = scale
    band = np.full((24, expected_width, 3), 18, dtype=np.uint8)
    cursor = 0
    for label in labels:
        label = label.upper()
        require(all(character in GLYPHS for character in label), "artifact-write", f"unsupported contact-label character in {label!r}")
        text_width = len(label) * glyph_width + max(0, len(label) - 1) * glyph_gap
        x0 = cursor + max(0, (panel_width - text_width) // 2)
        y0 = 5
        for character_index, character in enumerate(label):
            glyph = GLYPHS[character]
            gx = x0 + character_index * (glyph_width + glyph_gap)
            for y, bits in enumerate(glyph):
                for x, bit in enumerate(bits):
                    if bit == "1":
                        band[y0 + y * scale:y0 + (y + 1) * scale, gx + x * scale:gx + (x + 1) * scale] = 232
        cursor += panel_width + spacer_width
    return np.concatenate([band, *rows], axis=0)


def write_png(path: Path, image: np.ndarray) -> None:
    ppm_path = path.with_suffix(".ppm")
    with ppm_path.open("wb") as handle:
        handle.write(f"P6\n{image.shape[1]} {image.shape[0]}\n255\n".encode("ascii"))
        handle.write(np.ascontiguousarray(image, dtype=np.uint8).tobytes())
    try:
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(ppm_path), str(path)], check=True)
    except Exception as error:
        raise AnalysisFailure("artifact-write", f"contact PNG encode failed: {error}") from error
    finally:
        ppm_path.unlink(missing_ok=True)


def verify_image(role: dict[str, Any], frame_manifest_path: Path, label: str) -> tuple[Path, dict[str, Any]]:
    phase = "input-validation"
    descriptor = role.get("image") or {}
    path_value = descriptor.get("path")
    require(isinstance(path_value, str) and path_value, phase, f"{label} image path missing")
    path = resolve_path(path_value, frame_manifest_path)
    require(path.is_file(), phase, f"{label} image missing: {path}")
    byte_length = path.stat().st_size
    actual_sha256 = sha256_file(path)
    require(byte_length == int(descriptor.get("byteLength") or -1), phase, f"{label} image byte length mismatch")
    require(actual_sha256 == descriptor.get("sha256"), phase, f"{label} image SHA-256 mismatch")
    return path, {"path": str(path), "byteLength": byte_length, "sha256": actual_sha256}


def artifact(path: Path) -> dict[str, Any]:
    return {"path": str(path), "byteLength": path.stat().st_size, "sha256": sha256_file(path)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--producer-manifest", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--fractions", default="0.05,0.10,0.20")
    parser.add_argument("--representative-frame-indexes", default="0")
    args = parser.parse_args()

    producer_path = Path(args.producer_manifest).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.json"
    energy_contact_path = out_dir / "delta-energy-contact.png"
    oracle_contact_path = out_dir / "oracle-retention-contact.png"
    for stale in (energy_contact_path, oracle_contact_path):
        stale.unlink(missing_ok=True)
    evidence: dict[str, Any] = {}
    phase = "argument-validation"

    try:
        fractions = parse_csv_floats(args.fractions)
        representative_indexes = parse_csv_ints(args.representative_frame_indexes)

        phase = "input-validation"
        producer_bytes = producer_path.read_bytes()
        producer_sha256 = sha256_bytes(producer_bytes)
        evidence.update({"producerManifestPath": str(producer_path), "producerManifestSha256": producer_sha256})
        producer = json.loads(producer_bytes)
        require(producer.get("status") == "captured" and producer.get("failurePhase") is None, phase, "producer is not captured")
        require(producer.get("runtimeTruthAvailable") is False, phase, "producer must deny runtime truth")
        require(producer.get("renderCompositionRequested") == "raymarch-only-v0", phase, "producer did not request raymarch-only composition")
        frame_manifest_values = producer.get("frameManifests")
        require(isinstance(frame_manifest_values, list) and frame_manifest_values, phase, "producer frame manifests missing")
        require(len(frame_manifest_values) == int(producer.get("frameCount") or -1), phase, "producer frame count is partial")
        require(all(index < len(frame_manifest_values) for index in representative_indexes), phase, "representative frame index is outside producer sequence")

        decoded_frames: list[dict[str, Any]] = []
        metrics: list[dict[str, Any]] = []
        energy_rows: list[np.ndarray] = []
        oracle_rows: dict[int, np.ndarray] = {}
        for sequence_index, frame_manifest_value in enumerate(frame_manifest_values):
            frame_manifest_path = resolve_path(str(frame_manifest_value), producer_path)
            frame_bytes = frame_manifest_path.read_bytes()
            frame_sha256 = sha256_bytes(frame_bytes)
            frame = json.loads(frame_bytes)
            require(frame.get("status") == "captured" and frame.get("failurePhase") is None, phase, f"frame {sequence_index} is not captured")
            roles = frame.get("roles") or {}
            control = roles.get(CONTROL_ROLE) or {}
            treatment = roles.get(TREATMENT_ROLE) or {}
            for label, role in ((CONTROL_ROLE, control), (TREATMENT_ROLE, treatment)):
                require(role.get("requestedComposition") == "raymarch-only-v0", phase, f"{label} requested composition mismatch")
                require(role.get("effectiveComposition") == "raymarch-only-v0", phase, f"{label} effective composition mismatch")
                require(role.get("raymarchApplied") is True and role.get("splatApplied") is False, phase, f"{label} renderer attribution mismatch")
            require(control.get("backend") == treatment.get("backend") and isinstance(control.get("backend"), str), phase, "role backend mismatch")
            require(control.get("grid") == treatment.get("grid"), phase, "role output grid mismatch")
            same_state = control.get("sameNativeStateIdentity")
            require(isinstance(same_state, str) and same_state == treatment.get("sameNativeStateIdentity"), phase, "role native-state identity mismatch")
            control_path, control_receipt = verify_image(control, frame_manifest_path, CONTROL_ROLE)
            treatment_path, treatment_receipt = verify_image(treatment, frame_manifest_path, TREATMENT_ROLE)
            control_dimensions = image_dimensions(control_path)
            treatment_dimensions = image_dimensions(treatment_path)
            require(control_dimensions == treatment_dimensions, "image-decode", "role image dimensions mismatch")
            width, height = control_dimensions
            control_rgb = decode_rgb(control_path, width, height)
            treatment_rgb = decode_rgb(treatment_path, width, height)
            control_float = control_rgb.astype(np.float32) / np.float32(255.0)
            treatment_float = treatment_rgb.astype(np.float32) / np.float32(255.0)
            delta = treatment_float - control_float
            energy = np.sum(delta * delta, axis=2)
            flat = np.sort(energy.reshape(-1))[::-1]
            cumulative = np.cumsum(flat, dtype=np.float64)
            total_energy = float(cumulative[-1]) if cumulative.size else 0.0
            retention: dict[str, float] = {}
            for fraction in fractions:
                count = max(1, int(np.ceil(flat.size * fraction)))
                retention[f"{fraction:.2f}"] = float(cumulative[count - 1] / total_energy) if total_energy > 0.0 else 0.0
            delta_norm = np.sqrt(energy)
            luma = control_float @ np.asarray([0.2126, 0.7152, 0.0722], dtype=np.float32)
            inside = {}
            for threshold in (0.01, 0.03, 0.05):
                value = float(np.sum(energy[luma > threshold], dtype=np.float64) / total_energy) if total_energy > 0.0 else 0.0
                inside[f"gt{threshold:.2f}"] = min(1.0, max(0.0, value))
            metrics.append({
                "frameIndex": int(frame.get("frameIndex")),
                "simulationStep": int(frame.get("simulationStep")),
                "sameNativeStateIdentity": same_state,
                "frameManifestPath": str(frame_manifest_path),
                "frameManifestSha256": frame_sha256,
                "effectiveComposition": "raymarch-only-v0",
                "backend": control["backend"],
                "width": width,
                "height": height,
                "visibleDeltaEnergy": total_energy,
                "visibleEffectPresent": total_energy > 0.0,
                "topPixelFractionEnergyRetention": retention,
                "pixelsAboveRgbNorm": {
                    "1of255": float(np.mean(delta_norm > 1.0 / 255.0)),
                    "2of255": float(np.mean(delta_norm > 2.0 / 255.0)),
                    "5of255": float(np.mean(delta_norm > 5.0 / 255.0)),
                    "10of255": float(np.mean(delta_norm > 10.0 / 255.0)),
                },
                "deltaEnergyInsideDeterministicLuma": inside,
                "images": {CONTROL_ROLE: control_receipt, TREATMENT_ROLE: treatment_receipt},
            })

            heat = np.sqrt(energy)
            heat_scale = float(np.quantile(heat, 0.995)) if heat.size else 0.0
            heat = np.clip(heat / (heat_scale if heat_scale > 0.0 else 1.0), 0.0, 1.0)
            heat_rgb = np.uint8(np.round(np.stack([
                np.clip(heat * 2.0, 0.0, 1.0),
                np.clip((heat - 0.25) * 1.6, 0.0, 1.0),
                np.clip((heat - 0.65) * 2.5, 0.0, 1.0),
            ], axis=2) * 255.0))
            panels = [downsample_for_contact(item) for item in (control_rgb, treatment_rgb, heat_rgb)]
            spacer = np.full((panels[0].shape[0], 2, 3), 24, dtype=np.uint8)
            energy_rows.append(np.concatenate([panels[0], spacer, panels[1], spacer, panels[2]], axis=1))

            if sequence_index in representative_indexes:
                oracle_panels = [control_rgb, treatment_rgb]
                order = np.argsort(energy.reshape(-1))[::-1]
                for fraction in fractions:
                    mask = np.zeros(energy.size, dtype=bool)
                    mask[order[: int(np.ceil(energy.size * fraction))]] = True
                    mask = mask.reshape(height, width)
                    candidate = control_rgb.astype(np.float32)
                    candidate[mask] += (treatment_rgb.astype(np.float32) - control_rgb.astype(np.float32))[mask]
                    oracle_panels.append(np.uint8(np.clip(np.round(candidate), 0.0, 255.0)))
                oracle_panels = [downsample_for_contact(item) for item in oracle_panels]
                oracle_spacer = np.full((oracle_panels[0].shape[0], 2, 3), 24, dtype=np.uint8)
                oracle_row = oracle_panels[0]
                for panel in oracle_panels[1:]:
                    oracle_row = np.concatenate([oracle_row, oracle_spacer, panel], axis=1)
                oracle_rows[sequence_index] = oracle_row
            decoded_frames.append({"control": control_rgb, "treatment": treatment_rgb})

        phase = "artifact-write"
        energy_labels = ["CONTROL", "LEARNED", "DELTA ENERGY"]
        oracle_labels = ["CONTROL", "LEARNED", *[f"TOP {fraction * 100:.0f}%" for fraction in fractions]]
        energy_contact = labeled_contact(energy_rows, energy_labels, panels[0].shape[1])
        oracle_contact = labeled_contact(
            [oracle_rows[index] for index in representative_indexes],
            oracle_labels,
            oracle_panels[0].shape[1],
        )
        write_png(energy_contact_path, energy_contact)
        write_png(oracle_contact_path, oracle_contact)

        keys = [f"{fraction:.2f}" for fraction in fractions]
        report = {
            "schema": SCHEMA,
            "identity": "causal-control-to-learned-visible-delta-concentration-v0",
            "status": "captured",
            "failurePhase": None,
            "route": {"requested": ROUTE, "effective": ROUTE, "backend": "cpu-ffmpeg-rawvideo"},
            "runtimeTruthAvailable": False,
            "source": {
                "producerManifestPath": str(producer_path),
                "producerManifestSha256": producer_sha256,
                "producerIdentity": producer.get("identity"),
                "model": producer.get("model"),
                "roles": [CONTROL_ROLE, TREATMENT_ROLE],
            },
            "frameCountRequested": int(producer["frameCount"]),
            "frameCountProcessed": len(metrics),
            "hiddenFrameCap": False,
            "fractions": fractions,
            "representativeFrameIndexes": representative_indexes,
            "frames": metrics,
            "summary": {
                "meanTopPixelFractionEnergyRetention": {
                    key: float(np.mean([frame["topPixelFractionEnergyRetention"][key] for frame in metrics])) for key in keys
                },
                "rangeTopPixelFractionEnergyRetention": {
                    key: [
                        float(np.min([frame["topPixelFractionEnergyRetention"][key] for frame in metrics])),
                        float(np.max([frame["topPixelFractionEnergyRetention"][key] for frame in metrics])),
                    ] for key in keys
                },
                "meanPixelsAboveRgbNorm": {
                    key: float(np.mean([frame["pixelsAboveRgbNorm"][key] for frame in metrics]))
                    for key in metrics[0]["pixelsAboveRgbNorm"]
                },
            },
            "oracle": {
                "authority": "post-render-learned-delta-top-energy-mask-diagnostic-only-v0",
                "runtimeApplicable": False,
                "usesLearnedTreatmentOutput": True,
                "usesTruth": False,
                "columnOrder": [CONTROL_ROLE, TREATMENT_ROLE, *[f"top{fraction:.2f}VisibleDelta" for fraction in fractions]],
            },
            "contacts": {
                "deltaEnergy": {
                    "labelsEmbedded": True,
                    "columnOrder": [CONTROL_ROLE, TREATMENT_ROLE, "visibleDeltaEnergy"],
                },
                "oracleRetention": {
                    "labelsEmbedded": True,
                    "columnOrder": [CONTROL_ROLE, TREATMENT_ROLE, *[f"top{fraction:.2f}VisibleDelta" for fraction in fractions]],
                },
            },
            "artifacts": {
                "deltaEnergyContact": artifact(energy_contact_path),
                "oracleRetentionContact": artifact(oracle_contact_path),
            },
        }
        atomic_json(manifest_path, report)
        print(json.dumps({"ok": True, "manifest": str(manifest_path), "artifacts": report["artifacts"]}, indent=2))
        return 0
    except Exception as error:
        failure_phase = error.phase if isinstance(error, AnalysisFailure) else phase
        for stale in (energy_contact_path, oracle_contact_path):
            stale.unlink(missing_ok=True)
        failure = {
            "schema": SCHEMA,
            "identity": "causal-control-to-learned-visible-delta-concentration-v0",
            "status": "failed",
            "failurePhase": failure_phase,
            "reason": str(error),
            "route": {"requested": ROUTE, "effective": None, "backend": None},
            "lastTrustworthyEvidence": evidence,
        }
        atomic_json(manifest_path, failure)
        print(json.dumps({"ok": False, "manifest": str(manifest_path), "failurePhase": failure_phase, "reason": str(error)}, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
