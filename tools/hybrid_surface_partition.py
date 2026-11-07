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
                      pinhole_max_triangles=256, relief_plane_tolerance=.008):
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
            or pinhole_max_triangles < 0
            or not (0 <= relief_plane_tolerance <= 1)):
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

    # Coplanar surface-relief dilation: absorb shallow mortar grooves and surface relief whose vertices
    # lie within relief_plane_tolerance * scale of a primary mesh chart's plane and within its bounds.
    absorbed_relief_tris = 0
    if relief_plane_tolerance > 0 and mesh_mask.any():
        h_tol = relief_plane_tolerance * scale
        tri_centers = corners.mean(axis=1)
        q_relief = deque()
        chart_planes = {}
        for m_cid in np.unique(chart_ids[mesh_mask]):
            m = (chart_ids == m_cid)
            n_sum = cross[m].sum(axis=0)
            n_len = float(np.linalg.norm(n_sum))
            if n_len <= 1e-12:
                continue
            n_vec = n_sum / n_len
            c_pt = (tri_centers[m] * area[m, None]).sum(axis=0) / max(float(area[m].sum()), 1e-12)
            pts = corners[m].reshape(-1, 3)
            chart_planes[int(m_cid)] = (c_pt, n_vec, pts.min(0) - h_tol, pts.max(0) + h_tol)
            for t_idx in np.flatnonzero(m):
                q_relief.append((int(t_idx), int(m_cid)))

        while q_relief:
            cur, m_cid = q_relief.popleft()
            c_pt, n_vec, bmin, bmax = chart_planes[m_cid]
            for nb in full_adj[cur]:
                if not mesh_mask[nb] and len(full_adj[nb]) >= 3:
                    pts = corners[nb]
                    if (pts >= bmin).all() and (pts <= bmax).all():
                        if float(np.abs((pts - c_pt) @ n_vec).max()) <= h_tol:
                            mesh_mask[nb] = True
                            absorbed_relief_tris += 1
                            q_relief.append((nb, m_cid))

    # Absorb tiny enclosed interior pinhole components (zero open boundary edges) surrounded by mesh charts.
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
            has_open_edge = False
            while q:
                cur = q.popleft()
                if len(full_adj[cur]) < 3:
                    has_open_edge = True
                for nb in full_adj[cur]:
                    if mesh_mask[nb]:
                        touches_mesh = True
                    elif not visited[nb]:
                        visited[nb] = True
                        q.append(nb)
                        comp.append(nb)
            if touches_mesh and not has_open_edge and len(comp) <= pinhole_max_triangles:
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
            'absorbedReliefTriangles': int(absorbed_relief_tris),
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
            'pinholeMaxTriangles': int(pinhole_max_triangles),
            'reliefPlaneTolerance': float(relief_plane_tolerance),
        },
    }


def _union_find_components(num_verts, tris):
    parent = np.arange(num_verts, dtype=np.int64)
    for a, b in ((0, 1), (1, 2), (2, 0)):
        for ui, vi in zip(tris[:, a], tris[:, b]):
            ru, rv = int(ui), int(vi)
            while parent[ru] != ru:
                parent[ru] = parent[parent[ru]]
                ru = parent[ru]
            while parent[rv] != rv:
                parent[rv] = parent[parent[rv]]
                rv = parent[rv]
            if ru != rv:
                parent[rv] = ru
    for i in range(num_verts):
        r = i
        while parent[r] != r:
            r = parent[r]
        cur = i
        while cur != r:
            nxt = parent[cur]
            parent[cur] = r
            cur = nxt
    return parent


def partition_raw_field(surfels, triangles, opacity_cutoff=.98,
                        min_manifold_component_triangles=256,
                        absorb_pinhole_max_triangles=128):
    """Partition a pre-finishing raw TRELLIS surface field into manifold opaque mesh sheets and glass/sponge splats."""
    surfels = np.asarray(surfels, dtype=np.float64)
    triangles = np.asarray(triangles, dtype=np.int64)
    if (surfels.ndim != 2 or surfels.shape[1] != 12 or len(surfels) < 3
            or triangles.ndim != 2 or triangles.shape[1] != 3 or len(triangles) < 1
            or not np.isfinite(surfels).all()
            or triangles.min() < 0 or triangles.max() >= len(surfels)
            or not (0. <= opacity_cutoff <= 1.)
            or min_manifold_component_triangles < 1
            or absorb_pinhole_max_triangles < 0):
        raise ValueError('Valid finite 12-channel raw surfels, triangle indices, and partition thresholds required')

    pos = surfels[:, :3]
    opacity = surfels[:, 11]
    corners = pos[triangles]
    area = np.linalg.norm(np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0]), axis=1) * .5
    total_area = float(area.sum())
    if not np.isfinite(total_area) or total_area <= 0:
        raise ValueError('Raw field surface has no positive area')

    e0 = triangles[:, [0, 1]]
    e1 = triangles[:, [1, 2]]
    e2 = triangles[:, [2, 0]]
    all_e = np.sort(np.vstack([e0, e1, e2]), axis=1)
    u_view = np.ascontiguousarray(all_e).view(np.dtype((np.void, all_e.dtype.itemsize * 2))).ravel()
    _, inv, counts = np.unique(u_view, return_inverse=True, return_counts=True)
    edge_valence = counts[inv]
    tri_edges_manifold = (edge_valence.reshape(3, -1).T == 2).all(axis=1)

    vert_nonmanifold = np.zeros(len(surfels), dtype=bool)
    vert_nonmanifold[all_e[edge_valence != 2].ravel()] = True
    vert_open_boundary = np.zeros(len(surfels), dtype=bool)
    vert_open_boundary[all_e[edge_valence == 1].ravel()] = True

    glass_mask = (opacity[triangles].min(axis=1) < opacity_cutoff)
    cand_mesh = (~glass_mask) & (~vert_nonmanifold[triangles].any(axis=1))

    mesh_mask = np.zeros(len(triangles), dtype=bool)
    kept_components = 0
    dropped_flake_tris = 0
    if cand_mesh.any():
        cand_ids = np.flatnonzero(cand_mesh)
        cand_tris = triangles[cand_ids]
        parent = _union_find_components(len(surfels), cand_tris)
        tri_root = parent[cand_tris[:, 0]]
        uniq_roots, comp_counts = np.unique(tri_root, return_counts=True)
        keep_mask = comp_counts >= min_manifold_component_triangles
        kept_components = int(keep_mask.sum())
        keep_roots = set(uniq_roots[keep_mask].tolist())
        kept_cand = np.isin(tri_root, list(keep_roots))
        dropped_flake_tris = int((~kept_cand).sum())
        mesh_mask[cand_ids[kept_cand]] = True

    # 1-ring manifold collar dilation: include adjacent opaque valence-2-edge triangles up to the seam.
    collar_tris = 0
    if mesh_mask.any():
        mesh_verts = np.zeros(len(surfels), dtype=bool)
        mesh_verts[triangles[mesh_mask].ravel()] = True
        collar = (~mesh_mask) & tri_edges_manifold & (~glass_mask) & mesh_verts[triangles].any(axis=1)
        mesh_mask |= collar
        collar_tris = int(collar.sum())

    # Absorb small enclosed opaque pinhole components touching mesh_mask without open boundary edges.
    absorbed_pinhole_tris = 0
    if absorb_pinhole_max_triangles > 0 and mesh_mask.any():
        rem_opaque = (~mesh_mask) & (~glass_mask)
        if rem_opaque.any():
            rem_ids = np.flatnonzero(rem_opaque)
            rem_tris = triangles[rem_ids]
            parent2 = _union_find_components(len(surfels), rem_tris)
            rem_root = parent2[rem_tris[:, 0]]
            u2, c2 = np.unique(rem_root, return_counts=True)
            small_roots = set(u2[c2 <= absorb_pinhole_max_triangles].tolist())
            if small_roots:
                mesh_vert_mask = np.zeros(len(surfels), dtype=bool)
                mesh_vert_mask[triangles[mesh_mask].ravel()] = True
                flat_v = rem_tris.ravel()
                touches_mesh_roots = set(parent2[flat_v[mesh_vert_mask[flat_v]]].tolist())
                touches_open_roots = set(parent2[flat_v[vert_open_boundary[flat_v]]].tolist())
                absorb_roots = (small_roots & touches_mesh_roots) - touches_open_roots
                if absorb_roots:
                    absorbed = np.isin(rem_root, list(absorb_roots))
                    mesh_mask[rem_ids[absorbed]] = True
                    absorbed_pinhole_tris = int(absorbed.sum())

    splat_mask = ~mesh_mask
    sponge_mask = splat_mask & (~glass_mask)
    return {
        'meshTriangles': mesh_mask,
        'splatTriangles': splat_mask,
        'glassTriangles': glass_mask,
        'spongeTriangles': sponge_mask,
        'stats': {
            'sourceKind': 'raw-field-hybrid-partition',
            'totalTriangles': int(len(triangles)),
            'meshTriangleCount': int(mesh_mask.sum()),
            'splatTriangleCount': int(splat_mask.sum()),
            'glassTriangleCount': int(glass_mask.sum()),
            'spongeTriangleCount': int(sponge_mask.sum()),
            'manifoldSheetComponents': kept_components,
            'collarManifoldTriangles': collar_tris,
            'droppedFlakeTriangles': dropped_flake_tris,
            'absorbedPinholeTriangles': absorbed_pinhole_tris,
            'totalArea': total_area,
            'meshArea': float(area[mesh_mask].sum()),
            'splatArea': float(area[splat_mask].sum()),
            'glassArea': float(area[glass_mask].sum()),
            'spongeArea': float(area[sponge_mask].sum()),
            'opacityCutoff': float(opacity_cutoff),
            'minManifoldComponentTriangles': int(min_manifold_component_triangles),
            'absorbPinholeMaxTriangles': int(absorb_pinhole_max_triangles),
        },
    }


def _write_raw_field_mesh_glb(surfels, mesh_triangles_u32, out_path):
    """Write a compacted pre-finishing manifold opaque mesh GLB with linear COLOR_0 and 1x1 white PBR texture."""
    subset_indices = np.asarray(mesh_triangles_u32, dtype=np.int64).reshape(-1, 3)
    used_verts, remapped = np.unique(subset_indices, return_inverse=True)
    remapped_u32 = remapped.reshape(-1, 3).astype('<u4')

    sub_rows = surfels[used_verts]
    sub_pos = np.ascontiguousarray(sub_rows[:, :3], dtype='<f4')
    raw_nrm = sub_rows[:, 3:6].astype(np.float64)
    n_len = np.linalg.norm(raw_nrm, axis=1, keepdims=True)
    raw_nrm = np.where(n_len > 1e-12, raw_nrm / np.maximum(n_len, 1e-12), [0., 0., 1.])
    sub_nrm = np.ascontiguousarray(raw_nrm, dtype='<f4')
    # The texture is constant white, so these coordinates can also carry the
    # source's metallic/roughness pair without another buffer or UV splits.
    sub_uv = np.ascontiguousarray(np.clip(sub_rows[:, 9:11], 0., 1.), dtype='<f4')
    sub_col = np.ascontiguousarray(linear(np.clip(sub_rows[:, 6:9].astype(np.float64), 0., 1.)), dtype='<f4')

    metallic_mean = float(np.clip(sub_rows[:, 9].mean(), 0., 1.))
    roughness_mean = float(np.clip(sub_rows[:, 10].mean(), 0., 1.))

    white_stream = io.BytesIO()
    Image.fromarray(np.full((2, 2, 4), 255, dtype=np.uint8)).save(white_stream, format='PNG')
    png_bytes = white_stream.getvalue()

    new_blob = bytearray()
    new_views = []

    def append_chunk(raw_bytes, target=None):
        offset = len(new_blob)
        new_blob.extend(raw_bytes)
        new_blob.extend(b'\0' * (-len(new_blob) % 4))
        entry = {'buffer': 0, 'byteOffset': offset, 'byteLength': len(raw_bytes)}
        if target is not None:
            entry['target'] = target
        vid = len(new_views)
        new_views.append(entry)
        return vid

    idx_vid = append_chunk(remapped_u32.reshape(-1).tobytes(), 34963)
    pos_vid = append_chunk(sub_pos.tobytes(), 34962)
    nrm_vid = append_chunk(sub_nrm.tobytes(), 34962)
    uv_vid = append_chunk(sub_uv.tobytes(), 34962)
    col_vid = append_chunk(sub_col.tobytes(), 34962)
    img_vid = append_chunk(png_bytes)

    doc = {
        'asset': {'version': '2.0', 'generator': 'kaminos-raw-field-hybrid-partition'},
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0}],
        'buffers': [{'byteLength': len(new_blob)}],
        'bufferViews': new_views,
        'accessors': [
            {'bufferView': idx_vid, 'componentType': 5125, 'type': 'SCALAR', 'count': int(remapped_u32.size)},
            {
                'bufferView': pos_vid, 'componentType': 5126, 'type': 'VEC3', 'count': int(len(sub_pos)),
                'min': sub_pos.min(axis=0).astype(float).tolist(),
                'max': sub_pos.max(axis=0).astype(float).tolist(),
            },
            {'bufferView': nrm_vid, 'componentType': 5126, 'type': 'VEC3', 'count': int(len(sub_nrm))},
            {'bufferView': uv_vid, 'componentType': 5126, 'type': 'VEC2', 'count': int(len(sub_uv))},
            {'bufferView': col_vid, 'componentType': 5126, 'type': 'VEC3', 'count': int(len(sub_col))},
        ],
        'meshes': [{
            'primitives': [{
                'indices': 0,
                'attributes': {'POSITION': 1, 'NORMAL': 2, 'TEXCOORD_0': 3, 'COLOR_0': 4, '_KAMINOS_MATERIAL': 3},
                'material': 0,
            }],
        }],
        'materials': [{
            'pbrMetallicRoughness': {
                'baseColorTexture': {'index': 0},
                'metallicFactor': metallic_mean,
                'roughnessFactor': roughness_mean,
            },
            'alphaMode': 'OPAQUE',
        }],
        'textures': [{'source': 0}],
        'images': [{'bufferView': img_vid, 'mimeType': 'image/png'}],
    }
    json_bytes = json.dumps(doc).encode('utf-8')
    json_bytes += b' ' * (-len(json_bytes) % 4)
    header = struct.pack('<III', 0x46546c67, 2, 28 + len(json_bytes) + len(new_blob))
    chunk0 = struct.pack('<II', len(json_bytes), 0x4e4f534a) + json_bytes
    chunk1 = struct.pack('<II', len(new_blob), 0x004e4942) + new_blob
    Path(out_path).write_bytes(header + chunk0 + chunk1)
    return int(len(sub_pos)), int(len(remapped_u32))


def _raw_field_footprints(rows, radius):
    n = rows[:, 3:6].astype(np.float64)
    lengths = np.linalg.norm(n, axis=1, keepdims=True)
    n = np.where(lengths > 1e-12, n / np.maximum(lengths, 1e-12), [0., 0., 1.])
    ux = np.where(np.abs(n[:, 2]) < .9, n[:, 1], 0.)
    uy = np.where(np.abs(n[:, 2]) < .9, -n[:, 0], n[:, 2])
    uz = np.where(np.abs(n[:, 2]) < .9, 0., -n[:, 1])
    u = np.stack([ux, uy, uz], axis=1)
    u /= np.linalg.norm(u, axis=1, keepdims=True)
    v = np.cross(n, u)
    sigma = float(radius) * .5
    footprints = np.empty((len(rows), 8), dtype='<f4')
    footprints[:, :3] = u
    footprints[:, 3] = sigma
    footprints[:, 4:7] = v
    footprints[:, 7] = sigma
    return footprints


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
        if v.get('buffer') != 0 or v.get('extensions'):
            raise ValueError('Unsupported buffer view')
        off = v.get('byteOffset', 0)
        if off + v['byteLength'] > len(blob):
            raise ValueError('Buffer view outside binary chunk')
        return blob[off:off + v['byteLength']]

    def accessor(i):
        a = doc['accessors'][i]
        if a.get('sparse') or a.get('normalized'):
            raise ValueError('Sparse/normalized accessors unsupported')
        if ('bufferView' not in a
                or a.get('componentType') not in {5126, 5125, 5123, 5121}
                or a.get('type') not in {'SCALAR', 'VEC2', 'VEC3'}):
            raise ValueError('Unsupported accessor format')
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
            if any(k in node for k in ('translation', 'rotation', 'scale')):
                raise ValueError('Node cannot specify both matrix and TRS properties')
            local = np.array(node['matrix'], dtype=np.float64).reshape(4, 4).T
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
    if 'attributes' not in primitive or 'material' not in primitive or 'indices' not in primitive:
        raise ValueError('Primitive requires material, indices, and attributes')
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
    det = float(np.linalg.det(matrix[:3, :3]))
    if not np.isfinite(det) or abs(det) <= 1e-12:
        raise ValueError('Singular node transform')
    world_pos = pos @ matrix[:3, :3].T + matrix[:3, 3]
    world_normals = normals @ np.linalg.inv(matrix[:3, :3])
    lengths = np.linalg.norm(world_normals, axis=1)
    zero_normals = lengths < 1e-12
    world_normals /= np.maximum(lengths[:, None], 1e-12)
    indices = accessor(primitive['indices']).reshape(-1, 3).astype(np.int64)
    if indices.max() >= len(pos):
        raise ValueError('Triangle index outside vertices')
    if det < 0:
        indices = indices[:, [0, 2, 1]]
    return payload, doc, bytes(blob), view, primitive, material, pbr, world_pos, world_normals, zero_normals, uv, indices, matrix


def _write_subset_glb(doc, view, primitive, world_pos, world_normals, uv, subset_indices_u32, out_path):
    """Write a compacted world-space GLB containing only the referenced mesh-regime vertices, triangles, and images."""
    subset_indices = np.asarray(subset_indices_u32, dtype=np.int64).reshape(-1, 3)
    used_verts, remapped = np.unique(subset_indices, return_inverse=True)
    remapped_u32 = remapped.reshape(-1, 3).astype('<u4')

    sub_pos = np.ascontiguousarray(world_pos[used_verts], dtype='<f4')
    sub_nrm = np.ascontiguousarray(world_normals[used_verts], dtype='<f4')
    sub_uv = np.ascontiguousarray(uv[used_verts], dtype='<f4')

    new_doc = copy.deepcopy(doc)
    new_blob = bytearray()
    new_views = []

    def append_chunk(raw_bytes, target=None):
        offset = len(new_blob)
        new_blob.extend(raw_bytes)
        new_blob.extend(b'\0' * (-len(new_blob) % 4))
        entry = {'buffer': 0, 'byteOffset': offset, 'byteLength': len(raw_bytes)}
        if target is not None:
            entry['target'] = target
        vid = len(new_views)
        new_views.append(entry)
        return vid

    idx_vid = append_chunk(remapped_u32.reshape(-1).tobytes(), 34963)
    pos_vid = append_chunk(sub_pos.tobytes(), 34962)
    nrm_vid = append_chunk(sub_nrm.tobytes(), 34962)
    uv_vid = append_chunk(sub_uv.tobytes(), 34962)

    for img in new_doc.get('images', []):
        if 'bufferView' in img:
            old_bytes = bytes(view(img['bufferView']))
            img['bufferView'] = append_chunk(old_bytes)

    new_doc['bufferViews'] = new_views
    new_doc['accessors'] = [
        {
            'bufferView': idx_vid,
            'componentType': 5125,
            'type': 'SCALAR',
            'count': int(remapped_u32.size),
        },
        {
            'bufferView': pos_vid,
            'componentType': 5126,
            'type': 'VEC3',
            'count': int(len(sub_pos)),
            'min': sub_pos.min(axis=0).astype(float).tolist(),
            'max': sub_pos.max(axis=0).astype(float).tolist(),
        },
        {
            'bufferView': nrm_vid,
            'componentType': 5126,
            'type': 'VEC3',
            'count': int(len(sub_nrm)),
        },
        {
            'bufferView': uv_vid,
            'componentType': 5126,
            'type': 'VEC2',
            'count': int(len(sub_uv)),
        },
    ]
    new_prim = copy.deepcopy(primitive)
    new_prim['indices'] = 0
    new_prim['attributes'] = {'POSITION': 1, 'NORMAL': 2, 'TEXCOORD_0': 3}
    new_doc['meshes'] = [{'primitives': [new_prim]}]
    new_doc['nodes'] = [{'mesh': 0}]
    new_doc['scenes'] = [{'nodes': [0]}]
    new_doc['scene'] = 0
    new_doc['buffers'] = [{'byteLength': len(new_blob)}]

    json_bytes = json.dumps(new_doc).encode('utf-8')
    json_bytes += b' ' * (-len(json_bytes) % 4)
    header = struct.pack('<III', 0x46546c67, 2, 28 + len(json_bytes) + len(new_blob))
    chunk0 = struct.pack('<II', len(json_bytes), 0x4e4f534a) + json_bytes
    chunk1 = struct.pack('<II', len(new_blob), 0x004e4942) + new_blob
    Path(out_path).write_bytes(header + chunk0 + chunk1)
    return int(len(sub_pos)), int(len(remapped_u32))


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
    normal_fallback = {
        'zeroSourceVertices': int(zero_normals.sum()),
        'affectedSamples': int(missing.any(1).sum()),
        'policy': 'zero corner normals use the sampled triangle geometric normal',
        'scope': 'candidate pool before spatial selection',
    }
    return rows, source_parents, bary.astype('<f4'), total, normal_fallback


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--raw-field', action='store_true',
                        help='Partition a pre-finishing TRELLIS raw field directory (report.json + surfels.f32 + triangles.u32)')
    parser.add_argument('--splat-count', type=int, default=None)
    parser.add_argument('--candidate-multiplier', type=int, default=4)
    parser.add_argument('--min-chart-area-fraction', type=float, default=.002)
    parser.add_argument('--min-chart-thickness-ratio', type=float, default=.01)
    parser.add_argument('--normal-cos-threshold', type=float, default=.85)
    parser.add_argument('--chart-cone-cos-threshold', type=float, default=.75)
    parser.add_argument('--min-chart-compactness', type=float, default=.06)
    parser.add_argument('--pinhole-max-triangles', type=int, default=256)
    parser.add_argument('--relief-plane-tolerance', type=float, default=.008)
    parser.add_argument('--opacity-cutoff', type=float, default=.98)
    parser.add_argument('--min-manifold-component-triangles', type=int, default=256)
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        raise ValueError('Output must not overwrite source')
    args.output.mkdir(parents=True, exist_ok=False)
    report = {'ok': False, 'phase': 'sample', 'source': str(args.source.resolve()), 'requestedSplatCount': args.splat_count}
    try:
        repo_cwd = Path(__file__).resolve().parent
        if args.raw_field:
            report['phase'] = 'load'
            meta = json.loads((args.source / 'report.json').read_text())
            if not meta.get('ok') or 'triangles' not in meta:
                raise ValueError('A successful raw field source with original triangle connectivity is required')
            s_bytes = (args.source / 'surfels.f32').read_bytes()
            if hashlib.sha256(s_bytes).hexdigest() != meta.get('dataSHA256'):
                raise ValueError('Source surfels.f32 SHA-256 mismatch')
            t_file = meta['triangles']['file']
            t_bytes = (args.source / t_file).read_bytes()
            if hashlib.sha256(t_bytes).hexdigest() != meta['triangles'].get('sha256'):
                raise ValueError(f'Source {t_file} SHA-256 mismatch')
            surfels = np.frombuffer(s_bytes, dtype='<f4').reshape(-1, 12).copy()
            triangles = np.frombuffer(t_bytes, dtype='<u4').reshape(-1, 3).copy()
            if len(surfels) != meta.get('count') or len(triangles) != meta['triangles'].get('count'):
                raise ValueError('Raw field row/triangle count mismatch')

            report['phase'] = 'partition'
            part = partition_raw_field(
                surfels, triangles,
                opacity_cutoff=args.opacity_cutoff,
                min_manifold_component_triangles=args.min_manifold_component_triangles,
                absorb_pinhole_max_triangles=args.pinhole_max_triangles,
            )
            mesh_tri_ids = np.flatnonzero(part['meshTriangles'])
            splat_tri_ids = np.flatnonzero(part['splatTriangles'])
            if len(mesh_tri_ids) == 0 or len(splat_tri_ids) == 0:
                raise ValueError('Raw field partition produced an empty regime; adjust thresholds')

            report['phase'] = 'write_mesh'
            mesh_glb_path = args.output / 'mesh-region.glb'
            mesh_vert_count, mesh_tri_count = _write_raw_field_mesh_glb(
                surfels, triangles[mesh_tri_ids], mesh_glb_path
            )
            part['stats']['meshVertexCount'] = mesh_vert_count

            report['phase'] = 'write_splats'
            splat_tris_orig = triangles[splat_tri_ids]
            splat_vert_ids, remapped_splat_tris = np.unique(splat_tris_orig, return_inverse=True)
            remapped_splat_tris = remapped_splat_tris.reshape(-1, 3).astype('<u4')
            splat_rows = np.ascontiguousarray(surfels[splat_vert_ids], dtype='<f4')
            part['stats']['splatVertexCount'] = int(len(splat_rows))
            part['stats']['sharedSeamVertexCount'] = int(len(np.intersect1d(np.unique(triangles[mesh_tri_ids]), splat_vert_ids)))

            radius = float(meta.get('radius', 0.8 / 512))
            footprints = _raw_field_footprints(splat_rows, radius)

            splat_dir = args.output / 'splat-region'
            splat_dir.mkdir(parents=True, exist_ok=False)
            s_out_bytes = splat_rows.tobytes()
            t_out_bytes = remapped_splat_tris.tobytes()
            f_out_bytes = footprints.tobytes()
            (splat_dir / 'surfels.f32').write_bytes(s_out_bytes)
            (splat_dir / 'triangles.u32').write_bytes(t_out_bytes)
            (splat_dir / 'footprints.f32').write_bytes(f_out_bytes)

            splat_meta = {
                'schema': 'trellis-surfel-fields.v1',
                'ok': True,
                'phase': 'done',
                'source': meta.get('source', str(args.source.resolve())),
                'regionNormalizedYUp': meta.get('regionNormalizedYUp'),
                'layout': meta.get('layout', ['x', 'y', 'z', 'nx', 'ny', 'nz', 'r', 'g', 'b', 'metallic', 'roughness', 'opacity']),
                'sourceHashes': meta.get('sourceHashes', {'surfels': meta['dataSHA256'], 'triangles': meta['triangles']['sha256']}),
                'sourceCount': int(len(splat_rows)),
                'fallbackNormals': int(meta.get('fallbackNormals', 0)),
                'sourceBounds': meta.get('sourceBounds', [surfels[:, :3].min(0).tolist(), surfels[:, :3].max(0).tolist()]),
                'triangles': {
                    'file': 'triangles.u32',
                    'count': int(len(remapped_splat_tris)),
                    'sha256': hashlib.sha256(t_out_bytes).hexdigest(),
                    'sourceCount': int(len(triangles)),
                },
                'count': int(len(splat_rows)),
                'stride': 12,
                'gridSize': int(meta.get('gridSize', 512)),
                'radius': radius,
                'bounds': [splat_rows[:, :3].min(0).tolist(), splat_rows[:, :3].max(0).tolist()],
                'dataSHA256': hashlib.sha256(s_out_bytes).hexdigest(),
                'footprints': {
                    'file': 'footprints.f32',
                    'stride': 8,
                    'sha256': hashlib.sha256(f_out_bytes).hexdigest(),
                    'layout': 'tangent-u.xyz,sigma-u,tangent-v.xyz,sigma-v',
                    'supportSigma': 3,
                },
                'partition': part['stats'],
            }
            (splat_dir / 'report.json').write_text(json.dumps(splat_meta, indent=2) + '\n')

            report.update({
                'ok': True,
                'phase': 'complete',
                'sourceHashes': splat_meta['sourceHashes'],
                'partition': part['stats'],
                'meshRegionGlb': str(mesh_glb_path.resolve()),
                'meshRegionBytes': int(mesh_glb_path.stat().st_size),
                'splatRegionDir': str(splat_dir.resolve()),
                'splatCount': int(len(splat_rows)),
                'splatInstanceBytes': int(len(splat_rows) * 84),
                'repoRoot': subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True, cwd=repo_cwd).strip(),
                'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True, cwd=repo_cwd).strip(),
                'dirty': bool(subprocess.check_output(['git', 'status', '--porcelain'], text=True, cwd=repo_cwd).strip()),
            })
            return

        if args.splat_count is None or args.splat_count < 1 or args.candidate_multiplier < 1:
            raise ValueError('Positive splat count and candidate multiplier required')
        (payload, doc, blob_bytes, view, primitive, material, pbr,
         world_pos, world_normals, zero_normals, uv, indices, matrix) = _parse_glb(args.source)
        report['phase'] = 'partition'
        part = partition_surface(
            world_pos, world_normals, indices,
            min_chart_area_fraction=args.min_chart_area_fraction,
            min_chart_thickness_ratio=args.min_chart_thickness_ratio,
            normal_cos_threshold=args.normal_cos_threshold,
            chart_cone_cos_threshold=args.chart_cone_cos_threshold,
            min_chart_compactness=args.min_chart_compactness,
            pinhole_max_triangles=args.pinhole_max_triangles,
            relief_plane_tolerance=args.relief_plane_tolerance,
        )
        mesh_tri_ids = np.flatnonzero(part['meshTriangles'])
        splat_tri_ids = np.flatnonzero(part['splatTriangles'])
        if len(mesh_tri_ids) == 0 or len(splat_tri_ids) == 0:
            raise ValueError('Partition produced an empty regime; adjust thresholds for hybrid output')

        report['phase'] = 'write_mesh'
        mesh_glb_path = args.output / 'mesh-region.glb'
        mesh_vert_count, mesh_tri_count = _write_subset_glb(
            doc, view, primitive, world_pos, world_normals, uv, indices[mesh_tri_ids].astype('<u4'), mesh_glb_path
        )
        part['stats']['meshVertexCount'] = mesh_vert_count

        report['phase'] = 'sample_splats'
        pool_count = args.splat_count * args.candidate_multiplier
        rows, source_parents, bary, splat_area, normal_fallback = _sample_triangle_subset(
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
            'normalFallback': normal_fallback,
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

        repo_cwd = Path(__file__).resolve().parent
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
            'repoRoot': subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True, cwd=repo_cwd).strip(),
            'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True, cwd=repo_cwd).strip(),
            'dirty': bool(subprocess.check_output(['git', 'status', '--porcelain'], text=True, cwd=repo_cwd).strip()),
        })
    except BaseException as exc:
        report['error'] = str(exc)
        raise
    finally:
        (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
