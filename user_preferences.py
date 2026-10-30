"""One server-owned user preference document, shared by local Kaminos ports."""
from contextlib import contextmanager
from pathlib import Path
import fcntl
import hashlib
import json
import os
import tempfile

SCHEMA = 'kaminos.preferences.v1'

class PreferencesConflict(ValueError):
    pass

def preferences_path():
    return Path(os.environ.get('KAMINOS_PREFERENCES_PATH', '~/.config/kaminos/preferences.json')).expanduser().resolve()

def validate_preferences(value):
    if not isinstance(value, dict) or value.get('schema') != SCHEMA:
        raise ValueError('Unsupported preferences document')
    if value.get('navigationInput') not in (None, 'trackpad', 'mouse'):
        raise ValueError('Invalid navigation preference')
    if 'startupConfigured' in value and not isinstance(value['startupConfigured'], bool):
        raise ValueError('Invalid startup preference state')
    kiln = value.get('inferenceKiln')
    if kiln is not None:
        if not isinstance(kiln, dict) or kiln.get('schema') != 'kaminos.inference-kiln-selection.v1':
            raise ValueError('Invalid kiln selection')
        name = kiln.get('sceneFile')
        if not isinstance(name, str) or not name.endswith('.kaminos.json') or '/' in name or chr(92) in name:
            raise ValueError('Choose a saved kiln scene')
        if not isinstance(kiln.get('promptObjectId'), str) or not kiln['promptObjectId'].strip():
            raise ValueError('Choose the kiln prompt lettering')
    defaults = value.get('sceneDefaults')
    if defaults is not None and not isinstance(defaults, dict):
        raise ValueError('Scene defaults must be a settings object')
    if defaults and any(key in defaults for key in ('objects','groups','composition','localLiquid','selectionIds','activeObjectId','activeFieldId','sceneId','cameraViews','volumePrimitives')):
        raise ValueError('Scene defaults contain scene membership or simulation identity')
    # Reject NaN/Infinity instead of producing a document the browser cannot read.
    json.dumps(value, allow_nan=False)
    return value

@contextmanager
def locked(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.with_name(path.name + '.lock').open('a') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield

def _read(path):
    if not path.exists():
        return {'schema': SCHEMA, 'sceneDefaults': None, 'navigationInput': None}, None
    data = path.read_bytes()
    return validate_preferences(json.loads(data)), hashlib.sha256(data).hexdigest()

def read_preferences(path=None):
    path = preferences_path() if path is None else Path(path)
    with locked(path):
        value, revision = _read(path)
    return {'preferences': value, 'revision': revision, 'storePath': str(path)}

def write_preferences(value, expected_revision, path=None):
    value = validate_preferences(value)
    path = preferences_path() if path is None else Path(path)
    with locked(path):
        _, revision = _read(path)
        if revision != expected_revision:
            raise PreferencesConflict('Preferences changed in another window. Reopen Preferences before saving.')
        data = (json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + '\n').encode()
        descriptor, name = tempfile.mkstemp(prefix=path.name + '.', dir=path.parent)
        try:
            with os.fdopen(descriptor, 'wb') as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(name, path)
        finally:
            if os.path.exists(name):
                os.unlink(name)
    return {'preferences': value, 'revision': hashlib.sha256(data).hexdigest(), 'storePath': str(path)}
