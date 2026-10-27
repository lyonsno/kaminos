"""Deterministic area-stratified samples of one opaque textured glTF surface.

This is a finished-GLB conversion, not a raw decoder export. Unsupported
material/geometry semantics fail explicitly rather than losing channels.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import struct
import subprocess
import numpy as np
from PIL import Image


def linear(x):
    return np.where(x <= .04045, x / 12.92, ((x + .055) / 1.055) ** 2.4)


def srgb(x):
    return np.where(x <= .0031308, x * 12.92, 1.055 * np.maximum(x, 0) ** (1 / 2.4) - .055)


def sample_glb(path, count):
    if not isinstance(count, int) or count < 1:
        raise ValueError('Positive integer sample count required')
    payload = Path(path).read_bytes()
    magic, version, size = struct.unpack_from('<III', payload)
    if magic != 0x46546c67 or version != 2 or size != len(payload):
        raise ValueError('Invalid GLB header')
    length, kind = struct.unpack_from('<II', payload, 12)
    if kind != 0x4e4f534a:
        raise ValueError('Missing GLB JSON')
    doc = json.loads(payload[20:20 + length])
    offset = 20 + length
    length, kind = struct.unpack_from('<II', payload, offset)
    if kind != 0x004e4942 or offset + 8 + length != len(payload):
        raise ValueError('Expected one embedded GLB binary chunk')
    blob = memoryview(payload)[offset + 8:]
    if len(doc['buffers']) != 1 or doc['buffers'][0].get('uri'):
        raise ValueError('Only embedded buffer supported')
    if set(doc.get('extensionsRequired', [])) - {'EXT_texture_webp'}:
        raise ValueError('Unsupported required extension')
    if doc.get('animations') or doc.get('skins'):
        raise ValueError('Only static rigid surfaces supported')

    def view(i):
        v = doc['bufferViews'][i]
        if v['buffer'] != 0 or v.get('extensions'):
            raise ValueError('Unsupported buffer view')
        off = v.get('byteOffset', 0)
        if off + v['byteLength'] > len(blob):
            raise ValueError('Buffer view outside binary chunk')
        return blob[off:off + v['byteLength']]

    def accessor(i):
        a = doc['accessors'][i]
        if a.get('sparse') or a.get('normalized'):
            raise ValueError('Sparse/normalized accessors unsupported')
        dtype = {5126: '<f4', 5125: '<u4', 5123: '<u2', 5121: 'u1'}[a['componentType']]
        width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
        v = doc['bufferViews'][a['bufferView']]
        item = np.dtype(dtype).itemsize
        stride = v.get('byteStride', item * width)
        return np.ndarray((a['count'], width), dtype, buffer=view(a['bufferView']),
                          offset=a.get('byteOffset', 0), strides=(stride, item)).copy()

    instances = []
    def visit(i, parent, ancestors):
        if i in ancestors:
            raise ValueError('Cyclic scene nodes')
        node = doc['nodes'][i]
        if node.get('extensions') or node.get('skin') is not None:
            raise ValueError('Unsupported node semantics')
        if 'matrix' in node:
            local = np.array(node['matrix']).reshape(4, 4).T
        else:
            x, y, z, w = node.get('rotation', [0, 0, 0, 1])
            local = np.eye(4)
            local[:3, :3] = np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
                                      [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
                                      [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]]) @ np.diag(node.get('scale', [1, 1, 1]))
            local[:3, 3] = node.get('translation', [0, 0, 0])
        world = parent @ local
        if 'mesh' in node:
            instances.append((node['mesh'], world))
        for child in node.get('children', []):
            visit(child, world, ancestors | {i})
    for i in doc['scenes'][doc.get('scene', 0)]['nodes']:
        visit(i, np.eye(4), set())
    if len(instances) != 1:
        raise ValueError('Expected one static mesh instance')
    mesh_id, matrix = instances[0]
    primitives = doc['meshes'][mesh_id]['primitives']
    if len(primitives) != 1:
        raise ValueError('Expected one triangle primitive')
    primitive = primitives[0]
    if primitive.get('mode', 4) != 4 or primitive.get('extensions') or primitive.get('targets'):
        raise ValueError('Unsupported primitive semantics')
    if set(primitive['attributes']) != {'POSITION', 'NORMAL', 'TEXCOORD_0'}:
        raise ValueError('Expected position, normal and UV only')
    material = doc.get('materials', [])[primitive['material']]
    if material.get('alphaMode', 'OPAQUE') != 'OPAQUE':
        raise ValueError('Only OPAQUE materials supported')
    if material.get('extensions'):
        raise ValueError('Unsupported material extension')
    if any(material.get(k) for k in ['normalTexture', 'occlusionTexture', 'emissiveTexture']) or any(material.get('emissiveFactor', [0, 0, 0])):
        raise ValueError('Unsupported additional material channel')
    pbr = material.get('pbrMetallicRoughness', {})
    if pbr.get('extensions'):
        raise ValueError('Unsupported PBR extension')
    pos, normals, uv = [accessor(primitive['attributes'][k]).astype(np.float64) for k in ['POSITION', 'NORMAL', 'TEXCOORD_0']]
    if len(pos) != len(normals) or len(pos) != len(uv):
        raise ValueError('Mismatched vertex attributes')
    if not all(np.isfinite(a).all() for a in [pos, normals, uv, matrix]):
        raise ValueError('Nonfinite source attributes')
    pos = pos @ matrix[:3, :3].T + matrix[:3, 3]
    normals = normals @ np.linalg.inv(matrix[:3, :3])
    lengths = np.linalg.norm(normals, axis=1)
    zero_normals = lengths < 1e-12
    normals /= np.maximum(lengths[:, None], 1e-12)
    indices = accessor(primitive['indices']).reshape(-1, 3)
    if indices.max() >= len(pos):
        raise ValueError('Triangle index outside vertices')
    corners = pos[indices]
    area = np.linalg.norm(np.cross(corners[:, 1]-corners[:, 0], corners[:, 2]-corners[:, 0]), axis=1) * .5
    total = float(area.sum())
    if not np.isfinite(total) or total <= 0:
        raise ValueError('No nondegenerate surface')
    parents = np.searchsorted(np.cumsum(area), (np.arange(count)+.5)*total/count, side='right').astype('<u4')
    # Irrational rotations avoid random clumps while retaining interior coverage.
    serial = np.arange(count, dtype=np.float64) + .5
    u = np.sqrt(np.mod(serial * .7548776662466927, 1))
    v = np.mod(serial * .5698402909980532, 1)
    bary = np.c_[1-u, u*(1-v), u*v]
    chosen = indices[parents]
    rows = np.zeros((count, 12), '<f4')
    rows[:, :3] = (pos[chosen] * bary[:, :, None]).sum(1)
    corner_normals = normals[chosen].copy()
    face_normals = np.cross(corners[parents, 1]-corners[parents, 0], corners[parents, 2]-corners[parents, 0])
    face_normals /= np.linalg.norm(face_normals, axis=1)[:, None]
    missing = zero_normals[chosen]
    corner_normals[missing] = np.broadcast_to(face_normals[:, None, :], corner_normals.shape)[missing]
    interpolated = (corner_normals * bary[:, :, None]).sum(1)
    lengths = np.linalg.norm(interpolated, axis=1)
    if np.any(lengths < 1e-12):
        raise ValueError('Interpolated normal cancels')
    rows[:, 3:6] = interpolated / lengths[:, None]
    coords = (uv[chosen] * bary[:, :, None]).sum(1)

    def texture(info, color=False):
        if info is None:
            return np.ones((count, 4))
        if info.get('texCoord', 0) != 0 or info.get('extensions'):
            raise ValueError('Unsupported texture coordinates/transform')
        tex = doc['textures'][info['index']]
        if set(tex.get('extensions', {})) - {'EXT_texture_webp'}:
            raise ValueError('Unsupported texture extension')
        image_id = tex.get('extensions', {}).get('EXT_texture_webp', {}).get('source', tex.get('source'))
        image = doc['images'][image_id]
        if 'bufferView' not in image:
            raise ValueError('Only embedded images supported')
        pixels = np.asarray(Image.open(io.BytesIO(view(image['bufferView']))).convert('RGBA'), dtype=np.float32) / 255
        if color:
            pixels[:, :, :3] = linear(pixels[:, :, :3])
        sampler = doc.get('samplers', [])[tex['sampler']] if 'sampler' in tex else {}
        h, w = pixels.shape[:2]
        q = coords * [w, h] - .5  # glTF UV origin is image top-left; no extra flip.
        xy = np.floor(q).astype(np.int64)
        f = q - xy
        def wrap(a, n, mode):
            if mode == 33071:
                return np.clip(a, 0, n-1)
            if mode == 33648:
                a = np.mod(a, 2*n)
                return np.minimum(a, 2*n-1-a)
            if mode != 10497:
                raise ValueError('Unknown texture wrap')
            return np.mod(a, n)
        def texel(x, y):
            return pixels[wrap(y, h, sampler.get('wrapT', 10497)), wrap(x, w, sampler.get('wrapS', 10497))]
        if sampler.get('magFilter', 9729) == 9728:
            nearest = np.floor(q+.5).astype(np.int64)
            return texel(nearest[:, 0], nearest[:, 1])
        x, y = xy.T; fx, fy = f.T
        return ((texel(x,y)*(1-fx[:,None])+texel(x+1,y)*fx[:,None])*(1-fy[:,None]) +
                (texel(x,y+1)*(1-fx[:,None])+texel(x+1,y+1)*fx[:,None])*fy[:,None])

    base = texture(pbr.get('baseColorTexture'), True)
    rows[:, 6:9] = srgb(base[:, :3] * pbr.get('baseColorFactor', [1,1,1,1])[:3])
    mr = texture(pbr.get('metallicRoughnessTexture'))
    rows[:, 9] = mr[:, 2] * pbr.get('metallicFactor', 1)
    rows[:, 10] = mr[:, 1] * pbr.get('roughnessFactor', 1)
    rows[:, 11] = 1  # OPAQUE ignores the stored alpha and alpha factor.
    digest = hashlib.sha256(payload).hexdigest()
    meta = {'ok': True, 'sourceKind': 'sampled-glb', 'source': str(Path(path).resolve()),
            'sourceHashes': {'glb': digest}, 'sourceTriangleCount': len(indices), 'count': count,
            'sourceCount': count, 'stride': 12, 'bounds': [pos.min(0).tolist(), pos.max(0).tolist()],
            'normalFallback': {'zeroSourceVertices': int(zero_normals.sum()), 'affectedSamples': int(missing.any(1).sum()), 'policy': 'zero corner normals use the sampled triangle geometric normal'},
            'surfaceArea': total, 'radius': float(np.sqrt(total/count)*.8),
            'sampling': 'area-stratified triangle selection; interior irrational-rotation barycentrics',
            'textureSampling': 'base level; bilinear in linear color, nearest if authored magFilter NEAREST',
            'transform': matrix.tolist(), 'doubleSided': material.get('doubleSided', False),
            'claim': 'Samples the finished mesh; does not recover detail removed by finishing'}
    return rows, parents, bary.astype('<f4'), meta


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--count', type=int, required=True)
    parser.add_argument('--sampling', choices=['area', 'spatial'], default='area')
    parser.add_argument('--candidate-multiplier', type=int, default=4,
                        help='Candidates per output point for spatial selection')
    args = parser.parse_args()
    # New output only; never overwrite a source or prior evidence directory.
    args.output.mkdir(parents=True, exist_ok=False)
    report = {'ok': False, 'phase': 'sample', 'source': str(args.source.resolve()), 'requestedCount': args.count}
    try:
        if args.candidate_multiplier < 1:
            raise ValueError('Positive candidate multiplier required')
        pool_count = args.count*(args.candidate_multiplier if args.sampling == 'spatial' else 1)
        rows, parents, bary, meta = sample_glb(args.source, pool_count)
        spatial_footprints = None
        if args.sampling == 'spatial':
            from spatial_surface_samples import spatial_samples
            ids, spatial_footprints, selection = spatial_samples(rows, args.count, meta['surfaceArea'])
            rows, parents, bary = rows[ids], parents[ids], bary[ids]
            meta.update(count=args.count, sourceCount=args.count,
                        radius=float(np.sqrt(meta['surfaceArea']/args.count)*.8),
                        candidateSampling=meta['sampling'], spatialSampling=selection,
                        sampling='spatial/normal cells selected from area candidates')
            meta['normalFallback']['scope'] = 'candidate pool before spatial selection'
        report.update(meta)
        report['phase'] = 'write'
        report['repoRoot'] = subprocess.check_output(['git','rev-parse','--show-toplevel'], text=True).strip()
        report['commit'] = subprocess.check_output(['git','rev-parse','HEAD'], text=True).strip()
        report['dirty'] = bool(subprocess.check_output(['git','status','--porcelain'], text=True).strip())
        # Baseline isotropic reconstruction support; keep its policy explicit.
        normal = rows[:,3:6].astype(np.float64)
        axis = np.tile([0.,0.,1.], (len(rows),1))
        axis[np.abs(normal[:,2])>.9] = [1,0,0]
        tangent = np.cross(normal, axis); tangent /= np.linalg.norm(tangent,axis=1)[:,None]
        footprints = np.zeros((len(rows),8), '<f4')
        footprints[:,:3] = tangent; footprints[:,4:7] = np.cross(normal,tangent)
        footprints[:,3] = footprints[:,7] = report['radius']/2
        report['footprintFit'] = 'isotropic area-spacing baseline; support radius 1.2*sqrt(area/count)'
        if spatial_footprints is not None:
            footprints = spatial_footprints
            report['footprintFit'] = report['spatialSampling']['support']
        for key, name, array in [('data','surfels.f32',rows),('parentTriangles','parent-triangles.u32',parents),('barycentrics','barycentrics.f32',bary),('footprints','footprints.f32',footprints)]:
            value = array.tobytes(); (args.output/name).write_bytes(value)
            sha = hashlib.sha256(value).hexdigest()
            if key == 'data': report['dataSHA256'] = sha
            else: report[key] = {'file': name, 'sha256': sha, **({'stride':8,'supportSigma':3} if key=='footprints' else {})}
        report['ok'] = True; report['phase'] = 'done'
    except Exception as error:
        report.update(ok=False, error=repr(error))
        raise
    finally:
        (args.output/'report.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report))


if __name__ == '__main__':
    main()
