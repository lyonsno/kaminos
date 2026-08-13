"""Create a Blender Armature authoring adapter from named scene controls.

The adapter exposes the existing object/empty control contract to Blender's
ordinary Weight Paint workflow. It does not bind a cast, create weights, or
claim authority over independent muscle endpoint frames.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from pathlib import Path
from typing import Any


PLAN_SCHEMA = "kaminos.blender-armature-adapter-plan.v0"
REPORT_SCHEMA = "kaminos.blender-armature-adapter-report.v0"
FAILURE_SCHEMA = "kaminos.blender-armature-adapter-failure.v0"
SOURCE_SCHEMA = "kaminos.blender-control-source.v0"
ADAPTER_ID = "blender-armature-adapter-v0"
ARMATURE_NAME = "KAMINOS_CONTROL_ADAPTER"
COLLECTION_NAME = "KAMINOS_AUTHORING_ADAPTERS"
AUTHORITY = "authoring-adapter-not-deformation-source"
MUSCLE_ENDPOINT_AUTHORITY = "external-independent-endpoint-frames"

CONTROL_SPECS: tuple[tuple[str, str | None], ...] = (
    ("core", None),
    ("pelvis", "core"),
    ("head", "core"),
    ("tail", "pelvis"),
    ("forelimb-left", "core"),
    ("forelimb-right", "core"),
    ("hindlimb-left-hip", "pelvis"),
    ("hindlimb-left-stifle", "hindlimb-left-hip"),
    ("hindlimb-left-hock", "hindlimb-left-stifle"),
    ("hindlimb-right-hip", "pelvis"),
    ("hindlimb-right-stifle", "hindlimb-right-hip"),
    ("hindlimb-right-hock", "hindlimb-right-stifle"),
)

HINDLIMB_CONTROL_SPECS: tuple[tuple[str, str | None], ...] = (
    ("pelvis", None),
    ("hindlimb-left-hip", "pelvis"),
    ("hindlimb-left-stifle", "hindlimb-left-hip"),
    ("hindlimb-left-hock", "hindlimb-left-stifle"),
    ("hindlimb-right-hip", "pelvis"),
    ("hindlimb-right-stifle", "hindlimb-right-hip"),
    ("hindlimb-right-hock", "hindlimb-right-stifle"),
)

CONTROL_PROFILES = {
    "full": CONTROL_SPECS,
    "hindlimbs": HINDLIMB_CONTROL_SPECS,
}


class AdapterError(ValueError):
    def __init__(self, code: str, message: str, phase: str = "source-validation") -> None:
        super().__init__(message)
        self.code = code
        self.phase = phase


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan-json")
    parser.add_argument("--out")
    parser.add_argument("--failure")
    parser.add_argument("--source-blend")
    parser.add_argument("--expected-source-sha256")
    parser.add_argument("--save-as")
    parser.add_argument("--bone-length", type=float)
    parser.add_argument("--profile", choices=tuple(CONTROL_PROFILES), default="hindlimbs")
    if "--" in sys.argv:
        argv = sys.argv[sys.argv.index("--") + 1 :]
    elif "bpy" in sys.modules:
        # Blender's Text Editor inherits Blender's process arguments. A
        # parameterless Run Script should apply to the currently open scene.
        argv = []
    else:
        argv = sys.argv[1:]
    return parser.parse_args(argv)


def _write_json(path: str | Path, value: Any) -> None:
    target = Path(path).expanduser().resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def _resolved_path(path: str | Path) -> Path:
    return Path(path).expanduser().resolve()


def _reject_path_aliases(paths: dict[str, str | Path | None]) -> None:
    admitted: dict[Path, str] = {}
    for role, raw_path in paths.items():
        if not raw_path:
            continue
        path = _resolved_path(raw_path)
        prior_role = admitted.get(path)
        if prior_role is not None:
            raise AdapterError(
                "path_alias",
                f"{role} aliases {prior_role}: {path}",
                "argument-validation",
            )
        admitted[path] = role


def _safe_failure_path(args: argparse.Namespace, mode: str) -> Path | None:
    candidate = args.failure or (args.out if mode == "scene" else None)
    protected = [args.plan_json] if mode == "plan" else [args.source_blend, args.save_as]
    if mode == "scene":
        try:
            import bpy

            if bpy.data.filepath:
                protected.append(bpy.data.filepath)
        except Exception:
            pass
    if candidate:
        candidate_path = _resolved_path(candidate)
        if all(not path or candidate_path != _resolved_path(path) for path in protected):
            return candidate_path

    if mode == "plan" and args.plan_json:
        source = _resolved_path(args.plan_json)
        return source.with_name(f"{source.name}.kaminos-armature-adapter-failure.json")
    if mode == "scene":
        try:
            import bpy

            return _default_report_path(bpy).resolve()
        except Exception:
            return None
    return None


def _finite_matrix(name: str, value: Any) -> list[float]:
    if not isinstance(value, list) or len(value) != 16:
        raise AdapterError("invalid_transform", f"control {name} matrixWorld must contain 16 numbers")
    matrix: list[float] = []
    for item in value:
        if isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(float(item)):
            raise AdapterError("non_finite_transform", f"control {name} contains a non-finite transform value")
        number = round(float(item), 9)
        matrix.append(0.0 if number == 0 else number)
    return matrix


def _validate_source(graph: Any, profile: str) -> dict[str, Any]:
    if not isinstance(graph, dict) or graph.get("schema") != SOURCE_SCHEMA:
        raise AdapterError("invalid_source_schema", f"source schema must be {SOURCE_SCHEMA}")
    source = graph.get("source")
    if not isinstance(source, dict):
        raise AdapterError("invalid_source_identity", "source identity is required")
    for key in ("requestedPath", "effectivePath", "sha256"):
        if not isinstance(source.get(key), str) or not source[key].strip():
            raise AdapterError("invalid_source_identity", f"source {key} is required")
    if len(source["sha256"]) != 64:
        raise AdapterError("invalid_source_identity", "source sha256 must contain 64 characters")

    raw_controls = graph.get("controls")
    if not isinstance(raw_controls, list):
        raise AdapterError("invalid_control_inventory", "controls must be a list")
    by_name: dict[str, dict[str, Any]] = {}
    for raw in raw_controls:
        if not isinstance(raw, dict) or not isinstance(raw.get("name"), str):
            raise AdapterError("invalid_control_inventory", "every control requires a string name")
        name = raw["name"]
        if name in by_name:
            raise AdapterError("duplicate_control", f"duplicate control {name}")
        by_name[name] = raw

    controls: list[dict[str, Any]] = []
    for name, expected_parent in CONTROL_PROFILES[profile]:
        raw = by_name.get(name)
        if raw is None:
            raise AdapterError("missing_control", f"required source control {name} is absent")
        source_type = raw.get("type")
        if not isinstance(source_type, str) or not source_type:
            raise AdapterError("invalid_control_type", f"control {name} requires a source type")
        actual_parent = raw.get("parent")
        if actual_parent != expected_parent:
            raise AdapterError(
                "parent_mismatch",
                f"control {name} parent must be {expected_parent!r}, got {actual_parent!r}",
            )
        control = {
                "name": name,
                "parent": expected_parent,
                "sourceType": source_type,
                "matrixWorld": _finite_matrix(name, raw.get("matrixWorld")),
                "deform": True,
        }
        source_object_name = raw.get("sourceObjectName")
        if source_object_name is not None:
            if not isinstance(source_object_name, str) or not source_object_name:
                raise AdapterError("invalid_control_inventory", f"control {name} sourceObjectName must be a string")
            control["sourceObjectName"] = source_object_name
        controls.append(control)
    return {"source": source, "controls": controls}


def _build_plan(graph: Any, profile: str) -> dict[str, Any]:
    validated = _validate_source(graph, profile)
    return {
        "schema": PLAN_SCHEMA,
        "adapterId": ADAPTER_ID,
        "status": "planned",
        "profile": profile,
        "source": validated["source"],
        "armature": {"name": ARMATURE_NAME, "authority": AUTHORITY},
        "controls": validated["controls"],
        "muscleEndpointAuthority": MUSCLE_ENDPOINT_AUTHORITY,
        "bindCastAutomatically": False,
        "idempotence": "transactional-data-swap-preserves-owned-adapter-object",
    }


def _failure(error: Exception, requested_mode: str) -> dict[str, Any]:
    phase = error.phase if isinstance(error, AdapterError) else "adapter-execution"
    evidence_by_phase = {
        "argument-validation": "arguments parsed; no source admitted",
        "plan-source-read": "plan source not admitted",
        "source-open": "requested Blender scene not admitted",
        "source-validation": "effective source opened and inspected; no adapter result admitted",
        "adapter-build": "source plan admitted; prior owned adapter preserved",
        "save": "adapter constructed in memory; saved deliverable not admitted",
    }
    evidence = evidence_by_phase.get(phase, "no adapter result admitted")
    if requested_mode == "plan" and phase == "source-validation":
        evidence = "source JSON parsed; no adapter plan admitted"
    return {
        "schema": FAILURE_SCHEMA,
        "adapterId": ADAPTER_ID,
        "status": "failed",
        "requestedMode": requested_mode,
        "failurePhase": phase,
        "errorCode": error.code if isinstance(error, AdapterError) else "unexpected_error",
        "error": str(error),
        "lastTrustworthyEvidence": evidence,
    }


def _single_child(parent: Any, role: str, name_fragment: str) -> Any:
    candidates = [
        child for child in parent.children
        if child.type == "EMPTY" and name_fragment in child.name.lower()
    ]
    if len(candidates) != 1:
        names = [candidate.name for candidate in candidates]
        raise AdapterError(
            "ambiguous_control",
            f"{role} requires one {name_fragment!r} empty child of {parent.name}, got {names}",
        )
    return candidates[0]


def _hindlimb_scene_controls(bpy: Any) -> dict[str, Any]:
    pelvis = bpy.data.objects.get("pelvis")
    if pelvis is None or pelvis.type != "EMPTY":
        raise AdapterError("missing_control", "required source control pelvis is absent")
    resolved = {"pelvis": pelvis}
    for side in ("left", "right"):
        hip = _single_child(pelvis, f"hindlimb-{side}-hip", f"hindlimb-{side}-hip")
        stifle = _single_child(hip, f"hindlimb-{side}-stifle", "stifle")
        hock = _single_child(stifle, f"hindlimb-{side}-hock", "hock")
        resolved[f"hindlimb-{side}-hip"] = hip
        resolved[f"hindlimb-{side}-stifle"] = stifle
        resolved[f"hindlimb-{side}-hock"] = hock
    return resolved


def _scene_source_graph(
    bpy: Any,
    requested_path: Path,
    effective_path: Path,
    source_sha256: str,
    profile: str,
    source_dirty: bool,
) -> dict[str, Any]:
    resolved = (
        _hindlimb_scene_controls(bpy)
        if profile == "hindlimbs"
        else {name: bpy.data.objects.get(name) for name, _parent in CONTROL_PROFILES[profile]}
    )
    controls = []
    for name, expected_parent in CONTROL_PROFILES[profile]:
        obj = resolved.get(name)
        if obj is None:
            raise AdapterError("missing_control", f"required source control {name} is absent")
        if profile == "full":
            actual_parent = obj.parent.name if obj.parent else None
            if actual_parent != expected_parent:
                raise AdapterError(
                    "parent_mismatch",
                    f"control {name} parent must be {expected_parent!r}, got {actual_parent!r}",
                )
        controls.append(
            {
                "name": name,
                "parent": expected_parent,
                "sourceObjectName": obj.name,
                "type": obj.type,
                "matrixWorld": [float(obj.matrix_world[row][column]) for row in range(4) for column in range(4)],
            }
        )
    return {
        "schema": SOURCE_SCHEMA,
        "source": {
            "requestedPath": str(requested_path),
            "effectivePath": str(effective_path),
            "lastSavedSha256": source_sha256,
            "sha256": source_sha256,
            "liveState": "dirty-unsaved" if source_dirty else "matches-saved-file",
            "provenanceAuthority": "saved-file-plus-live-controls" if source_dirty else "exact-saved-file",
        },
        "controls": controls,
    }


def _source_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _bone_length(plan: dict[str, Any], requested: float | None) -> float:
    if requested is not None:
        if not math.isfinite(requested) or requested <= 0:
            raise AdapterError("invalid_bone_length", "bone length must be finite and positive", "adapter-build")
        return requested
    points = [control["matrixWorld"] for control in plan["controls"]]
    xs = [matrix[3] for matrix in points]
    ys = [matrix[7] for matrix in points]
    zs = [matrix[11] for matrix in points]
    diagonal = math.sqrt((max(xs) - min(xs)) ** 2 + (max(ys) - min(ys)) ** 2 + (max(zs) - min(zs)) ** 2)
    return max(diagonal * 0.035, 0.001)


def _collection_in_scene(root: Any, target: Any) -> bool:
    if root == target:
        return True
    return any(_collection_in_scene(child, target) for child in root.children)


def _apply_scene(plan: dict[str, Any], bpy: Any, bone_length: float | None) -> dict[str, Any]:
    from mathutils import Matrix, Vector

    existing = bpy.data.objects.get(ARMATURE_NAME)
    if existing is not None and (
        existing.type != "ARMATURE" or existing.get("kaminos_adapter_id") != ADAPTER_ID
    ):
        raise AdapterError(
            "adapter_name_collision",
            f"object {ARMATURE_NAME} exists but is not owned by {ADAPTER_ID}",
            "adapter-build",
        )

    collection = bpy.data.collections.get(COLLECTION_NAME)
    if collection is None:
        collection = bpy.data.collections.new(COLLECTION_NAME)
    if not _collection_in_scene(bpy.context.scene.collection, collection):
        bpy.context.scene.collection.children.link(collection)

    if existing is not None and existing.name not in bpy.context.scene.objects:
        raise AdapterError(
            "adapter_outside_active_scene",
            f"owned object {ARMATURE_NAME} is not linked to the active scene",
            "adapter-build",
        )

    length = _bone_length(plan, bone_length)
    build_name = f"{ARMATURE_NAME}.__building__"
    stale_build = bpy.data.objects.get(build_name)
    if stale_build is not None:
        if stale_build.get("kaminos_adapter_id") != ADAPTER_ID:
            raise AdapterError("adapter_name_collision", f"object {build_name} is not adapter-owned", "adapter-build")
        stale_data = stale_build.data
        bpy.data.objects.remove(stale_build, do_unlink=True)
        if stale_data.users == 0:
            bpy.data.armatures.remove(stale_data)

    armature_data = bpy.data.armatures.new(build_name)
    build_object = bpy.data.objects.new(build_name, armature_data)
    collection.objects.link(build_object)
    build_object["kaminos_adapter_id"] = ADAPTER_ID

    try:
        for obj in bpy.context.selected_objects:
            obj.select_set(False)
        build_object.select_set(True)
        bpy.context.view_layer.objects.active = build_object
        bpy.ops.object.mode_set(mode="EDIT")

        edit_bones: dict[str, Any] = {}
        for control in plan["controls"]:
            matrix_world = Matrix((
                control["matrixWorld"][0:4],
                control["matrixWorld"][4:8],
                control["matrixWorld"][8:12],
                control["matrixWorld"][12:16],
            ))
            head = matrix_world.translation
            y_axis = matrix_world.to_3x3() @ Vector((0.0, 1.0, 0.0))
            z_axis = matrix_world.to_3x3() @ Vector((0.0, 0.0, 1.0))
            if y_axis.length <= 1.0e-9 or z_axis.length <= 1.0e-9:
                raise AdapterError("collapsed_control_frame", f"control {control['name']} frame collapsed", "adapter-build")
            bone = armature_data.edit_bones.new(control["name"])
            bone.head = head
            bone.tail = head + y_axis.normalized() * length
            bone.align_roll(z_axis.normalized())
            bone.use_deform = bool(control["deform"])
            bone.use_connect = False
            edit_bones[control["name"]] = bone

        for control in plan["controls"]:
            parent = control["parent"]
            if parent is not None:
                edit_bones[control["name"]].parent = edit_bones[parent]

        bpy.ops.object.mode_set(mode="OBJECT")
        for control in plan["controls"]:
            bone = armature_data.bones[control["name"]]
            bone["kaminos_source_control"] = control["name"]
            bone["kaminos_source_type"] = control["sourceType"]
            bone["kaminos_authority"] = AUTHORITY
    except Exception:
        if build_object.mode != "OBJECT":
            try:
                bpy.ops.object.mode_set(mode="OBJECT")
            except Exception:
                pass
        bpy.data.objects.remove(build_object, do_unlink=True)
        if armature_data.users == 0:
            bpy.data.armatures.remove(armature_data)
        raise

    if existing is None:
        armature_object = build_object
        armature_object.name = ARMATURE_NAME
        armature_data.name = ARMATURE_NAME
    else:
        old_data = existing.data
        existing.data = armature_data
        armature_object = existing
        bpy.data.objects.remove(build_object, do_unlink=True)
        armature_data.name = ARMATURE_NAME
        if old_data.users == 0:
            bpy.data.armatures.remove(old_data)

    armature_object.show_in_front = True
    armature_object.display_type = "WIRE"
    armature_object["kaminos_adapter_id"] = ADAPTER_ID
    armature_object["kaminos_adapter_schema"] = REPORT_SCHEMA
    armature_object["kaminos_authority"] = AUTHORITY
    armature_object["kaminos_muscle_endpoint_authority"] = MUSCLE_ENDPOINT_AUTHORITY
    armature_object["kaminos_source_sha256"] = plan["source"]["sha256"]

    armature_object.select_set(True)
    bpy.context.view_layer.objects.active = armature_object
    return {
        "schema": REPORT_SCHEMA,
        "adapterId": ADAPTER_ID,
        "status": "completed",
        "source": plan["source"],
        "blender": {"version": bpy.app.version_string},
        "armature": {
            "name": ARMATURE_NAME,
            "collection": COLLECTION_NAME,
            "authority": AUTHORITY,
            "showInFront": True,
            "boneCount": len(plan["controls"]),
            "boneNames": [control["name"] for control in plan["controls"]],
            "boneLength": length,
            "controlMappings": [
                {
                    "boneName": control["name"],
                    "sourceObjectName": control.get("sourceObjectName", control["name"]),
                    "parentBoneName": control["parent"],
                }
                for control in plan["controls"]
            ],
        },
        "muscleEndpointAuthority": MUSCLE_ENDPOINT_AUTHORITY,
        "bindCastAutomatically": False,
        "operatorNextAction": "Select the cast, shift-select KAMINOS_CONTROL_ADAPTER, then parent with empty groups and paint named vertex groups.",
    }


def _default_report_path(bpy: Any) -> Path:
    blend = Path(bpy.data.filepath)
    if blend.name:
        return blend.with_suffix(".kaminos-armature-adapter-report.json")
    return Path.home() / "kaminos-armature-adapter-report.json"


def _run_plan(args: argparse.Namespace) -> int:
    if not args.out:
        raise AdapterError("missing_output_path", "--out is required in plan mode", "argument-validation")
    _reject_path_aliases({
        "plan source": args.plan_json,
        "success report": args.out,
        "failure report": args.failure,
    })
    try:
        graph = json.loads(Path(args.plan_json).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise AdapterError("invalid_plan_source", str(error), "plan-source-read") from error
    plan = _build_plan(graph, args.profile)
    _write_json(args.out, plan)
    print(json.dumps({"status": "planned", "outputPath": str(Path(args.out).resolve())}))
    return 0


def _run_blender(args: argparse.Namespace) -> int:
    try:
        import bpy
    except ImportError as error:
        raise AdapterError("blender_required", "scene application must run inside Blender", "environment") from error

    _reject_path_aliases({
        "requested Blender source": args.source_blend,
        "success report": args.out,
        "failure report": args.failure,
        "saved Blender result": args.save_as,
    })
    requested = Path(args.source_blend).expanduser().resolve() if args.source_blend else None
    if requested:
        if not requested.is_file():
            raise AdapterError("missing_source_blend", f"source blend does not exist: {requested}", "source-open")
        if Path(bpy.data.filepath).resolve() != requested:
            result = bpy.ops.wm.open_mainfile(filepath=str(requested))
            if "FINISHED" not in result:
                raise AdapterError("source_open_cancelled", f"Blender returned {result}", "source-open")
            if not bpy.data.filepath or Path(bpy.data.filepath).resolve() != requested:
                raise AdapterError("source_route_mismatch", "Blender opened a different scene", "source-open")

    if not bpy.data.filepath:
        raise AdapterError("unsaved_source_blend", "save the Blender scene before creating the adapter", "source-validation")
    effective_path = Path(bpy.data.filepath).resolve()
    requested_path = requested or effective_path
    output_path = Path(args.out).expanduser() if args.out else _default_report_path(bpy)
    _reject_path_aliases({
        "effective Blender source": effective_path,
        "success report": output_path,
        "failure report": args.failure,
        "saved Blender result": args.save_as,
    })
    source_sha256 = _source_sha256(effective_path)
    if args.expected_source_sha256 and source_sha256 != args.expected_source_sha256:
        raise AdapterError("source_sha256_mismatch", "source Blender SHA-256 mismatch", "source-validation")

    source_dirty = bool(bpy.data.is_dirty)
    graph = _scene_source_graph(
        bpy,
        requested_path,
        effective_path,
        source_sha256,
        args.profile,
        source_dirty,
    )
    plan = _build_plan(graph, args.profile)
    report = _apply_scene(plan, bpy, args.bone_length)
    if args.save_as:
        save_path = Path(args.save_as).expanduser().resolve()
        save_path.parent.mkdir(parents=True, exist_ok=True)
        result = bpy.ops.wm.save_as_mainfile(filepath=str(save_path))
        if "FINISHED" not in result or not save_path.is_file():
            raise AdapterError("save_cancelled", f"Blender returned {result}", "save")
        report["savedBlend"] = str(save_path)
        report["savedBlendSha256"] = _source_sha256(save_path)
    _write_json(output_path, report)
    print(json.dumps({"status": "completed", "outputPath": str(output_path.resolve()), "armature": ARMATURE_NAME}))
    return 0


def main() -> int:
    args = _arguments()
    mode = "plan" if args.plan_json else "scene"
    try:
        return _run_plan(args) if mode == "plan" else _run_blender(args)
    except Exception as error:
        failure_path = _safe_failure_path(args, mode)
        if failure_path:
            _write_json(failure_path, _failure(error, mode))
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
