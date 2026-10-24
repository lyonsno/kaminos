"""Prepare the pinned MobRecon package using NumPy/SciPy, without model inference.

Only the exact released checkpoint and transform hashes are accepted. The Torch
archive reader supports their observed four pickle globals, not arbitrary .pt
files. Topology iteration follows OpenMesh 1.2.1's clockwise halfedge order.
"""
import collections
import hashlib
import io
import json
from pathlib import Path
import pickle
import zipfile

import numpy as np

CHECKPOINT_SHA256 = '2b634114dadb324802c9e55a8b7a9236f0e7b476157ac0b175f0eb258d9d276c'
TRANSFORM_SHA256 = '78877f06e9858bedd5fbca13692ccee25cfe09b6314e7ee3b3d0827c39979f3c'
SOURCE_REVISION = '3c87e958d4855f890e3884ec94bcfc0f99422c3d'


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def require_hash(path, expected):
    actual = digest(path)
    if actual != expected:
        raise ValueError(f'{Path(path).name}: SHA-256 {actual} does not match {expected}')


def checkpoint_arrays(path):
    require_hash(path, CHECKPOINT_SHA256)

    def tensor(storage, offset, shape, stride, *_):
        return np.ndarray(tuple(shape), dtype=storage.dtype, buffer=storage,
                          offset=offset * storage.dtype.itemsize,
                          strides=tuple(n * storage.dtype.itemsize for n in stride))

    class Reader(pickle.Unpickler):
        def find_class(self, module, name):
            allowed = {('collections', 'OrderedDict'): collections.OrderedDict,
                       ('torch', 'FloatStorage'): np.dtype('<f4'),
                       ('torch', 'LongStorage'): np.dtype('<i8'),
                       ('torch._utils', '_rebuild_tensor_v2'): tensor}
            if (module, name) not in allowed:
                raise ValueError(f'Unsupported checkpoint object: {module}.{name}')
            return allowed[module, name]

        def persistent_load(self, value):
            kind, dtype, key, location, size = value
            if kind != 'storage' or location != 'cpu':
                raise ValueError(f'Unsupported checkpoint storage {kind}/{location}')
            data = archive.read(prefix + 'data/' + key)
            if len(data) != size * dtype.itemsize:
                raise ValueError('Checkpoint storage size mismatch')
            return np.frombuffer(data, dtype=dtype)

    with zipfile.ZipFile(path) as archive:
        member = next(n for n in archive.namelist() if n.endswith('/data.pkl'))
        prefix = member[:-len('data.pkl')]
        return Reader(io.BytesIO(archive.read(member))).load()


def clockwise_neighbors(faces, count):
    """OpenMesh PolyConnectivity add_face/cvoh ordering, for manifold triangles.

    Algorithm provenance: OpenMesh 1.2.1 PolyConnectivity.cc and CirculatorsT.hh;
    see OPENMESH-LICENSE.txt for the upstream BSD notice.
    """
    nxt, prev, used, outgoing, edges = {}, {}, set(), [None] * count, set()
    opposite = lambda h: (h[1], h[0])

    def ring(v):
        start = outgoing[v]
        if start is None:
            return []
        current, result = start, []
        while True:
            result.append(current)
            current = nxt[opposite(current)]
            if current == start:
                return result
            if current in result:
                raise ValueError('Nonmanifold topology circulation')

    for face in faces:
        vertices = [int(v) for v in face]
        inner = [(vertices[i], vertices[(i + 1) % 3]) for i in range(3)]
        new = [h not in edges for h in inner]
        cache, adjust = [], []
        if any(not fresh and h in used for h, fresh in zip(inner, new)):
            raise ValueError('Nonmanifold topology edge')
        for i in range(3):
            j = (i + 1) % 3
            a, b = inner[i], inner[j]
            if not new[i] and not new[j] and nxt[a] != b:
                boundary = opposite(b)
                while True:
                    boundary = opposite(nxt[boundary])
                    if boundary not in used:
                        break
                if boundary == a:
                    raise ValueError('Topology patch relink failed')
                cache.extend([(boundary, nxt[a]), (prev[b], nxt[boundary]), (a, b)])
        for h in inner:
            edges.update([h, opposite(h)])
        for i in range(3):
            j = (i + 1) % 3
            a, b, v = inner[i], inner[j], vertices[j]
            mode = int(new[i]) + 2 * int(new[j])
            if mode == 1:
                cache.append((prev[b], opposite(a)))
                outgoing[v] = opposite(a)
            elif mode == 2:
                cache.append((opposite(b), nxt[a]))
                outgoing[v] = nxt[a]
            elif mode == 3:
                if outgoing[v] is None:
                    outgoing[v] = opposite(a)
                    cache.append((opposite(b), opposite(a)))
                else:
                    boundary = outgoing[v]
                    cache.extend([(prev[boundary], opposite(a)), (opposite(b), boundary)])
            elif outgoing[v] == b:
                adjust.append(v)
            if mode:
                cache.append((a, b))
            used.add(a)
        for a, b in cache:
            nxt[a], prev[b] = b, a
        for v in adjust:
            for h in ring(v):
                if h not in used:
                    outgoing[v] = h
                    break
    return [[h[1] for h in ring(v)] for v in range(count)]


def spirals_for(faces, vertices):
    neighbors = clockwise_neighbors(faces, len(vertices))

    def next_ring(last, other):
        result = []
        for v in last:
            after = False
            for candidate in neighbors[v]:
                if after and candidate not in last and candidate not in other and candidate not in result:
                    result.append(candidate)
                if candidate in last:
                    after = True
            for candidate in neighbors[v]:
                if candidate in last:
                    break
                if candidate not in last and candidate not in other and candidate not in result:
                    result.append(candidate)
        return result

    rows = []
    for v, one_ring in enumerate(neighbors):
        spiral, last = [v], list(one_ring)
        following = next_ring(last, spiral)
        spiral.extend(last)
        while len(spiral) + len(following) < 9:
            if not following:
                break
            last = following
            following = next_ring(last, spiral)
            spiral.extend(last)
        if following:
            spiral.extend(following)
        else:
            # The released topology should not need the upstream KDTree path.
            # Do not quietly substitute an independently ordered nearest set.
            raise ValueError(f'Pinned topology unexpectedly needs KDTree at vertex {v}')
        rows.append(spiral[:9])
    return np.asarray(rows, dtype='<i4')


def prepare(checkpoint, transform, shapes, out):
    require_hash(transform, TRANSFORM_SHA256)
    state = checkpoint_arrays(checkpoint)
    state = state.get('model_state_dict', state)
    with Path(transform).open('rb') as stream:
        topology = pickle.load(stream, encoding='latin1')
    tensors = {}
    for level in range(4):
        tensors[f'topology.spiral.{level}'] = spirals_for(topology['face'][level], topology['vertices'][level])
    for level, matrix in enumerate(topology['up_transform']):
        matrix = matrix.tocoo()
        order = np.lexsort((np.arange(len(matrix.row)), matrix.row))
        count = matrix.shape[0]
        if not np.array_equal(np.bincount(matrix.row, minlength=count), np.full(count, 3)):
            raise ValueError('Unexpected upsampling structure')
        tensors[f'topology.up.{level}.index'] = matrix.col[order].reshape(count, 3).astype('<i4')
        tensors[f'topology.up.{level}.weight'] = matrix.data[order].reshape(count, 3).astype('<f4')
    tensors['topology.faces'] = np.asarray(topology['face'][0], dtype='<u4')
    rows = json.loads(Path(shapes).read_text())['tensors']
    for row in rows:
        name = row['name']
        if name in tensors:
            continue
        if name == 'decoder3d.upsample':
            tensors[name] = state[name]
            continue
        stem, parameter = name.rsplit('.', 1)
        if stem + '.layer.' + parameter in state:
            tensors[name] = state[stem + '.layer.' + parameter]
            continue
        source = stem + '.0.weight'
        weight = state[source].astype(np.float64)
        bias = state.get(stem + '.0.bias')
        bias = bias.astype(np.float64) if bias is not None else None
        norm = stem + '.1.'
        if norm + 'running_var' in state:
            scale = state[norm + 'weight'].astype(np.float64) / np.sqrt(state[norm + 'running_var'].astype(np.float64) + 1e-5)
            shift = state[norm + 'bias'].astype(np.float64) - state[norm + 'running_mean'].astype(np.float64) * scale
            if bias is not None:
                shift += bias * scale
            weight = weight * scale.reshape(-1, *([1] * (weight.ndim - 1)))
            bias = shift
        value = weight if parameter == 'weight' else bias
        if value is None:
            raise ValueError(f'Missing bias for {name}')
        tensors[name] = value.astype('<f4')
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    offset, packed = 0, []
    with (out / 'mobrecon.bin').open('wb') as stream:
        for row in rows:
            value = np.ascontiguousarray(tensors[row['name']])
            if list(value.shape) != row['shape'] or value.dtype.name != {'f32': 'float32', 'i32': 'int32', 'u32': 'uint32'}[row['dtype']]:
                raise ValueError(f'Unexpected tensor contract: {row["name"]}')
            stream.seek(offset)
            stream.write(value.tobytes())
            packed.append({**row, 'byteOffset': offset, 'byteLength': value.nbytes})
            offset = (offset + value.nbytes + 255) // 256 * 256
        stream.truncate(offset)
    revision = f'SeanChenxy/HandMesh@{SOURCE_REVISION[:8]}:{CHECKPOINT_SHA256[:16]}:f32-bn-folded'
    manifest = {'modelId': 'mobrecon.densestack-spiralconv', 'revision': revision,
                'bundle': {'byteLength': offset, 'sha256': digest(out / 'mobrecon.bin')},
                'allocations': [{'allocationId': 'mobrecon.0', 'byteOffset': 0, 'byteLength': offset, 'usage': 140, 'tensors': packed}]}
    package = {'schema': 'mobrecon.browser-weight-package.v0', 'status': 'succeeded', 'revision': revision, 'dtype': 'f32',
               'provenance': {'sourceRevision': SOURCE_REVISION, 'checkpointSha256': CHECKPOINT_SHA256, 'transformSha256': TRANSFORM_SHA256,
                              'preparation': 'numpy-scipy-no-framework-no-inference'},
               'resources': [{'resourceId': 'mobrecon', 'file': 'mobrecon.bin', 'manifest': manifest}]}
    (out / 'package.json').write_text(json.dumps(package, indent=2) + '\n')
    return package
