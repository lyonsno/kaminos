"""Rendered basin covers kept beside immutable settings, keyed by preset id."""
import base64
import binascii
import copy
import fcntl
import hashlib
import json
import math
import os
import re
import struct
import tempfile
import zlib
from pathlib import Path

SCHEMA = 'kaminos.basin-cover.v1'

def checked_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'vsp-[0-9a-f]{64}', value):
        raise ValueError('Cover requires an immutable basin id')
    return value

def validate_portrait(portrait):
    if not isinstance(portrait, dict) or portrait.get('schema') != 'kaminos.flame-portrait.v1':
        raise ValueError('Cover requires a flame portrait')
    if portrait.get('framing') != 'domain-front-v1' or portrait.get('origin') not in ('current-field', 'backfill'):
        raise ValueError('Cover framing or source is unsupported')
    simulation = portrait.get('simulation') or {}
    if not isinstance(simulation, dict):
        raise ValueError('Cover simulation receipt is invalid')
    steps = simulation.get('simStepCount')
    if not isinstance(steps, (int, float)) or isinstance(steps, bool) or not math.isfinite(steps) or steps <= 0:
        raise ValueError('Cover requires an evolved field')
    camera = portrait.get('camera') or {}
    if not isinstance(camera, dict):
        raise ValueError('Cover camera receipt is invalid')
    if any(not isinstance(camera.get(key), list) or len(camera[key]) != 3 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in camera[key]) for key in ('position', 'target', 'up')):
        raise ValueError('Cover requires its effective camera')
    if not isinstance(camera.get('fov'), (int, float)) or not 0 < camera['fov'] < 180:
        raise ValueError('Cover camera field of view is invalid')
    image = portrait.get('image')
    if not isinstance(image, str) or not image.startswith('data:image/png;base64,'):
        raise ValueError('Cover image must be a PNG data URL')
    try:
        data = base64.b64decode(image.split(',', 1)[1], validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError('Cover PNG encoding is invalid') from error
    if not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Cover PNG header is invalid')
    position, dimensions, ended = 8, None, False
    while position < len(data):
        if position + 12 > len(data):
            raise ValueError('Cover PNG is incomplete')
        length = struct.unpack('>I', data[position:position+4])[0]
        kind = data[position+4:position+8]
        end = position + 12 + length
        if end > len(data) or zlib.crc32(data[position+4:end-4]) & 0xffffffff != struct.unpack('>I', data[end-4:end])[0]:
            raise ValueError('Cover PNG is incomplete or corrupt')
        if kind == b'IHDR':
            if position != 8 or length != 13:
                raise ValueError('Cover PNG dimensions are invalid')
            dimensions = struct.unpack('>II', data[position+8:position+16])
        if kind == b'IEND':
            ended = True
            if length or end != len(data):
                raise ValueError('Cover PNG ending is invalid')
        position = end
    if not ended or dimensions != (portrait.get('width'), portrait.get('height')) or not all(dimensions):
        raise ValueError('Cover PNG dimensions differ from its capture')
    if not isinstance(portrait.get('capturedAt'), str) or not portrait['capturedAt']:
        raise ValueError('Cover capture time is missing')
    return data

def _atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='cover-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def write_cover(store, preset_id, portrait, source):
    preset_id = checked_id(preset_id)
    store = Path(store)
    if not (store / 'presets' / f'{preset_id}.json').is_file():
        raise FileNotFoundError('Cover basin is not present in this store')
    data = validate_portrait(portrait)
    digest = hashlib.sha256(data).hexdigest()
    metadata = {key: copy.deepcopy(value) for key, value in portrait.items() if key != 'image'}
    document = {'schema': SCHEMA, 'presetId': preset_id, 'imageHash': f'sha256:{digest}', 'portrait': metadata, 'source': dict(source or {})}
    directory = store / 'covers' / preset_id
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / '.lock').open('a+b') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        image = directory / f'{digest}.png'
        if not image.exists():
            _atomic(image, data)
        _atomic(directory / 'current.json', json.dumps(document, sort_keys=True, indent=2).encode())
    return document

def read_cover(layers, preset_id, *, include_image=False):
    preset_id = checked_id(preset_id)
    for role, store in sorted(layers, key=lambda item: 0 if item[0] == 'shared' else 1):
        directory = Path(store) / 'covers' / preset_id
        path = directory / 'current.json'
        if not path.is_file():
            continue
        document = json.loads(path.read_text())
        if not isinstance(document, dict) or document.get('schema') != SCHEMA or document.get('presetId') != preset_id or not isinstance(document.get('imageHash'), str) or not re.fullmatch(r'sha256:[0-9a-f]{64}', document['imageHash']):
            raise ValueError('Basin cover identity is invalid')
        if not isinstance(document.get('portrait'), dict):
            raise ValueError('Basin cover portrait metadata is invalid')
        digest = document['imageHash'][7:]
        image_path = directory / f'{digest}.png'
        if not image_path.is_file():
            raise ValueError('Basin cover image is missing')
        document['storeRole'] = role
        document['imageUrl'] = f'/api/volume-settings-preset-cover-image?id={preset_id}&hash={digest}'
        if include_image:
            data = image_path.read_bytes()
            if hashlib.sha256(data).hexdigest() != digest:
                raise ValueError('Basin cover image hash differs')
            document['portrait']['image'] = 'data:image/png;base64,' + base64.b64encode(data).decode()
            validate_portrait(document['portrait'])
        return document
    return None

def read_cover_image(layers, preset_id, digest):
    checked_id(preset_id)
    if not isinstance(digest, str) or not re.fullmatch(r'[0-9a-f]{64}', digest):
        raise ValueError('Cover image hash is invalid')
    for role, store in sorted(layers, key=lambda item: 0 if item[0] == 'shared' else 1):
        path = Path(store) / 'covers' / preset_id / f'{digest}.png'
        if path.is_file():
            data = path.read_bytes()
            if hashlib.sha256(data).hexdigest() != digest:
                raise ValueError('Basin cover image hash differs')
            return data
    raise FileNotFoundError('Basin cover image is missing')
