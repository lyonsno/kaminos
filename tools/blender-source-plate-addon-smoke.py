from __future__ import annotations

import json
from pathlib import Path
import sys
import traceback

import bpy


def main() -> int:
    if "--" not in sys.argv:
        raise RuntimeError("expected output directory after --")
    output_dir = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "source-plate-addon-smoke.json"
    source_root = Path(__file__).resolve().parents[1] / "blender_addons"
    sys.path.insert(0, str(source_root))

    report = {
        "schema": "kaminos.source-plate-addon-smoke.v0",
        "status": "running",
        "blenderVersion": bpy.app.version_string,
        "sourceRoot": str(source_root),
    }
    addon = None
    try:
        import kaminos_source_plate as addon

        addon.register()
        scene = bpy.context.scene
        report["effective"] = {
            "operatorRegistered": hasattr(bpy.types, "KAMINOS_OT_export_assay_plate"),
            "panelRegistered": hasattr(bpy.types, "KAMINOS_PT_source_plate"),
            "outputRootProperty": scene.kaminos_source_plate_output_root,
            "resolutionProperty": scene.kaminos_source_plate_resolution,
            "labelProperty": scene.kaminos_source_plate_label,
        }
        if not all(
            (
                report["effective"]["operatorRegistered"],
                report["effective"]["panelRegistered"],
                report["effective"]["resolutionProperty"] == 1024,
            )
        ):
            raise RuntimeError("registered add-on does not expose its complete runtime contract")
        report["status"] = "completed"
    except Exception as error:
        report["status"] = "failed"
        report["failure"] = {
            "phase": "addon-registration",
            "errorType": type(error).__name__,
            "message": str(error),
            "traceback": traceback.format_exc(),
        }
        return_code = 1
    else:
        return_code = 0
    finally:
        if addon is not None:
            try:
                addon.unregister()
            except Exception:
                report["unregisterFailure"] = traceback.format_exc()
                return_code = 1
        report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
        print(json.dumps(report, sort_keys=True))
    return return_code


raise SystemExit(main())
