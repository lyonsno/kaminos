#!/usr/bin/env python3
import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def load_runner():
    spec = importlib.util.spec_from_file_location(
        "run_mps_geometry_control", ROOT / "run_mps_geometry_control.py"
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def main() -> None:
    runner = load_runner()

    satisfied = {
        "status": "running",
        "failurePhase": None,
        "effectiveRoute": {"targetFaces": 500_000},
        "geometry": {"finalFaces": 499_999},
    }
    assert runner.apply_target_contract(satisfied) is True
    assert satisfied["status"] == "completed"
    assert satisfied["failurePhase"] is None
    assert satisfied["geometry"]["targetSatisfied"] is True

    missed = {
        "status": "running",
        "failurePhase": None,
        "effectiveRoute": {"targetFaces": 500_000},
        "geometry": {"finalFaces": 27_134_294},
    }
    assert runner.apply_target_contract(missed) is False
    assert missed["status"] == "partial"
    assert missed["failurePhase"] == "geometry-simplification-target"
    assert missed["geometry"]["targetSatisfied"] is False


if __name__ == "__main__":
    main()
