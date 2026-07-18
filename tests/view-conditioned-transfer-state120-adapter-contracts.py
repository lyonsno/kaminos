#!/usr/bin/env python3

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
ADAPTER_PATH = ROOT / "view-conditioned-transfer-state120-adapter.py"
ORACLE_PATH = ROOT / "volume-layer-coefficient-render-oracle.py"
REDUCER_PATH = ROOT / "view-conditioned-transfer-compression.py"


def load(path: Path, name: str):
    if not path.is_file():
        raise AssertionError(f"{name} module is absent; adapter parity has no implementation")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class State120AdapterContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.adapter = load(ADAPTER_PATH, "view_conditioned_transfer_state120_adapter")
        cls.oracle = load(ORACLE_PATH, "volume_layer_coefficient_render_oracle")
        cls.reducer = load(REDUCER_PATH, "view_conditioned_transfer_compression")

    def test_plane_conversion_matches_existing_shared_transmittance_oracle(self):
        planes = np.zeros((3, 2, 1, 8), dtype=np.float32)
        planes[0, :, :, 0] = 0.4
        planes[0, :, :, 3] = np.log(2.0)
        planes[1, :, :, 4] = 0.6
        planes[1, :, :, 7] = np.log(4.0)
        planes[2, :, :, 2] = 0.8
        path_scale = 0.75
        arrays = self.adapter.planes_to_transfer_arrays(
            planes,
            near_depth=1.0,
            far_depth=4.0,
            path_scale=path_scale,
        )
        oracle_rgb, _, _, oracle_transmittance = self.oracle.compose_planes(planes, path_scale, "total")
        radiance = np.concatenate([arrays["ridge_radiance"], arrays["nonridge_radiance"]], axis=-1)
        adapted = self.reducer.compose_transfer_sequence(
            self.reducer.transfer_slices(radiance, arrays["extinction"])
        )
        self.assertTrue(np.allclose(self.reducer.total_rgb(adapted), oracle_rgb, atol=2e-7))
        self.assertTrue(np.allclose(adapted.transmittance, oracle_transmittance, atol=2e-7))
        self.assertTrue(np.allclose(arrays["depths"], [1.5, 2.5, 3.5]))

    def test_product_manifest_binds_source_camera_route_and_array_hash(self):
        a = self.adapter
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            planes = np.zeros((2, 2, 3, 8), dtype=np.float32)
            planes[..., 0] = 0.25
            source = {
                "identity": "state120-test-source-v0",
                "stateIdentity": "coefficient-state-120",
                "cameraIdentity": "camera-10-pose-sha",
                "sourceManifestPath": "/source/training-manifest.json",
                "sourceManifestSha256": "a" * 64,
                "captureReportPath": "/source/capture-report.json",
                "captureReportSha256": "b" * 64,
                "rowCount": 1899742,
                "cameraIndex": 10,
            }
            route = {
                "requested": "state120-coefficient-plane-export-v0",
                "effective": "state120-coefficient-plane-export-v0",
                "backend": "numpy-cpu-v0",
                "fallbackUsed": False,
                "fallbackIdentity": None,
            }
            manifest_path = a.write_transfer_product(
                root,
                planes,
                near_depth=1.0,
                far_depth=3.0,
                path_scale=4.0,
                source=source,
                route=route,
            )
            product = json.loads(manifest_path.read_text())
            arrays_path = root / product["artifacts"]["arrays"]["path"]
            self.assertEqual(product["source"], source)
            self.assertEqual(product["route"], route)
            self.assertEqual(product["transfer"]["shape"], [2, 2, 3])
            self.assertEqual(product["transfer"]["pathScale"], 4.0)
            self.assertEqual(product["artifacts"]["arrays"]["bytes"], arrays_path.stat().st_size)
            self.assertEqual(product["artifacts"]["arrays"]["sha256"], a.sha256_file(arrays_path))
            loaded = self.reducer.load_transfer_input(manifest_path)
            self.assertEqual(loaded.shape, (2, 2, 3))

    def test_product_writer_rejects_fallback_and_invalid_depth_range(self):
        a = self.adapter
        planes = np.zeros((2, 1, 1, 8), dtype=np.float32)
        source = {
            "identity": "source",
            "stateIdentity": "state",
            "cameraIdentity": "camera",
        }
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, "fallback"):
                a.write_transfer_product(
                    Path(tmp),
                    planes,
                    near_depth=1.0,
                    far_depth=2.0,
                    path_scale=1.0,
                    source=source,
                    route={
                        "requested": "route",
                        "effective": "route",
                        "backend": "numpy-cpu-v0",
                        "fallbackUsed": True,
                        "fallbackIdentity": "fallback",
                    },
                )
            with self.assertRaisesRegex(ValueError, "far depth"):
                a.write_transfer_product(
                    Path(tmp),
                    planes,
                    near_depth=2.0,
                    far_depth=1.0,
                    path_scale=1.0,
                    source=source,
                    route={
                        "requested": "route",
                        "effective": "route",
                        "backend": "numpy-cpu-v0",
                        "fallbackUsed": False,
                        "fallbackIdentity": None,
                    },
                )


if __name__ == "__main__":
    unittest.main()
