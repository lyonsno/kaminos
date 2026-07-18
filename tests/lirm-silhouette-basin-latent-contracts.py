#!/usr/bin/env python3

import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "lirm-silhouette-basin-latent.py"

if not MODULE_PATH.is_file():
    raise AssertionError("missing basin-conditioned latent route")

spec = importlib.util.spec_from_file_location("lirm_silhouette_basin_latent", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

strengths = module.parse_strengths("0,0.2,0.55")
assert strengths == [0.0, 0.2, 0.55]

mu = np.linspace(-0.5, 0.5, 8, dtype=np.float32)
std = np.linspace(0.2, 0.9, 8, dtype=np.float32)
first = module.posterior_perturbations(mu, std, strengths, samples_per_strength=3, seed=713)
second = module.posterior_perturbations(mu, std, strengths, samples_per_strength=3, seed=713)
assert len(first) == 1 + 2 * 3
assert np.array_equal(first[0]["latent"], mu)
assert first[0]["strength"] == 0.0
assert all(np.array_equal(a["latent"], b["latent"]) for a, b in zip(first, second))
assert all(not np.array_equal(item["latent"], mu) for item in first[1:])
assert len({item["latentHash"] for item in first}) == len(first)

representatives = np.array([
    [0.0, 0.0, 0.0],
    [5.0, 0.0, 0.0],
    [0.0, 5.0, 0.0],
], dtype=np.float64)
classification = module.classify_basin(np.array([4.8, 0.1, 0.0]), representatives)
assert classification["basinIndex"] == 1
assert classification["distance"] < 0.2

source = np.zeros((16, 16), dtype=np.uint8)
source[4:12, 5:11] = 1
same = source.copy()
escaped = np.zeros_like(source)
escaped[3:13, 3:13] = 1
training = np.stack([source, np.fliplr(source)])
same_assay = module.source_escape_assay(same, source, training, copy_threshold=0.94)
escaped_assay = module.source_escape_assay(escaped, source, training, copy_threshold=0.94)
assert same_assay["escapedSource"] is False
assert same_assay["nearestTraining"]["copied"] is True
assert escaped_assay["escapedSource"] is True
assert escaped_assay["nearestTraining"]["copied"] is False
same_reference = module.reference_similarity_assay(same, source, escape_threshold=0.94)
escaped_reference = module.reference_similarity_assay(escaped, source, escape_threshold=0.94)
assert same_reference == {
    "metric": "canonical-mask-iou",
    "escapeThreshold": 0.94,
    "similarity": 1.0,
    "transform": "direct",
    "escaped": False,
}
assert escaped_reference["similarity"] == 0.48
assert escaped_reference["escaped"] is True

model_corpora = [{
    "path": "/corpus/a",
    "receiptHash": "sha256:receipt-a",
    "trainingIndexHash": "sha256:index-a",
    "acceptedSampleCount": 12,
}]
atlas_corpora = [{
    "path": "/corpus/a",
    "receiptHash": "sha256:receipt-a",
    "trainingIndexHash": "sha256:index-a",
    "acceptedSourceCount": 12,
}]
assert module.validate_model_atlas_corpora(model_corpora, atlas_corpora) is True
misaligned = [dict(atlas_corpora[0], trainingIndexHash="sha256:index-b")]
try:
    module.validate_model_atlas_corpora(model_corpora, misaligned)
    raise AssertionError("model and atlas with different corpora were accepted")
except ValueError as error:
    assert "model/atlas corpus identity mismatch" in str(error)

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    corpus = root / "corpus"
    corpus.mkdir()
    receipt_path = corpus / "receipt.json"
    index_path = corpus / "training-index.jsonl"
    receipt_path.write_text('{"status":"complete"}\n')
    index_path.write_text("")
    corpus_contract = {
        "path": str(corpus),
        "receiptHash": module.sha256_bytes(receipt_path.read_bytes()),
        "trainingIndexHash": module.sha256_bytes(index_path.read_bytes()),
        "acceptedSourceCount": 0,
    }
    _receipt, rows = module.validate_corpus_source(corpus_contract)
    assert rows == []
    receipt_path.write_text('{"status":"moved"}\n')
    try:
        module.validate_corpus_source(corpus_contract)
        raise AssertionError("stale corpus receipt was accepted")
    except ValueError as error:
        assert "receipt moved beneath atlas" in str(error)

    failed_out = root / "failed"
    result = subprocess.run([
        sys.executable,
        str(MODULE_PATH),
        "--model-run-dir", str(root / "missing-model"),
        "--atlas-dir", str(root / "missing-atlas"),
        "--out-dir", str(failed_out),
    ], capture_output=True, text=True)
    assert result.returncode != 0
    failure = json.loads((failed_out / "receipt.json").read_text())
    assert failure["status"] == "failed"
    assert failure["failurePhase"] == "source_validation"
    assert failure["lastTrustworthyEvidence"] == "receipt_initialized"

    malformed_out = root / "malformed"
    malformed = subprocess.run([
        sys.executable,
        str(MODULE_PATH),
        "--model-run-dir", str(root / "unused-model"),
        "--atlas-dir", str(root / "unused-atlas"),
        "--out-dir", str(malformed_out),
        "--strengths", "0,banana",
    ], capture_output=True, text=True)
    assert malformed.returncode != 0
    malformed_receipt = json.loads((malformed_out / "receipt.json").read_text())
    assert malformed_receipt["status"] == "failed"
    assert malformed_receipt["failurePhase"] == "invocation_validation"
    assert "banana" in malformed_receipt["requestedConfig"]["strengths"]

print("LIRM silhouette basin-conditioned latent contracts passed")
