#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "volume-nonridge-source-basis-ridge-assay.py");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kaminos-nonridge-ridge-assay-"));

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function writeF32(filePath, values, shape, semanticRole) {
  const array = Float32Array.from(values);
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  fs.writeFileSync(filePath, bytes);
  return {
    path: filePath,
    bytes: bytes.byteLength,
    byteLength: bytes.byteLength,
    sha256: sha256(bytes),
    dtype: "float32-le",
    shape,
    semanticRole,
  };
}

function makeSetting(id, role, phase, rows = 256) {
  const current = [];
  const complete = [];
  const targets = [];
  let positiveMembershipRows = 0;
  let negativeMembershipRows = 0;
  let positiveOpticalRows = 0;
  for (let index = 0; index < rows; index += 1) {
    const u = ((index * 37 + phase * 19) % rows) / (rows - 1) * 2 - 1;
    const nuisance = Math.sin(index * 1.71 + phase) * 0.08;
    const membership = u > 0 ? 1 : 0;
    const opticalOnly = !membership && index === 0;
    const emission = membership
      ? [0.4 + 0.3 * u, 0.2 + 0.2 * u, 0.1 + 0.1 * u]
      : opticalOnly ? [0.03, 0.02, 0.01] : [0, 0, 0];
    const extinction = membership ? 0.15 + 0.25 * u : opticalOnly ? 0.02 : 0;
    current.push(nuisance, Math.cos(index * 0.93 + phase) * 0.08);
    complete.push(nuisance, Math.cos(index * 0.93 + phase) * 0.08, u);
    targets.push(membership, ...emission, extinction);
    positiveMembershipRows += membership;
    negativeMembershipRows += 1 - membership;
    positiveOpticalRows += Number(emission.some((value) => value > 0) || extinction > 0);
  }
  const base = path.join(tmp, id);
  return {
    id,
    splitRole: role,
    effectiveControlIdentity: `sha256:${sha256(Buffer.from(id))}`,
    effectiveControls: { "support.thermal": phase / 10 },
    requestedControls: { "support.thermal": phase / 10 },
    negativeControl: false,
    targetSummary: { positiveMembershipRows, negativeMembershipRows, positiveOpticalRows, allTargetsZero: false },
    rows: {
      count: rows,
      current16: writeF32(`${base}-current.f32`, current, [rows, 2], "candidate-features-current16"),
      sourceComplete: writeF32(`${base}-complete.f32`, complete, [rows, 3], "candidate-features-source-complete"),
      targets: writeF32(`${base}-targets.f32`, targets, [rows, 5], "supervision-targets-positive-nonridge"),
    },
  };
}

const settings = [
  makeSetting("setting-a", "train", 1),
  makeSetting("setting-b", "train", 2),
  makeSetting("setting-c", "heldOut", 3),
];

function coverage(settingIds) {
  return settingIds.reduce((summary, id) => {
    const target = settings.find((setting) => setting.id === id).targetSummary;
    summary.positiveMembershipRows += target.positiveMembershipRows;
    summary.negativeMembershipRows += target.negativeMembershipRows;
    summary.positiveOpticalRows += target.positiveOpticalRows;
    return summary;
  }, { positiveMembershipRows: 0, negativeMembershipRows: 0, positiveOpticalRows: 0 });
}

const corpus = {
  schema: "kaminos.volume.nonridge-source-basis-corpus.v0",
  status: "complete",
  failurePhase: null,
  identity: `sha256:${"a".repeat(64)}`,
  authority: "checksum-bound-randomized-nonridge-source-basis-v0",
  verdictAuthority: null,
  assayStatus: "capture-tranche-complete-awaiting-verdict-v0",
  featureViews: {
    current16: {
      identity: "synthetic-current-v0",
      order: ["current.a", "current.b"],
      includesControls: false,
      includesTargets: false,
    },
    sourceComplete: {
      identity: "synthetic-source-complete-v0",
      order: ["current.a", "current.b", "source.signal"],
      includesControls: false,
      includesTargets: false,
    },
  },
  targets: {
    identity: "positive-nonridge-membership-emission-extinction-v0",
    order: [
      "candidate.nonRidgeMembership",
      "nonRidge.emission.r",
      "nonRidge.emission.g",
      "nonRidge.emission.b",
      "nonRidge.extinction",
    ],
    membershipTeacherLeakageIntoFeatures: false,
    semanticRole: "supervision-only",
  },
  cohort: {
    identity: "full-grid",
    retentionPolicy: "retain-all-admitted-settings-and-rows-uncapped-v0",
    sampleCap: null,
    retainedSettingCount: settings.length,
    droppedRowCount: 0,
    totalRows: settings.reduce((sum, setting) => sum + setting.rows.count, 0),
  },
  design: { computed: { rank: 2, requiredRank: 2 } },
  splits: {
    identity: "whole-effective-control-setting-holdout-v0",
    train: {
      settingIds: ["setting-a", "setting-b"],
      effectiveControlIdentities: settings.slice(0, 2).map((setting) => setting.effectiveControlIdentity),
    },
    heldOut: {
      settingIds: ["setting-c"],
      effectiveControlIdentities: [settings[2].effectiveControlIdentity],
    },
    targetCoverage: {
      train: coverage(["setting-a", "setting-b"]),
      heldOut: coverage(["setting-c"]),
    },
  },
  ablations: [{
    ablation: "source-complete-drop-one-channel-v0",
    baselineView: "current16",
    channel: "source.signal",
    sourceCompleteIndex: 2,
  }],
  settings,
};

const corpusPath = path.join(tmp, "corpus-manifest.json");
const corpusBytes = Buffer.from(`${JSON.stringify(corpus, null, 2)}\n`);
fs.writeFileSync(corpusPath, corpusBytes);
const corpusSha = sha256(corpusBytes);
const outDir = path.join(tmp, "result");

const result = spawnSync("python3", [
  SCRIPT,
  "--corpus-manifest", corpusPath,
  "--corpus-manifest-sha256", corpusSha,
  "--out-dir", outDir,
  "--calibration-setting", "setting-b",
  "--chunk-rows", "64",
], { cwd: ROOT, encoding: "utf8" });

assert.equal(result.status, 0, `ridge assay failed:\nstdout=${result.stdout}\nstderr=${result.stderr}`);
const report = JSON.parse(fs.readFileSync(path.join(outDir, "assay-manifest.json"), "utf8"));
assert.equal(report.schema, "kaminos.volume.nonridge-source-basis-ridge-assay.v0");
assert.equal(report.status, "complete");
assert.equal(report.failurePhase, null);
assert.equal(report.source.corpusManifestSha256, corpusSha);
assert.equal(report.source.corpusIdentity, corpus.identity);
assert.equal(report.source.corpusManifestRead, "single-byte-snapshot-v0");
assert.match(report.source.implementation.scriptSha256, /^[a-f0-9]{64}$/);
assert.equal(report.source.implementation.gitCommit.length, 40);
assert.equal(report.rows.policy, "all-rows-streamed-uncapped-v0");
assert.equal(report.rows.evaluationMode, "chunk-streamed-no-full-role-materialization-v0");
assert.equal(report.rows.fit.settingIds.join(","), "setting-a");
assert.equal(report.rows.calibration.settingIds.join(","), "setting-b");
assert.equal(report.rows.heldOut.settingIds.join(","), "setting-c");
assert.equal(report.training.calibrationSelection, "lexical-last-nonblack-train-setting-v0");
assert.equal(report.views.current16.rowsEvaluated, 256);
assert.equal(report.views.sourceComplete.rowsEvaluated, 256);
assert.ok(
  report.views.sourceComplete.metrics.membership.soft.rmse
    < report.views.current16.metrics.membership.soft.rmse * 0.55,
  "source-complete should materially reduce soft error on the synthetic step target",
);
assert.ok(report.views.sourceComplete.metrics.membership.strongSupport.f1 > 0.95);
assert.ok(report.views.sourceComplete.metrics.optical.positiveSupport.rmseMean < 0.08);
assert.equal(report.views.sourceComplete.metrics.optical.positiveSupport.rows, 129);
assert.equal(report.views.sourceComplete.calibration.supportBalance.positiveOptical, 129);
assert.equal(report.ablations.length, 1);
assert.equal(report.ablations[0].droppedChannel, "source.signal");
assert.ok(report.ablations[0].metrics.membership.soft.rmse > report.views.sourceComplete.metrics.membership.soft.rmse);
assert.ok(report.views.sourceComplete.metrics.optical.predictedAnySupportGated.rmseMean < 0.14);
assert.equal(report.verification.currentPrefixExactBytes, true);
assert.equal(report.verification.artifactsPostConsumptionVerified, true);

const blackCalibrationCorpus = structuredClone(corpus);
const blackCalibrationSetting = blackCalibrationCorpus.settings.find((setting) => setting.id === "setting-b");
blackCalibrationSetting.rows.targets = writeF32(
  path.join(tmp, "setting-b-black-targets.f32"),
  new Array(256 * 5).fill(0),
  [256, 5],
  "supervision-targets-positive-nonridge",
);
blackCalibrationSetting.targetSummary = {
  positiveMembershipRows: 0,
  negativeMembershipRows: 256,
  positiveOpticalRows: 0,
  allTargetsZero: true,
};
const blackCalibrationPath = path.join(tmp, "black-calibration-corpus-manifest.json");
const blackCalibrationBytes = Buffer.from(`${JSON.stringify(blackCalibrationCorpus, null, 2)}\n`);
fs.writeFileSync(blackCalibrationPath, blackCalibrationBytes);
const blackCalibrationOut = path.join(tmp, "black-calibration-result");
const blackCalibration = spawnSync("python3", [
  SCRIPT,
  "--corpus-manifest", blackCalibrationPath,
  "--corpus-manifest-sha256", sha256(blackCalibrationBytes),
  "--out-dir", blackCalibrationOut,
  "--calibration-setting", "setting-b",
], { cwd: ROOT, encoding: "utf8" });
assert.notEqual(blackCalibration.status, 0, "an all-black calibration setting must fail loud");
const blackCalibrationFailure = JSON.parse(
  fs.readFileSync(path.join(blackCalibrationOut, "failure-report.json"), "utf8"),
);
assert.equal(blackCalibrationFailure.failurePhase, "calibration-selection");

function runRejectedManifest(label, mutate, expectedPhase, calibrationSetting = "setting-b") {
  const candidate = structuredClone(corpus);
  mutate(candidate);
  const candidatePath = path.join(tmp, `${label}-corpus-manifest.json`);
  const candidateBytes = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`);
  fs.writeFileSync(candidatePath, candidateBytes);
  const candidateOut = path.join(tmp, `${label}-result`);
  const candidateRun = spawnSync("python3", [
    SCRIPT,
    "--corpus-manifest", candidatePath,
    "--corpus-manifest-sha256", sha256(candidateBytes),
    "--out-dir", candidateOut,
    "--calibration-setting", calibrationSetting,
    "--chunk-rows", "64",
  ], { cwd: ROOT, encoding: "utf8" });
  assert.notEqual(candidateRun.status, 0, `${label} must fail loud`);
  const candidateFailure = JSON.parse(fs.readFileSync(path.join(candidateOut, "failure-report.json"), "utf8"));
  assert.equal(candidateFailure.failurePhase, expectedPhase);
}

runRejectedManifest("duplicate-split", (candidate) => {
  candidate.splits.train.settingIds.splice(1, 0, "setting-a");
}, "split-contract");

runRejectedManifest("duplicate-effective-control", (candidate) => {
  candidate.settings[2].effectiveControlIdentity = candidate.settings[0].effectiveControlIdentity;
}, "split-contract");

runRejectedManifest("contradictory-setting-split-role", (candidate) => {
  candidate.settings[0].splitRole = "heldOut";
}, "split-contract");

runRejectedManifest("missing-split-effective-identities", (candidate) => {
  delete candidate.splits.train.effectiveControlIdentities;
}, "split-contract");

runRejectedManifest("stale-cohort-total", (candidate) => {
  candidate.cohort.totalRows += 1;
}, "corpus-retention");

runRejectedManifest("curated-calibration", () => {}, "calibration-selection", "setting-a");

runRejectedManifest("nonfinite-artifact", (candidate) => {
  const setting = candidate.settings[0];
  const bytes = fs.readFileSync(setting.rows.sourceComplete.path);
  const values = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  values[2] = Number.NaN;
  setting.rows.sourceComplete = writeF32(
    path.join(tmp, "setting-a-nonfinite-complete.f32"),
    values,
    [256, 3],
    "candidate-features-source-complete",
  );
}, "artifact-finite");

runRejectedManifest("invalid-target-domain", (candidate) => {
  const setting = candidate.settings[0];
  const bytes = fs.readFileSync(setting.rows.targets.path);
  const values = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  values[0] = 1.25;
  setting.rows.targets = writeF32(
    path.join(tmp, "setting-a-invalid-targets.f32"), values, [256, 5], "supervision-targets-positive-nonridge",
  );
}, "target-domain");

runRejectedManifest("stale-target-summary", (candidate) => {
  candidate.settings[0].targetSummary.positiveOpticalRows += 1;
}, "target-summary");

runRejectedManifest("one-class-heldout", (candidate) => {
  const setting = candidate.settings[2];
  const bytes = fs.readFileSync(setting.rows.targets.path);
  const values = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  for (let row = 0; row < 256; row += 1) values[row * 5] = 1;
  setting.rows.targets = writeF32(
    path.join(tmp, "setting-c-one-class-targets.f32"), values, [256, 5], "supervision-targets-positive-nonridge",
  );
  setting.targetSummary.positiveMembershipRows = 256;
  setting.targetSummary.negativeMembershipRows = 0;
  candidate.splits.targetCoverage.heldOut = structuredClone(setting.targetSummary);
  delete candidate.splits.targetCoverage.heldOut.allTargetsZero;
}, "heldout-support");

runRejectedManifest("zero-optical-heldout", (candidate) => {
  const setting = candidate.settings[2];
  const bytes = fs.readFileSync(setting.rows.targets.path);
  const values = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  for (let row = 0; row < 256; row += 1) {
    for (let column = 1; column < 5; column += 1) values[row * 5 + column] = 0;
  }
  setting.rows.targets = writeF32(
    path.join(tmp, "setting-c-zero-optical-targets.f32"), values, [256, 5], "supervision-targets-positive-nonridge",
  );
  setting.targetSummary.positiveOpticalRows = 0;
  candidate.splits.targetCoverage.heldOut.positiveOpticalRows = 0;
}, "heldout-support");

runRejectedManifest("malformed-descriptor-shape", (candidate) => {
  candidate.settings[0].rows.current16.shape = [256, "bad"];
}, "artifact-verification");

const artifactCustodyProbe = spawnSync("python3", ["-c", String.raw`
import hashlib
import importlib.util
import os
import pathlib
import sys
import tempfile

script = pathlib.Path(${JSON.stringify(SCRIPT)})
spec = importlib.util.spec_from_file_location("nonridge_ridge_assay", script)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
root = pathlib.Path(tempfile.mkdtemp(prefix="kaminos-artifact-custody-"))
path = root / "artifact.f32"
original = (b"\x00\x00\x80?" * 4)
replacement = (b"\x00\x00\x00@" * 4)
path.write_bytes(original)
descriptor = {
    "path": str(path), "bytes": len(original), "byteLength": len(original),
    "sha256": hashlib.sha256(original).hexdigest(), "dtype": "float32-le",
    "shape": [4, 1], "semanticRole": "custody-probe",
}
artifact = module.open_verified_artifact(descriptor, 1, "artifact-verification")
replacement_path = root / "replacement.f32"
replacement_path.write_bytes(replacement)
os.replace(replacement_path, path)
assert module.sha256_handle(artifact.handle) == descriptor["sha256"]
artifact.close()

descriptor["sha256"] = hashlib.sha256(replacement).hexdigest()
artifact = module.open_verified_artifact(descriptor, 1, "artifact-verification")
with path.open("r+b") as handle:
    handle.seek(0)
    handle.write(b"\x00\x00@@")
setting = module.OpenedSetting({"rows": {"count": 4}}, artifact, artifact, artifact)
try:
    module.verify_artifacts_post_consumption({"setting-probe": setting})
except module.AssayError as error:
    assert error.phase == "artifact-post-consumption"
else:
    raise AssertionError("in-place artifact mutation was not detected")
artifact.close()

path.write_bytes(replacement)
descriptor["sha256"] = hashlib.sha256(replacement).hexdigest()
artifact = module.open_verified_artifact(descriptor, 1, "artifact-verification")
with path.open("r+b") as handle:
    handle.seek(0)
    handle.write(original[:4])
_ = float(artifact.array[0, 0])
with path.open("r+b") as handle:
    handle.seek(0)
    handle.write(replacement[:4])
setting = module.OpenedSetting({"rows": {"count": 4}}, artifact, artifact, artifact)
try:
    module.verify_artifacts_post_consumption({"setting-probe": setting})
except module.AssayError as error:
    assert error.phase == "artifact-post-consumption"
else:
    raise AssertionError("transient ABA artifact mutation was not detected")
artifact.close()
`], { cwd: ROOT, encoding: "utf8" });
assert.equal(
  artifactCustodyProbe.status,
  0,
  `persistent artifact custody probe failed:\nstdout=${artifactCustodyProbe.stdout}\nstderr=${artifactCustodyProbe.stderr}`,
);

const argumentFailureOut = path.join(tmp, "argument-failure-result");
const argumentFailure = spawnSync("python3", [
  SCRIPT,
  "--corpus-manifest", corpusPath,
  "--out-dir", argumentFailureOut,
], { cwd: ROOT, encoding: "utf8" });
assert.notEqual(argumentFailure.status, 0, "argument parsing must fail loud");
const argumentFailureReport = JSON.parse(
  fs.readFileSync(path.join(argumentFailureOut, "failure-report.json"), "utf8"),
);
assert.equal(argumentFailureReport.failurePhase, "arguments");

const forgedOut = path.join(tmp, "forged-result");
fs.appendFileSync(corpusPath, " ");
const forged = spawnSync("python3", [
  SCRIPT,
  "--corpus-manifest", corpusPath,
  "--corpus-manifest-sha256", corpusSha,
  "--out-dir", forgedOut,
  "--calibration-setting", "setting-b",
], { cwd: ROOT, encoding: "utf8" });
assert.notEqual(forged.status, 0, "forged corpus-manifest bytes must fail");
const failure = JSON.parse(fs.readFileSync(path.join(forgedOut, "failure-report.json"), "utf8"));
assert.equal(failure.status, "failed");
assert.equal(failure.failurePhase, "corpus-manifest-checksum");
assert.equal(failure.lastTrustworthyEvidence.expectedSha256, corpusSha);

console.log("volume nonridge source-basis ridge assay contracts passed");
