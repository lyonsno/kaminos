"""Small deterministic checks used by terminal collection and focused tests."""

import hashlib
import struct
import zlib
from pathlib import Path


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def png_dimensions(path: Path) -> tuple[int, int] | None:
    try:
        header = path.read_bytes()[:24]
    except OSError:
        return None
    if header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", header[16:24])


def _unfilter_png_rows(raw: bytes, width: int, height: int, channels: int) -> list[bytes]:
    stride = width * channels
    rows = []
    offset = 0
    previous = bytes(stride)
    for _ in range(height):
        filter_type = raw[offset]
        offset += 1
        encoded = raw[offset:offset + stride]
        offset += stride
        if len(encoded) != stride:
            raise ValueError("truncated PNG scanline")
        decoded = bytearray(stride)
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
                prediction = left + above - upper_left
                distances = (abs(prediction - left), abs(prediction - above), abs(prediction - upper_left))
                predictor = (left, above, upper_left)[distances.index(min(distances))]
                decoded[index] = (value + predictor) & 0xFF
            else:
                raise ValueError(f"unsupported PNG filter {filter_type}")
        row = bytes(decoded)
        rows.append(row)
        previous = row
    return rows


def png_is_visually_blank(path: Path) -> bool:
    """Reject a uniformly colored RGB/RGBA/grayscale PNG without image tooling."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return True
    position = 8
    width = height = color_type = bit_depth = None
    compressed = bytearray()
    while position + 12 <= len(data):
        length = struct.unpack(">I", data[position:position + 4])[0]
        chunk_type = data[position + 4:position + 8]
        chunk = data[position + 8:position + 8 + length]
        position += 12 + length
        if len(chunk) != length:
            return True
        if chunk_type == b"IHDR":
            width, height, bit_depth, color_type, _, _, _ = struct.unpack(">IIBBBBB", chunk)
        elif chunk_type == b"IDAT":
            compressed.extend(chunk)
        elif chunk_type == b"IEND":
            break
    if bit_depth != 8 or color_type not in {0, 2, 4, 6} or not compressed:
        return False
    channels = {0: 1, 2: 3, 4: 2, 6: 4}[color_type]
    try:
        rows = _unfilter_png_rows(zlib.decompress(compressed), width, height, channels)
    except (struct.error, ValueError, zlib.error):
        return True
    pixels = b"".join(rows)
    if color_type in {4, 6}:
        pixels = b"".join(pixels[index:index + channels - 1] for index in range(0, len(pixels), channels))
    return bool(pixels) and min(pixels) == max(pixels)


def validate_output(path: Path, expected_size: tuple[int, int], started_at: float | None) -> list[str]:
    if not path.is_file():
        return [f"primary output is missing: {path}"]
    errors = []
    if path.stat().st_size <= 1024:
        errors.append(f"primary output is suspiciously small: {path.stat().st_size} bytes")
    if png_dimensions(path) != expected_size:
        errors.append(f"primary output dimensions are {png_dimensions(path)}, expected {expected_size}")
    if png_is_visually_blank(path):
        errors.append("primary output is blank or unreadable")
    if started_at is not None and path.stat().st_mtime + 1 < started_at:
        errors.append("primary output predates the authenticated job start")
    return errors


def validate_status(status: dict, expected: dict) -> list[str]:
    errors = []
    if status.get("status") != "done":
        errors.append(f"status is {status.get('status')}, expected done")
    if status.get("exit_code") != 0:
        errors.append(f"exit code is {status.get('exit_code')}, expected 0")
    if status.get("job_type") != expected["jobType"]:
        errors.append(f"job type is {status.get('job_type')}, expected {expected['jobType']}")
    for key, value in expected["params"].items():
        if (status.get("params") or {}).get(key) != str(value):
            errors.append(f"parameter {key} is {(status.get('params') or {}).get(key)!r}, expected {str(value)!r}")
    route = status.get("effective_route") or ""
    required_tokens = [
        "mflux-generate-flux2-edit", expected["source"], expected["promptFile"], expected["output"],
        f"--seed {expected['params']['seed']}", f"--model {expected['params']['model']}",
        f"--quantize {expected['params']['quantize']}", f"--height {expected['params']['height']}",
        f"--width {expected['params']['width']}", f"--steps {expected['params']['steps']}",
        f"--guidance {expected['params']['guidance']}",
        f"--mlx-cache-limit-gb {expected['params']['mlx_cache_limit_gb']}",
    ]
    if any(token not in route for token in required_tokens):
        errors.append("effective route does not bind the requested runner, input, prompt, output, and settings")
    return errors
