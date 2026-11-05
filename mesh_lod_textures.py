"""Append compatible appearance products to a stored geometry's level set."""
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import struct
import tempfile

SCHEMA = 'kaminos.lod-textures.v1'
SHA = re.compile(r'[0-9a-f]{64}')


def valid_relative_error(error):
    relative = error.get('relative') if isinstance(error, dict) else None
    try:
        return isinstance(relative, dict) and all(type(relative.get(k)) in (int, float)
            and math.isfinite(relative[k]) and relative[k] >= 0 for k in ('max', 'p95', 'mean'))
    except OverflowError:
        return False


def validate_beauty_catalog(record):
    """Validate the restricted identity/selection fields before using a sidecar."""
    levels = record.get('beautyLevels', [])
    if not isinstance(levels, list):
        raise ValueError('Invalid beauty catalog: expected a list')
    for level in levels:
        if (not isinstance(level, dict) or level.get('purpose') != 'beauty'
                or not isinstance(level.get('sha256'), str) or not SHA.fullmatch(level['sha256'])
                or type(level.get('faces')) is not int or level['faces'] < 1
                or not isinstance(level.get('route'), str) or not level['route']):
            raise ValueError('Invalid beauty level: digest, positive faces, route and beauty purpose required')
        for field in ('targetFaces', 'textureSize', 'mergeFactor'):
            if field in level and (type(level[field]) is not int or level[field] < 1):
                raise ValueError('Invalid beauty level: ' + field + ' must be a positive integer')
        if 'error' in level and not valid_relative_error(level['error']):
            raise ValueError('Invalid beauty level: finite non-negative relative error required')


def _document(data):
    if len(data) < 20 or data[:4] != b'glTF' or struct.unpack_from('<I', data, 4)[0] != 2:
        raise ValueError('Appearance needs a binary glTF 2.0 file')
    length = struct.unpack_from('<I', data, 8)[0]
    if length != len(data):
        raise ValueError('Incomplete appearance GLB')
    offset, doc, binary = 12, None, b''
    while offset + 8 <= length:
        size, kind = struct.unpack_from('<II', data, offset)
        chunk = data[offset + 8:offset + 8 + size]
        if len(chunk) != size:
            raise ValueError('Incomplete appearance GLB chunk')
        if kind == 0x4e4f534a:
            doc = json.loads(chunk)
        elif kind == 0x004e4942:
            binary = chunk
        offset += 8 + size
    if doc is None:
        raise ValueError('Appearance GLB has no document')
    return doc, binary


def _geometry(doc, binary):
    # All accessor payloads and their layouts, not just positions/face counts.
    accessors = []
    for accessor in doc.get('accessors', []):
        if accessor.get('sparse') or 'bufferView' not in accessor:
            raise ValueError('Appearance needs embedded nonsparse geometry')
        view = doc['bufferViews'][accessor['bufferView']]
        start, size = view.get('byteOffset', 0), view['byteLength']
        if view.get('buffer') != 0 or start + size > len(binary):
            raise ValueError('Appearance accessor is outside the embedded buffer')
        accessors.append(({k: v for k, v in accessor.items() if k != 'bufferView'},
                          view.get('byteStride'), binary[start:start + size]))
    return ({k: doc.get(k) for k in ('scene', 'scenes', 'nodes', 'meshes', 'skins', 'animations', 'materials', 'textures', 'samplers')}, accessors)


def _texture_info(doc, binary):
    dimensions, gpu_bytes = [], 0
    for image in doc.get('images', []):
        view = doc['bufferViews'][image['bufferView']]
        start = view.get('byteOffset', 0)
        image_bytes = binary[start:start + view['byteLength']]
        if image.get('mimeType') != 'image/png' or image_bytes[:8] != b'\x89PNG\r\n\x1a\n' or len(image_bytes) < 24:
            raise ValueError('Appearance currently requires embedded PNG textures')
        w, h = struct.unpack_from('>II', image_bytes, 16)
        if w < 1 or h < 1:
            raise ValueError('Empty appearance texture')
        dimensions.append((w, h))
        while True:
            gpu_bytes += 4 * w * h
            if w == h == 1:
                break
            w, h = max(1, w // 2), max(1, h // 2)
    if not dimensions:
        raise ValueError('Appearance has no texture images')
    return max(max(d) for d in dimensions), gpu_bytes


def save_texture_set(payload, *, root, resolve_mesh, resolve_source):
    if not isinstance(payload, dict):
        raise ValueError('Appearance registration needs an object')
    source = resolve_source(payload.get('source'))
    geometry = payload.get('geometry')
    variants = payload.get('variants')
    if not isinstance(geometry, str) or not SHA.fullmatch(geometry) or not isinstance(variants, list) or not variants:
        raise ValueError('Stored geometry and nonempty appearance variants required')
    root = Path(root).resolve()
    def read(sha):
        path = resolve_mesh(root, sha)
        if not path:
            raise ValueError('Appearance mesh not stored: ' + sha)
        data = Path(path).read_bytes()
        if hashlib.sha256(data).hexdigest() != sha:
            raise ValueError('Appearance content identity mismatch: ' + sha)
        return _document(data)
    base_doc, base_bin = read(geometry)
    expected = _geometry(base_doc, base_bin)
    checked = []
    for item in variants:
        sha = item.get('sha256') if isinstance(item, dict) else None
        if not isinstance(sha, str) or not SHA.fullmatch(sha):
            raise ValueError('Appearance sha256 required')
        doc, binary = read(sha)
        if _geometry(doc, binary) != expected:
            raise ValueError('Appearance changed geometry, placement, UVs or material bindings')
        size, gpu_bytes = _texture_info(doc, binary)
        if type(item.get('textureSize')) is not int or item['textureSize'] != size or type(item.get('gpuBytes')) is not int or item['gpuBytes'] != gpu_bytes:
            raise ValueError('Appearance dimensions or mip-chain byte cost disagree with the GLB')
        density = item.get('relativeTexelSize')
        if type(density) not in (int, float) or not math.isfinite(density) or density <= 0:
            raise ValueError('Positive finite appearance texel density required')
        checked.append(dict(item))
    path = root / ('.' + source + '.glb.lods.json')
    with (root / ('.' + source + '.lods.lock')).open('a+b') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        record = json.loads(path.read_text()) if path.exists() else {'schema': 'kaminos.lod-set.v0', 'source': source, 'levels': []}
        validate_beauty_catalog(record)
        if geometry != source and not any(l.get('sha256') == geometry for l in record['levels'] + record.get('beautyLevels', [])):
            raise ValueError('Appearance geometry is not a current level of this source')
        previous = record.setdefault('textureSets', {}).get(geometry)
        merged = {v['textureSize']: v for v in (previous or {}).get('variants', [])}
        for item in checked:
            old = merged.get(item['textureSize'])
            if old and old != item and payload.get('supersede') is not True:
                raise ValueError('Appearance resolution already registered; explicit supersede required')
            if old and old != item:
                record.setdefault('retiredTextureVariants', []).append({'geometry': geometry, **old})
            merged[item['textureSize']] = item
        texture_set = {'schema': SCHEMA, 'geometry': geometry, 'variants': sorted(merged.values(), key=lambda v: -v['textureSize'])}
        record['textureSets'][geometry] = texture_set
        with tempfile.NamedTemporaryFile(mode='w', dir=root, prefix='.mesh-lod-textures-', delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(record, handle)
        try:
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
    return {'source': source, 'geometry': geometry, 'textureSet': texture_set}
