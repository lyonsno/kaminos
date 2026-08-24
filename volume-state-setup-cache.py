#!/usr/bin/env python3
"""Disk cache for per-state setup products: restricted medium + smoothed lattice.

Every yielding-pipeline generation was rebuilding restricted mediums and
Gaussian-smoothed target lattices for all chain states from the raw source
rows — an unyieldable multi-minute block paid on every resume, measured live
holding operator jobs behind pure setup. These products are deterministic
functions of (manifest identity, state, rung, population, sigma, fine grid),
so they are computed once and loaded in seconds thereafter.

Cache layout, one directory per key under the cache root:
  <manifest-sha12>-<state>-g<rung>-<population>-s<sigma>-f<fine>/
    medium.npz      array fields of RestrictedMedium
    medium-meta.json  scalar fields + conservation receipt + camera
    lattice.npy     smoothed target lattice

The key embeds the manifest's own content identity (its `identity` field, a
sha256 over the capture), so a re-captured or edited manifest can never serve
stale setup products. A cache miss falls through to the real builders.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any, Callable

import numpy as np

ROOT = Path(__file__).resolve().parent

_MEDIUM_ARRAY_FIELDS = (
    "origin", "source_spacing", "spacing", "positions", "covariances",
    "coefficients", "density_coefficients", "source_counts", "coarse_cell_ids",
    "selected_mass", "remainder_mass",
)
_MEDIUM_SCALAR_FIELDS = ("source_grid", "grid", "population")


def _load_module(name: str, filename: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_FITTER = None


def _fitter() -> Any:
    global _FITTER
    if _FITTER is None:
        _FITTER = _load_module("setup_cache_fitter", "volume-multiscale-fitting-sequence.py")
    return _FITTER


def manifest_identity(manifest_path: Path) -> str:
    payload = json.loads(Path(manifest_path).read_text())
    identity = str(payload.get("identity", ""))
    if not identity:
        raise ValueError(f"manifest has no content identity: {manifest_path}")
    return identity.split(":")[-1]


def cache_key(
    manifest_sha: str, state_id: str, target_grid: int,
    population: str, sigma_cells: float, fine_grid: int,
) -> str:
    return (
        f"{manifest_sha[:12]}-{state_id}-g{int(target_grid)}-{population}"
        f"-s{float(sigma_cells):g}-f{int(fine_grid)}"
    )


def save_entry(entry_dir: Path, medium: Any, camera: dict, lattice: np.ndarray) -> None:
    entry_dir.mkdir(parents=True, exist_ok=True)
    arrays = {f: np.asarray(getattr(medium, f)) for f in _MEDIUM_ARRAY_FIELDS}
    tmp = entry_dir / "medium.npz.tmp.npz"
    np.savez(tmp, **arrays)
    tmp.replace(entry_dir / "medium.npz")
    meta = {
        "scalars": {f: getattr(medium, f) for f in _MEDIUM_SCALAR_FIELDS},
        "conservation": medium.conservation,
        "camera": camera,
    }
    (entry_dir / "medium-meta.json").write_text(json.dumps(meta))
    tmp2 = entry_dir / "lattice.npy.tmp.npy"
    np.save(tmp2, np.asarray(lattice))
    tmp2.replace(entry_dir / "lattice.npy")


def load_entry(entry_dir: Path) -> tuple[Any, dict, np.ndarray] | None:
    npz_path = entry_dir / "medium.npz"
    meta_path = entry_dir / "medium-meta.json"
    lattice_path = entry_dir / "lattice.npy"
    if not (npz_path.is_file() and meta_path.is_file() and lattice_path.is_file()):
        return None
    with np.load(npz_path) as payload:
        arrays = {f: payload[f] for f in _MEDIUM_ARRAY_FIELDS}
    meta = json.loads(meta_path.read_text())
    medium = _fitter().RestrictedMedium(
        **meta["scalars"], **arrays, conservation=meta["conservation"]
    )
    lattice = np.load(lattice_path)
    return medium, meta.get("camera") or {}, lattice


def load_or_build(
    manifest_path: Path,
    state_id: str,
    target_grid: int,
    population: str,
    sigma_cells: float,
    fine_grid: int,
    cache_root: Path | None,
    build_medium: Callable[[], tuple[Any, dict]],
    build_lattice: Callable[[Any], np.ndarray],
) -> tuple[Any, dict, np.ndarray]:
    """Return (medium, camera, lattice); build+persist on miss, load on hit.

    `build_medium` and `build_lattice` are injected so callers keep authority
    over the real construction route (and so contracts can prove hit/miss
    behavior without a full manifest fixture). cache_root=None disables
    caching entirely.
    """
    entry_dir = None
    if cache_root is not None:
        sha = manifest_identity(manifest_path)
        entry_dir = Path(cache_root) / cache_key(
            sha, state_id, target_grid, population, sigma_cells, fine_grid
        )
        cached = load_entry(entry_dir)
        if cached is not None:
            return cached
    medium, camera = build_medium()
    lattice = np.asarray(build_lattice(medium))
    if entry_dir is not None:
        save_entry(entry_dir, medium, camera, lattice)
    return medium, camera, lattice
