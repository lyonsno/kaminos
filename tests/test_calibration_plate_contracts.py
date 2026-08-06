"""Fail-first contracts for the carrier-class calibration plate builder.

The plate is an evidence surface handed to the operator. Its failure mode is not
a crash; it is looking authoritative while quietly omitting the field that would
have falsified the cell. These contracts try to make the harness lie and require
it to fail loud instead.

Run: python3 -m pytest tests/test_calibration_plate_contracts.py -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from calibration_plate import MANIFEST_SCHEMA, build_plate  # noqa: E402


def _cell(**overrides):
    cell = {
        "group": "Original prompt",
        "inputLabel": "Clean generic-cat envelope",
        "inputImage": "envelope-render/clean.png",
        "inputSha256": "a" * 64,
        "inputMeta": {"Provenance": "photo -> TRELLIS -> clay render"},
        "promptText": "Use the supplied silhouette as the exact shape guide.",
        "promptSha256": "b" * 64,
        "settings": {"Seed": 80301, "Steps": 8, "Guidance": 1.0},
        "requestedRoute": "gpu-greenroom/mflux_flux2_edit_promptfile",
        "effectiveRoute": "gpu-greenroom/mflux_flux2_edit_promptfile",
        "jobId": "deadbeef0001",
        "outputLabel": "Generated",
        "outputImage": "cells/clean/output.png",
        "outputSha256": "c" * 64,
        "observation": "Recorded observation.",
    }
    cell.update(overrides)
    return cell


def _manifest(**overrides):
    manifest = {
        "schema": MANIFEST_SCHEMA,
        "title": "Carrier-Class Calibration",
        "verdict": "Production receipt only.",
        "description": "All cells frozen except the supplied image and the prompt.",
        "comparisonClass": {
            "matched": ["seed", "model", "steps", "guidance", "resolution"],
            "varied": ["conditioning image", "prompt"],
            "knownCoupling": "prompt and image vary across the two groups",
        },
        "claimCeiling": "Does not establish carrier superiority.",
        "cells": [_cell()],
    }
    manifest.update(overrides)
    return manifest


def test_rejects_unknown_schema():
    """A manifest from another contract must not render as if it were this one."""
    with pytest.raises(ValueError, match="unsupported manifest schema"):
        build_plate(_manifest(schema="kaminos.some-other-thing.v0"))


def test_rejects_empty_cell_set():
    """An empty plate is a failed run, not a clean sheet."""
    with pytest.raises(ValueError, match="no cells"):
        build_plate(_manifest(cells=[]))


def test_full_prompt_text_is_present_verbatim():
    """The operator contract is the FULL prompt, not a truncated preview."""
    prompt = (
        "Use the supplied silhouette and proportions as the exact shape guide "
        "for one coherent living domestic cat. Render a complete continuous "
        "fur-covered exterior with natural paws, face, ears, and tail."
    )
    html = build_plate(_manifest(cells=[_cell(promptText=prompt)]))
    assert prompt in html


def test_missing_field_renders_loud_not_silent():
    """A field that was never recorded must be visible as MISSING.

    Silently dropping it would let an unrecorded seed or job id read as
    'nothing to report' on a surface the operator trusts.
    """
    html = build_plate(_manifest(cells=[_cell(jobId=None, outputSha256="")]))
    assert html.count('class="missing"') >= 2


def test_route_divergence_is_surfaced():
    """A fallback route invalidates the matched comparison and must show it."""
    html = build_plate(
        _manifest(
            cells=[
                _cell(
                    requestedRoute="gpu-greenroom/mflux_flux2_edit_promptfile",
                    effectiveRoute="gpu-greenroom/some_fallback_route",
                )
            ]
        )
    )
    assert 'class="route route-mismatch"' in html
    assert "not a clean matched comparison" in html


def test_matching_route_is_not_flagged():
    """The warning must mean something: no false alarm on an honest cell."""
    html = build_plate(_manifest())
    assert 'class="route route-mismatch"' not in html
    assert "not a clean matched comparison" not in html


def test_frozen_variable_ledger_is_rendered():
    """Matched/varied identity is a first-class published field, not prose."""
    html = build_plate(_manifest())
    assert "Frozen across cells" in html
    assert "conditioning image" in html
    assert "prompt and image vary across the two groups" in html


def test_unrecorded_comparison_class_is_loud():
    """An absent frozen-variable ledger must not render as an empty string."""
    html = build_plate(_manifest(comparisonClass={}))
    assert "UNRECORDED" in html


def test_prompt_text_is_escaped():
    """Prompt text is data, not markup; it must not inject into the plate."""
    html = build_plate(_manifest(cells=[_cell(promptText="<script>x</script>")]))
    assert "<script>x</script>" not in html
    assert "&lt;script&gt;" in html


def test_cells_are_grouped_in_manifest_order():
    """Both prompt arms appear, each under its own heading."""
    html = build_plate(
        _manifest(
            cells=[
                _cell(group="Original prompt", inputLabel="A-orig"),
                _cell(group="Neutralized prompt", inputLabel="A-neut"),
            ]
        )
    )
    assert "Original prompt" in html
    assert "Neutralized prompt" in html
    assert html.index("Original prompt") < html.index("Neutralized prompt")
