# kaminos-test: manual — needs the exact observed MLX source and its CPU packages.
"""Replay the accepted MLX attached-surface contract through our actual CLI."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import numpy as np

source, expected, out = Path(sys.argv[1]).resolve(), sys.argv[2], Path(sys.argv[3]).resolve()
out.mkdir(parents=True, exist_ok=True)
runner = Path(__file__).resolve().parents[1] / 'postprocess-retained-mesh.py'
# Source1201553 tests/test_mesh_cleanup.py::_make_fine_surface_and_debris.
# This reproduces the established split-then-delete mechanism, not a new
# visual-quality oracle. The four connected faces survive; detached debris does not.
v = np.array([[0,0,0],[.01,0,0],[0,.0012,0],[0,-.0012,0],[0,0,.0012],
              [-.001,0,0],[1,0,0],[1.001,0,0],[1,.001,0]], dtype='<f4')
f = np.array([[0,1,2],[1,0,3],[0,1,4],[0,2,5],[6,7,8]], dtype='<u4')
def descriptor(name, values, dtype):
    data = values.tobytes()
    (out/name).write_bytes(data)
    return dict(file=name, shape=list(values.shape), dtype=dtype,
                byteLength=len(data), sha256=hashlib.sha256(data).hexdigest())
manifest = dict(schema='trellis2.raw-mesh-input.v0',
                vertices=descriptor('input.f32', v, 'float32'),
                triangles=descriptor('input.u32', f, 'uint32'))
input_path = out/'input.json'
input_path.write_text(json.dumps(manifest))
result = subprocess.run([sys.executable, '-B', str(runner), '--source-root', str(source),
    '--expected-source-commit', expected, '--input', str(input_path), '--output', str(out/'result'),
    '--target-faces', '100', '--cleanup-mode', 'mlx-surface-preserving'], capture_output=True, text=True)
assert result.returncode == 0, 'accepted MLX finishing selection failed: ' + result.stderr + result.stdout
r = json.loads((out/'result/report.json').read_text())
assert r['modelCalls'] == 0 and r['source']['commit'] == expected
assert r['effectiveRoute'] == 'Trellis2MLX/surface-preserving/CPU-fast-simplify-first'
assert r['settings'] == dict(referenceCleanup=False, simplifyFirst=True, qemSimplify=False,
                            holeFill=True, preserveSurfaceParts=True)
def read(name, dtype):
    row = r['arrays'][name]
    data = (out/'result'/row['file']).read_bytes()
    assert hashlib.sha256(data).hexdigest() == row['sha256']
    return np.frombuffer(data, dtype=dtype).reshape(row['shape'])
ov, of = read('vertices','<f4'), read('triangles','<u4')
def triangles(vertices, faces):
    return {tuple(sorted(map(tuple, t))) for t in vertices[faces]}
assert triangles(v, f[:4]) <= triangles(ov, of), 'attached detail deleted'
assert not triangles(v, f[4:]) & triangles(ov, of), 'detached debris retained'
print('Actual accepted MLX source preserves connected detail, removes debris and reports the selected finishing route without inference.')
for mode in ['unknown-mode', 'mlx-surface-preserving']:
    bad_source = mode == 'mlx-surface-preserving'
    bad_out = out/('wrong-source' if bad_source else 'wrong-mode')
    command = [sys.executable, '-B', str(runner), '--source-root', str(source),
        '--expected-source-commit', '0'*40 if bad_source else expected,
        '--input', str(input_path), '--output', str(bad_out), '--target-faces', '100', '--cleanup-mode', mode]
    failed = subprocess.run(command, capture_output=True, text=True)
    refusal = json.loads((bad_out/'report.json').read_text())
    assert failed.returncode != 0 and refusal['status'] == 'failed'
    assert refusal['phase'] == 'source-admission' and refusal['effectiveRoute'] is None
    assert not (bad_out/'vertices.f32').exists()
    assert 'exact clean' in refusal['error']['message'] if bad_source else 'cleanup mode' in refusal['error']['message']
print('Wrong source and unsupported cleanup mode fail before primary output with durable phase/error reports.')
