"""Adapt complete WebGPU mesh/material fields to the existing original Metal exporter."""
import argparse
import importlib.util
import hashlib
import json
from pathlib import Path
import sys
import traceback
from types import SimpleNamespace
import numpy as np
from source_attestation import git_source_identity


def digest(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def read_array(root, row, dtype, width):
    file = (root / row['file']).resolve()
    if not file.is_relative_to(root.resolve()):
        raise ValueError('retained array escapes its input directory')
    data = file.read_bytes()
    if len(data) != row['byteLength'] or hashlib.sha256(data).hexdigest() != row['sha256'] or not data or len(data) % (4 * width):
        raise ValueError('complete unchanged retained Metal input required')
    if row['dtype'] != dtype:
        raise ValueError('retained Metal dtype mismatch')
    result = np.frombuffer(data, dtype='<f4' if dtype in ('f32', 'float32') else '<u4' if dtype == 'uint32' else '<i4').reshape(-1, width)
    if not np.isfinite(result).all():
        raise ValueError('nonfinite retained Metal input')
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for key in ['source-root', 'expected-source-commit', 'mesh-input', 'material-input', 'backend-manifest', 'output-dir']:
        p.add_argument('--'+key, required=True)
    for key in ['grid-size', 'target-faces', 'texture-size']:
        p.add_argument('--'+key, required=True, type=int)
    for key in ['band', 'project-back']:
        p.add_argument('--'+key, required=True, type=float)
    a = p.parse_args()
    out = Path(a.output_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    report = {'schema': 'trellis2.retained-metal-finishing.v0', 'status': 'failed', 'phase': 'source-admission', 'modelCalls': 0, 'command': sys.argv}
    def persist():
        (out/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    persist()
    try:
        source = Path(a.source_root).resolve()
        report['source'] = {'root': str(source), **git_source_identity(source)}
        if report['source']['commit'] != a.expected_source_commit or report['source']['dirty']:
            raise ValueError('exact clean Metal source required')
        mesh_file, material_file = Path(a.mesh_input).resolve(), Path(a.material_input).resolve()
        mesh, material = json.loads(mesh_file.read_text()), json.loads(material_file.read_text())
        report['phase'] = 'retained-input-admission'; persist()
        vertices = read_array(mesh_file.parent, mesh['vertices'], 'float32', 3)
        faces = read_array(mesh_file.parent, mesh['triangles'], 'uint32', 3)
        attrs = read_array(Path(material['root']), material['features'], 'f32', 6)
        coords = read_array(Path(material['root']), material['coordinates'], 'i32', 3)
        if len(attrs) != len(coords) or a.grid_size != material['resolution']:
            raise ValueError('matching complete material grid required')
        checkpoints = out/'checkpoints'
        checkpoints.mkdir(exist_ok=False)
        np.savez_compressed(checkpoints/'mesh_raw.npz', vertices=vertices, faces=faces)
        np.savez_compressed(checkpoints/'texture.npz', tex_np=attrs, tex_coords_spatial=coords, mesh_grid_size=a.grid_size)
        report['inputs'] = {'meshManifestSha256': digest(mesh_file), 'materialManifestSha256': digest(material_file),
                            'meshSha256': digest(checkpoints/'mesh_raw.npz'), 'textureSha256': digest(checkpoints/'texture.npz')}
        report['phase'] = 'original-metal-finishing'; persist()
        sys.path.insert(0, str(source))
        spec = importlib.util.spec_from_file_location('trellis_original_metal_runner', source/'scripts/source_metal_remesh_finishing.py')
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        report['finishing'] = module.run(SimpleNamespace(checkpoints=checkpoints, output_dir=out/'finishing',
            mesh_sha256=report['inputs']['meshSha256'], texture_sha256=report['inputs']['textureSha256'],
            backend_manifest=Path(a.backend_manifest), expected_revision=a.expected_source_commit,
            require_composition_report=None, grid_size=a.grid_size, target_faces=a.target_faces,
            texture_size=a.texture_size, band=a.band, project_back=a.project_back))
        if report['finishing']['status'] != 'complete':
            raise ValueError('source Metal exporter failed; inspect retained finishing report')
        if git_source_identity(source) != {k:v for k,v in report['source'].items() if k!='root'}:
            raise ValueError('Metal source changed during finishing')
        report.update(status='complete', phase=None)
    except Exception as error:
        report.update(error=str(error), traceback=traceback.format_exc())
    persist()
    return 0 if report['status']=='complete' else 1


if __name__ == '__main__':
    raise SystemExit(main())
