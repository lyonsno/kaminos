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
        # where 4 interior triangles have a steep mortar-groove normal (pinholes),
        # plus a 36-sided smooth cylinder (72 triangles, radius=0.04, length=1.2, pairwise dihedral=10 deg, cos=0.985 > 0.85).
        xs = np.linspace(0., 2., 11)
        ys = np.linspace(0., 2., 11)
        verts, tris = [], []
        for j in range(10):
            for i in range(10):
                b = len(verts)
                z_bump = 0.008 if (i in (4, 5) and j == 5) else 0.0
                verts.extend([
                    [xs[i], ys[j], 0.0],
                    [xs[i + 1], ys[j], 0.0],
                    [xs[i + 1], ys[j + 1], z_bump],
                    [xs[i], ys[j + 1], 0.0],
                ])
                tris.extend([[b, b + 1, b + 2], [b, b + 2, b + 3]])
        wall_tri_count = len(tris)
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
        res = hybrid.partition_surface(pos, nrm, idx)
        self.assertTrue(res['meshTriangles'][:wall_tri_count].all(),
                        'Broad wall including absorbed interior mortar pinholes must stay in mesh regime')
        self.assertTrue(res['splatTriangles'][wall_tri_count:].all(),
                        'Smooth high-curvature cylinder must split by normal cone and route to splat regime')


if __name__ == '__main__':
    unittest.main()
