import copy
import json
import math
import unittest
from pathlib import Path

from tools.m31_m47_articulation import (
    EligibilityError,
    advance_failure_receipt,
    deform_ring_sections,
    route_eligibility,
    rotate_about_axis,
)


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "track-m-routing" / "m31-m47-routing-fixture.json"


def _fixture():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _square_sections():
    return [
        [[-1.0, -1.0, z], [1.0, -1.0, z], [1.0, 1.0, z], [-1.0, 1.0, z]]
        for z in (0.0, 1.0, 2.0)
    ]


class FailureReceiptContracts(unittest.TestCase):
    def test_receipt_accumulates_only_established_identity(self):
        receipt = {
            "schema": "test.failure.v1",
            "status": "started",
            "failurePhase": "startup",
        }
        advance_failure_receipt(
            receipt,
            phase="source-open",
            evidence="source authenticated",
            identity={"sourceSha256": "abc", "sourceEffective": "/source.blend"},
        )
        advance_failure_receipt(
            receipt,
            phase="render-setup",
            evidence="hinge resolved",
            identity={"effectiveHinge": {"axis": [1, 0, 0]}},
        )

        self.assertEqual(receipt["failurePhase"], "render-setup")
        self.assertEqual(receipt["lastTrustworthyEvidence"], "hinge resolved")
        self.assertEqual(receipt["sourceSha256"], "abc")
        self.assertEqual(receipt["sourceEffective"], "/source.blend")
        self.assertEqual(receipt["effectiveHinge"], {"axis": [1, 0, 0]})


class EligibilityContracts(unittest.TestCase):
    def test_authentic_selected_pair_is_support_to_support(self):
        result = route_eligibility(_fixture(), ("muscle-31", "muscle-47"))

        self.assertEqual(result["status"], "eligible")
        self.assertEqual(result["supportFamily"], ["Cube.002", "Cube.003"])
        self.assertEqual(result["constructionIds"], ["muscle-31", "muscle-47"])

    def test_muscle_surface_support_fails_loud(self):
        fixture = _fixture()
        route = fixture["conditions"]["correct"]["routes"][0]
        route["insertion"]["sourceAuthority"] = "provisional_muscle_surface"
        route["insertion"]["sourceName"] = "Muscle 22 | Surface"

        with self.assertRaisesRegex(EligibilityError, "source_mesh"):
            route_eligibility(fixture, ("muscle-31", "muscle-47"))

    def test_manual_offset_marker_fails_loud(self):
        fixture = _fixture()
        fixture["conditions"]["correct"]["routes"][1]["manualOffset"] = True

        with self.assertRaisesRegex(EligibilityError, "manual offset"):
            route_eligibility(fixture, ("muscle-31", "muscle-47"))


class GeometryContracts(unittest.TestCase):
    def test_zero_angle_is_exact_identity(self):
        sections = _square_sections()
        result = deform_ring_sections(
            sections,
            origin=[0.0, 0.0, 0.0],
            insertion=[0.0, 0.0, 2.0],
            posed_insertion=[0.0, 0.0, 2.0],
        )

        self.assertEqual(result["sections"], sections)
        self.assertEqual(result["origin"], [0.0, 0.0, 0.0])
        self.assertEqual(result["insertion"], [0.0, 0.0, 2.0])
        self.assertAlmostEqual(result["radialScale"], 1.0, places=12)

    def test_fixed_origin_and_moving_insertion_are_exact(self):
        sections = _square_sections()
        posed = rotate_about_axis(
            [0.0, 0.0, 2.0],
            pivot=[0.0, 0.0, 1.0],
            axis=[1.0, 0.0, 0.0],
            angle_radians=math.radians(25.0),
        )
        result = deform_ring_sections(
            sections,
            origin=[0.0, 0.0, 0.0],
            insertion=[0.0, 0.0, 2.0],
            posed_insertion=posed,
        )

        self.assertEqual(result["origin"], [0.0, 0.0, 0.0])
        self.assertEqual(result["insertion"], posed)
        for actual, expected in zip(result["sections"][0], sections[0]):
            self.assertEqual(actual, expected)

        moved_center = [sum(point[axis] for point in result["sections"][-1]) / 4 for axis in range(3)]
        for actual, expected in zip(moved_center, posed):
            self.assertAlmostEqual(actual, expected, places=9)

    def test_volume_proxy_stays_bounded_across_sweep(self):
        sections = _square_sections()
        neutral = deform_ring_sections(
            sections,
            origin=[0.0, 0.0, 0.0],
            insertion=[0.0, 0.0, 2.0],
            posed_insertion=[0.0, 0.0, 2.0],
        )
        posed = rotate_about_axis(
            [0.0, 0.0, 2.0],
            pivot=[0.0, 0.0, 1.0],
            axis=[1.0, 0.0, 0.0],
            angle_radians=math.radians(30.0),
        )
        moved = deform_ring_sections(
            sections,
            origin=[0.0, 0.0, 0.0],
            insertion=[0.0, 0.0, 2.0],
            posed_insertion=posed,
        )

        ratio = moved["volumeProxy"] / neutral["volumeProxy"]
        self.assertGreater(ratio, 0.98)
        self.assertLess(ratio, 1.02)


if __name__ == "__main__":
    unittest.main()
