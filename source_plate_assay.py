"""Replay-complete source-plate assay manifests and visual experiment plates.

This module records an experiment; it does not invoke a generator.  The caller
owns all paths, Molten owns generator allocation and interpretation, and the
source-plate workbench remains responsible for preserving source/projection
identity across that boundary.
"""

from __future__ import annotations

import base64
import copy
import hashlib
import html
import json
from pathlib import Path
from typing import Any


SPEC_SCHEMA = "kaminos.source-plate-assay-spec.v0"
MANIFEST_SCHEMA = "kaminos.source-plate-assay-manifest.v0"
PROMPT_GRAMMAR_SCHEMA = "kaminos.source-plate-prompt-grammar.v0"
PROMPT_CLAUSE_ORDER = (
    "sourceAuthority",
    "structural",
    "completion",
    "aesthetic",
    "projection",
    "exclusion",
)
REQUIRED_SETTING_KEYS = (
    "routeId",
    "model",
    "modelRevision",
    "steps",
    "guidance",
    "seed",
    "width",
    "height",
    "quantize",
)
REQUIRED_AUTHORITY_KEYS = (
    "guidance",
    "steps",
    "seed",
    "dimensions",
    "quantize",
)


class SourcePlateAssayError(ValueError):
    """Contract failure with a stable phase for durable failure reports."""

    def __init__(self, message: str, *, phase: str):
        super().__init__(message)
        self.phase = phase


def _fail(message: str, phase: str) -> None:
    raise SourcePlateAssayError(message, phase=phase)


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _valid_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(character in "0123456789abcdef" for character in value.lower())


def _nonempty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _positive_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _verified_file(path_value: Any, expected_sha256: Any, *, label: str, phase: str) -> Path:
    if not _nonempty(path_value) or not _valid_sha256(expected_sha256):
        _fail(f"{label} requires a path and SHA-256 identity", phase)
    path = Path(path_value)
    if not path.is_file():
        _fail(f"{label} is missing at {path}", phase)
    actual = _sha256(path.read_bytes())
    if actual != expected_sha256:
        _fail(f"{label} SHA-256 mismatch: expected {expected_sha256}, measured {actual}", phase)
    return path


def _normalize_prompt(clauses: Any) -> dict[str, Any]:
    if not isinstance(clauses, dict):
        _fail("promptClauses must be an object", "prompt-grammar")
    unknown = sorted(set(clauses) - set(PROMPT_CLAUSE_ORDER))
    missing = [name for name in PROMPT_CLAUSE_ORDER if name not in clauses]
    if missing or unknown:
        _fail(f"prompt grammar mismatch; missing={missing}, unknown={unknown}", "prompt-grammar")
    ordered = {name: clauses[name].strip() if isinstance(clauses[name], str) else clauses[name] for name in PROMPT_CLAUSE_ORDER}
    for name in PROMPT_CLAUSE_ORDER[:-1]:
        if not _nonempty(ordered[name]):
            _fail(f"prompt clause {name} must be non-empty", "prompt-grammar")
    if not isinstance(ordered["exclusion"], str):
        _fail("prompt clause exclusion must be a string; use an empty string when absent", "prompt-grammar")
    full_text = " ".join(value for value in ordered.values() if value)
    return {
        "schema": PROMPT_GRAMMAR_SCHEMA,
        "clauses": ordered,
        "fullText": full_text,
        "sha256": _sha256(full_text.encode("utf-8")),
    }


def _validate_conditioning_inputs(inputs: Any, *, verify_files: bool) -> None:
    if not isinstance(inputs, list) or not inputs:
        _fail("at least one conditioning input is required", "conditioning-input")
    slots: set[int] = set()
    for record in inputs:
        slot = record.get("slot") if isinstance(record, dict) else None
        if not isinstance(slot, int) or slot < 0 or slot in slots:
            _fail("conditioning input slots must be unique non-negative integers", "conditioning-input")
        slots.add(slot)
        if not _nonempty(record.get("role")) or not _nonempty(record.get("mediaType")):
            _fail(f"conditioning input slot {slot} lacks role or media type", "conditioning-input")
        if not _nonempty(record.get("requestedPath")) or not _nonempty(record.get("effectivePath")):
            _fail(f"conditioning input slot {slot} lacks requested/effective path identity", "conditioning-input")
        if verify_files:
            _verified_file(record["effectivePath"], record.get("sha256"), label=f"conditioning input slot {slot}", phase="conditioning-input")
        elif not _valid_sha256(record.get("sha256")):
            _fail(f"conditioning input slot {slot} lacks SHA-256 identity", "conditioning-input")
        descriptor = record.get("descriptor")
        if not isinstance(descriptor, dict) or not _nonempty(descriptor.get("requestedPath")) or not _nonempty(descriptor.get("effectivePath")):
            _fail(f"conditioning input slot {slot} lacks descriptor requested/effective identity", "conditioning-input")
        if verify_files:
            _verified_file(descriptor["effectivePath"], descriptor.get("sha256"), label=f"conditioning descriptor slot {slot}", phase="conditioning-input")
        elif not _valid_sha256(descriptor.get("sha256")):
            _fail(f"conditioning descriptor slot {slot} lacks SHA-256 identity", "conditioning-input")
        projection = record.get("projection")
        if projection.get("mode") not in {"orthographic", "perspective"}:
            _fail(f"conditioning input slot {slot} has unsupported projection mode", "projection-identity")
        if not _valid_sha256(projection.get("cameraSha256")) or not _valid_sha256(projection.get("silhouetteSha256")):
            _fail(f"conditioning input slot {slot} lacks camera/silhouette identity", "projection-identity")


def _validate_settings(requested: Any, effective: Any, status: str, *, verify_files: bool, historical_import: bool) -> None:
    if not isinstance(requested, dict) or not isinstance(effective, dict):
        _fail("requestedSettings and effectiveSettings must be objects", "effective-settings")
    for name in REQUIRED_SETTING_KEYS:
        if name not in requested or name not in effective:
            _fail(f"requested/effective settings omit {name}", "effective-settings")
    for name in ("steps", "width", "height"):
        if not _positive_int(requested[name]) or not _positive_int(effective[name]):
            _fail(f"{name} must be a positive integer", "effective-settings")
    for name in ("routeId", "model", "modelRevision"):
        if not _nonempty(requested[name]) or not _nonempty(effective[name]):
            _fail(f"{name} requires requested/effective identity", "effective-settings")
    if effective.get("fallback") is not False or effective["routeId"] != requested["routeId"]:
        _fail("renderer or route fallback is forbidden", "route-identity")
    ignored = effective.get("ignoredParams")
    if not isinstance(ignored, list):
        _fail("effective ignoredParams must be an explicit list", "effective-settings")
    authority = effective.get("settingAuthority")
    if not isinstance(authority, dict) or any(not _nonempty(authority.get(name)) for name in REQUIRED_AUTHORITY_KEYS):
        _fail("effective setting authority is incomplete", "effective-settings")
    if effective["model"] in {"flux2-klein-4b", "flux2-klein-9b"}:
        if effective["guidance"] != 1.0 or authority["guidance"] != "fixed-distilled-1.0":
            _fail("distilled FLUX.2 Klein guidance must be fixed and recorded as 1.0", "effective-settings")
    if status in {"complete", "failed"}:
        if not _nonempty(effective.get("runner")) or not _nonempty(effective.get("runnerVersion")):
            _fail("terminal manifests require effective runner identity", "effective-settings")
        if effective.get("modelRevision") == "unrecorded" and not historical_import:
            _fail("terminal manifests require an effective model revision; unrecorded is historical-import only", "effective-settings")
        if verify_files:
            _verified_file(effective.get("receiptPath"), effective.get("receiptSha256"), label="route receipt", phase="effective-settings")
        elif not _nonempty(effective.get("receiptPath")) or not _valid_sha256(effective.get("receiptSha256")):
            _fail("terminal manifests require a receipt path and SHA-256", "effective-settings")


def _validate_outputs(manifest: dict[str, Any], *, verify_files: bool) -> None:
    requested = manifest.get("requestedChannels")
    outputs = manifest.get("outputs")
    if not isinstance(requested, list) or not requested or not all(_nonempty(channel) for channel in requested):
        _fail("requestedChannels must name at least one channel", "output-validation")
    if len(requested) != len(set(requested)):
        _fail("requestedChannels must be unique", "output-validation")
    if not isinstance(outputs, list):
        _fail("outputs must be a list", "output-validation")
    if manifest["status"] == "failed":
        failure = manifest.get("failure")
        if not isinstance(failure, dict) or not _nonempty(failure.get("phase")) or not _nonempty(failure.get("message")):
            _fail("failed manifest requires failure phase and message", "failure-report")
        if not isinstance(failure.get("lastTrustworthyIdentity"), dict) or not failure["lastTrustworthyIdentity"]:
            _fail("failed manifest requires last trustworthy identity", "failure-report")
        return
    if manifest["status"] != "complete":
        return
    by_channel = {record.get("channel"): record for record in outputs if isinstance(record, dict)}
    missing = [channel for channel in requested if channel not in by_channel]
    extra = [channel for channel in by_channel if channel not in requested]
    if missing or extra or len(outputs) != len(by_channel):
        _fail(f"output set has missing requested channels={missing} or unexpected channels={extra}", "output-validation")
    paths: set[str] = set()
    for channel in requested:
        record = by_channel[channel]
        if record.get("status") != "complete" or record.get("nonblank") is not True:
            _fail(f"output {channel} is partial or blank", "output-validation")
        if record.get("cached") is not False:
            _fail(f"output {channel} is cached or has unknown cache identity", "output-validation")
        if not _positive_int(record.get("byteLength")):
            _fail(f"output {channel} is zero-byte or lacks measured size", "output-validation")
        path = record.get("path")
        if path in paths:
            _fail("multiple output channels share one artifact", "output-validation")
        paths.add(path)
        if verify_files:
            measured = _verified_file(path, record.get("sha256"), label=f"output {channel}", phase="output-validation")
            if measured.stat().st_size != record["byteLength"]:
                _fail(f"output {channel} byte length mismatch", "output-validation")
        elif not _nonempty(path) or not _valid_sha256(record.get("sha256")):
            _fail(f"output {channel} lacks path or SHA-256 identity", "output-validation")


def manifest_sha256(manifest: dict[str, Any]) -> str:
    """Hash every manifest field except the self-referential identity field."""

    payload = copy.deepcopy(manifest)
    payload.pop("manifestSha256", None)
    return _sha256(_canonical_json(payload).encode("utf-8"))


def validate_experiment_manifest(manifest: dict[str, Any], *, verify_files: bool = True) -> dict[str, Any]:
    """Validate one manifest and return a compact receipt or raise."""

    if not isinstance(manifest, dict) or manifest.get("schema") != MANIFEST_SCHEMA:
        _fail("unsupported source-plate assay manifest schema", "manifest-schema")
    if not _nonempty(manifest.get("id")) or manifest.get("status") not in {"planned", "running", "complete", "failed"}:
        _fail("manifest requires a stable id and known status", "manifest-schema")
    prompt = manifest.get("prompt")
    if not isinstance(prompt, dict) or prompt.get("schema") != PROMPT_GRAMMAR_SCHEMA:
        _fail("manifest prompt grammar is missing or unsupported", "prompt-grammar")
    normalized_prompt = _normalize_prompt(prompt.get("clauses"))
    if prompt.get("fullText") != normalized_prompt["fullText"] or prompt.get("sha256") != normalized_prompt["sha256"]:
        _fail("full prompt text or SHA-256 does not match its ordered clauses", "prompt-grammar")
    _validate_conditioning_inputs(manifest.get("conditioningInputs"), verify_files=verify_files)
    comparison = manifest.get("comparison")
    if not isinstance(comparison, dict) or not _nonempty(comparison.get("trancheId")) or not _nonempty(comparison.get("cellId")):
        _fail("manifest requires tranche and cell comparison identity", "comparison-identity")
    _validate_settings(
        manifest.get("requestedSettings"),
        manifest.get("effectiveSettings"),
        manifest["status"],
        verify_files=verify_files,
        historical_import=comparison.get("historicalImport") is True,
    )
    _validate_outputs(manifest, verify_files=verify_files)
    identity = manifest_sha256(manifest)
    if manifest.get("manifestSha256") != identity:
        _fail("manifest SHA-256 does not bind the recorded experiment", "manifest-identity")
    return {"ok": True, "status": manifest["status"], "manifestSha256": identity}


def build_experiment_manifest(spec: dict[str, Any], *, verify_files: bool = True) -> dict[str, Any]:
    """Normalize a caller-owned spec into the durable assay manifest contract."""

    if not isinstance(spec, dict) or spec.get("schema") != SPEC_SCHEMA:
        _fail("unsupported source-plate assay spec schema", "manifest-schema")
    status = spec.get("status")
    manifest = {
        "schema": MANIFEST_SCHEMA,
        "id": spec.get("id"),
        "status": status,
        "comparison": copy.deepcopy(spec.get("comparison")),
        "conditioningInputs": copy.deepcopy(spec.get("conditioningInputs")),
        "prompt": _normalize_prompt(spec.get("promptClauses")),
        "requestedSettings": copy.deepcopy(spec.get("requestedSettings")),
        "effectiveSettings": copy.deepcopy(spec.get("effectiveSettings")),
        "requestedChannels": copy.deepcopy(spec.get("requestedChannels")),
        "outputs": copy.deepcopy(spec.get("outputs")),
        "failure": copy.deepcopy(spec.get("failure")),
    }
    manifest["manifestSha256"] = manifest_sha256(manifest)
    validate_experiment_manifest(manifest, verify_files=verify_files)
    return manifest


def _image_data_uri(record: dict[str, Any], *, label: str) -> str:
    path = _verified_file(record.get("effectivePath", record.get("path")), record.get("sha256"), label=label, phase="experiment-plate")
    media_type = record.get("mediaType", "image/png")
    return f"data:{media_type};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def _settings_rows(settings: dict[str, Any]) -> str:
    names = ("routeId", "runner", "runnerVersion", "model", "modelRevision", "steps", "guidance", "seed", "width", "height", "quantize", "fallback")
    rows = "".join(
        f"<tr><th>{html.escape(name)}</th><td>{html.escape(str(settings.get(name)))}</td></tr>"
        for name in names
    )
    authority = settings.get("settingAuthority", {})
    rows += "".join(
        f"<tr><th>{html.escape(name)} authority</th><td>{html.escape(str(authority.get(name)))}</td></tr>"
        for name in REQUIRED_AUTHORITY_KEYS
    )
    return rows


def build_experiment_plate_html(manifest: dict[str, Any], *, embed_images: bool = True) -> str:
    """Render a self-contained, human-auditable experiment plate."""

    validate_experiment_manifest(manifest, verify_files=embed_images)
    input_cards = []
    for record in manifest["conditioningInputs"]:
        src = _image_data_uri(record, label=f"conditioning input slot {record['slot']}") if embed_images else Path(record["effectivePath"]).as_uri()
        input_cards.append(
            f'<figure><img src="{src}" alt="conditioning input {html.escape(record["role"])}">'
            f'<figcaption>input {record["slot"]} · {html.escape(record["role"])}<br><code>{record["sha256"]}</code></figcaption></figure>'
        )
    output_cards = []
    for record in manifest["outputs"]:
        src = _image_data_uri(record, label=f"output {record['channel']}") if embed_images else Path(record["path"]).as_uri()
        output_cards.append(
            f'<figure><img src="{src}" alt="output {html.escape(record["channel"])}">'
            f'<figcaption>output · {html.escape(record["channel"])} · {html.escape(record["status"])}<br><code>{record["sha256"]}</code></figcaption></figure>'
        )
    if not output_cards:
        output_cards.append('<div class="missing">NO AUTHORITATIVE OUTPUT</div>')
    clauses = "".join(
        f'<dt>{html.escape(name)}</dt><dd>{html.escape(value) if value else "<em>empty</em>"}</dd>'
        for name, value in manifest["prompt"]["clauses"].items()
    )
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(manifest['id'])}</title>
<style>
:root {{ color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; background:#111; color:#eee; }}
body {{ margin:0; padding:28px; }} main {{ max-width:1440px; margin:auto; }}
.header {{ display:flex; justify-content:space-between; gap:24px; border-bottom:1px solid #555; padding-bottom:16px; }}
.status {{ color:#9ee6ae; text-transform:uppercase; letter-spacing:.12em; }}
.grid {{ display:grid; grid-template-columns:minmax(300px,1fr) minmax(360px,1.25fr) minmax(300px,1fr); gap:20px; margin-top:20px; }}
.panel {{ background:#1c1c1c; border:1px solid #4a4a4a; border-radius:10px; padding:16px; overflow:hidden; }}
.images {{ display:grid; gap:12px; }} figure {{ margin:0; }} img {{ width:100%; max-height:520px; object-fit:contain; background:#bbb; }}
figcaption, code {{ overflow-wrap:anywhere; font-size:12px; color:#bbb; }} h1,h2 {{ margin-top:0; }}
.full-prompt {{ white-space:pre-wrap; line-height:1.5; padding:14px; background:#111; border-left:4px solid #e0a85a; }}
dl {{ display:grid; grid-template-columns:120px 1fr; gap:7px 12px; }} dt {{ font-weight:700; color:#e0a85a; }} dd {{ margin:0; }}
table {{ width:100%; border-collapse:collapse; }} th,td {{ text-align:left; border-bottom:1px solid #383838; padding:6px; vertical-align:top; }} th {{ width:34%; color:#e0a85a; }}
.missing {{ border:3px solid #f05b5b; color:#ffb0b0; padding:32px; font-weight:800; text-align:center; }}
</style></head>
<body><main data-manifest-sha256="{manifest['manifestSha256']}">
<div class="header"><div><h1>{html.escape(manifest['id'])}</h1><code>{manifest['manifestSha256']}</code></div><div class="status">{manifest['status']}</div></div>
<div class="grid">
<section class="panel"><h2>Conditioning inputs</h2><div class="images">{''.join(input_cards)}</div></section>
<section class="panel"><h2>Full prompt</h2><div class="full-prompt">{html.escape(manifest['prompt']['fullText'])}</div><h2>Clause ledger</h2><dl>{clauses}</dl></section>
<section class="panel"><h2>Outputs</h2><div class="images">{''.join(output_cards)}</div><h2>Effective settings</h2><table>{_settings_rows(manifest['effectiveSettings'])}</table></section>
</div></main></body></html>"""


def write_experiment_manifest(path: Path | str, manifest: dict[str, Any]) -> Path:
    """Write a validated manifest to a caller-addressed path."""

    validate_experiment_manifest(manifest)
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    return destination


def write_experiment_plate(path: Path | str, manifest: dict[str, Any], *, embed_images: bool = True) -> Path:
    """Write a validated visual plate to a caller-addressed path."""

    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(build_experiment_plate_html(manifest, embed_images=embed_images))
    return destination
