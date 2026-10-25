"""Durable local storage for Iron Gland browser gesture captures."""
from contextlib import contextmanager
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import tempfile
import time
import uuid


FILES = re.compile(r"(?:frames/[0-9]{8}\.(?:png|f32|json)|events/[0-9]{8}\.json|video/[0-9]{8}\.(?:webm|mp4)|topology\.u16)\Z")
IDS = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\Z")
TERMINAL_FIELDS = frozenset({"status", "reason", "error", "frameCount", "videoChunks", "eventCount",
                             "startedAtMs", "finishedAtMs", "protocolComplete"})


class CaptureError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def default_root():
    return Path(os.environ.get("KAMINOS_IRON_GLAND_CAPTURE_ROOT",
                               "~/.local/state/kaminos/iron-gland-captures")).expanduser().resolve()


def _atomic(path, data):
    fd, temporary = tempfile.mkstemp(prefix=".capture-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _manifest(path, document):
    _atomic(path / "manifest.json", json.dumps(document, allow_nan=False, indent=2).encode())


def _object(raw):
    try:
        result = json.loads(raw, parse_constant=lambda value: (_ for _ in ()).throw(ValueError("nonfinite JSON")))
    except (ValueError, UnicodeError) as error:
        raise CaptureError("Invalid JSON: " + str(error)) from error
    if not isinstance(result, dict):
        raise CaptureError("Expected a JSON object")
    return result


class CaptureStore:
    def __init__(self):
        self.root = default_root()

    @contextmanager
    def capture(self, identifier):
        if not isinstance(identifier, str) or not IDS.fullmatch(identifier):
            raise CaptureError("Invalid capture id")
        path = self.root / identifier
        if not path.is_dir() or path.is_symlink():
            raise CaptureError("Capture not found", 404)
        # Separate lock inode survives atomic manifest replacement, including across servers.
        with (path / ".lock").open("a+b") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                yield path, _object((path / "manifest.json").read_bytes())
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    def start(self, metadata):
        self.root.mkdir(parents=True, exist_ok=True)
        identifier = str(uuid.uuid4())
        path = self.root / identifier
        path.mkdir()
        _manifest(path, {**metadata, "id": identifier, "path": str(path), "status": "recording",
                         "startedAtUnixMs": time.time_ns() // 1000000})
        return {"id": identifier, "path": str(path)}

    def get(self, identifier):
        if identifier is None:
            return {"root": str(self.root)}
        with self.capture(identifier) as (_, manifest):
            return manifest

    def write(self, identifier, name, raw):
        if not isinstance(name, str) or not FILES.fullmatch(name):
            raise CaptureError("Invalid capture filename")
        if not raw:
            raise CaptureError("Capture file must not be empty")
        with self.capture(identifier) as (path, manifest):
            target = path / name
            if target.parent.is_symlink() or target.is_symlink():
                raise CaptureError("Symlink capture paths are forbidden")
            if target.exists():
                if target.read_bytes() != raw:
                    raise CaptureError("Capture file already exists with different bytes", 409)
            else:
                if manifest["status"] != "recording":
                    raise CaptureError("Capture is finalized", 409)
                target.parent.mkdir(exist_ok=True)
                _atomic(target, raw)
        return {"name": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}

    def finish(self, identifier, metadata):
        metadata = {key: value for key, value in metadata.items() if key in TERMINAL_FIELDS}
        requested = metadata.get("status")
        if requested not in ("complete", "partial", "failed"):
            raise CaptureError("status must be complete, partial, or failed")
        with self.capture(identifier) as (path, previous):
            if previous["status"] != "recording":
                finalization = previous.get("finalization", {})
                if finalization.get("request") == metadata:
                    return previous, finalization["httpStatus"]
                raise CaptureError("Capture already finalized with a different terminal request", 409)
            counts, errors = _validate(path, previous.get("feature"))
            for key, observed in counts.items():
                if key in metadata and (type(metadata[key]) is not int or metadata[key] != observed):
                    errors.append(f"{key}: requested {metadata[key]!r}, observed {observed}")
            status = 409 if requested == "complete" and errors else 200
            manifest = {**previous, **metadata, **counts, "id": previous["id"], "path": str(path),
                        "startedAtUnixMs": previous["startedAtUnixMs"],
                        "finishedAtUnixMs": time.time_ns() // 1000000,
                        "status": "partial" if requested == "complete" and errors else requested,
                        "validationErrors": errors,
                        "finalization": {"request": metadata, "httpStatus": status}}
            _manifest(path, manifest)
            return manifest, status


def _validate(path, feature):
    errors = []
    groups = {group: sorted((path / group).glob("*")) for group in ("frames", "video", "events")}
    for files in groups.values():
        for file in files:
            if file.is_symlink() or not file.is_file() or not file.stat().st_size:
                errors.append(f"Invalid or empty capture file: {file.name}")
    frames = groups["frames"]
    stems = sorted({file.stem for file in frames})
    counts = {"frameCount": len(stems), "videoChunks": len(groups["video"]), "eventCount": len(groups["events"])}
    if not stems:
        errors.append("Capture contains no frames")
    if not groups["video"]:
        errors.append("Capture contains no video chunks")
    topology = path / "topology.u16"
    if topology.is_symlink() or not topology.is_file() or not topology.stat().st_size:
        errors.append("Capture requires nonempty topology.u16")
    for group, indices in (("frames", stems), ("video", [p.stem for p in groups["video"]]),
                           ("events", [p.stem for p in groups["events"]])):
        if indices != [f"{index:08d}" for index in range(len(indices))]:
            errors.append(f"{group} indices must be consecutive starting at zero")
    for stem in stems:
        try:
            if not (path / "frames" / (stem + ".png")).is_file():
                raise CaptureError("missing PNG")
            frame = _object((path / "frames" / (stem + ".json")).read_bytes())
            if frame.get("error"):
                raise CaptureError("frame reports an error")
            if type(frame.get("index")) is not int or frame["index"] != int(stem):
                raise CaptureError("frame index mismatch")
            for key in ("captureAtMs", "completedAtMs"):
                if type(frame.get(key)) not in (int, float) or not math.isfinite(frame[key]):
                    raise CaptureError(f"{key} must be finite numeric")
            if frame["completedAtMs"] < frame["captureAtMs"]:
                raise CaptureError("completedAtMs precedes captureAtMs")
            layout = frame.get("layout")
            if not isinstance(layout, list):
                raise CaptureError("layout must be an array")
            cursor, names = 0, set()
            for entry in layout:
                if not isinstance(entry, dict):
                    raise CaptureError("invalid layout entry")
                name, shape = entry.get("name"), entry.get("shape")
                if not isinstance(name, str) or not name or name in names:
                    raise CaptureError("layout names must be nonempty and unique")
                names.add(name)
                if not isinstance(shape, list) or any(type(n) is not int or n < 0 for n in shape):
                    raise CaptureError("invalid layout shape")
                if (type(entry.get("offset")) is not int or entry["offset"] != cursor or
                        type(entry.get("length")) is not int or entry["length"] != math.prod(shape)):
                    raise CaptureError("layout must cover contiguous float32 elements with shape-matched lengths")
                cursor += entry["length"]
            if frame.get("hasHand") is True:
                if not layout:
                    raise CaptureError("hasHand frame requires a nonempty layout")
                if not isinstance(feature, str) or not feature or feature not in names:
                    raise CaptureError("hasHand frame is missing the start-declared feature")
            buffer = path / "frames" / (stem + ".f32")
            if layout:
                if not buffer.is_file() or buffer.stat().st_size != cursor * 4:
                    raise CaptureError("float32 buffer byte size does not match layout")
            elif buffer.exists():
                raise CaptureError("empty no-hand layout must have no float32 buffer")
        except (ValueError, OSError, TypeError, OverflowError) as error:
            errors.append(f"frame {stem}: {error}")
    return counts, errors


def handle(handler, query, write=False):
    if not handler._vantage_allowed():
        return
    try:
        store = CaptureStore()
        identifier = query.get("id", [None])[0]
        if not write:
            return handler.send_json(store.get(identifier))
        action = query.get("action", [None])[0]
        if action not in ("start", "write", "finish"):
            raise CaptureError("Unknown capture action")
        if action != "write" and (handler.headers.get("Content-Type") or "").split(";")[0].strip().lower() != "application/json":
            raise CaptureError("Send metadata as application/json", 415)
        length = int(handler.headers.get("Content-Length") or 0)
        if length <= 0:
            raise CaptureError("Request body must not be empty")
        raw = handler.rfile.read(length)
        if len(raw) != length:
            raise CaptureError("Incomplete request body")
        if action == "start":
            return handler.send_json(store.start(_object(raw)))
        if action == "write":
            return handler.send_json(store.write(identifier, query.get("name", [None])[0], raw))
        manifest, status = store.finish(identifier, _object(raw))
        handler.send_json(manifest, status)
    except CaptureError as error:
        handler.send_json({"error": str(error)}, error.status)
    except ValueError as error:
        handler.send_json({"error": str(error)}, 400)
    except OSError as error:
        handler.send_json({"error": str(error)}, 500)
