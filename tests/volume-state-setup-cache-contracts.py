#!/usr/bin/env python3
"""Fail-first contracts for the per-state setup cache."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


CACHE = load("setup_cache_contract", "volume-state-setup-cache.py")
FITTER = load("setup_cache_fitter_contract", "volume-multiscale-fitting-sequence.py")


def synthetic_medium():
    n = 5
    return FITTER.RestrictedMedium(
        source_grid=8,
        grid=4,
        population="ridge",
        origin=np.array([-1.0, -2.0, 0.5]),
        source_spacing=np.array([0.5, 0.25, 0.75]),
        spacing=np.array([1.0, 0.5, 1.5]),
        positions=np.arange(n * 3, dtype=np.float64).reshape(n, 3),
        covariances=np.tile(np.eye(3) * 0.1, (n, 1, 1)),
        coefficients=np.linspace(0.0, 1.0, n * 8).reshape(n, 8),
        density_coefficients=np.linspace(0.5, 2.0, n),
        source_counts=np.arange(n, dtype=np.uint32),
        coarse_cell_ids=np.arange(n, dtype=np.uint32) * 3,
        selected_mass=np.arange(8, dtype=np.float64),
        remainder_mass=np.arange(8, dtype=np.float64) * 0.5,
        conservation={"conserved": True, "targetGrid": 4},
    )


def write_manifest(scratch: Path, identity: str) -> Path:
    path = scratch / "manifest.json"
    path.write_text(json.dumps({"identity": f"sha256:{identity}"}))
    return path


class SetupCacheContracts(unittest.TestCase):
    def test_roundtrip_preserves_medium_camera_lattice(self) -> None:
        medium = synthetic_medium()
        camera = {"cameraPose": [1, 2, 3], "width": 320}
        lattice = np.random.default_rng(7).random((6, 6, 6))
        with tempfile.TemporaryDirectory() as scratch:
            entry = Path(scratch) / "entry"
            CACHE.save_entry(entry, medium, camera, lattice)
            loaded = CACHE.load_entry(entry)
            self.assertIsNotNone(loaded)
            got_medium, got_camera, got_lattice = loaded
            for f in CACHE._MEDIUM_ARRAY_FIELDS:
                np.testing.assert_array_equal(
                    np.asarray(getattr(got_medium, f)), np.asarray(getattr(medium, f)),
                    err_msg=f"medium field {f} drifted through the cache",
                )
            for f in CACHE._MEDIUM_SCALAR_FIELDS:
                self.assertEqual(getattr(got_medium, f), getattr(medium, f))
            self.assertEqual(got_medium.conservation, medium.conservation)
            self.assertEqual(got_camera, camera)
            np.testing.assert_array_equal(got_lattice, lattice)

    def test_hit_skips_builders_and_miss_invokes_once(self) -> None:
        medium = synthetic_medium()
        camera = {"cameraPose": [0, 0, 1], "width": 96}
        lattice = np.ones((4, 4, 4))
        calls = {"medium": 0, "lattice": 0}

        def build_medium():
            calls["medium"] += 1
            return medium, camera

        def build_lattice(m):
            calls["lattice"] += 1
            return lattice

        with tempfile.TemporaryDirectory() as scratch:
            manifest = write_manifest(Path(scratch), "a" * 64)
            root = Path(scratch) / "cache"
            first = CACHE.load_or_build(
                manifest, "coefficient-state-120", 48, "ridge", 0.6, 96,
                root, build_medium, build_lattice,
            )
            self.assertEqual(calls, {"medium": 1, "lattice": 1})
            second = CACHE.load_or_build(
                manifest, "coefficient-state-120", 48, "ridge", 0.6, 96,
                root, build_medium, build_lattice,
            )
            self.assertEqual(calls, {"medium": 1, "lattice": 1},
                             "cache hit must not re-run builders")
            np.testing.assert_array_equal(first[2], second[2])

    def test_manifest_identity_change_misses(self) -> None:
        medium = synthetic_medium()
        calls = {"n": 0}

        def build_medium():
            calls["n"] += 1
            return medium, {}

        def build_lattice(m):
            return np.zeros((2, 2, 2))

        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch) / "cache"
            m1 = write_manifest(Path(scratch), "b" * 64)
            CACHE.load_or_build(m1, "s", 16, "ridge", 0.6, 96, root, build_medium, build_lattice)
            recaptured = write_manifest(Path(scratch), "c" * 64)
            CACHE.load_or_build(recaptured, "s", 16, "ridge", 0.6, 96, root, build_medium, build_lattice)
            self.assertEqual(calls["n"], 2, "a re-captured manifest must not serve stale setup")

    def test_missing_manifest_identity_fails_loud(self) -> None:
        with tempfile.TemporaryDirectory() as scratch:
            path = Path(scratch) / "manifest.json"
            path.write_text(json.dumps({"schema": "x"}))
            with self.assertRaises(ValueError):
                CACHE.manifest_identity(path)

    def test_cache_disabled_always_builds(self) -> None:
        calls = {"n": 0}

        def build_medium():
            calls["n"] += 1
            return synthetic_medium(), {}

        with tempfile.TemporaryDirectory() as scratch:
            manifest = write_manifest(Path(scratch), "d" * 64)
            for _ in range(2):
                CACHE.load_or_build(
                    manifest, "s", 16, "ridge", 0.6, 96,
                    None, build_medium, lambda m: np.zeros((2, 2, 2)),
                )
            self.assertEqual(calls["n"], 2)


if __name__ == "__main__":
    unittest.main()
