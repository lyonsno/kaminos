"""Execute the pinned MLX crew's CPU mesh finalizer; no model import or call."""
import argparse
import ast
import hashlib
import importlib
from importlib import metadata
import json
from pathlib import Path
import subprocess
import sys
import time
import traceback

import numpy as np

ROUTE = 'Trellis2MLX/reference-cleanup/CPU-fast-simplification'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def identity(root):
    return {'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
            'dirty': subprocess.check_output(['git', 'status', '--porcelain'], cwd=root, text=True)}


def load_source(root, expected):
    observed = identity(root)
    if observed['commit'] != expected or observed['dirty']:
        raise ValueError('exact clean postprocess source revision required')
    source_path = root / 'generate.py'
    source_bytes = source_path.read_bytes()
    module = ast.parse(source_bytes, filename=str(source_path))
    nodes = [n for n in module.body if isinstance(n, ast.FunctionDef) and n.name == '_cleanup_and_simplify_mesh']
    if len(nodes) != 1:
        raise ValueError('one actual source cleanup function required')
    # Compile only the actual CPU finalizer. generate.py's model imports and
    # inference entry point are deliberately not executed by this consumer.
    namespace = {'np': np, 'time': time}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source_path), 'exec'), namespace)
    sys.path.insert(0, str(root))
    cleanup_module = importlib.import_module('trellmlx.mesh_cleanup')
    if Path(cleanup_module.__file__).resolve() != (root / 'trellmlx/mesh_cleanup.py').resolve():
        raise ValueError('effective cleanup import differs from requested source')
    return namespace['_cleanup_and_simplify_mesh'], {
        **observed, 'root': str(root), 'generateSha256': digest(source_bytes),
        'cleanupSha256': digest((root / 'trellmlx/mesh_cleanup.py').read_bytes()),
        'function': '_cleanup_and_simplify_mesh',
        'packages': {k: metadata.version(k) for k in ['numpy', 'scipy', 'trimesh', 'fast-simplification']},
    }


def read_array(folder, row, dtype, label):
    file = (folder / row['file']).resolve()
    shape = row.get('shape')
    if not file.is_relative_to(folder) or row.get('dtype') != dtype or not isinstance(shape, list) or len(shape) != 2 or shape[1] != 3 or not isinstance(shape[0], int) or shape[0] < 1:
        raise ValueError('complete typed mesh descriptor required: ' + label)
    data = file.read_bytes()
    if len(data) != shape[0] * 12 or len(data) != row.get('byteLength') or digest(data) != row.get('sha256'):
        raise ValueError('changed or partial mesh array: ' + label)
    return np.frombuffer(data, dtype='<f4' if dtype == 'float32' else '<u4').reshape(shape).copy()


def write_array(output, name, values):
    data = values.tobytes()
    (output / name).write_bytes(data)
    return {'file': name, 'shape': list(values.shape), 'dtype': 'float32' if values.dtype.kind == 'f' else 'uint32',
            'byteLength': len(data), 'sha256': digest(data)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', required=True, type=Path)
    parser.add_argument('--expected-source-commit', required=True)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--target-faces', type=int, required=True)
    parser.add_argument('--keep-largest', action='store_true')
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    report = {'schema': 'trellis2.mesh-postprocess.v0', 'status': 'running', 'phase': 'source-admission',
              'requestedSource': {'root': str(args.source_root.resolve()), 'commit': args.expected_source_commit},
              'requestedRoute': ROUTE, 'effectiveRoute': None, 'modelCalls': 0,
              'targetFaces': args.target_faces, 'keepLargest': args.keep_largest,
              'command': sys.argv, 'events': [], 'operationTrace': []}

    def persist():
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')

    def log(message, **_):
        report['events'].append({'message': str(message), 'elapsedSeconds': time.perf_counter() - started})
        persist()
        print(message, flush=True)

    started = time.perf_counter()
    persist()
    try:
        cleanup, report['source'] = load_source(args.source_root.resolve(), args.expected_source_commit)
        if args.target_faces < 1:
            raise ValueError('positive caller-selected simplification target required')
        report['phase'] = 'mesh-input-admission'
        persist()
        input_path = args.input.resolve()
        raw_manifest = input_path.read_bytes()
        manifest = json.loads(raw_manifest)
        if manifest.get('schema') != 'trellis2.raw-mesh-input.v0':
            raise ValueError('identified raw mesh input required')
        vertices = read_array(input_path.parent, manifest['vertices'], 'float32', 'vertices')
        faces = read_array(input_path.parent, manifest['triangles'], 'uint32', 'triangles')
        if not np.isfinite(vertices).all() or faces.max() >= len(vertices):
            raise ValueError('finite complete indexed input surface required')
        report.update(inputManifestSha256=digest(raw_manifest), inputVertices=len(vertices), inputFaces=len(faces),
                      input={'vertices': manifest['vertices'], 'triangles': manifest['triangles']},
                      effectiveRoute=ROUTE, phase='reference-order-cleanup')
        persist()
        vertices, faces = cleanup(vertices, faces, target_faces=args.target_faces, no_cleanup=False,
            keep_largest=args.keep_largest, reference_cleanup=True, qem_simplify=False,
            simplify_first=False, operation_trace=report['operationTrace'], log=log)
        report['precision'] = {'inputVertices': 'float32', 'sourceReturnedVertices': str(vertices.dtype),
                               'sourceReturnedFaces': str(faces.dtype), 'emittedVertices': 'float32',
                               'emittedFaces': 'uint32', 'normalization': 'explicit GLTF F32 positions/U32 indices'}
        if len(vertices) < 1 or len(faces) < 1 or not np.isfinite(vertices).all() or faces.min() < 0 or faces.max() >= len(vertices):
            raise ValueError('source finalizer produced no finite complete surface')
        vertices = np.ascontiguousarray(vertices, dtype='<f4')
        faces = np.ascontiguousarray(faces, dtype='<u4')
        if not np.isfinite(vertices).all():
            raise ValueError('source positions cannot be emitted as finite F32')
        report['sourceAfter'] = identity(args.source_root.resolve())
        if report['sourceAfter'] != {k: report['source'][k] for k in ['commit', 'dirty']}:
            raise ValueError('postprocess source changed during execution')
        report['phase'] = 'processed-mesh-write'
        persist()
        report['arrays'] = {'vertices': write_array(output, 'vertices.f32', vertices),
                            'triangles': write_array(output, 'triangles.u32', faces)}
        report.update(outputVertices=len(vertices), outputFaces=len(faces), status='succeeded', phase=None)
    except Exception as error:
        report.update(status='failed', error={'name': type(error).__name__, 'message': str(error), 'traceback': traceback.format_exc()})
    finally:
        report['elapsedSeconds'] = time.perf_counter() - started
        persist()
    print(json.dumps({k: report.get(k) for k in ['status', 'phase', 'inputFaces', 'outputFaces', 'elapsedSeconds', 'error']}), flush=True)
    return 0 if report['status'] == 'succeeded' else 1


if __name__ == '__main__':
    sys.exit(main())
