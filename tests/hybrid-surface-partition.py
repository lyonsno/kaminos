# kaminos-test: python
import importlib.util
import io
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('hybrid', Path(__file__).resolve().parents[1] / 'tools/hybrid_surface_partition.py')
hybrid = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hybrid)


def make_hybrid_glb(path, alpha='OPAQUE'):
    # Broad 2x2 planar wall (two large triangles, area=4.0, duplicated along diagonal to test UV-seam welding)
    # plus 8 thin detached vertical pipe/blade ribbons (each 0.01 x 0.4, area=0.004 each).
    wall_pos = np.array([
        [0, 0, 0], [2, 0, 0], [2, 2, 0],
        [0, 0, 0], [2, 2, 0], [0, 2, 0],
    ], '<f4')
    wall_nrm = np.tile([0, 0, 1], (6, 1)).astype('<f4')
    wall_uv = np.array([
        [0, 0], [1, 0], [1, 1],
        [0, 0], [1, 1], [0, 1],
    ], '<f4')
    wall_idx = np.arange(6, dtype='<u4').reshape(-1, 3)

    ribbon_pos_list, ribbon_nrm_list, ribbon_uv_list, ribbon_idx_list = [], [], [], []
    base_v = 6
    for k in range(8):
        x0 = 3.0 + k * 0.1
        rp = np.array([
            [x0, 0, 0], [x0 + 0.01, 0, 0], [x0 + 0.01, 0.4, 0.05], [x0, 0.4, 0.05]
        ], '<f4')
        rn = np.tile([0, -0.12403473, 0.99227786], (4, 1)).astype('<f4')
        ruv = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], '<f4')
        ridx = np.array([[base_v, base_v + 1, base_v + 2], [base_v, base_v + 2, base_v + 3]], '<u4')
        ribbon_pos_list.append(rp)
        ribbon_nrm_list.append(rn)
        ribbon_uv_list.append(ruv)
        ribbon_idx_list.append(ridx)
        base_v += 4

    pos = np.vstack([wall_pos] + ribbon_pos_list)
    normals = np.vstack([wall_nrm] + ribbon_nrm_list)
    uv = np.vstack([wall_uv] + ribbon_uv_list)
    indices = np.vstack([wall_idx] + ribbon_idx_list)

    color = np.full((4, 4, 4), [180, 120, 90, 255], 'uint8')
    mr = np.full((4, 4, 3), [0, 160, 32], 'uint8')
    chunks = [indices.reshape(-1).tobytes(), pos.tobytes(), normals.tobytes(), uv.tobytes()]
    for pixels in [color, mr]:
        stream = io.BytesIO()
        Image.fromarray(pixels).save(stream, format='PNG')
        chunks.append(stream.getvalue())
    blob = bytearray()
    views = []
    for c in chunks:
        views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(c)})
        blob.extend(c)
        blob.extend(b'\0' * (-len(blob) % 4))
    material = {
        'pbrMetallicRoughness': {
            'baseColorTexture': {'index': 0},
            'metallicRoughnessTexture': {'index': 1},
        },
        'alphaMode': alpha,
    }
    doc = {
        'asset': {'version': '2.0'},
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0}],
        'buffers': [{'byteLength': len(blob)}],
        'bufferViews': views,
        'accessors': [
            {'bufferView': 0, 'componentType': 5125, 'type': 'SCALAR', 'count': int(indices.size)},
            {'bufferView': 1, 'componentType': 5126, 'type': 'VEC3', 'count': int(len(pos))},
            {'bufferView': 2, 'componentType': 5126, 'type': 'VEC3', 'count': int(len(normals))},
            {'bufferView': 3, 'componentType': 5126, 'type': 'VEC2', 'count': int(len(uv))},
        ],
        'meshes': [{'primitives': [{'indices': 0, 'attributes': {'POSITION': 1, 'NORMAL': 2, 'TEXCOORD_0': 3}, 'material': 0}]}],
        'materials': [material],
        'textures': [{'source': 0}, {'source': 1}],
        'images': [{'bufferView': 4, 'mimeType': 'image/png'}, {'bufferView': 5, 'mimeType': 'image/png'}],
    }
    data = json.dumps(doc).encode()
    data += b' ' * (-len(data) % 4)
    path.write_bytes(
        struct.pack('<III', 0x46546c67, 2, 28 + len(data) + len(blob))
        + struct.pack('<II', len(data), 0x4e4f534a) + data
        + struct.pack('<II', len(blob), 0x004e4942) + blob
    )
    return pos, normals, indices


class HybridPartitionTest(unittest.TestCase):
    def test_welds_uv_seams_and_separates_broad_sheet_from_thin_ribbons(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / 'hybrid.glb'
            pos, normals, indices = make_hybrid_glb(p)
            res = hybrid.partition_surface(pos, normals, indices)
            mesh_mask = res['meshTriangles']
            splat_mask = res['splatTriangles']
            self.assertEqual(len(mesh_mask), 18)
            self.assertTrue(np.array_equal(mesh_mask, ~splat_mask), 'Partition must be exact and disjoint')
            # First 2 triangles form the welded 2x2 wall; remaining 16 form thin ribbons.
            self.assertTrue(mesh_mask[:2].all(), 'Broad wall triangles across a UV seam must weld into one mesh chart')
            self.assertEqual(int(res['chartIds'][0]), int(res['chartIds'][1]))
            self.assertTrue(splat_mask[2:].all(), 'Thin low-area ribbons must route to the splat regime')
            self.assertAlmostEqual(res['stats']['meshArea'], 4.0, places=5)
            self.assertEqual(res['stats']['meshTriangleCount'], 2)
            self.assertEqual(res['stats']['splatTriangleCount'], 16)

    def test_cli_emits_mesh_subset_glb_and_enclosed_splat_region(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            p = root / 'source.glb'
            make_hybrid_glb(p)
            original = p.read_bytes()
            out = root / 'out'
            cmd = [sys.executable, str(Path(hybrid.__file__)), str(p), str(out), '--splat-count', '32']
            proc = subprocess.run(cmd, capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            report = json.loads((out / 'report.json').read_text())
            self.assertTrue(report['ok'])
            self.assertEqual(report['partition']['meshTriangleCount'], 2)
            self.assertEqual(report['partition']['splatTriangleCount'], 16)
            self.assertTrue((out / 'mesh-region.glb').exists())
            rows = np.fromfile(out / 'splat-region/surfels.f32', dtype='<f4').reshape(-1, 12)
            footprints = np.fromfile(out / 'splat-region/footprints.f32', dtype='<f4').reshape(-1, 8)
            parents = np.fromfile(out / 'splat-region/parent-triangles.u32', dtype='<u4')
            splat_report = json.loads((out / 'splat-region/report.json').read_text())
            self.assertIn('dataSHA256', splat_report)
            self.assertEqual(splat_report['footprints']['file'], 'footprints.f32')
            self.assertEqual(splat_report['footprints']['stride'], 8)
            self.assertEqual(len(rows), 32)
            self.assertEqual(len(footprints), 32)
            self.assertTrue((parents >= 2).all() and (parents < 18).all(),
                            'Splat parent triangles must map back to splat-assigned source triangle IDs')
            self.assertEqual(p.read_bytes(), original)

    def test_invalid_inputs_and_alias_guards_fail_loudly(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            p = root / 'bad.glb'
            make_hybrid_glb(p, alpha='BLEND')
            cmd = [sys.executable, str(Path(hybrid.__file__)), str(p), str(root / 'failed'), '--splat-count', '16']
            proc = subprocess.run(cmd, capture_output=True, text=True)
            self.assertNotEqual(proc.returncode, 0)
            report = json.loads((root / 'failed/report.json').read_text())
            self.assertFalse(report['ok'])
            self.assertEqual(report['phase'], 'sample')

    def test_bounded_normal_cone_and_pinhole_fill_separate_wall_from_gradual_cylinder(self):
        # Build a 2x2 planar wall subdivided into a 10x10 grid (200 triangles, area=4.0)
        # where 40 interior triangles form a shallow mortar-groove relief network (z=-0.005)
        # plus a 4-triangle protruding open-boundary tab on the edge (z=+0.08, open boundary edges)
        # plus a 36-sided smooth cylinder (72 triangles, radius=0.04, length=1.2).
        xs = np.linspace(0., 2., 11)
        ys = np.linspace(0., 2., 11)
        verts, tris = [], []
        for j in range(10):
            for i in range(10):
                b = len(verts)
                z_bump = -0.006 if (2 <= i <= 7 and j in (4, 5)) else 0.0
                verts.extend([
                    [xs[i], ys[j], 0.0],
                    [xs[i + 1], ys[j], 0.0],
                    [xs[i + 1], ys[j + 1], z_bump],
                    [xs[i], ys[j + 1], 0.0],
                ])
                tris.extend([[b, b + 1, b + 2], [b, b + 2, b + 3]])
        wall_tri_count = len(tris)
        # Add a 4-triangle protruding perpendicular open-boundary tab attached to the outer wall edge (x=2.0)
        b_tab = len(verts)
        verts.extend([
            [2.0, 0.4, 0.0], [2.0, 0.45, 0.0], [2.0, 0.45, 0.04], [2.0, 0.4, 0.04],
            [2.0, 0.45, 0.0], [2.0, 0.5, 0.0], [2.0, 0.5, 0.04], [2.0, 0.45, 0.04],
        ])
        tris.extend([
            [b_tab, b_tab + 1, b_tab + 2], [b_tab, b_tab + 2, b_tab + 3],
            [b_tab + 4, b_tab + 5, b_tab + 6], [b_tab + 4, b_tab + 6, b_tab + 7],
        ])
        tab_tri_end = len(tris)
        # Add 36-sided cylinder (radius 0.04, height 1.2)
        n_sides = 36
        angles = np.linspace(0., 2. * np.pi, n_sides, endpoint=False)
        for k in range(n_sides):
            a0, a1 = angles[k], angles[(k + 1) % n_sides]
            r = 0.04
            b = len(verts)
            verts.extend([
                [3.0 + r * np.cos(a0), r * np.sin(a0), 0.0],
                [3.0 + r * np.cos(a1), r * np.sin(a1), 0.0],
                [3.0 + r * np.cos(a1), r * np.sin(a1), 1.2],
                [3.0 + r * np.cos(a0), r * np.sin(a0), 1.2],
            ])
            tris.extend([[b, b + 1, b + 2], [b, b + 2, b + 3]])
        pos = np.asarray(verts, dtype=np.float64)
        idx = np.asarray(tris, dtype=np.int64)
        nrm = np.tile([0., 0., 1.], (len(pos), 1))
        res = hybrid.partition_surface(pos, nrm, idx, pinhole_max_triangles=8)
        self.assertTrue(res['meshTriangles'][:wall_tri_count].all(),
                        'Broad wall including shallow coplanar mortar-groove relief (>8 tris) must stay in mesh regime')
        self.assertTrue(res['splatTriangles'][wall_tri_count:tab_tri_end].all(),
                        'Protruding open-boundary edge tab must not be absorbed as an interior pinhole')
        self.assertTrue(res['splatTriangles'][tab_tri_end:].all(),
                        'Smooth high-curvature cylinder must split by normal cone and route to splat regime')

    def test_non_identity_node_transform_compacts_mesh_glb_in_world_space_and_cli_flags_work(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            p = root / 'transformed.glb'
            make_hybrid_glb(p)
            # Rewrite node 0 in transformed.glb with non-identity translation and scale
            raw = p.read_bytes()
            jlen, _ = struct.unpack_from('<II', raw, 12)
            doc = json.loads(raw[20:20 + jlen])
            bin_chunk = raw[20 + jlen:]
            doc['nodes'][0] = {'mesh': 0, 'translation': [1.5, -0.5, 2.0], 'scale': [2.0, 2.0, 2.0]}
            jbytes = json.dumps(doc).encode()
            jbytes += b' ' * (-len(jbytes) % 4)
            p.write_bytes(
                struct.pack('<III', 0x46546c67, 2, 20 + len(jbytes) + len(bin_chunk))
                + struct.pack('<II', len(jbytes), 0x4e4f534a) + jbytes + bin_chunk
            )
            out = root / 'out'
            cmd = [
                sys.executable, str(Path(hybrid.__file__)), str(p), str(out),
                '--splat-count', '32',
                '--chart-cone-cos-threshold', '0.75',
                '--min-chart-compactness', '0.06',
                '--pinhole-max-triangles', '64',
                '--relief-plane-tolerance', '0.008',
            ]
            # Run from temporary directory (outside git repo) to verify git cwd handling
            proc = subprocess.run(cmd, cwd=str(root), capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            report = json.loads((out / 'report.json').read_text())
            self.assertEqual(report['partition']['pinholeMaxTriangles'], 64)
            self.assertAlmostEqual(report['partition']['reliefPlaneTolerance'], 0.008)
            splat_report = json.loads((out / 'splat-region/report.json').read_text())
            self.assertIn('normalFallback', splat_report)

            # Parse exported mesh-region.glb and verify its vertices are compacted (only 6 wall vertices, not 38)
            # and baked into world space with an identity node transform matching splat-region.
            (_, sub_doc, _, _, _, _, _, sub_pos, _, _, _, sub_idx, sub_mat) = hybrid._parse_glb(out / 'mesh-region.glb')
            self.assertEqual(sub_doc['nodes'], [{'mesh': 0}])
            self.assertTrue(np.allclose(sub_mat, np.eye(4)))
            self.assertLessEqual(len(sub_pos), 6, 'Subset GLB must compact out unreferenced splat-only vertices')
            self.assertEqual(len(sub_idx), 2)
            self.assertTrue(np.allclose(sub_pos.min(0), [1.5, -0.5, 2.0]))
            self.assertTrue(np.allclose(sub_pos.max(0), [5.5, 3.5, 2.0]))
            self.assertLess((out / 'mesh-region.glb').stat().st_size, p.stat().st_size,
                            'Compacted subset GLB must be smaller than the full source GLB')

    def test_parser_rejects_mixed_matrix_trs_and_missing_required_keys_with_value_error(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            p = root / 'mixed.glb'
            make_hybrid_glb(p)
            raw = p.read_bytes()
            jlen, _ = struct.unpack_from('<II', raw, 12)
            base_doc = json.loads(raw[20:20 + jlen])
            bin_chunk = raw[20 + jlen:]

            def write_mutated(mut_doc, dest):
                jb = json.dumps(mut_doc).encode()
                jb += b' ' * (-len(jb) % 4)
                dest.write_bytes(
                    struct.pack('<III', 0x46546c67, 2, 20 + len(jb) + len(bin_chunk))
                    + struct.pack('<II', len(jb), 0x4e4f534a) + jb + bin_chunk
                )

            # 1. Node with both matrix and translation
            d1 = json.loads(json.dumps(base_doc))
            d1['nodes'][0] = {'mesh': 0, 'matrix': [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], 'translation': [1, 2, 3]}
            write_mutated(d1, p)
            with self.assertRaisesRegex(ValueError, 'matrix and TRS'):
                hybrid._parse_glb(p)

            # 2. Primitive missing material
            d2 = json.loads(json.dumps(base_doc))
            del d2['meshes'][0]['primitives'][0]['material']
            write_mutated(d2, p)
            with self.assertRaisesRegex(ValueError, 'Primitive requires'):
                hybrid._parse_glb(p)

            # 3. Singular matrix
            d3 = json.loads(json.dumps(base_doc))
            d3['nodes'][0] = {'mesh': 0, 'matrix': [0]*16}
            write_mutated(d3, p)
            with self.assertRaisesRegex(ValueError, 'Singular'):
                hybrid._parse_glb(p)

    def test_partition_raw_field_separates_manifold_opaque_from_glass_and_nonmanifold_sponge(self):
        # Build a closed manifold icosahedron-like subdivided octahedron (32 manifold opaque triangles, 18 vertices)
        # plus a 12-triangle closed glass tetrahedron/box (opacity = 0.25 < 0.98)
        # plus a non-manifold sponge cluster (valence-3 T-junction and valence-1 open boundary ribbons)
        # plus a tiny 4-triangle closed manifold tetrahedron flake (< min_manifold_component_triangles=16).
        def make_closed_box(origin, scale, opacity_val):
            ox, oy, oz = origin
            s = scale
            v = np.array([
                [ox, oy, oz], [ox+s, oy, oz], [ox+s, oy+s, oz], [ox, oy+s, oz],
                [ox, oy, oz+s], [ox+s, oy, oz+s], [ox+s, oy+s, oz+s], [ox, oy+s, oz+s],
                # face centers to give 24 manifold triangles per box (or 2 boxes = 48 connected if welded, or 6*4=24 tris)
                [ox+s*.5, oy+s*.5, oz], [ox+s*.5, oy+s*.5, oz+s],
                [ox+s*.5, oy, oz+s*.5], [ox+s*.5, oy+s, oz+s*.5],
                [ox, oy+s*.5, oz+s*.5], [ox+s, oy+s*.5, oz+s*.5],
            ], dtype='<f4')
            f = np.array([
                [0,2,8],[0,3,2],[0,1,8],[1,2,8],
            ], dtype='<u4')
            # Clean 24-triangle closed manifold triangulated cube (6 faces * 4 tris sharing face center)
            faces = []
            for c_idx, loop in [
                (8, [0, 3, 2, 1]),
                (9, [4, 5, 6, 7]),
                (10, [0, 1, 5, 4]),
                (11, [3, 7, 6, 2]),
                (12, [0, 4, 7, 3]),
                (13, [1, 2, 6, 5]),
            ]:
                for k in range(4):
                    faces.append([loop[k], loop[(k+1)%4], c_idx])
            f = np.asarray(faces, dtype='<u4')
            rows = np.zeros((len(v), 12), dtype='<f4')
            rows[:, :3] = v
            center = v[:8].mean(axis=0)
            n = v - center
            n /= np.linalg.norm(n, axis=1, keepdims=True)
            rows[:, 3:6] = n
            rows[:, 6:9] = [0.6, 0.4, 0.2]
            rows[:, 9] = 0.05
            rows[:, 10] = 0.7
            rows[:, 11] = opacity_val
            return rows, f

        sheet_rows, sheet_tris = make_closed_box([0., 0., 0.], 0.4, 1.0)
        glass_rows, glass_tris = make_closed_box([1.0, 0., 0.], 0.3, 0.25)
        glass_tris = glass_tris + len(sheet_rows)

        # Tiny 4-triangle closed manifold tetrahedron flake (4 < min_manifold_component_triangles=16)
        base_f = len(sheet_rows) + len(glass_rows)
        flake_v = np.array([
            [2.0, 0., 0.], [2.05, 0., 0.], [2.02, 0.05, 0.], [2.02, 0.02, 0.05]
        ], dtype='<f4')
        flake_rows = np.zeros((4, 12), dtype='<f4')
        flake_rows[:, :3] = flake_v
        flake_rows[:, 3:6] = [0., 0., 1.]
        flake_rows[:, 6:9] = [0.5, 0.5, 0.5]
        flake_rows[:, 9:12] = [0., 0.8, 1.0]
        flake_tris = np.array([
            [0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]
        ], dtype='<u4') + base_f

        # Non-manifold T-junction sponge (3 triangles sharing edge (0,1), plus open boundary edges)
        base_s = base_f + len(flake_rows)
        sponge_v = np.array([
            [3.0, 0., 0.], [3.1, 0., 0.], [3.05, 0.1, 0.], [3.05, -0.1, 0.], [3.05, 0., 0.1]
        ], dtype='<f4')
        sponge_rows = np.zeros((5, 12), dtype='<f4')
        sponge_rows[:, :3] = sponge_v
        sponge_rows[:, 3:6] = [0., 0., 1.]
        sponge_rows[:, 6:9] = [0.3, 0.3, 0.3]
        sponge_rows[:, 9:12] = [0., 0.9, 1.0]
        sponge_tris = np.array([
            [0, 1, 2], [0, 3, 1], [0, 1, 4]
        ], dtype='<u4') + base_s

        surfels = np.vstack([sheet_rows, glass_rows, flake_rows, sponge_rows])
        triangles = np.vstack([sheet_tris, glass_tris, flake_tris, sponge_tris])

        res = hybrid.partition_raw_field(surfels, triangles, min_manifold_component_triangles=16, absorb_pinhole_max_triangles=8)
        self.assertEqual(res['stats']['totalTriangles'], 55)
        self.assertEqual(res['stats']['meshTriangleCount'], 24)
        self.assertEqual(res['stats']['glassTriangleCount'], 24)
        self.assertEqual(res['stats']['spongeTriangleCount'], 7)
        self.assertTrue(res['meshTriangles'][:24].all(), 'Manifold opaque sheet >=16 tris must route to mesh')
        self.assertTrue(res['glassTriangles'][24:48].all(), 'Low-opacity closed bottle must route to glass splats')
        self.assertTrue(res['splatTriangles'][24:].all(), 'Glass, tiny flakes, and non-manifold sponge must route to splats')

        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            raw_dir = root / 'raw'
            raw_dir.mkdir()
            s_bytes = surfels.tobytes()
            t_bytes = triangles.tobytes()
            (raw_dir / 'surfels.f32').write_bytes(s_bytes)
            (raw_dir / 'triangles.u32').write_bytes(t_bytes)
            import hashlib
            (raw_dir / 'report.json').write_text(json.dumps({
                'schema': 'trellis-surfel-fields.v1',
                'ok': True,
                'phase': 'done',
                'source': 'synthetic-raw',
                'sourceHashes': {'mesh_raw.npz': 'h1', 'texture.npz': 'h2'},
                'sourceCount': len(surfels),
                'count': len(surfels),
                'stride': 12,
                'gridSize': 512,
                'radius': 0.0015625,
                'bounds': [surfels[:, :3].min(0).tolist(), surfels[:, :3].max(0).tolist()],
                'dataSHA256': hashlib.sha256(s_bytes).hexdigest(),
                'triangles': {
                    'file': 'triangles.u32',
                    'count': len(triangles),
                    'sha256': hashlib.sha256(t_bytes).hexdigest(),
                    'sourceCount': len(triangles),
                },
            }))
            out_dir = root / 'out'
            cmd = [
                sys.executable, str(Path(hybrid.__file__)), str(raw_dir), str(out_dir),
                '--raw-field', '--min-manifold-component-triangles', '16', '--pinhole-max-triangles', '8'
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            report = json.loads((out_dir / 'report.json').read_text())
            self.assertTrue(report['ok'])
            self.assertEqual(report['partition']['meshTriangleCount'], 24)
            self.assertEqual(report['partition']['splatTriangleCount'], 31)
            self.assertEqual(report['partition']['meshVertexCount'], 14)
            self.assertTrue((out_dir / 'mesh-region.glb').exists())
            splat_meta = json.loads((out_dir / 'splat-region/report.json').read_text())
            self.assertEqual(splat_meta['schema'], 'trellis-surfel-fields.v1')
            self.assertEqual(splat_meta['count'], 23)
            self.assertEqual(splat_meta['triangles']['count'], 31)
            self.assertIn('footprints', splat_meta)

    def test_raw_mesh_preserves_spatial_metal_and_roughness_without_uv_splits(self):
        rows=np.zeros((4,12),dtype='<f4')
        rows[:,:3]=[[0,0,0],[1,0,0],[0,1,0],[1,1,0]]
        rows[:,5]=1;rows[:,6:9]=.5;rows[:,11]=1
        rows[:,9:11]=[[0,.1],[.2,.3],[.7,.8],[1,1]]
        original=rows.copy()
        triangles=np.array([[0,1,2],[1,3,2]],dtype='<u4')
        with tempfile.TemporaryDirectory() as t:
            out=Path(t)/'mesh.glb';hybrid._write_raw_field_mesh_glb(rows,triangles,out)
            payload=out.read_bytes();length=struct.unpack_from('<I',payload,12)[0]
            doc=json.loads(payload[20:20+length]);blob=payload[28+length:]
            primitive=doc['meshes'][0]['primitives'][0]
            self.assertIn('_KAMINOS_MATERIAL',primitive['attributes'])
            accessor=doc['accessors'][primitive['attributes']['_KAMINOS_MATERIAL']]
            view=doc['bufferViews'][accessor['bufferView']]
            values=np.frombuffer(blob,dtype='<f4',count=accessor['count']*2,offset=view.get('byteOffset',0)).reshape(-1,2)
            np.testing.assert_array_equal(values,rows[:,9:11])
            self.assertEqual(accessor['count'],4)
            self.assertEqual(primitive['attributes']['TEXCOORD_0'],primitive['attributes']['_KAMINOS_MATERIAL'])
            np.testing.assert_array_equal(rows,original)


if __name__ == '__main__':
    unittest.main()
