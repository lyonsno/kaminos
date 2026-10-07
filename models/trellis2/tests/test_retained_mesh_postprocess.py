"""Observed CPU-source conformance and refusal reporting; no model/GPU calls."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
import trimesh

SOURCE = Path(sys.argv[1]).resolve()
EXPECTED = sys.argv[2]
OUT = Path(sys.argv[3]).resolve()
OUT.mkdir(parents=True, exist_ok=True)
RUNNER = Path(__file__).resolve().parents[1] / 'postprocess-retained-mesh.py'
mesh = trimesh.creation.icosphere(subdivisions=2)
vertices = np.asarray(mesh.vertices, dtype='<f4')
faces = np.asarray(mesh.faces, dtype='<u4')


def descriptor(name, values, dtype):
    data = values.tobytes()
    (OUT / name).write_bytes(data)
    return {'file': name, 'shape': list(values.shape), 'dtype': dtype,
            'byteLength': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


manifest = {'schema': 'trellis2.raw-mesh-input.v0',
            'vertices': descriptor('input-vertices.f32', vertices, 'float32'),
            'triangles': descriptor('input-faces.u32', faces, 'uint32'), 'futureAdditiveMetadata': True}
input_path = OUT / 'input.json'
input_path.write_text(json.dumps(manifest))


def run(label, expected=EXPECTED):
    output = OUT / label
    result = subprocess.run([sys.executable, str(RUNNER), '--source-root', str(SOURCE),
        '--expected-source-commit', expected, '--input', str(input_path), '--output', str(output),
        '--target-faces', '100'], capture_output=True, text=True)
    report = json.loads((output / 'report.json').read_text())
    return result, report


result, report = run('actual-source')
assert result.returncode == 0, result.stderr + result.stdout
assert report['status'] == 'succeeded'
assert report['modelCalls'] == 0
assert report['effectiveRoute'] == 'Trellis2MLX/reference-cleanup/CPU-fast-simplification'
assert report['inputFaces'] == 320 and 0 < report['outputFaces'] < 320
assert report['source']['commit'] == EXPECTED and report['sourceAfter']['dirty'] == ''
assert [x['operation'] for x in report['operationTrace']] == [
    'simplify_coarse', 'cleanup_initial', 'simplify_final', 'cleanup_final', 'orient_faces_by_adjacency']
for name, row in report['arrays'].items():
    data = (OUT / 'actual-source' / row['file']).read_bytes()
    assert hashlib.sha256(data).hexdigest() == row['sha256']
    assert len(data) == row['byteLength'] == row['shape'][0] * 12
result, rejected = run('wrong-source', '0' * 40)
assert result.returncode != 0
assert rejected['phase'] == 'source-admission' and rejected['status'] == 'failed'
assert 'exact clean' in rejected['error']['message']
assert not (OUT / 'wrong-source' / 'vertices.f32').exists()
for label, mutate in [('wrong-dtype', lambda m: m['vertices'].update(dtype='float64')),
                      ('partial', lambda m: m['triangles'].update(byteLength=m['triangles']['byteLength'] - 4))]:
    changed = json.loads(json.dumps(manifest))
    mutate(changed)
    input_path.write_text(json.dumps(changed))
    result, rejected = run(label)
    assert result.returncode != 0 and rejected['status'] == 'failed'
    assert rejected['phase'] == 'mesh-input-admission' and rejected['error']
    assert not (OUT / label / 'vertices.f32').exists()
print('Actual pinned CPU source finalizes a real mesh in reference order; wrong source/dtype/partial arrays leave durable refusal reports without primary output.')
