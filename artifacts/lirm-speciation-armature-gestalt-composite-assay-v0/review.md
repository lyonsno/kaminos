# Gestalt Composite Assay Review

## Review Surface

- Base: `bab02d1f`
- Initial head: `d5028df4`
- Scope: `lirm-speciation-armature-core.js`, `lirm-speciation-gestalt-composite-witness.mjs`, `lirm-speciation-gestalt-imagegen-core.mjs`, and the two gestalt contract tests
- Review scope: `review-scope.md`

The first automated Gemini review attempt reached the intended path-restricted surface but both configured backends failed during authentication with quota exhaustion. It produced no review result and therefore no finding or closure claim.

An independent read-only GPT-5.5 review then inspected the same surface and executed adversarial validator probes. It found no material defect in the shared 3D implicit-field wiring and reported four evidence-contract obligations.

## Addressed Findings

1. **Input and prompt hash drift accepted at stable paths.** Addressed by rehashing both live files during imagegen completion validation and returning the live evidence rather than planned evidence.
2. **Trellis fixed settings not validated.** Addressed by parsing the effective command and requiring exact `--resolution 512`, `--no-cascade`, and `--simplify-first` evidence in addition to the dynamic Greenroom parameters.
3. **Runner identity accepted prefix spoofs.** Addressed by requiring the first effective-command token to equal the expected executable for imagegen, Trellis, and Blender witness jobs.
4. **Missing timing and stale primary output accepted.** Addressed by requiring actual finite numeric submit/start/finish timestamps and an output mtime within the run window. Witness receipts now retain timing and witness-script hash evidence as well.

Fail-first coverage demonstrated the pre-fix prefix-spoof acceptance before implementation. The expanded tests also reject input hash drift, prompt hash drift, script hash drift, missing timing, stale output, missing Trellis flags, and executable-prefix substitution.

After repair, the original Greenroom jobs were collected again without new inference. All `8` image outputs, `5` Trellis casts, and `20` Blender witness frames passed the stricter validators with complete timing evidence and zero rejection.

The first revision confirmation found one residual JavaScript coercion path: `submitted_at: null` became numeric zero before the finite check. A fail-first contract reproduced that acceptance. Timing validation now rejects null, undefined, string, and non-finite timestamp values before destructuring the three numeric timestamps. The original jobs again passed collection without new inference.

The correction was resubmitted as `1dc9006b..817634ba` to an independent read-only GPT-5.5 confirmation pass. It reported no remaining material finding and confirmed that the shared timing helper closes the coercion path for imagegen, Trellis, and Blender witness receipts. Its sandbox prevented fixture creation, so the owning lane's successful contract execution remains the runtime evidence for the test suite.

## Residual Boundary

The contract tests establish common code-path derivation and evidence identity. Pixel-level cross-map semantic coherence remains a visual/evaluation concern rather than a source-level invariant; the inspected CPU and Trellis contact sheets carry that evidence for this assay.
