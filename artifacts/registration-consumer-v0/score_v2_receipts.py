#!/usr/bin/env python3
"""Score the three v2 articulated receipts under the FROZEN calibrated measure.

First evidential run: Trellis skin and Trellis maquette were never
operator-eyeballed; verdicts here come from the frozen thresholds alone.
Thresholds are read from calibration-receipt.v0.json and never re-fit.
"""
import json
import numpy as np

MB = "/private/tmp/kaminos-mushfinger-cast-correspondence-0807/artifacts/cast-correspondence-v0/receipts/"
CAL = json.load(open("calibration-receipt.v0.json"))
FLOOR = CAL["thresholds"]["containment_mean_min"]
MAN = json.load(open("provisional-region-manifest.v0.json"))["bone_to_region"]

CASTS = ["sf3d-skin-baseline", "trellis-skin-baseline", "trellis-maquette-baseline"]
COVERAGE_MIN = 0.8  # chain regions: spanning most of the cast structure
EYEBALLED = {"sf3d-skin-baseline"}

out = {"schema": "kaminos.registration-scoring.v0",
       "frozen_thresholds": CAL["thresholds"], "casts": {}}
for cast in CASTS:
    bc = json.load(open(MB + f"bone-containment--cast-{cast}.json"))
    ar = json.load(open(MB + f"articulated-refinement--cast-{cast}.json"))
    per = {x["name"]: x["insideFraction"] for x in bc["probe"]["perBone"]}
    regions = {}
    for n, frac in per.items():
        regions.setdefault(MAN.get(n, "unknown"), []).append(frac)
    cov = {g["group"]: g.get("coverage", {}).get("coverage")
           for g in ar["refinement"]["groups"]}
    verdicts, vec = {}, {}
    for reg, vals in sorted(regions.items()):
        m = float(np.mean(vals)); vec[reg] = round(m, 4)
        if reg == "ribcage":
            verdicts[reg] = "UNMEASURABLE-AT-BONE-GRANULARITY"
        elif reg == "caudal":
            c = cov.get("tail")
            verdicts[reg] = (f"UNDERSPANS (coverage {c:.2f})" if c and c < COVERAGE_MIN
                             else f"REGISTERS (coverage {c})")
        elif reg == "skull_mandible":
            verdicts[reg] = ("REGISTERS-CONTAINMENT-ONLY" if m >= FLOOR
                             else f"FAILS-CONTAINMENT ({m:.3f} < {FLOOR})")
        else:
            verdicts[reg] = "REGISTERS" if m >= FLOOR else f"FAILS-CONTAINMENT ({m:.3f} < {FLOOR})"
    guard = [] if cast in EYEBALLED else [
        "no operator ground truth for this cast; verdicts are instrument-only"]
    if cast == "trellis-maquette-baseline":
        guard.append("paw band barred from ground-truth-positive at global fit (calibration guard)")
    out["casts"][cast] = {"containment_mean_by_region": vec,
                          "coverage_by_group": {k: (round(v, 4) if v else None)
                                                for k, v in cov.items()},
                          "verdicts": verdicts, "guards": guard}
json.dump(out, open("scoring-receipt-three-casts.v0.json", "w"), indent=1)
for cast, r in out["casts"].items():
    print(f"== {cast}")
    for reg, v in r["verdicts"].items():
        print(f"  {reg:15s} {v}")
print("wrote scoring-receipt-three-casts.v0.json")
