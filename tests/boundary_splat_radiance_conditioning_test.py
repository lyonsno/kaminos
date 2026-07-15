import importlib.util
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "boundary_splat_conditioning.py"
SPEC = importlib.util.spec_from_file_location("boundary_splat_conditioning", SCRIPT_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class EmitterLifecycleConditioningTest(unittest.TestCase):
    def test_effective_controls_normalize_to_declared_order(self):
        frame = {
            "id": "narrow-frame",
            "sameStateCaptureId": "state-7",
            "simStepCount": 88,
            "controlConditioning": {
                "identity": "boundary-splat-emitter-lifecycle-conditioning-v0",
                "authority": "effective-runtime-controls-frozen-sim-state-v0",
                "sameStateCaptureId": "state-7",
                "simStepCount": 88,
                "values": {
                    "inputRadius": 0.08,
                    "flowRate": 2.5,
                    "fireScale": 1.3,
                    "reactionFuelScale": 0.75,
                    "lifecycleEffect": "snuff",
                    "lifecycleT": 0.25,
                    "quenchVapor": 2.0,
                },
            },
        }

        condition = MODULE.resolve_emitter_lifecycle_condition(frame, "frame 0")

        self.assertEqual(condition[MODULE.EMITTER_LIFECYCLE_CONDITION_ORDER.index("inputRadius")], 0.0)
        self.assertEqual(condition[MODULE.EMITTER_LIFECYCLE_CONDITION_ORDER.index("flowRate")], 1.0)
        self.assertEqual(condition[MODULE.EMITTER_LIFECYCLE_CONDITION_ORDER.index("fireScale")], 1.0)
        self.assertEqual(condition[MODULE.EMITTER_LIFECYCLE_CONDITION_ORDER.index("reactionFuelScale")], 0.5)
        self.assertEqual(condition[MODULE.EMITTER_LIFECYCLE_CONDITION_ORDER.index("lifecycleSnuff")], 1.0)
        self.assertEqual(condition[MODULE.EMITTER_LIFECYCLE_CONDITION_ORDER.index("lifecycleT")], 0.25)
        self.assertEqual(condition[MODULE.EMITTER_LIFECYCLE_CONDITION_ORDER.index("quenchVapor")], 1.0)

    def test_conditioning_rejects_missing_or_stale_authority(self):
        with self.assertRaisesRegex(ValueError, "control conditioning"):
            MODULE.resolve_emitter_lifecycle_condition({"id": "missing", "sameStateCaptureId": "state-1"}, "frame 0")

        stale = {
            "id": "stale",
            "sameStateCaptureId": "state-1",
            "simStepCount": 1,
            "controlConditioning": {
                "identity": "boundary-splat-emitter-lifecycle-conditioning-v0",
                "authority": "effective-runtime-controls-frozen-sim-state-v0",
                "sameStateCaptureId": "state-2",
                "simStepCount": 1,
                "values": {},
            },
        }
        with self.assertRaisesRegex(ValueError, "same-state"):
            MODULE.resolve_emitter_lifecycle_condition(stale, "frame 0")


if __name__ == "__main__":
    unittest.main()
