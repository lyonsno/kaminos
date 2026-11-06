"""One server-owned user preference document, shared by local Kaminos ports."""
from contextlib import contextmanager
from pathlib import Path
import fcntl
import hashlib
import json
import math
import os
import tempfile

SCHEMA = 'kaminos.preferences.v1'

class PreferencesConflict(ValueError):
    pass

def preferences_path():
    return Path(os.environ.get('KAMINOS_PREFERENCES_PATH', '~/.config/kaminos/preferences.json')).expanduser().resolve()

def _settings_object(value, label):
    if not isinstance(value, dict):
        raise ValueError(f'{label} must be a settings object')
    return value

def _numbers(value, names, *, minimum=0, positive=False, maximum=None, integer=False):
    for name in names:
        if name not in value:
            continue
        number = value[name]
        try:
            finite = not isinstance(number, bool) and isinstance(number, (int, float)) and math.isfinite(number)
        except OverflowError:
            finite = False  # JSON integers outside the consumer's numeric range.
        if (not finite or number < minimum or positive and number == minimum
                or maximum is not None and number > maximum or integer and number != int(number)):
            raise ValueError(f'Invalid preference {name}')

def _booleans(value, names):
    for name in names:
        if name in value and not isinstance(value[name], bool):
            raise ValueError(f'Invalid preference {name}')

def _choices(value, names):
    for name, choices in names.items():
        if name in value and value[name] not in choices:
            raise ValueError(f'Invalid preference {name}')

def _scene_defaults(defaults, label):
    _settings_object(defaults, label)
    if any(name in defaults for name in ('objects','groups','composition','localLiquid','selectionIds','activeObjectId','activeFieldId','sceneId','cameraViews','volumePrimitives')):
        raise ValueError(f'{label} contains scene membership or simulation identity')
    post = _settings_object(defaults.get('postprocessing', {}), 'Postprocessing')
    if 'sceneGI' in post:
        gi = _settings_object(post['sceneGI'], 'Scene GI')
        _choices(gi, {'mode': ('gtao','combined'), 'view': ('scene','ao','gi','incoming')})
        _numbers(gi, ('gain','denoise'))
        _numbers(gi, ('radius','thickness','resolutionScale'), positive=True)
        _numbers(gi, ('slices','steps'), positive=True, integer=True)
        _booleans(gi, ('temporal','temporalRefine','bounceFeedback'))
        _numbers(gi, ('temporalWeight',))
        if gi.get('temporalWeight', 0) >= 1:
            raise ValueError('Scene GI temporalWeight must be in [0, 1)')
        estimator = _settings_object(gi.get('estimator', {}), 'GI estimator')
        _numbers(estimator, ('expFactor','depthPhi','normalPhi','lumaPhi'), positive=True)
        _numbers(estimator, ('aoContrast','backfaceLighting'))
        _booleans(estimator, ('screenSpaceSampling','linearThickness','mipSampling','perspectiveReconstruction'))
    if 'ao' in post:
        ao = _settings_object(post['ao'], 'Ambient occlusion')
        _booleans(ao, ('enabled',))
        _numbers(ao, ('radius','intensity','scale','thickness','falloff','farBlend'))
    # Match the unchanged fixed-range consumers; arbitrary valid GI fractions
    # remain untouched. Unknown/additive settings are retained verbatim.
    ranges = [('backdropBrightness', defaults, .1, 2, .05)]
    if 'dof' in post:
        dof = _settings_object(post['dof'], 'Depth of field')
        ranges += [(name, dof, low, high, step) for name, low, high, step in
                   [('focus', .5, 10, .1), ('aperture', .0001, .01, .0001), ('maxblur', 0, .05, .001)]]
    for name, owner, low, high, step in ranges:
        _numbers(owner, (name,), minimum=low, maximum=high)
        if name in owner and abs((owner[name]-low)/step - round((owner[name]-low)/step)) > 1e-7:
            raise ValueError(f'Invalid preference step for {name}')
    if 'environment' in defaults:
        env = _settings_object(defaults['environment'], 'Environment')
        if not isinstance(env.get('name'), str) or not env['name']:
            raise ValueError('Choose a default environment')
        _numbers(env, ('exposure','intensity','backgroundBlur','backgroundBrightness','backgroundContrast'))
        _numbers(env, ('backgroundBlur',), maximum=1)
    if 'sceneCamera' in defaults:
        camera = _settings_object(defaults['sceneCamera'], 'Scene camera')
        aspect = camera.get('aspect')
        if not isinstance(aspect, list) or len(aspect) != 2 or camera.get('activeId') is not None:
            raise ValueError('Default output needs a positive aspect and no active scene camera')
        _numbers(dict(enumerate(aspect)), (0,1), positive=True)
    if 'camera' in defaults:
        camera = _settings_object(defaults['camera'], 'Camera')
        for name in ('position','target','up'):
            vector = camera.get(name)
            if not isinstance(vector, list) or len(vector) != 3:
                raise ValueError(f'Camera {name} needs three finite values')
            _numbers(dict(enumerate(vector)), (0,1,2), minimum=-math.inf)
        delta = [b-a for a,b in zip(camera['position'], camera['target'])]
        up = camera['up']
        cross = [delta[1]*up[2]-delta[2]*up[1],delta[2]*up[0]-delta[0]*up[2],delta[0]*up[1]-delta[1]*up[0]]
        if not any(delta) or not any(cross) or any(name not in camera for name in ('fov','near','far')):
            raise ValueError('Invalid default camera view')
        _numbers(camera, ('fov','near','far'), positive=True)
        if camera['fov'] >= 180 or camera['far'] <= camera['near']:
            raise ValueError('Invalid default camera projection')
    if 'editorDisplay' in defaults:
        display = _settings_object(defaults['editorDisplay'], 'Viewport display')
        _booleans(display, ('overlays','gizmos','outlines','bounds','helpers','bones','paths','zones','domains','emitters','hints'))
        _numbers(display, ('outlineWidth','domainWidth','emitterWidth'), positive=True)
        _numbers(display, ('outlineOpacity','domainOpacity','emitterOpacity'), maximum=1)
        _choices(display, {'shading': ('solid','wireframe'), 'water': ('full','proxy'), 'fire': ('full','proxy'), 'quality': ('full','preview')})
        if 'hiddenIds' in display and display['hiddenIds'] != []:
            raise ValueError('Default display cannot refer to hidden scene objects')

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
    for key in ('sceneDefaults', 'agentSceneDefaults'):
        defaults = value.get(key)
        if defaults is not None:
            _scene_defaults(defaults, key)
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
