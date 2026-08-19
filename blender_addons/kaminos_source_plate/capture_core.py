from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
from itertools import product
import json
import math
from pathlib import Path
import re
import struct
import tempfile
from typing import Any
import zlib


SCHEMA = "kaminos.source-plate-viewport-capture.v0"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


@dataclass
class SourcePlateCaptureError(RuntimeError):
    phase: str
    message: str

    def __str__(self) -> str:
        return self.message


def slugify(value: str, *, fallback: str = "capture") -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or fallback


def validate_fixed_raster(width: int, height: int) -> tuple[int, int]:
    if (
        isinstance(width, bool)
        or isinstance(height, bool)
        or not isinstance(width, int)
        or not isinstance(height, int)
        or width <= 0
        or height <= 0
    ):
        raise SourcePlateCaptureError(
            "capture-request",
            f"fixed raster dimensions must be positive integers, got {width!r} x {height!r}",
        )
    return width, height


def discover_morph_properties(
    properties: Any, *, prefix: str = "morph_"
) -> dict[str, float]:
    discovered: dict[str, float] = {}
    for name, value in sorted(properties.items()):
        if (
            not name.startswith(prefix)
            or isinstance(value, bool)
            or not isinstance(value, (int, float))
        ):
            continue
        numeric = float(value)
        if math.isfinite(numeric):
            discovered[name] = numeric
    return discovered


def parse_morph_sample_values(value: str) -> tuple[float, ...]:
    samples: list[float] = []
    for token in value.split(","):
        token = token.strip()
        if not token:
            continue
        try:
            sample = float(token)
        except ValueError as error:
            raise SourcePlateCaptureError(
                "capture-request", f"invalid morph sample value {token!r}"
            ) from error
        if not math.isfinite(sample):
            raise SourcePlateCaptureError(
                "capture-request", f"morph sample value must be finite, got {token!r}"
            )
        if sample not in samples:
            samples.append(sample)
    if not samples:
        raise SourcePlateCaptureError(
            "capture-request", "morph sample values must contain at least one number"
        )
    return tuple(samples)


def build_morph_sample_plan(
    baseline: dict[str, float], samples: tuple[float, ...], *, mode: str
) -> list[dict[str, Any]]:
    if not baseline:
        raise SourcePlateCaptureError(
            "capture-request", "the active object has no finite numeric morph properties"
        )
    if not samples:
        raise SourcePlateCaptureError(
            "capture-request", "morph sample values must not be empty"
        )
    names = sorted(baseline)
    normalized = {name: float(baseline[name]) for name in names}
    if mode == "one-axis":
        plan: list[dict[str, Any]] = [
            {
                "kind": "baseline",
                "axis": None,
                "sample": None,
                "values": dict(normalized),
            }
        ]
        for name in names:
            for sample in samples:
                if math.isclose(
                    sample, normalized[name], rel_tol=1e-12, abs_tol=1e-12
                ):
                    continue
                values = dict(normalized)
                values[name] = float(sample)
                plan.append(
                    {
                        "kind": "axis",
                        "axis": name,
                        "sample": float(sample),
                        "values": values,
                    }
                )
        return plan
    if mode == "cartesian":
        return [
            {
                "kind": "cartesian",
                "axis": None,
                "sample": None,
                "values": {name: float(sample) for name, sample in zip(names, values)},
            }
            for values in product(samples, repeat=len(names))
        ]
    raise SourcePlateCaptureError(
        "capture-request", f"unsupported morph sweep mode {mode!r}"
    )


@contextmanager
def applied_morph_values(target: Any, values: dict[str, float]):
    missing = [name for name in values if name not in target]
    if missing:
        raise SourcePlateCaptureError(
            "capture-request",
            f"morph target is missing properties: {', '.join(sorted(missing))}",
        )
    snapshot = {name: target[name] for name in values}
    try:
        for name, value in values.items():
            target[name] = value
        yield
    finally:
        for name, value in snapshot.items():
            target[name] = value


def capture_paths(
    *,
    output_root: str | Path,
    source_stem: str,
    label: str,
    captured_at: str,
) -> dict[str, Path]:
    root = Path(output_root).expanduser().resolve()
    source_dir = root / slugify(source_stem, fallback="unsaved")
    source_dir.mkdir(parents=True, exist_ok=True)

    timestamp = re.sub(r"[^0-9]", "", captured_at)
    if not timestamp:
        raise SourcePlateCaptureError("capture-request", "capture timestamp contains no digits")
    label_slug = slugify(label, fallback="view")
    stem = f"{timestamp}-{label_slug}"
    candidate = source_dir / f"{stem}.png"
    suffix = 2
    while candidate.exists() or candidate.with_suffix(".json").exists():
        candidate = source_dir / f"{stem}-{suffix:02d}.png"
        suffix += 1
    return {"image": candidate, "sidecar": candidate.with_suffix(".json")}


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def conditioning_geometry(
    *,
    source_width: int,
    source_height: int,
    target_width: int,
    target_height: int,
) -> dict[str, Any]:
    source_width, source_height = validate_fixed_raster(source_width, source_height)
    target_width, target_height = validate_fixed_raster(target_width, target_height)
    scale_x = target_width / source_width
    scale_y = target_height / source_height
    anisotropy = scale_x / scale_y
    return {
        "sourceWidth": source_width,
        "sourceHeight": source_height,
        "targetWidth": target_width,
        "targetHeight": target_height,
        "sourceAspectRatio": source_width / source_height,
        "targetAspectRatio": target_width / target_height,
        "scaleX": scale_x,
        "scaleY": scale_y,
        "anisotropyRatio": anisotropy,
        "geometryPreserved": math.isclose(anisotropy, 1.0, rel_tol=1e-12, abs_tol=1e-12),
    }


def _paeth(left: int, above: int, upper_left: int) -> int:
    prediction = left + above - upper_left
    left_distance = abs(prediction - left)
    above_distance = abs(prediction - above)
    upper_left_distance = abs(prediction - upper_left)
    if left_distance <= above_distance and left_distance <= upper_left_distance:
        return left
    if above_distance <= upper_left_distance:
        return above
    return upper_left


def _unfilter_scanlines(raw: bytes, *, width: int, height: int, channels: int) -> bytes:
    stride = width * channels
    expected = height * (stride + 1)
    if len(raw) != expected:
        raise SourcePlateCaptureError(
            "output-validation",
            f"PNG decompressed payload has {len(raw)} bytes; expected {expected}",
        )
    rows: list[bytearray] = []
    cursor = 0
    for row_index in range(height):
        filter_type = raw[cursor]
        cursor += 1
        encoded = raw[cursor : cursor + stride]
        cursor += stride
        decoded = bytearray(stride)
        previous = rows[row_index - 1] if row_index else bytearray(stride)
        for index, value in enumerate(encoded):
            left = decoded[index - channels] if index >= channels else 0
            above = previous[index]
            upper_left = previous[index - channels] if index >= channels else 0
            if filter_type == 0:
                decoded[index] = value
            elif filter_type == 1:
                decoded[index] = (value + left) & 0xFF
            elif filter_type == 2:
                decoded[index] = (value + above) & 0xFF
            elif filter_type == 3:
                decoded[index] = (value + ((left + above) // 2)) & 0xFF
            elif filter_type == 4:
                decoded[index] = (value + _paeth(left, above, upper_left)) & 0xFF
            else:
                raise SourcePlateCaptureError(
                    "output-validation", f"PNG uses unsupported filter type {filter_type}"
                )
        rows.append(decoded)
    return b"".join(rows)


def _read_png_pixels(path: Path) -> tuple[int, int, int, bytes]:
    payload = path.read_bytes()
    if not payload.startswith(PNG_SIGNATURE):
        raise SourcePlateCaptureError("output-validation", f"{path} is not a PNG")

    cursor = len(PNG_SIGNATURE)
    width = height = bit_depth = color_type = None
    compressed = bytearray()
    while cursor < len(payload):
        if cursor + 12 > len(payload):
            raise SourcePlateCaptureError("output-validation", "PNG contains a truncated chunk")
        length = struct.unpack(">I", payload[cursor : cursor + 4])[0]
        kind = payload[cursor + 4 : cursor + 8]
        data_start = cursor + 8
        data_end = data_start + length
        if data_end + 4 > len(payload):
            raise SourcePlateCaptureError("output-validation", "PNG contains a truncated payload")
        data = payload[data_start:data_end]
        if kind == b"IHDR":
            width, height, bit_depth, color_type, compression, filtering, interlace = struct.unpack(
                ">IIBBBBB", data
            )
            if compression != 0 or filtering != 0 or interlace != 0:
                raise SourcePlateCaptureError(
                    "output-validation", "PNG compression, filtering, or interlace is unsupported"
                )
        elif kind == b"IDAT":
            compressed.extend(data)
        elif kind == b"IEND":
            break
        cursor = data_end + 4

    if width is None or height is None or bit_depth is None or color_type is None:
        raise SourcePlateCaptureError("output-validation", "PNG is missing IHDR")
    if bit_depth != 8:
        raise SourcePlateCaptureError(
            "output-validation", f"PNG bit depth {bit_depth} is unsupported; expected 8"
        )
    channels_by_color_type = {0: 1, 2: 3, 4: 2, 6: 4}
    if color_type not in channels_by_color_type:
        raise SourcePlateCaptureError(
            "output-validation", f"PNG color type {color_type} is unsupported"
        )
    try:
        raw = zlib.decompress(bytes(compressed))
    except zlib.error as error:
        raise SourcePlateCaptureError("output-validation", f"PNG decompression failed: {error}") from error
    channels = channels_by_color_type[color_type]
    pixels = _unfilter_scanlines(raw, width=width, height=height, channels=channels)
    return width, height, channels, pixels


def inspect_png(
    path: str | Path, *, expected_width: int, expected_height: int
) -> dict[str, Any]:
    expected_width, expected_height = validate_fixed_raster(expected_width, expected_height)
    image = Path(path)
    if not image.is_file():
        raise SourcePlateCaptureError("output-validation", f"PNG output is missing: {image}")
    width, height, channels, pixels = _read_png_pixels(image)
    if (width, height) != (expected_width, expected_height):
        raise SourcePlateCaptureError(
            "output-validation",
            f"PNG dimensions are {width} x {height}; expected {expected_width} x {expected_height}",
        )
    first_pixel = pixels[:channels]
    uniform = True
    for index in range(channels, len(pixels), channels):
        if pixels[index : index + channels] != first_pixel:
            uniform = False
            break
    if channels in (2, 4):
        alpha_values = pixels[channels - 1 :: channels]
        nonblank = any(alpha_values)
    else:
        nonblank = any(pixels)
    return {
        "path": str(image.resolve()),
        "width": width,
        "height": height,
        "byteLength": image.stat().st_size,
        "sha256": sha256_file(image),
        "nonblank": nonblank,
        "uniform": uniform,
        "distinctPixelCountLowerBound": 1 if uniform else 2,
    }


def atomic_write_json(path: str | Path, document: dict[str, Any]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{target.name}.", suffix=".tmp", dir=target.parent
    )
    temporary = Path(temporary_name)
    try:
        with open(descriptor, "w", encoding="utf-8") as handle:
            json.dump(document, handle, indent=2, sort_keys=True)
            handle.write("\n")
        temporary.replace(target)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
