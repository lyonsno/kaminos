#!/usr/bin/env python3
"""Fail-first contracts for the render-loss delta tracker (v1).

Load-bearing properties:
1. Identity at init — an untrained tracker must reproduce the frozen arm
   exactly (zero deltas), so training can only improve on the measured floor.
2. Gradients flow through the reparameterization — optimizing MLP weights
   through the render loss must strictly reduce the loss on a tiny fixture.
   This is THE contract: it proves render-space training reaches the network.
3. Checkpoint roundtrip — weights + Adam moments + step survive a save/load,
   so yielded training resumes as one optimization (the fresh-moments
   shatter mode is already characterized on fits; trainers inherit the law).
"""

from __future__ import annotations

import importlib.util
import builtins
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


TRACKER = load("delta_tracker_contract", "volume-splat-delta-tracker-mlx.py")
oracle_tests = load("tracker_oracle_tests", "tests/volume-grid16-ceiling-oracle-contracts.py")
CONTRACT_SPEC = load("tracker_target_contract", "volume-grid16-reconstruction-target-contract.py")
synthetic_medium = oracle_tests.synthetic_medium
synthetic_camera = oracle_tests.synthetic_camera


def tiny_pair():
    """One synthetic hop pair: state A (3 splats) against field B."""
    medium = synthetic_medium()
    lattice_b, _ = CONTRACT_SPEC.build_gaussian_density_lattice(
        medium, sigma_cells=0.6, fine_grid=16
    )
    rng = np.random.default_rng(11)
    n = 3
    lower = np.asarray(medium.origin, dtype=np.float64)
    extent = np.asarray(medium.source_spacing, dtype=np.float64) * medium.source_grid
    state_a = {
        "centers": lower + extent * (0.3 + 0.4 * rng.random((n, 3))),
        "covariances": np.tile(np.eye(3) * float(np.mean(medium.spacing)) ** 2, (n, 1, 1)),
        "emission": 0.5 + rng.random((n, 3)),
        "extinction": 0.5 + rng.random(n),
    }
    return medium, state_a, lattice_b


class TrackerCheckpointCompatibilityContracts(unittest.TestCase):
    """Archive admission is CPU-only and precedes model or target work."""

    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.checkpoint = Path(self.scratch.name) / "tracker-weights.npz"
        # Historical archive layout: no parameterization identity.
        np.savez(self.checkpoint, __step__=7, **{
            "weight.w1": np.ones((TRACKER.FEATURE_DIM, 2)),
            "opt.step": np.asarray(7),
        })
        self.before = self.checkpoint.read_bytes()

    def cpu_only(self):
        original = builtins.__import__

        def guarded(name, *args, **kwargs):
            if name == "mlx" or name.startswith("mlx."):
                raise AssertionError("checkpoint reached MLX before compatibility rejection")
            return original(name, *args, **kwargs)

        return patch("builtins.__import__", side_effect=guarded)

    def test_training_rejects_unversioned_archive_before_mlx(self):
        with self.cpu_only(), self.assertRaisesRegex(ValueError, "parameterization"):
            TRACKER.train(
                pairs=[], cameras=[], fit_width=1, fit_samples_per_cell=1,
                iterations=1, learning_rate=1e-3, seed=0,
                checkpoint_path=self.checkpoint,
            )
        self.assertEqual(self.checkpoint.read_bytes(), self.before)

    def test_rollout_rejects_unversioned_archive_before_mlx(self):
        module = load("tracker_rollout_admission", "volume-tracker-rollout-eval-offline.py")
        with patch.object(module, "WEIGHTS", self.checkpoint), self.cpu_only():
            with self.assertRaisesRegex(ValueError, "parameterization"):
                module.main()
        self.assertEqual(self.checkpoint.read_bytes(), self.before)

    def test_anatomy_rejects_unversioned_archive_before_target_work(self):
        module = load("tracker_anatomy_admission", "volume-tracker-error-anatomy-offline.py")
        with patch.object(module, "OUT", self.checkpoint.parent), self.cpu_only():
            with patch.object(module, "fitted", side_effect=AssertionError(
                "checkpoint reached target work before compatibility rejection"
            )):
                with self.assertRaisesRegex(ValueError, "parameterization"):
                    module.main()
        self.assertEqual(self.checkpoint.read_bytes(), self.before)

    def test_save_does_not_relabel_an_existing_legacy_archive(self):
        with self.cpu_only(), self.assertRaisesRegex(ValueError, "parameterization"):
            TRACKER.save_checkpoint(self.checkpoint, step=0, weights={}, optimizer_state={})
        self.assertEqual(self.checkpoint.read_bytes(), self.before)

    def test_loader_rejects_mismatched_or_malformed_identity(self):
        for identity in ("legacy-full-covariance", "unknown-future-version", 1,
                         [TRACKER.RAW_PARAMETERIZATION]):
            with self.subTest(identity=identity):
                np.savez(self.checkpoint, **{TRACKER.RAW_PARAMETERIZATION_KEY: identity})
                before = self.checkpoint.read_bytes()
                with self.cpu_only(), self.assertRaisesRegex(ValueError, "parameterization"):
                    TRACKER.load_checkpoint(self.checkpoint)
                self.assertEqual(self.checkpoint.read_bytes(), before)

    def test_current_checkpoint_roundtrip_preserves_identity_and_training_state(self):
        path = self.checkpoint.parent / "corrected-tracker.npz"
        weight = np.arange(6, dtype=np.float32).reshape(3, 2)
        moment = weight / 8
        with self.cpu_only():
            TRACKER.save_checkpoint(path, step=11, weights={"w1": weight},
                                    optimizer_state={"step": 11, "m": {"w1": moment}})
            archive = TRACKER.load_checkpoint(path)
            self.assertEqual(archive[TRACKER.RAW_PARAMETERIZATION_KEY].item(), TRACKER.RAW_PARAMETERIZATION)
            self.assertEqual(archive["__step__"].item(), 11)
            self.assertEqual(archive["opt.step"].item(), 11)
            np.testing.assert_array_equal(archive["weight.w1"], weight)
            np.testing.assert_array_equal(archive["opt.m/w1"], moment)
            # Additive metadata does not change admission authority.
            np.savez(path, **archive, future_metadata="preserve")
            self.assertEqual(TRACKER.load_checkpoint(path)["future_metadata"].item(), "preserve")
            TRACKER.save_checkpoint(path, step=12, weights={"w1": weight}, optimizer_state={"step": 12})
            self.assertEqual(TRACKER.load_checkpoint(path)["__step__"].item(), 12)
        self.assertEqual(self.checkpoint.read_bytes(), self.before)


class DeltaTrackerContracts(unittest.TestCase):
    def test_identity_at_init(self) -> None:
        medium, state_a, lattice_b = tiny_pair()
        model = TRACKER.DeltaTracker(feature_dim=TRACKER.FEATURE_DIM, seed=3)
        features = TRACKER.splat_features(state_a, lattice_b, lattice_b, medium)
        raw_a = TRACKER.state_to_raw_np(state_a, medium)
        updated = TRACKER.apply_tracker_np(model, features, raw_a)
        for key in raw_a:
            np.testing.assert_allclose(
                updated[key], raw_a[key], atol=1e-6,
                err_msg=f"untrained tracker perturbed raw parameter {key}",
            )

    def test_render_loss_gradients_reach_the_network(self) -> None:
        medium, state_a, lattice_b = tiny_pair()
        with tempfile.TemporaryDirectory() as scratch:
            result = TRACKER.train(
                pairs=[TRACKER.TrainingPair("a", "b", state_a, lattice_b, lattice_b, medium)],
                cameras=[synthetic_camera()],
                fit_width=24,
                fit_samples_per_cell=3,
                iterations=15,
                learning_rate=1e-3,
                seed=5,
                checkpoint_path=Path(scratch) / "tracker.npz",
            )
            losses = result["losses"]
            self.assertGreater(len(losses), 10)
            self.assertLess(
                losses[-1], losses[0],
                f"render loss did not decrease through the MLP: {losses[0]:.5f} -> {losses[-1]:.5f}",
            )

    def test_checkpoint_roundtrip_preserves_weights_moments_step(self) -> None:
        medium, state_a, lattice_b = tiny_pair()
        with tempfile.TemporaryDirectory() as scratch:
            ckpt = Path(scratch) / "tracker.npz"
            first = TRACKER.train(
                pairs=[TRACKER.TrainingPair("a", "b", state_a, lattice_b, lattice_b, medium)],
                cameras=[synthetic_camera()],
                fit_width=24,
                fit_samples_per_cell=3,
                iterations=6,
                learning_rate=1e-3,
                seed=5,
                checkpoint_path=ckpt,
            )
            self.assertTrue(ckpt.is_file())
            archive = np.load(ckpt)
            self.assertIn("__step__", archive.files)
            self.assertEqual(int(archive["__step__"]), 6)
            self.assertTrue(any(k.startswith("opt.") for k in archive.files),
                            "Adam moments missing from tracker checkpoint")
            second = TRACKER.train(
                pairs=[TRACKER.TrainingPair("a", "b", state_a, lattice_b, lattice_b, medium)],
                cameras=[synthetic_camera()],
                fit_width=24,
                fit_samples_per_cell=3,
                iterations=10,
                learning_rate=1e-3,
                seed=5,
                checkpoint_path=ckpt,
            )
            self.assertEqual(second["startStep"], 6)
            self.assertEqual(second["completedSteps"], 10)


if __name__ == "__main__":
    unittest.main()
