"""Adapt complete WebGPU mesh/material fields to the existing original Metal exporter."""
import argparse
import importlib.util
import hashlib
import json
import struct
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


def read_page_reconstruction(file, expected_sha256, grid_size):
    """Read the existing page codec's lossless raw GLB, never its rendered colors."""
    data = Path(file).read_bytes()
    if hashlib.sha256(data).hexdigest() != expected_sha256:
        raise ValueError('page reconstruction digest mismatch')
    if len(data) < 28 or struct.unpack_from('<III', data) != (0x46546c67, 2, len(data)):
        raise ValueError('complete page reconstruction GLB required')
    json_size, json_type = struct.unpack_from('<II', data, 12)
    binary_start = 28 + json_size
    if json_type != 0x4e4f534a or json_size % 4 or binary_start > len(data):
        raise ValueError('complete page reconstruction JSON required')
    binary_size, binary_type = struct.unpack_from('<II', data, 20 + json_size)
    if binary_type != 0x004e4942 or binary_start + binary_size != len(data):
        raise ValueError('complete page reconstruction binary required')
    doc = json.loads(data[20:20 + json_size])
    raw = doc.get('extras', {}).get('trellisReconstruction', {})
    if raw.get('schema') != 'kaminos.trellis-reconstruction.v1':
        raise ValueError('supported page reconstruction schema required')
    if doc['buffers'][0]['byteLength'] != binary_size:
        raise ValueError('page reconstruction buffer size mismatch')
    material = raw['materialFields']
    if type(material['resolution']) is not int or material['resolution'] != grid_size:
        raise ValueError('matching page material grid required')

    def read(index, dtype, width):
        views = doc['bufferViews']
        if type(index) is not int or not 0 <= index < len(views):
            raise ValueError('valid page reconstruction buffer view required')
        view = views[index]
        offset, size = view.get('byteOffset', 0), view.get('byteLength')
        if (view.get('buffer') != 0 or 'byteStride' in view
                or type(offset) is not int or type(size) is not int
                or offset < 0 or offset % 4 or size <= 0 or size % (4 * width)
                or offset + size > binary_size):
            raise ValueError('complete packed page reconstruction array required')
        result = np.frombuffer(data, dtype=dtype, count=size // 4,
                               offset=binary_start + offset).reshape(-1, width)
        if not np.isfinite(result).all():
            raise ValueError('nonfinite page reconstruction array')
        return result

    vertices = read(raw['decode']['vertices'], '<f4', 3)
    faces = read(raw['decode']['triangles'], '<u4', 3)
    attrs = read(material['features'], '<f4', 6)
    coords = read(material['coordinates'], '<i4', 3)
    # The codec displays source coordinates through its fixed (x,z,-y) basis.
    # Accessor identity alone cannot establish that this is the displayed surface.
    scene_id = doc.get('scene', 0)
    scenes, nodes = doc['scenes'], doc['nodes']
    basis = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]
    if (type(scene_id) is not int or not 0 <= scene_id < len(scenes)
            or scenes[scene_id].get('nodes') != [0] or not nodes
            or nodes[0].get('mesh') != 0 or nodes[0].get('matrix') != basis
            or nodes[0].get('children') or doc.get('animations')
            or any(key in nodes[0] for key in ('translation', 'rotation', 'scale', 'skin', 'weights'))
            or nodes[0].get('extensions')):
        raise ValueError('supported page reconstruction scene and source basis required')
    primitives = doc['meshes'][0]['primitives']
    if (len(primitives) != 1 or primitives[0].get('mode', 4) != 4
            or primitives[0].get('targets') or primitives[0].get('extensions')):
        raise ValueError('one displayed page triangle surface required')
    primitive = primitives[0]
    for accessor_id, view_id, component, shape, count in (
            (primitive['attributes']['POSITION'], raw['decode']['vertices'], 5126, 'VEC3', len(vertices)),
            (primitive['indices'], raw['decode']['triangles'], 5125, 'SCALAR', faces.size)):
        accessors = doc['accessors']
        if type(accessor_id) is not int or not 0 <= accessor_id < len(accessors):
            raise ValueError('valid displayed page mesh accessor required')
        accessor = accessors[accessor_id]
        if (accessor.get('bufferView') != view_id or accessor.get('byteOffset', 0) != 0
                or accessor.get('componentType') != component or accessor.get('type') != shape
                or accessor.get('count') != count or accessor.get('normalized', False)
                or 'sparse' in accessor):
            raise ValueError('page reconstruction raw mesh differs from its displayed mesh')
    provenance = doc.get('extras', {}).get('trellis', {}).get('provenance', {})
    return vertices, faces, attrs, coords, provenance


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for key in ['source-root', 'expected-source-commit', 'backend-manifest', 'output-dir']:
        p.add_argument('--'+key, required=True)
    for key in ['mesh-input', 'material-input', 'reconstruction-glb', 'expected-reconstruction-sha256']:
        p.add_argument('--'+key)
    p.add_argument('--stage-inputs-only', action='store_true',
                   help='Stage validated complete inputs without invoking Metal; never a finished-asset result.')
    for key in ['grid-size', 'target-faces', 'texture-size']:
        p.add_argument('--'+key, required=True, type=int)
    for key in ['band', 'project-back']:
        p.add_argument('--'+key, required=True, type=float)
    a = p.parse_args()
    out = Path(a.output_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    report = {'schema': 'trellis2.retained-metal-finishing.v0', 'status': 'failed', 'phase': 'source-admission', 'modelCalls': 0, 'command': sys.argv,
              'mode': 'input-staging' if a.stage_inputs_only else 'metal-finishing'}
    def persist():
        (out/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    persist()
    try:
        source = Path(a.source_root).resolve()
        report['source'] = {'root': str(source), **git_source_identity(source)}
        if report['source']['commit'] != a.expected_source_commit or report['source']['dirty']:
            raise ValueError('exact clean Metal source required')
        report['phase'] = 'retained-input-admission'; persist()
        if a.reconstruction_glb:
            if a.mesh_input or a.material_input or not a.expected_reconstruction_sha256:
                raise ValueError('one hash-bound reconstruction or paired manifests required')
            vertices, faces, attrs, coords, provenance = read_page_reconstruction(
                a.reconstruction_glb, a.expected_reconstruction_sha256, a.grid_size)
            report['reconstructionProvenance'] = provenance
            report['inputs'] = {'reconstructionPath': str(Path(a.reconstruction_glb).resolve()),
                                'reconstructionSha256': a.expected_reconstruction_sha256}
        else:
            if not a.mesh_input or not a.material_input or a.expected_reconstruction_sha256:
                raise ValueError('one hash-bound reconstruction or paired manifests required')
            mesh_file, material_file = Path(a.mesh_input).resolve(), Path(a.material_input).resolve()
            mesh, material = json.loads(mesh_file.read_text()), json.loads(material_file.read_text())
            vertices = read_array(mesh_file.parent, mesh['vertices'], 'float32', 3)
            faces = read_array(mesh_file.parent, mesh['triangles'], 'uint32', 3)
            attrs = read_array(Path(material['root']), material['features'], 'f32', 6)
            coords = read_array(Path(material['root']), material['coordinates'], 'i32', 3)
            if a.grid_size != material['resolution']:
                raise ValueError('matching complete material grid required')
            report['inputs'] = {'meshManifestSha256': digest(mesh_file), 'materialManifestSha256': digest(material_file)}
        if (a.grid_size <= 0 or len(attrs) != len(coords) or faces.max() >= len(vertices)
                or coords.min() < 0 or coords.max() >= a.grid_size):
            raise ValueError('valid complete mesh and material grid required')
        # Raw decoder channels are centered; source texture.npz contains the
        # affine-decoded appearance. Match trellis-material.js's separate F32
        # multiply/add boundaries for all six channels, without clipping.
        attrs = attrs * np.float32(.5) + np.float32(.5)
        report['appearanceTransform'] = 'all six raw decoded F32 channels * F32(0.5) + F32(0.5); unclipped'
        checkpoints = out/'checkpoints'
        checkpoints.mkdir(exist_ok=False)
        np.savez_compressed(checkpoints/'mesh_raw.npz', vertices=vertices, faces=faces)
        np.savez_compressed(checkpoints/'texture.npz', tex_np=attrs, tex_coords_spatial=coords, mesh_grid_size=a.grid_size)
        report['inputs'].update(meshSha256=digest(checkpoints/'mesh_raw.npz'), textureSha256=digest(checkpoints/'texture.npz'))
        if a.stage_inputs_only:
            report.update(status='inputs-staged', phase='retained-inputs-staged')
            persist()
            return 0
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
