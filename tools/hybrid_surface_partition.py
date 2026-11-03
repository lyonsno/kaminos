"""Partition a triangle surface into coherent developable mesh sheets and thin/high-curvature splat regions."""
import argparse
from collections import deque
import copy
import hashlib
import io
import json
from pathlib import Path
import struct
import subprocess
import sys
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from glb_surface_fields import linear, srgb
from spatial_surface_samples import spatial_samples


def partition_surface(pos, normals, indices, min_chart_area_fraction=.002,
                      min_chart_thickness_ratio=.01, normal_cos_threshold=.85,
                      chart_cone_cos_threshold=.75, min_chart_compactness=.06,
                      pinhole_max_triangles=64):
    pos = np.asarray(pos, dtype=np.float64)
    normals = np.asarray(normals, dtype=np.float64)
    indices = np.asarray(indices, dtype=np.int64)
    if (pos.ndim != 2 or pos.shape[1] != 3 or normals.shape != pos.shape
            or indices.ndim != 2 or indices.shape[1] != 3 or len(indices) < 1
            or not (np.isfinite(pos).all() and np.isfinite(normals).all())
            or indices.min() < 0 or indices.max() >= len(pos)
            or not (0 <= min_chart_area_fraction <= 1)
            or not (0 <= min_chart_thickness_ratio <= 1)
            or not (-1 <= normal_cos_threshold <= 1)
            or not (-1 <= chart_cone_cos_threshold <= 1)
            or not (0 <= min_chart_compactness <= 1)
            or pinhole_max_triangles < 0):
        raise ValueError('Valid finite surface mesh and partition thresholds required')

    corners = pos[indices]
    cross = np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0])
    double_area = np.linalg.norm(cross, axis=1)
    area = double_area * .5
    total_area = float(area.sum())
    if not np.isfinite(total_area) or total_area <= 0:
        raise ValueError('Surface has no positive area')

    face_normals = np.zeros_like(cross)
    valid_face = double_area > 1e-12
    face_normals[valid_face] = cross[valid_face] / double_area[valid_face, None]

    # Weld vertices by quantized 3D coordinate so UV seam splits do not break smooth charts.
    scale = max(float(np.linalg.norm(np.ptp(pos, axis=0))), 1e-6)
    quantized = np.round((pos - pos.min(0)) / (scale * 1e-6)).astype(np.int64)
    q_Struct = np.ascontiguousarray(quantized).view(np.dtype((np.void, quantized.dtype.itemsize * 3))).ravel()
    _, welded_vid = np.unique(q_Struct, return_inverse=True)
    welded_tris = welded_vid[indices]

    # Build undirected edges on welded vertex IDs.
    num_tris = len(indices)
    e0 = np.c_[welded_tris[:, 0], welded_tris[:, 1]]
    e1 = np.c_[welded_tris[:, 1], welded_tris[:, 2]]
    e2 = np.c_[welded_tris[:, 2], welded_tris[:, 0]]
    all_edges = np.vstack([e0, e1, e2])
    undirected = np.sort(all_edges, axis=1)
    edge_tris = np.tile(np.arange(num_tris, dtype=np.int64), 3)

    u_view = np.ascontiguousarray(undirected).view(np.dtype((np.void, undirected.dtype.itemsize * 2))).ravel()
    order = np.argsort(u_view, kind='stable')
    sorted_u = undirected[order]
    sorted_tris = edge_tris[order]

    same_next = np.zeros(len(order), dtype=bool)
    if len(order) > 1:
        same_next[:-1] = (sorted_u[:-1, 0] == sorted_u[1:, 0]) & (sorted_u[:-1, 1] == sorted_u[1:, 1])

    adj = [[] for _ in range(num_tris)]
    full_adj = [[] for _ in range(num_tris)]
    pair_indices = np.flatnonzero(same_next)
    for idx in pair_indices:
        ta = int(sorted_tris[idx])
        tb = int(sorted_tris[idx + 1])
        if ta != tb and valid_face[ta] and valid_face[tb]:
            full_adj[ta].append(tb)
            full_adj[tb].append(ta)
            if float(np.dot(face_normals[ta], face_normals[tb])) >= normal_cos_threshold:
                adj[ta].append(tb)
                adj[tb].append(ta)

    # Seed charts in decreasing triangle-area order so broad flat faces anchor normal cones first.
    tri_order = np.argsort(-area, kind='stable')
    chart_ids = np.full(num_tris, -1, dtype=np.int32)
    chart_areas = []
    chart_diags = []

    cid = 0
    for t in tri_order:
        t = int(t)
        if chart_ids[t] != -1:
            continue
        seed_normal = face_normals[t]
        chart_ids[t] = cid
        q = deque([t])
        tris = [t]
        c_area = 0.
        while q:
            cur = q.popleft()
            c_area += float(area[cur])
            for nb in adj[cur]:
                if chart_ids[nb] == -1 and float(np.dot(seed_normal, face_normals[nb])) >= chart_cone_cos_threshold:
                    chart_ids[nb] = cid
                    q.append(nb)
                    tris.append(nb)
        pts = corners[tris].reshape(-1, 3)
        c_diag = float(np.linalg.norm(pts.max(0) - pts.min(0)))
        chart_areas.append(c_area)
        chart_diags.append(c_diag)
        cid += 1

    chart_areas = np.asarray(chart_areas, dtype=np.float64)
    chart_diags = np.asarray(chart_diags, dtype=np.float64)
    thickness = chart_areas / np.maximum(chart_diags, 1e-12)
    compactness = chart_areas / np.maximum(chart_diags ** 2, 1e-12)
    area_thresh = min_chart_area_fraction * total_area
    thick_thresh = min_chart_thickness_ratio * np.sqrt(total_area)
    chart_is_mesh = (
        (chart_areas >= area_thresh)
        & (thickness >= thick_thresh)
        & (compactness >= min_chart_compactness)
    )
    mesh_mask = chart_is_mesh[chart_ids].copy()

    # Absorb tiny interior pinhole components (e.g. steep mortar-groove triangles) surrounded by mesh charts.
    absorbed_pinhole_tris = 0
    if pinhole_max_triangles > 0 and mesh_mask.any():
        visited = mesh_mask.copy()
        for t in range(num_tris):
            if visited[t]:
                continue
            visited[t] = True
            q = deque([t])
            comp = [t]
            touches_mesh = False
            while q:
                cur = q.popleft()
                for nb in full_adj[cur]:
                    if mesh_mask[nb]:
                        touches_mesh = True
                    elif not visited[nb]:
                        visited[nb] = True
                        q.append(nb)
                        comp.append(nb)
            if touches_mesh and len(comp) <= pinhole_max_triangles:
                mesh_mask[comp] = True
                absorbed_pinhole_tris += len(comp)

    splat_mask = ~mesh_mask

    return {
        'meshTriangles': mesh_mask,
        'splatTriangles': splat_mask,
        'chartIds': chart_ids,
        'stats': {
            'totalTriangles': int(num_tris),
            'meshTriangleCount': int(mesh_mask.sum()),
            'splatTriangleCount': int(splat_mask.sum()),
            'absorbedPinholeTriangles': int(absorbed_pinhole_tris),
            'totalArea': total_area,
            'meshArea': float(area[mesh_mask].sum()),
            'splatArea': float(area[splat_mask].sum()),
            'chartCount': int(cid),
            'meshChartCount': int(chart_is_mesh.sum()),
            'splatChartCount': int((~chart_is_mesh).sum()),
            'minChartAreaFraction': float(min_chart_area_fraction),
            'minChartThicknessRatio': float(min_chart_thickness_ratio),
            'normalCosThreshold': float(normal_cos_threshold),
            'chartConeCosThreshold': float(chart_cone_cos_threshold),
            'minChartCompactness': float(min_chart_compactness),
        },
    }


def _parse_glb(path):
    payload = Path(path).read_bytes()
    magic, version, size = struct.unpack_from('<III', payload)
    if magic != 0x46546c67 or version != 2 or size != len(payload):
        raise ValueError('Invalid GLB header')
    length, kind = struct.unpack_from('<II', payload, 12)
    if kind != 0x4e4f534a:
        raise ValueError('Missing GLB JSON')
    doc = json.loads(payload[20:20 + length])
    offset = 20 + length
    bin_len, kind = struct.unpack_from('<II', payload, offset)
    if kind != 0x004e4942 or offset + 8 + bin_len != len(payload):
        raise ValueError('Expected one embedded GLB binary chunk')
    blob = memoryview(payload)[offset + 8:]
    if len(doc.get('buffers', [])) != 1 or doc['buffers'][0].get('uri'):
        raise ValueError('Only embedded buffer supported')
    if set(doc.get('extensionsRequired', [])) - {'EXT_texture_webp', 'KHR_texture_basisu'}:
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
    world_pos = pos @ matrix[:3, :3].T + matrix[:3, 3]
    world_normals = normals @ np.linalg.inv(matrix[:3, :3])
    lengths = np.linalg.norm(world_normals, axis=1)
    zero_normals = lengths < 1e-12
    world_normals /= np.maximum(lengths[:, None], 1e-12)
    indices = accessor(primitive['indices']).reshape(-1, 3).astype(np.int64)
    if indices.max() >= len(pos):
        raise ValueError('Triangle index outside vertices')
    return payload, doc, bytes(blob), view, primitive, material, pbr, world_pos, world_normals, zero_normals, uv, indices, matrix


def _write_subset_glb(doc, blob_bytes, primitive, subset_indices_u32, out_path):
    new_doc = copy.deepcopy(doc)
    idx_acc_id = primitive['indices']
    idx_acc = new_doc['accessors'][idx_acc_id]
    new_idx_bytes = np.asarray(subset_indices_u32, dtype='<u4').reshape(-1).tobytes()
    new_blob = bytearray(blob_bytes)
    new_blob.extend(b'\0' * (-len(new_blob) % 4))
    new_view_id = len(new_doc['bufferViews'])
    new_doc['bufferViews'].append({
        'buffer': 0,
        'byteOffset': len(new_blob),
        'byteLength': len(new_idx_bytes),
    })
    new_blob.extend(new_idx_bytes)
    new_blob.extend(b'\0' * (-len(new_blob) % 4))
    idx_acc['bufferView'] = new_view_id
    idx_acc['byteOffset'] = 0
    idx_acc['componentType'] = 5125
    idx_acc['count'] = int(subset_indices_u32.size)
    idx_acc.pop('max', None)
    idx_acc.pop('min', None)
    new_doc['buffers'][0]['byteLength'] = len(new_blob)
    json_bytes = json.dumps(new_doc).encode('utf-8')
    json_bytes += b' ' * (-len(json_bytes) % 4)
    header = struct.pack('<III', 0x46546c67, 2, 28 + len(json_bytes) + len(new_blob))
    chunk0 = struct.pack('<II', len(json_bytes), 0x4e4f534a) + json_bytes
    chunk1 = struct.pack('<II', len(new_blob), 0x004e4942) + new_blob
    Path(out_path).write_bytes(header + chunk0 + chunk1)


def _sample_triangle_subset(doc, view, pbr, world_pos, world_normals, zero_normals, uv,
                            all_indices, splat_tri_ids, pool_count):
    sub_indices = all_indices[splat_tri_ids]
    corners = world_pos[sub_indices]
    area = np.linalg.norm(np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0]), axis=1) * .5
    total = float(area.sum())
    if not np.isfinite(total) or total <= 0:
        raise ValueError('Splat partition has no positive area')
    local_parents = np.searchsorted(np.cumsum(area), (np.arange(pool_count) + .5) * total / pool_count, side='right')
    local_parents = np.clip(local_parents, 0, len(splat_tri_ids) - 1)
    source_parents = splat_tri_ids[local_parents].astype('<u4')
    serial = np.arange(pool_count, dtype=np.float64) + .5
    u = np.sqrt(np.mod(serial * .7548776662466927, 1))
    v = np.mod(serial * .5698402909980532, 1)
    bary = np.c_[1 - u, u * (1 - v), u * v]
    chosen = sub_indices[local_parents]
    rows = np.zeros((pool_count, 12), '<f4')
    rows[:, :3] = (world_pos[chosen] * bary[:, :, None]).sum(1)
    corner_normals = world_normals[chosen].copy()
    face_normals = np.cross(corners[local_parents, 1] - corners[local_parents, 0],
                            corners[local_parents, 2] - corners[local_parents, 0])
    face_normals /= np.linalg.norm(face_normals, axis=1)[:, None]
    missing = zero_normals[chosen]
    corner_normals[missing] = np.broadcast_to(face_normals[:, None, :], corner_normals.shape)[missing]
    interpolated = (corner_normals * bary[:, :, None]).sum(1)
    lengths = np.linalg.norm(interpolated, axis=1)
    if np.any(lengths < 1e-12):
        raise ValueError('Interpolated normal cancels')
    rows[:, 3:6] = interpolated / lengths[:, None]
    coords = (uv[chosen] * bary[:, :, None]).sum(1)

    def sample_tex(info, color=False):
        if info is None:
            return np.ones((pool_count, 4))
        if info.get('texCoord', 0) != 0 or info.get('extensions'):
            raise ValueError('Unsupported texture coordinates/transform')
        tex = doc['textures'][info['index']]
        if set(tex.get('extensions', {})) - {'EXT_texture_webp'}:
            raise ValueError('Unsupported texture extension for splat sampling')
        image_id = tex.get('extensions', {}).get('EXT_texture_webp', {}).get('source', tex.get('source'))
        image = doc['images'][image_id]
        if 'bufferView' not in image:
            raise ValueError('Only embedded images supported')
        pixels = np.asarray(Image.open(io.BytesIO(view(image['bufferView']))).convert('RGBA'), dtype=np.float32) / 255
        if color:
            pixels[:, :, :3] = linear(pixels[:, :, :3])
        sampler = doc.get('samplers', [])[tex['sampler']] if 'sampler' in tex else {}
        h, w = pixels.shape[:2]
        q = coords * [w, h] - .5
        xy = np.floor(q).astype(np.int64)
        f = q - xy
        def wrap(a, n, mode):
            if mode == 33071:
                return np.clip(a, 0, n - 1)
            if mode == 33648:
                a = np.mod(a, 2 * n)
                return np.minimum(a, 2 * n - 1 - a)
            if mode != 10497:
                raise ValueError('Unknown texture wrap')
            return np.mod(a, n)
        def texel(x, y):
            return pixels[wrap(y, h, sampler.get('wrapT', 10497)), wrap(x, w, sampler.get('wrapS', 10497))]
        if sampler.get('magFilter', 9729) == 9728:
            nearest = np.floor(q + .5).astype(np.int64)
            return texel(nearest[:, 0], nearest[:, 1])
        x, y = xy.T
        fx, fy = f.T
        return ((texel(x, y) * (1 - fx[:, None]) + texel(x + 1, y) * fx[:, None]) * (1 - fy[:, None]) +
                (texel(x, y + 1) * (1 - fx[:, None]) + texel(x + 1, y + 1) * fx[:, None]) * fy[:, None])

    base = sample_tex(pbr.get('baseColorTexture'), True)
    rows[:, 6:9] = srgb(base[:, :3] * pbr.get('baseColorFactor', [1, 1, 1, 1])[:3])
    mr = sample_tex(pbr.get('metallicRoughnessTexture'))
    rows[:, 9] = mr[:, 2] * pbr.get('metallicFactor', 1)
    rows[:, 10] = mr[:, 1] * pbr.get('roughnessFactor', 1)
    rows[:, 11] = 1
    return rows, source_parents, bary.astype('<f4'), total


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--splat-count', type=int, required=True)
    parser.add_argument('--candidate-multiplier', type=int, default=4)
    parser.add_argument('--min-chart-area-fraction', type=float, default=.002)
    parser.add_argument('--min-chart-thickness-ratio', type=float, default=.01)
    parser.add_argument('--normal-cos-threshold', type=float, default=.85)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    report = {'ok': False, 'phase': 'sample', 'source': str(args.source.resolve()), 'requestedSplatCount': args.splat_count}
    try:
        if args.splat_count < 1 or args.candidate_multiplier < 1:
            raise ValueError('Positive splat count and candidate multiplier required')
        (payload, doc, blob_bytes, view, primitive, material, pbr,
         world_pos, world_normals, zero_normals, uv, indices, matrix) = _parse_glb(args.source)
        report['phase'] = 'partition'
        part = partition_surface(
            world_pos, world_normals, indices,
            min_chart_area_fraction=args.min_chart_area_fraction,
            min_chart_thickness_ratio=args.min_chart_thickness_ratio,
            normal_cos_threshold=args.normal_cos_threshold,
        )
        mesh_tri_ids = np.flatnonzero(part['meshTriangles'])
        splat_tri_ids = np.flatnonzero(part['splatTriangles'])
        if len(mesh_tri_ids) == 0 or len(splat_tri_ids) == 0:
            raise ValueError('Partition produced an empty regime; adjust thresholds for hybrid output')

        report['phase'] = 'write_mesh'
        mesh_glb_path = args.output / 'mesh-region.glb'
        _write_subset_glb(doc, blob_bytes, primitive, indices[mesh_tri_ids].astype('<u4'), mesh_glb_path)

        report['phase'] = 'sample_splats'
        pool_count = args.splat_count * args.candidate_multiplier
        rows, source_parents, bary, splat_area = _sample_triangle_subset(
            doc, view, pbr, world_pos, world_normals, zero_normals, uv, indices, splat_tri_ids, pool_count
        )
        ids, footprints, selection = spatial_samples(rows, args.splat_count, splat_area)
        rows = rows[ids]
        source_parents = source_parents[ids]
        bary = bary[ids]

        report['phase'] = 'write_splats'
        splat_dir = args.output / 'splat-region'
        splat_dir.mkdir(parents=True, exist_ok=False)
        splat_meta = {
            'ok': True,
            'sourceKind': 'hybrid-splat-partition',
            'source': str(args.source.resolve()),
            'sourceHashes': {'glb': hashlib.sha256(payload).hexdigest()},
            'sourceTriangleCount': int(len(indices)),
            'splatTriangleCount': int(len(splat_tri_ids)),
            'count': int(args.splat_count),
            'sourceCount': int(args.splat_count),
            'stride': 12,
            'bounds': [world_pos.min(0).tolist(), world_pos.max(0).tolist()],
            'surfaceArea': float(splat_area),
            'radius': float(np.sqrt(splat_area / args.splat_count) * .8),
            'spatialSampling': selection,
            'footprintFit': selection['support'],
            'partition': part['stats'],
            'transform': matrix.tolist(),
            'doubleSided': material.get('doubleSided', False),
        }
        for key, name, array in [
            ('data', 'surfels.f32', rows),
            ('parentTriangles', 'parent-triangles.u32', source_parents),
            ('barycentrics', 'barycentrics.f32', bary),
            ('footprints', 'footprints.f32', footprints),
        ]:
            value = array.tobytes()
            (splat_dir / name).write_bytes(value)
            sha = hashlib.sha256(value).hexdigest()
            if key == 'data':
                splat_meta['dataSHA256'] = sha
            else:
                splat_meta[key] = {'file': name, 'sha256': sha, **({'stride': 8, 'supportSigma': 3} if key == 'footprints' else {})}
        (splat_dir / 'report.json').write_text(json.dumps(splat_meta, indent=2) + '\n')

        report.update({
            'ok': True,
            'phase': 'complete',
            'sourceHashes': {'glb': hashlib.sha256(payload).hexdigest()},
            'partition': part['stats'],
            'meshRegionGlb': str(mesh_glb_path.resolve()),
            'meshRegionBytes': int(mesh_glb_path.stat().st_size),
            'splatRegionDir': str(splat_dir.resolve()),
            'splatCount': int(args.splat_count),
            'splatInstanceBytes': int(args.splat_count * 84),
            'spatialSampling': selection,
            'repoRoot': subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip(),
            'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
            'dirty': bool(subprocess.check_output(['git', 'status', '--porcelain'], text=True).strip()),
        })
        (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    except Exception as exc:
        report['error'] = str(exc)
        (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        raise


if __name__ == '__main__':
    main()
