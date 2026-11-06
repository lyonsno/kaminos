"""Cheap, read-only coverage of the current stored-mesh preparation recipe."""
import io
import json
from pathlib import Path
import struct

PROFILE = 'surface-detail-v1'
SHARED_ROUTE = 'closed-remesh+projection+trellis-simplify'
BEAUTY_ROUTE = 'trellis-simplify+pairing'
TARGETS = {25000, 10000, 5000, 1000, 500}


def source_description(source):
    """Read GLB JSON and PNG headers, without decoding images or geometry."""
    stream = io.BytesIO(source) if isinstance(source, (bytes, bytearray, memoryview)) else Path(source).open('rb')
    with stream as f:
        f.seek(0, 2); length = f.tell(); f.seek(0)
        header = f.read(20)
        if len(header) != 20 or header[:4] != b'glTF' or struct.unpack_from('<II', header, 4) != (2, length):
            raise ValueError('Incomplete binary glTF 2.0 source')
        size, kind = struct.unpack_from('<II', header, 12)
        if kind != 0x4e4f534a or size > length - 20:
            raise ValueError('Invalid GLB document')
        doc = json.loads(f.read(size))
        binary = 28 + size
        faces = 0
        nodes = doc.get('nodes', [])
        # Same node ownership as glbNodeWorldMatrices: each mesh-bearing node
        # contributes its primitives, including repeated uses of a mesh.
        mesh_ids = [n['mesh'] for n in nodes if 'mesh' in n] if nodes else range(len(doc.get('meshes', [])))
        for index in mesh_ids:
            for primitive in doc['meshes'][index].get('primitives', []):
                if primitive.get('mode', 4) != 4:
                    raise ValueError('Only triangle mesh preparation is supported')
                accessor = primitive.get('indices', primitive.get('attributes', {}).get('POSITION'))
                accessors = doc.get('accessors', [])
                if accessor is None or accessor >= len(accessors):
                    faces = None
                    break
                if faces is not None:
                    faces += accessors[accessor]['count'] // 3
        sizes = []
        for image in doc.get('images', []):
            if image.get('mimeType') != 'image/png' or 'bufferView' not in image:
                raise ValueError('Appearance preparation requires embedded PNG images')
            view = doc['bufferViews'][image['bufferView']]
            if view.get('buffer', 0) != 0 or view['byteLength'] < 24 or binary + view.get('byteOffset', 0) + view['byteLength'] > length:
                raise ValueError('Appearance image is outside the embedded GLB buffer')
            f.seek(binary + view.get('byteOffset', 0)); png = f.read(24)
            if len(png) != 24 or png[:8] != b'\x89PNG\r\n\x1a\n':
                raise ValueError('Appearance image is not PNG')
            width, height = struct.unpack_from('>II', png, 16)
            if not width or not height:
                raise ValueError('Appearance image has empty dimensions')
            sizes.append(max(width, height))
        pyramid = [max(sizes)] if sizes else []
        while pyramid and pyramid[-1] > 256:
            pyramid.append(max(256, pyramid[-1] // 2))
        return {'sourceFaces': faces, 'textureSizes': pyramid}


def preparation_status(record, description):
    shared = [r for r in record['levels'] if r.get('route') == SHARED_ROUTE]
    legacy_complete = len(shared) >= len(TARGETS) and all('targetFaces' not in r for r in shared)
    missing = sorted(TARGETS - {r.get('targetFaces', r['faces']) for r in shared}, reverse=True) if not legacy_complete else []
    beauty = record.get('beautyLevels', [])
    missing_beauty = ([100000] if (description['sourceFaces'] is None or description['sourceFaces'] > 100000)
                      and not any(r.get('route') == BEAUTY_ROUTE and r.get('targetFaces', r['faces']) == 100000 for r in beauty) else [])
    geometry = [record['source']] + [r['sha256'] for r in record['levels'] + beauty
                                   if not r.get('mergeFactor') and not r.get('representation') and not str(r.get('route', '')).startswith('trellis-surfels')]
    appearance = []
    for sha in dict.fromkeys(geometry):
        registered = record.get('textureSets', {}).get(sha, {}).get('variants', [])
        needed = [size for size in description['textureSizes'] if not any(v.get('textureSize') == size for v in registered)]
        if needed:
            appearance.append({'geometry': sha, 'sizes': needed})
    return {'schema': 'kaminos.mesh-preparation.v1', 'profile': PROFILE, 'source': record['source'],
            **description, 'missingSharedTargets': missing, 'missingBeautyTargets': missing_beauty,
            'missingAppearance': appearance, 'complete': not (missing or missing_beauty or appearance)}
