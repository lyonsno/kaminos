"""Offline, provisional surface-connected claims for an analytical carrier.

All vertices participate. Input/output paths and geometric tolerances belong to
the caller's manifest. No generation, mesh repair, or permanent cuts occur.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation


def world_matrix(pose):
    matrix = np.eye(4)
    matrix[:3, :3] = Rotation.from_euler('XYZ', pose['rotation']).as_matrix() @ np.diag(pose['scale'])
    matrix[:3, 3] = pose['position']
    if not np.isfinite(matrix).all() or abs(np.linalg.det(matrix[:3, :3])) < 1e-15:
        raise ValueError('non-finite or degenerate transform')
    return matrix


def export_frame(vertices):
    """Exact TRELLIS generate.py export convention: (x,y,z) -> (x,z,-y)."""
    return np.asarray(vertices)[:, [0, 2, 1]] * [1, 1, -1]


def primitive_distance(vertices, geometry, matrix):
    inverse = np.linalg.inv(matrix)
    local = vertices @ inverse[:3, :3].T + inverse[:3, 3]
    p = geometry['parameters']
    if geometry['kind'] == 'box':
        outside = np.maximum(np.abs(local) - np.array([p['width'], p['height'], p['depth']]) / 2, 0)
        distance = np.linalg.norm(outside, axis=1)
    elif geometry['kind'] == 'cylinder':
        distance = np.hypot(np.maximum(np.linalg.norm(local[:, [0, 2]], axis=1) - p['radius'], 0),
                            np.maximum(np.abs(local[:, 1]) - p['height'] / 2, 0))
    else:
        raise ValueError('unsupported analytical primitive: ' + geometry['kind'])
    # Matches the existing viewer's conservative local-to-world distance.
    return distance * np.linalg.norm(matrix[:3, :3], axis=0).min()


def carrier_distances(vertices, source, alignment):
    parts = source['provenance']['analyticalCarrier']['parts']
    objects = {row['id']: row for row in source['objects']}
    rows = []
    for part, ids in parts.items():
        values = []
        for key in ids:
            obj = objects[key]
            if obj['type'] != 'procedural-mesh':
                continue
            values.append(primitive_distance(vertices, obj['geometry'],
                          world_matrix(alignment) @ world_matrix(obj['transform'])))
        if not values:
            raise ValueError('part has no supported geometry: ' + part)
        rows.append(np.min(values, axis=0))
    return list(parts), np.asarray(rows, dtype=np.float32).T


def surface_claims(vertices, faces, distances, *, seed_radius, seed_margin, reach, ambiguity):
    """Grow independent proposals along actual mesh edges from exclusive cores.

    Each role gets its own shortest-path field, with an analytical envelope
    penalty. Near ties remain multiply claimed; unreachable or distant surface
    remains unclaimed. Tolerances are scene units, not probabilities.
    """
    checked_mesh(vertices, faces)
    distances = np.asarray(distances, dtype=float)
    if distances.ndim != 2 or distances.shape[0] != len(vertices) or distances.shape[1] < 2:
        raise ValueError('distances must cover every vertex and at least two roles')
    if not np.isfinite(distances).all() or (distances < 0).any():
        raise ValueError('distances must be finite and nonnegative')
    if not all(np.isfinite(x) and x > 0 for x in (seed_radius, seed_margin, reach, ambiguity)):
        raise ValueError('geometric tolerances must be positive and finite')
    edges = np.concatenate([faces[:, [0,1]], faces[:, [1,2]], faces[:, [2,0]]])
    edges.sort(axis=1)
    edges = np.unique(edges, axis=0)
    lengths = np.maximum(np.linalg.norm(vertices[edges[:,0]] - vertices[edges[:,1]], axis=1), 1e-12)
    order = np.argsort(distances, axis=1)
    margin = distances[np.arange(len(vertices)), order[:,1]] - distances[np.arange(len(vertices)), order[:,0]]
    seeds = np.zeros_like(distances, dtype=bool)
    costs = np.full_like(distances, np.inf)
    for role in range(distances.shape[1]):
        seeds[:,role] = (order[:,0] == role) & (distances[:,role] <= seed_radius) & (margin >= seed_margin)
        if not seeds[:,role].any():
            continue
        weights = lengths * (1 + (distances[edges[:,0],role] + distances[edges[:,1],role]) / (2 * reach))
        graph = coo_matrix((weights, (edges[:,0], edges[:,1])), shape=(len(vertices),len(vertices))).tocsr()
        # Full field, no propagation cutoff or vertex sampling.
        geodesic = dijkstra(graph, directed=False, indices=np.flatnonzero(seeds[:,role]), min_only=True)
        costs[:,role] = np.hypot(geodesic, distances[:,role])
    best = costs.min(axis=1)
    claims = np.isfinite(costs) & (costs <= reach) & (costs <= best[:,None] + ambiguity)
    return claims, seeds, costs


def digest(path):
    with Path(path).open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def checked_mesh(vertices, faces):
    if vertices.ndim != 2 or vertices.shape[1] != 3 or not len(vertices) or not np.isfinite(vertices).all():
        raise ValueError('mesh needs nonempty finite vertices')
    if faces.ndim != 2 or faces.shape[1] != 3 or not len(faces) or not np.issubdtype(faces.dtype, np.integer):
        raise ValueError('mesh needs nonempty integer triangles')
    if faces.min() < 0 or faces.max() >= len(vertices):
        raise ValueError('face index outside vertex range')


def mask_bits(claims):
    if claims.shape[1] > 31:
        raise ValueError('bitset format supports at most 31 analytical roles')
    return np.sum(claims.astype(np.uint32) << np.arange(claims.shape[1],dtype=np.uint32), axis=1, dtype=np.uint32)


def counts(bits, parts):
    return {'triangles': int(len(bits)), 'unclaimed': int((bits == 0).sum()),
            'contested': int(((bits != 0) & ((bits & (bits - np.uint32(1))) != 0)).sum()),
            'parts': {part:int(((bits & (1 << n)) != 0).sum()) for n,part in enumerate(parts)}}


def write_colored(mesh, bits, colors, path):
    import trimesh
    scene = trimesh.Scene()
    for code in np.unique(bits):
        subset = mesh.submesh([np.flatnonzero(bits == code)], append=True)
        if code == 0: color = [255,120,59,255]
        elif code & (code - np.uint32(1)): color = [255,57,232,255]
        else: color = colors[int(code).bit_length()-1]
        subset.visual = trimesh.visual.ColorVisuals(mesh=subset, face_colors=color)
        scene.add_geometry(subset, node_name=f'claims-{code}')
    scene.export(path)


def run(manifest_path):
    import trimesh
    manifest_path = Path(manifest_path)
    manifest = json.loads(manifest_path.read_text())
    out = Path(manifest['output_dir'])
    inputs = manifest['inputs']
    # Outputs are append-by-run: cannot overwrite a previous result or source.
    if out.exists() and any(out.iterdir()):
        raise ValueError('output directory must be empty; preserve prior comparisons')
    out.mkdir(parents=True, exist_ok=True)
    report = {'schema':'kaminos.surface-claims.v1', 'status':'failed', 'phase':'inputs',
              'manifest':str(manifest_path), 'manifest_sha256':digest(manifest_path),
              'method':'exclusive analytical cores; independent intrinsic mesh-edge distance fields; explicit near-tie overlap',
              'parameters':manifest['parameters'], 'inputs':{}, 'last_trustworthy_evidence':{},
              'limits':['provisional geometric proposals, not semantic probabilities',
                        'raw mesh precedes simplification; transfer is nearest raw vertex at each final triangle centroid',
                        'no hidden geometry reconstructed, no watertight cuts or articulation inferred']}
    try:
        for name, item in inputs.items():
            path = Path(item['path']); actual = digest(path)
            report['inputs'][name] = {'path':str(path),'sha256':actual,'bytes':path.stat().st_size}
            if actual != item['sha256']:
                raise ValueError('source identity mismatch: '+name)
        source = json.loads(Path(inputs['source']['path']).read_text())
        fit = json.loads(Path(inputs['fit']['path']).read_text())
        if fit['identity']['source']['sha256'] != inputs['source']['sha256'] or fit['identity']['target']['sha256'] != inputs['target']['sha256']:
            raise ValueError('saved registration does not identify supplied source/target')
        if fit['recipe']['targetTransform'] != {'position':[0,0,0],'rotation':[0,0,0],'scale':[1,1,1]}:
            raise ValueError('offline transfer currently requires the generated target in its native frame')
        meta = json.loads(Path(inputs['raw_metadata']['path']).read_text())
        report['grid_size'] = meta['mesh_grid_size']
        report['phase'] = 'raw_surface'
        with np.load(inputs['raw_mesh']['path'], allow_pickle=False) as raw:
            vertices = export_frame(raw['vertices']).astype(np.float32)
            faces = np.asarray(raw['faces'], dtype=np.int32)
        checked_mesh(vertices, faces)
        report['raw_surface'] = {'vertices':len(vertices),'triangles':len(faces),
                                  'bounds':[vertices.min(axis=0).tolist(),vertices.max(axis=0).tolist()]}
        report['last_trustworthy_evidence'] = report['raw_surface']
        report['phase'] = 'analytical_distances'
        parts, distances = carrier_distances(vertices, source, fit['recipe']['settings']['alignment'])
        report['parts'] = parts
        report['phase'] = 'surface_paths'
        claims, seeds, costs = surface_claims(vertices, faces, distances, **manifest['parameters'])
        report['seed_counts'] = dict(zip(parts, seeds.sum(axis=0).astype(int).tolist()))
        np.savez_compressed(out/'raw-claims.npz', claims=claims, seeds=seeds, costs=costs, distances=distances)
        report['phase'] = 'final_mesh_transfer'
        target_scene = trimesh.load(inputs['target']['path'], force='scene', process=False)
        if len(target_scene.graph.nodes_geometry) != 1:
            raise ValueError('this first transfer consumes exactly one generated mesh instance')
        node = target_scene.graph.nodes_geometry[0]
        transform, name = target_scene.graph[node]
        target = target_scene.geometry[name].copy()
        target.apply_transform(transform)
        checked_mesh(target.vertices, target.faces)
        centers = target.vertices[target.faces].mean(axis=1)
        transfer_distance, nearest = cKDTree(vertices).query(centers, workers=1)
        # Every final triangle is retained, including distant/untrusted transfers.
        baseline_distances = carrier_distances(centers, source, fit['recipe']['settings']['alignment'])[1]
        settings = fit['recipe']['settings']
        baseline_bits = mask_bits(np.exp(-baseline_distances/settings['falloff']) >= settings['threshold'])
        supported = transfer_distance <= manifest['transfer_tolerance']
        candidate_bits = mask_bits(claims[nearest])
        candidate_bits[~supported] = 0
        np.savez_compressed(out/'target-claims.npz', nearest_raw_vertex=nearest, transfer_distance=transfer_distance,
                            supported=supported, baseline_bits=baseline_bits, candidate_bits=candidate_bits)
        report['baseline'] = counts(baseline_bits, parts)
        report['candidate'] = counts(candidate_bits, parts)
        report['transfer'] = {'unsupported_triangles':int((~supported).sum()),
                             'distance_quantiles':dict(zip(['0','50','90','99','100'], np.percentile(transfer_distance,[0,50,90,99,100]).tolist())),
                             'tolerance':manifest['transfer_tolerance']}
        colors = [[54,214,207,255],[240,187,75,255],[154,142,255,255],[235,115,156,255]]
        if len(parts) > len(colors):
            raise ValueError('provide additional display colors for this carrier')
        report['phase'] = 'exports'
        write_colored(target, baseline_bits, colors, out/'baseline.glb')
        write_colored(target, candidate_bits, colors, out/'candidate.glb')
        pieces = []
        for i,part in enumerate(parts):
            selected = np.flatnonzero((candidate_bits & (1<<i)) != 0)
            if not len(selected): continue
            piece = target.submesh([selected], append=True)
            piece.export(out/(part+'.glb'))
            pieces.append({'part':part,'path':part+'.glb','triangles':int(len(selected))})
        report['pieces'] = pieces
        report['outputs'] = {p.name:{'sha256':digest(p),'bytes':p.stat().st_size} for p in out.iterdir() if p.is_file()}
        report['status'] = 'complete'; report['phase'] = 'complete'
        return report
    except Exception as error:
        report['error'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True, type=Path)
    args = parser.parse_args()
    report = run(args.manifest)
    print(json.dumps({'status':report['status'],'candidate':report['candidate'],'transfer':report['transfer']}))


if __name__ == '__main__':
    main()
