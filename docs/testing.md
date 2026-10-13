# Testing

Run the suite from the repository root after `npm ci`:

```sh
npm test
npm test -- --only tests/a.mjs,tests/b.mjs
```

`tools/test-runner.mjs` runs every top-level `.mjs` and `.py` file in `tests/` whose kind is `node` or `python`. It writes a report and one complete log per test. Pass `--report <path>` to choose where. Other flags are `--parallel <n>`, `--timeout-ms <ms>`, `--kinds node,python` and `--only <files>`.

The runner checks that every package in `package-lock.json` is installed at the locked version before running anything, and records whether integrity could be verified. It hands child tests a stub executable through `KAMINOS_CHROME`, `CHROME_BIN`, `CHROME` and `KAMINOS_SHARP_WEBGPU_CHROME`. A witness that reaches a browser launch hits the stub, which records the attempt and fails; the run then fails and names the test. Witnesses that read other variables or hardcode a browser path are not covered.

## Classifying a test

Declare the kind on the first line of a new test file:

```js
// kaminos-test: node
// kaminos-test: browser — drives Playwright against a served page
```

```py
# kaminos-test: manual — needs a live page URL
```

| Kind | Meaning |
| --- | --- |
| `node` | A self-contained Node script that exits 0 on success. |
| `python` | A self-contained Python script that exits 0 on success. |
| `browser` | Launches or drives a browser. Needs a reason. Not run by `npm test`. |
| `manual` | Needs arguments, a live page, or a private environment. Needs a reason. |
| `helper` | Imported by other tests. Needs a reason. |

Files that existed when the runner was introduced are classified in `tests/suite.json`. A declaration that disagrees with that manifest is an error. An unclassified file fails the run, so a test can't silently go unexecuted.

Prefer behavior tests that import a module and exercise it. Avoid new assertions that match the text of `index.html` with regular expressions: they break when code moves and hide whether the behavior still works.

## Known failures

`tests/quarantine.json` lists failures that existed when the runner was introduced. Each entry has a class, an owner, a reason and a signature.

- **Signature:** what identifies the failure. For a plain script it is the first error line of its output, with generic assertion messages carrying their detail lines. For a `node:test` file the runner adds a reporter that writes structured events beside the log, and the signature lists every failing test by its suite path and the thrown error's name and first message line, every failed hook, and every error caught outside a test. A listed test is a known failure only while it fails with exactly that signature.
- **Changed signature:** a different failure, a timeout, or a test that cannot start is a new failure.
- **Passing again:** a listed test that passes fails the run until its entry is removed, so the list only shrinks.
- **Harness defect:** a `node:test` file that ran but left no events is reported as a harness defect and counts as a new failure, never as known.

## Test roots outside tests/

The inference kit, the model ports and the material-photo demo keep their own tests. `excludedRoots` in `tests/suite.json` names each one with the reason it isn't run here, and every report lists them. A test directory or `*.test.mjs` file that is neither covered nor excluded fails the run.
