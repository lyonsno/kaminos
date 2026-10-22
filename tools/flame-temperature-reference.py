#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["cantera==3.2.0"]
# ///
"""Offline HP equilibrium reference; no runtime dependency or preset mutation.

uv run tools/flame-temperature-reference.py --input request.json --out reference.json
Input: {"fuel":"CH4", "oxidizer":"O2:1, N2:3.76", "pressurePa":101325,
        "cases":[{"initialKelvin":300,"equivalenceRatio":1}, ...]}
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys


def run(request, ct, progress):
    pressure = request["pressurePa"]
    if not math.isfinite(pressure) or pressure <= 0 or not request["cases"]:
        raise ValueError("positive pressure and nonempty cases required")
    gas = ct.Solution("gri30.yaml")
    mechanism = next(Path(p) / "gri30.yaml" for p in ct.get_data_directories()
                     if (Path(p) / "gri30.yaml").is_file())
    rows = []
    progress["rows"] = rows
    for case in request["cases"]:
        progress["activeCase"] = case
        temperature, phi = case["initialKelvin"], case["equivalenceRatio"]
        if not all(math.isfinite(v) and v > 0 for v in (temperature, phi)):
            raise ValueError("positive finite temperature and equivalence ratio required")
        gas.TP = temperature, pressure
        gas.set_equivalence_ratio(phi, request["fuel"], request["oxidizer"])
        before = {"temperatureKelvin": gas.T, "pressurePa": gas.P,
                  "enthalpyMass": gas.enthalpy_mass, "massFractions": dict(zip(gas.species_names, gas.Y.tolist()))}
        gas.equilibrate("HP")
        if not math.isfinite(gas.T) or gas.T <= temperature:
            raise ValueError("reference did not produce a finite temperature rise")
        rows.append({**case, "finalKelvin": gas.T, "initial": before,
                     "final": {"pressurePa": gas.P, "enthalpyMass": gas.enthalpy_mass,
                               "massFractions": dict(zip(gas.species_names, gas.Y.tolist()))}})
    return {"identity": "kaminos.flame-temperature-reference.v1", "status": "complete",
            "requested": request, "effective": {"backend": "cantera", "version": ct.__version__,
            "constraint": "HP", "mechanism": "gri30.yaml", "mechanismSha256": hashlib.sha256(mechanism.read_bytes()).hexdigest(),
            "speciesCount": gas.n_species, "source": "https://www.cantera.org/3.2/userguide/flame-temperature.html"},
            "rows": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    report = {"status": "failed", "phase": "input", "input": str(Path(args.input).resolve())}
    try:
        def reject_constant(value):
            raise ValueError(f"non-finite JSON constant: {value}")
        def finite_float(value):
            number = float(value)
            if not math.isfinite(number):
                return reject_constant(value)
            return number
        request = json.loads(Path(args.input).read_text(), parse_constant=reject_constant, parse_float=finite_float)
        report["requested"] = request
        report["phase"] = "backend-import"
        import cantera as ct
        report["phase"] = "equilibrium"
        report = run(request, ct, report)
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
    out.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"status": report["status"], "out": str(out.resolve())}))
    return 0 if report["status"] == "complete" else 1


if __name__ == "__main__":
    sys.exit(main())
