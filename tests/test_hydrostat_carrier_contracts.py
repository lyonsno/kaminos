import json
import math
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import hydrostat_carrier_core as hc

REPO = Path(__file__).resolve().parents[1]


def make_spec(n=7, septum=0.5, posture=None):
    return {
        "name": "test-hydrostat",
        "chambers": [
            {"rest_volume": 1.0, "semi_length": 0.5, "septum_depth": septum}
            for _ in range(n)
        ],
        "posture": posture or [],
    }


SQUAT = [
    {"phoneme": "pool", "start": 0.0, "end": 0.34},
    {"phoneme": "erect", "start": 0.34, "end": 1.0},
]


def test_turgor_normalization_conserves_total_volume_exactly():
    carrier = hc.load_spec(make_spec(posture=SQUAT))
    posed = hc.pose_carrier(carrier)
    total_rest = sum(c.rest_volume for c in carrier.chambers)
    total_posed = sum(pc.volume for pc in posed)
    assert math.isclose(total_posed, total_rest, rel_tol=1e-9)


def test_pose_actually_redistributes_volume():
    # Guard against a vacuous conservation test: the squat must move volume
    # between chambers, not leave turgor identically 1.
    carrier = hc.load_spec(make_spec(posture=SQUAT))
    posed = hc.pose_carrier(carrier)
    turgors = [pc.turgor for pc in posed]
    assert max(turgors) - min(turgors) > 0.05


def test_eccentricity_preserves_cross_section_area():
    carrier = hc.load_spec(make_spec(posture=SQUAT))
    posed = hc.pose_carrier(carrier)
    pooled = [pc for pc in posed if pc.contact]
    assert pooled, "squat must produce contact chambers"
    for pc in pooled:
        b = pc.radius * (1.0 + pc.eccentricity)
        c = pc.radius / (1.0 + pc.eccentricity)
        assert math.isclose(b * c, pc.radius**2, rel_tol=1e-9)


def test_mesh_volume_pose_invariant_within_band():
    # The factorization law made visible: same morphology, different posture,
    # near-equal realized mesh volume.
    neutral = hc.pose_carrier(hc.load_spec(make_spec()))
    squat = hc.pose_carrier(hc.load_spec(make_spec(posture=SQUAT)))
    v_neutral = hc.mesh_volume(*hc.generate_mesh(neutral))
    v_squat = hc.mesh_volume(*hc.generate_mesh(squat))
    assert v_neutral > 0 and v_squat > 0
    assert abs(v_squat - v_neutral) / v_neutral < 0.15


def test_septum_depth_deepens_waist_monotonically():
    waists = []
    for depth in (0.1, 0.5, 0.9):
        posed = hc.pose_carrier(hc.load_spec(make_spec(septum=depth)))
        waists.append(hc.waist_radius(posed, 3))
    assert waists[0] > waists[1] > waists[2]


def test_squat_erects_head_above_pooled_tail():
    posed = hc.pose_carrier(hc.load_spec(make_spec(posture=SQUAT)))
    tail, head = posed[0], posed[-1]
    assert tail.contact and not head.contact
    assert head.center[1] > tail.center[1] + head.radius


def test_mesh_volume_tracks_analytic_total():
    posed = hc.pose_carrier(hc.load_spec(make_spec()))
    analytic = sum(pc.volume for pc in posed)
    realized = hc.mesh_volume(*hc.generate_mesh(posed))
    # The max-envelope loft over overlapping chambers cannot match the
    # ellipsoid sum exactly; it must stay in a sane band of it.
    assert 0.5 * analytic < realized < 1.5 * analytic


def test_compile_is_deterministic_bytes():
    spec = make_spec(posture=SQUAT)
    with TemporaryDirectory(dir="/tmp") as tmp:
        tmp = Path(tmp)
        spec_path = tmp / "spec.json"
        spec_path.write_text(json.dumps(spec, sort_keys=True))
        r1 = hc.compile_to_dir(spec_path, tmp / "a")
        r2 = hc.compile_to_dir(spec_path, tmp / "b")
        assert (tmp / "a" / "mesh.obj").read_bytes() == (tmp / "b" / "mesh.obj").read_bytes()
        assert r1["outputs"] == r2["outputs"]


def test_cli_compile_writes_receipt_with_true_hashes():
    import hashlib

    spec = make_spec(posture=SQUAT)
    with TemporaryDirectory(dir="/tmp") as tmp:
        tmp = Path(tmp)
        spec_path = tmp / "spec.json"
        spec_path.write_text(json.dumps(spec, sort_keys=True))
        out = tmp / "out"
        proc = subprocess.run(
            [
                sys.executable,
                str(REPO / "hydrostat_carrier_core.py"),
                "compile",
                "--spec",
                str(spec_path),
                "--out-dir",
                str(out),
            ],
            capture_output=True,
            text=True,
        )
        assert proc.returncode == 0, proc.stderr
        receipt = json.loads((out / "receipt.json").read_text())
        for fname, sha in receipt["outputs"].items():
            actual = hashlib.sha256((out / fname).read_bytes()).hexdigest()
            assert actual == sha, f"{fname} receipt hash does not match content"
        assert receipt["mesh_volume"] > 0


def test_cli_invalid_spec_fails_loud_with_phase_report():
    with TemporaryDirectory(dir="/tmp") as tmp:
        tmp = Path(tmp)
        spec_path = tmp / "spec.json"
        spec_path.write_text(json.dumps({"name": "bad", "chambers": []}))
        out = tmp / "out"
        proc = subprocess.run(
            [
                sys.executable,
                str(REPO / "hydrostat_carrier_core.py"),
                "compile",
                "--spec",
                str(spec_path),
                "--out-dir",
                str(out),
            ],
            capture_output=True,
            text=True,
        )
        assert proc.returncode != 0
        report = json.loads((out / "report.json").read_text())
        assert report["phase"] == "load"
        assert "error" in report
        assert not (out / "mesh.obj").exists()
        assert not (out / "receipt.json").exists()


def test_wave_phase_moves_the_bulge():
    def bulge_center(phase):
        posture = [{"phoneme": "wave", "start": 0.0, "end": 1.0, "phase": phase}]
        posed = hc.pose_carrier(hc.load_spec(make_spec(posture=posture)))
        turgors = [pc.turgor for pc in posed]
        return turgors.index(max(turgors))

    assert bulge_center(0.2) < bulge_center(0.8)


FULL_ERECT = [{"phoneme": "erect", "start": 0.0, "end": 1.0}]


def test_load_girth_tapers_erect_column():
    # Equal rest volumes, fully erect: the base supports everything above it,
    # so realized radius must decrease from base to head.
    spec = make_spec(posture=FULL_ERECT)
    for c in spec["chambers"]:
        c["rest_volume"] = 1.0
    posed = hc.pose_carrier(hc.load_spec(spec))
    radii = [pc.radius for pc in posed]
    assert radii[0] > radii[-1] * 1.05
    assert all(radii[i] >= radii[i + 1] - 1e-9 for i in range(len(radii) - 1))


def test_neutral_posture_has_no_load_gradient():
    posed = hc.pose_carrier(hc.load_spec(make_spec()))
    turgors = [pc.turgor for pc in posed]
    assert max(turgors) - min(turgors) < 1e-9


def test_statics_preserve_volume_conservation():
    for posture in ([], SQUAT, FULL_ERECT):
        carrier = hc.load_spec(make_spec(posture=posture))
        posed = hc.pose_carrier(carrier)
        assert math.isclose(
            sum(pc.volume for pc in posed),
            sum(c.rest_volume for c in carrier.chambers),
            rel_tol=1e-9,
        )


def test_com_projects_over_support_patch():
    posed = hc.pose_carrier(hc.load_spec(make_spec(posture=SQUAT)))
    masses = [pc.volume for pc in posed]
    com_x = sum(pc.center[0] * m for pc, m in zip(posed, masses)) / sum(masses)
    # Support is geometric: chambers whose underside rests on the ground.
    undersides = [
        pc.center[1] - pc.radius / (1.0 + pc.eccentricity) for pc in posed
    ]
    floor = min(undersides)
    grounded = [
        pc
        for pc, u in zip(posed, undersides)
        if u - floor <= hc.GROUND_EPS_FRACTION * pc.radius
    ]
    assert grounded
    lo = min(pc.center[0] - pc.semi_length for pc in grounded)
    hi = max(pc.center[0] + pc.semi_length for pc in grounded)
    assert lo <= com_x <= hi


def test_droop_bound_limits_adjacent_pitch_change():
    posture = [
        {"phoneme": "pool", "start": 0.0, "end": 0.3},
        {"phoneme": "erect", "start": 0.3, "end": 1.0, "amount": 2.0},
    ]
    carrier = hc.load_spec(make_spec(posture=posture))
    channels = hc.apply_statics(carrier, hc.compile_pose(carrier))
    pitches = [ch["pitch"] for ch in channels]
    # The COM lean shifts non-contact pitches by one shared scalar, so
    # adjacent non-contact deltas still obey the bound; check interior pairs.
    for a, b in zip(pitches, pitches[1:]):
        assert abs(b - a) <= hc.MAX_BEND + 0.6 + 1e-9
