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
    const emission = membership ? [0.4 + 0.3 * u, 0.2 + 0.2 * u, 0.1 + 0.1 * u] : [0, 0, 0];
    const extinction = membership ? 0.15 + 0.25 * u : 0;
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
    train: { settingIds: ["setting-a", "setting-b"] },
    heldOut: { settingIds: ["setting-c"] },
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
assert.equal(report.rows.policy, "all-rows-streamed-uncapped-v0");
assert.equal(report.rows.fit.settingIds.join(","), "setting-a");
assert.equal(report.rows.calibration.settingIds.join(","), "setting-b");
assert.equal(report.rows.heldOut.settingIds.join(","), "setting-c");
assert.equal(report.views.current16.rowsEvaluated, 256);
assert.equal(report.views.sourceComplete.rowsEvaluated, 256);
assert.ok(
  report.views.sourceComplete.metrics.membership.soft.rmse
    < report.views.current16.metrics.membership.soft.rmse * 0.55,
  "source-complete should materially reduce soft error on the synthetic step target",
);
assert.ok(report.views.sourceComplete.metrics.membership.strongSupport.f1 > 0.95);
assert.ok(report.views.sourceComplete.metrics.optical.positiveSupport.rmseMean < 0.08);
assert.equal(report.ablations.length, 1);
assert.equal(report.ablations[0].droppedChannel, "source.signal");
assert.ok(report.ablations[0].metrics.membership.soft.rmse > report.views.sourceComplete.metrics.membership.soft.rmse);

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
assert.equal(blackCalibrationFailure.failurePhase, "calibration-support");

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
