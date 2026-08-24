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
EVALUATED_GEOMETRY_SCHEMA = "kaminos.evaluated-mesh-geometry.v0"
EVALUATED_VISIBLE_OBJECT_MESH_GEOMETRY_SCHEMA = (
    "kaminos.evaluated-visible-object-mesh-geometry.v0"
)
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


def _hash_sized_bytes(digest: Any, payload: bytes) -> None:
    digest.update(struct.pack("<Q", len(payload)))
    digest.update(payload)


def _mesh_index(value: Any, *, vertex_count: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise SourcePlateCaptureError(
            "context-capture", f"mesh index must be an integer, got {value!r}"
        )
    if value < 0 or value >= vertex_count:
        raise SourcePlateCaptureError(
            "context-capture",
            f"mesh index {value} is outside vertex range [0, {vertex_count})",
        )
    return value


def evaluated_mesh_geometry_record(
    *,
    vertices: Any,
    edges: Any,
    polygons: Any,
) -> dict[str, Any]:
    vertex_rows = tuple(tuple(vertex) for vertex in vertices)
    edge_rows = tuple(tuple(edge) for edge in edges)
    polygon_rows = tuple(tuple(polygon) for polygon in polygons)

    position_digest = hashlib.sha256()
    position_digest.update(b"kaminos.evaluated-mesh-positions.v0\0")
    position_digest.update(struct.pack("<Q", len(vertex_rows)))
    for vertex in vertex_rows:
        if len(vertex) != 3:
            raise SourcePlateCaptureError(
                "context-capture", f"mesh vertex must have three coordinates, got {vertex!r}"
            )
        coordinates = tuple(float(component) for component in vertex)
        if not all(math.isfinite(component) for component in coordinates):
            raise SourcePlateCaptureError(
                "context-capture", f"mesh vertex must be finite, got {vertex!r}"
            )
        try:
            position_digest.update(struct.pack("<3f", *coordinates))
        except (OverflowError, struct.error) as error:
            raise SourcePlateCaptureError(
                "context-capture", f"mesh vertex is outside float32 range: {vertex!r}"
            ) from error

    topology_digest = hashlib.sha256()
    topology_digest.update(b"kaminos.evaluated-mesh-topology.v0\0")
    topology_digest.update(struct.pack("<Q", len(vertex_rows)))
    topology_digest.update(struct.pack("<Q", len(edge_rows)))
    for edge in edge_rows:
        if len(edge) != 2:
            raise SourcePlateCaptureError(
                "context-capture", f"mesh edge must contain two indices, got {edge!r}"
            )
        topology_digest.update(
            struct.pack(
                "<2Q",
                *(
                    _mesh_index(index, vertex_count=len(vertex_rows))
                    for index in edge
                ),
            )
        )
    topology_digest.update(struct.pack("<Q", len(polygon_rows)))
    loop_count = 0
    for polygon in polygon_rows:
        topology_digest.update(struct.pack("<Q", len(polygon)))
        loop_count += len(polygon)
        for index in polygon:
            topology_digest.update(
                struct.pack(
                    "<Q", _mesh_index(index, vertex_count=len(vertex_rows))
                )
            )

    position_sha256 = position_digest.hexdigest()
    topology_sha256 = topology_digest.hexdigest()
    geometry_digest = hashlib.sha256()
    geometry_digest.update(EVALUATED_GEOMETRY_SCHEMA.encode("ascii") + b"\0")
    geometry_digest.update(bytes.fromhex(position_sha256))
    geometry_digest.update(bytes.fromhex(topology_sha256))
    return {
        "schema": EVALUATED_GEOMETRY_SCHEMA,
        "vertexCount": len(vertex_rows),
        "edgeCount": len(edge_rows),
        "polygonCount": len(polygon_rows),
        "loopCount": loop_count,
        "positionSha256": position_sha256,
        "topologySha256": topology_sha256,
        "geometrySha256": geometry_digest.hexdigest(),
    }


def evaluated_visible_object_mesh_geometry_record(objects: Any) -> dict[str, Any]:
    rows = sorted(tuple(objects), key=lambda row: row[0])
    names = [name for name, _record, _matrix_world in rows]
    if len(names) != len(set(names)):
        raise SourcePlateCaptureError(
            "context-capture",
            "evaluated visible-object mesh geometry contains duplicate object names",
        )

    digest = hashlib.sha256()
    digest.update(
        EVALUATED_VISIBLE_OBJECT_MESH_GEOMETRY_SCHEMA.encode("ascii") + b"\0"
    )
    digest.update(struct.pack("<Q", len(rows)))
    for name, record, matrix_world in rows:
        if not isinstance(name, str) or not name:
            raise SourcePlateCaptureError(
                "context-capture", f"mesh object name must be non-empty, got {name!r}"
            )
        geometry_sha256 = record.get("geometrySha256")
        if not isinstance(geometry_sha256, str) or len(geometry_sha256) != 64:
            raise SourcePlateCaptureError(
                "context-capture", f"mesh object {name!r} has no valid geometry digest"
            )
        _hash_sized_bytes(digest, name.encode("utf-8"))
        try:
            digest.update(bytes.fromhex(geometry_sha256))
        except ValueError as error:
            raise SourcePlateCaptureError(
                "context-capture", f"mesh object {name!r} has an invalid geometry digest"
            ) from error
        matrix_rows = tuple(tuple(row) for row in matrix_world)
        if len(matrix_rows) != 4 or any(len(row) != 4 for row in matrix_rows):
            raise SourcePlateCaptureError(
                "context-capture",
                f"mesh object {name!r} must have a 4x4 evaluated world matrix",
            )
        for row in matrix_rows:
            values = tuple(float(component) for component in row)
            if not all(math.isfinite(component) for component in values):
                raise SourcePlateCaptureError(
                    "context-capture",
                    f"mesh object {name!r} has a non-finite evaluated world matrix",
                )
            try:
                digest.update(struct.pack("<4f", *values))
            except (OverflowError, struct.error) as error:
                raise SourcePlateCaptureError(
                    "context-capture",
                    f"mesh object {name!r} has a world matrix outside float32 range",
                ) from error
    return {
        "schema": EVALUATED_VISIBLE_OBJECT_MESH_GEOMETRY_SCHEMA,
        "objectCount": len(rows),
        "aggregateSha256": digest.hexdigest(),
    }


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


def camera_frame_capture_plan(
    *,
    source_width: int,
    source_height: int,
    pixel_aspect_x: float,
    pixel_aspect_y: float,
    target_width: int,
    target_height: int,
    use_border: bool,
    border_min_x: float,
    border_max_x: float,
    border_min_y: float,
    border_max_y: float,
) -> dict[str, Any]:
    source_width, source_height = validate_fixed_raster(source_width, source_height)
    target_width, target_height = validate_fixed_raster(target_width, target_height)
    aspects = (float(pixel_aspect_x), float(pixel_aspect_y))
    if not all(math.isfinite(value) and value > 0 for value in aspects):
        raise SourcePlateCaptureError(
            "capture-request",
            f"camera pixel aspect must be positive and finite, got {aspects!r}",
        )

    if use_border:
        bounds = tuple(
            float(value)
            for value in (
                border_min_x,
                border_max_x,
                border_min_y,
                border_max_y,
            )
        )
        if (
            not all(math.isfinite(value) for value in bounds)
            or not 0.0 <= bounds[0] < bounds[1] <= 1.0
            or not 0.0 <= bounds[2] < bounds[3] <= 1.0
        ):
            raise SourcePlateCaptureError(
                "capture-request", f"camera render border is invalid: {bounds!r}"
            )
        frame = "render-border"
        fraction_x = bounds[1] - bounds[0]
        fraction_y = bounds[3] - bounds[2]
    else:
        bounds = (0.0, 1.0, 0.0, 1.0)
        frame = "camera-frame"
        fraction_x = fraction_y = 1.0

    display_source_width = source_width * aspects[0]
    display_source_height = source_height * aspects[1]
    display_frame_width = display_source_width * fraction_x
    display_frame_height = display_source_height * fraction_y
    scale = min(
        target_width / display_frame_width,
        target_height / display_frame_height,
    )
    render_width = max(1, math.floor(display_source_width * scale + 1e-9))
    render_height = max(1, math.floor(display_source_height * scale + 1e-9))
    expected_content_width = max(
        1, math.floor(render_width * fraction_x + 1e-9)
    )
    expected_content_height = max(
        1, math.floor(render_height * fraction_y + 1e-9)
    )
    if (
        expected_content_width > target_width
        or expected_content_height > target_height
    ):
        raise SourcePlateCaptureError(
            "capture-request",
            "camera frame plan exceeds the requested fixed raster",
        )
    return {
        "frame": frame,
        "cropToBorder": bool(use_border),
        "sourceWidth": source_width,
        "sourceHeight": source_height,
        "sourcePixelAspectX": aspects[0],
        "sourcePixelAspectY": aspects[1],
        "sourceFrameAspectRatio": display_frame_width / display_frame_height,
        "border": {
            "minX": bounds[0],
            "maxX": bounds[1],
            "minY": bounds[2],
            "maxY": bounds[3],
        },
        "renderWidth": render_width,
        "renderHeight": render_height,
        "expectedContentWidth": expected_content_width,
        "expectedContentHeight": expected_content_height,
        "targetWidth": target_width,
        "targetHeight": target_height,
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


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    body = kind + payload
    return (
        struct.pack(">I", len(payload))
        + body
        + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
    )


def letterbox_png(
    source: str | Path,
    target: str | Path,
    *,
    target_width: int,
    target_height: int,
) -> dict[str, Any]:
    target_width, target_height = validate_fixed_raster(target_width, target_height)
    source_path = Path(source)
    target_path = Path(target)
    source_width, source_height, channels, source_pixels = _read_png_pixels(
        source_path
    )
    if source_width > target_width or source_height > target_height:
        raise SourcePlateCaptureError(
            "output-validation",
            f"camera-frame PNG is {source_width} x {source_height}; "
            f"cannot place it without resizing inside {target_width} x {target_height}",
        )

    offset_x = (target_width - source_width) // 2
    offset_y = (target_height - source_height) // 2
    if channels == 1:
        padding_pixel = b"\x00"
        color_type = 0
    elif channels == 2:
        padding_pixel = b"\x00\xff"
        color_type = 4
    elif channels == 3:
        padding_pixel = b"\x00\x00\x00"
        color_type = 2
    elif channels == 4:
        padding_pixel = b"\x00\x00\x00\xff"
        color_type = 6
    else:
        raise SourcePlateCaptureError(
            "output-validation", f"camera-frame PNG has unsupported channel count {channels}"
        )

    padded = bytearray(padding_pixel * (target_width * target_height))
    source_stride = source_width * channels
    target_stride = target_width * channels
    for row in range(source_height):
        source_start = row * source_stride
        target_start = (row + offset_y) * target_stride + offset_x * channels
        padded[target_start : target_start + source_stride] = source_pixels[
            source_start : source_start + source_stride
        ]

    raw = b"".join(
        b"\x00" + padded[row * target_stride : (row + 1) * target_stride]
        for row in range(target_height)
    )
    payload = (
        PNG_SIGNATURE
        + _png_chunk(
            b"IHDR",
            struct.pack(
                ">IIBBBBB",
                target_width,
                target_height,
                8,
                color_type,
                0,
                0,
                0,
            ),
        )
        + _png_chunk(b"IDAT", zlib.compress(raw))
        + _png_chunk(b"IEND", b"")
    )
    target_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{target_path.name}.", suffix=".tmp", dir=target_path.parent
    )
    temporary = Path(temporary_name)
    try:
        with open(descriptor, "wb") as handle:
            handle.write(payload)
        temporary.replace(target_path)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return {
        "sourceWidth": source_width,
        "sourceHeight": source_height,
        "targetWidth": target_width,
        "targetHeight": target_height,
        "offsetX": offset_x,
        "offsetY": offset_y,
        "padding": "opaque-black",
    }


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
