"""Disposable, stat-validated scene summaries; documents remain authoritative.

Listing never reads a scene. Explicit hydration reads only missing/changed
summaries, and save/import seed them from the document already in memory.
Cache files are independent atomic replacements, so different servers can share
one cache without lost updates. Failure to cache never prevents opening/saving.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import tempfile
import threading


def _identity(path):
    return _stat_identity(path.stat())


def _stat_identity(stat):
    return [stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns]


def _summary(document):
    if not isinstance(document, dict):
        raise ValueError('Scene document must be an object')
    capture = document.get('capture')
    return {'label': str(document.get('label') or (capture.get('label') if isinstance(capture, dict) else '') or ''),
            'timestamp': str(document.get('timestamp') or ''),
            'provenance': {key: document['provenance'][key] for key in ('source_group', 'greenroom_job_id') if key in document['provenance']} if isinstance(document.get('provenance'), dict) else None,
            'composition': {'flame': {key: document['composition']['flame'][key] for key in ('label', 'presetId') if key in document['composition']['flame']}} if isinstance(document.get('composition'), dict) and isinstance(document['composition'].get('flame'), dict) else None,
            'capture': {key: capture[key] for key in ('label', 'capturedAt') if key in capture} if isinstance(capture, dict) else None}



class SceneCatalogue:
    _hydration_lock = threading.Lock()

    def __init__(self, cache_dir):
        self.cache_dir = Path(cache_dir)

    def _cache_path(self, path):
        return self.cache_dir / (hashlib.sha256(str(path).encode()).hexdigest() + '.json')

    def _write(self, path, identity, summary):
        temporary = None
        try:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            fd, temporary = tempfile.mkstemp(dir=self.cache_dir, suffix='.tmp')
            with os.fdopen(fd, 'w') as stream:
                json.dump({'version': 2, 'identity': identity, 'summary': summary}, stream)
            os.replace(temporary, self._cache_path(path))
        except OSError:
            # Derived metadata is expendable; the scene write is authoritative.
            pass
        finally:
            if temporary:
                try:
                    os.unlink(temporary)
                except OSError:
                    pass

    def summarize(self, document):
        summary = _summary(document)
        capture = document.get('capture')
        image = capture.get('image') if isinstance(capture, dict) else None
        if isinstance(image, str) and image.startswith('data:image/png;base64,'):
            try:
                data = base64.b64decode(image.split(',', 1)[1], validate=True)
                digest = hashlib.sha256(data).hexdigest()
                self.cache_dir.mkdir(parents=True, exist_ok=True)
                target = self.cache_dir / (digest + '.png')
                # Content identity makes concurrent identical writes safe.
                # Atomic rename prevents a reader seeing the file before its bytes finish.
                fd, temporary = tempfile.mkstemp(dir=self.cache_dir, suffix='.tmp')
                try:
                    with os.fdopen(fd, 'wb') as stream:
                        stream.write(data)
                    os.replace(temporary, target)
                finally:
                    if os.path.exists(temporary):
                        os.unlink(temporary)
                summary['capture']['imageSha256'] = digest
            except (OSError, ValueError):
                # A thumbnail is optional; document opening remains available.
                summary['thumbnailError'] = 'Saved preview could not be cached'
        return summary

    def thumbnail(self, root, name, version):
        entry = self.entry(root, name)
        digest = (entry.get('capture') or {}).get('imageSha256')
        if entry['metadata'] != 'complete' or digest != version or not isinstance(digest, str) or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
            raise FileNotFoundError('Saved preview is unavailable or changed')
        return (self.cache_dir / (digest + '.png')).read_bytes()

    def remember(self, path, document, written_stat):
        path = Path(path).resolve()
        try:
            identity = _stat_identity(written_stat)
            if _identity(path) == identity:
                self._write(path, identity, self.summarize(document))
        except (OSError, ValueError, RuntimeError):
            pass

    def entry(self, root, name, *, hydrate=False):
        if hydrate:
            with self._hydration_lock:
                return self._entry(root, name, hydrate=True)
        return self._entry(root, name)

    def _entry(self, root, name, *, hydrate=False):
        root = Path(root).resolve()
        entry = {'name': name, 'label': '', 'timestamp': '', 'metadata': 'pending'}
        try:
            path = (root / name).resolve()
            if not path.is_relative_to(root) or not path.is_file():
                raise ValueError('Scene is outside its store or is not a file')
            identity = _identity(path)
            try:
                cached = json.loads(self._cache_path(path).read_text())
                if cached.get('version') == 2 and cached.get('identity') == identity:
                    summary = cached['summary']
                    if isinstance(summary, dict) and isinstance(summary.get('label'), str) and isinstance(summary.get('timestamp'), str):
                        return {**entry, **summary, 'metadata': 'error' if 'error' in summary else 'complete'}
            except (OSError, ValueError, TypeError, KeyError, AttributeError):
                pass
            if not hydrate:
                return entry
            try:
                summary = self.summarize(json.loads(path.read_text()))
            except (ValueError, UnicodeError) as error:
                summary = {'label': '', 'timestamp': '', 'error': str(error)}
            if _identity(path) != identity:
                return entry  # concurrent replacement: never publish stale labels
            self._write(path, identity, summary)
            return {**entry, **summary, 'metadata': 'error' if 'error' in summary else 'complete'}
        except (OSError, ValueError, RuntimeError) as error:
            return {**entry, 'metadata': 'error', 'error': str(error)}

    def list(self, root, *, hydrate=False):
        return [self.entry(root, path.name, hydrate=hydrate)
                for path in sorted(Path(root).glob('*.kaminos.json'))]
