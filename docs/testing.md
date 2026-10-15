# Testing

Run the suite from the repository root after `npm ci`:

```sh
npm test
npm test -- --only tests/a.mjs,tests/b.mjs
```

`tools/test-runner.mjs` runs every top-level `.mjs` and `.py` file in `tests/` whose kind is `node` or `python`. It writes a report and one complete log per test. Pass `--report <path>` to choose where. Other flags are `--parallel <n>`, `--timeout-ms <ms>`, `--kinds node,python` and `--only <files>`.

Landing a branch on `main` goes through `tools/land.mjs`, which requires a green run of this suite in CI for the exact commit being landed and dispatches one when none exists; see `docs/landing.md`.

`requirements.txt` at the repository root lists the Python distributions the suite needs: bare distribution names (`pillow`, not `PIL`), one per line, with comments and blank lines allowed. They belong in a repo-local venv; from the repository root, `uv venv --allow-existing .venv && uv pip install --python .venv/bin/python3 -r requirements.txt` creates it, completes it, or repairs one whose interpreter is broken (the system and Homebrew interpreters are externally managed and refuse `pip install`; CI installs into its own interpreter). If you have a working python3 that is not a uv shim, `python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt` also works on a fresh tree.

The runner uses one Python interpreter and names it, with where it came from, at the end of the summary line: `KAMINOS_PYTHON` when it is set; otherwise `.venv/bin/python3` under the repository root when it resolves to an executable file; otherwise the `python3` on your path. It checks the requirements with that interpreter, runs Python tests with it, and gives it to child tests that spawn a bare `python3`: with the venv, `.venv/bin` goes first on their `PATH`; with `KAMINOS_PYTHON`, a run-private directory under the logs holding a `python3` that execs it by its own path, so a venv interpreter keeps its venv. A programmatic caller that passes `executables.python` gets it for the check and the Python tests only. The report records the choice in `effective.pythonExecutable`.

The Python check never fails a run. Before running anything, whatever tests are selected, the runner checks that every distribution in `requirements.txt` is installed in that interpreter. Installed means the package metadata is present (`importlib.metadata`), not that the package imports: a broken install passes the check and fails in the test that uses it. A missing distribution, a line that is not a bare distribution name, an interpreter that cannot run, a `.venv/bin/python3` that does not resolve to an executable file (the runner then uses the `python3` on your path), or a `KAMINOS_PYTHON` that cannot be found is a warning naming what was found and the command that fixes it, written out for the checkout: the venv command above or, under `KAMINOS_PYTHON`, `uv pip install --python <that interpreter> -r requirements.txt`. The tests run either way, so a test that needs a missing package fails as an ordinary test failure.

The runner checks that every package in `package-lock.json` is installed at the locked version before running anything, and records whether integrity could be verified. It hands child tests a stub executable through `KAMINOS_CHROME`, `CHROME_BIN`, `CHROME` and `KAMINOS_SHARP_WEBGPU_CHROME`. A witness that reaches a browser launch hits the stub, which records the attempt and fails; the run then fails and names the test. Witnesses that read other variables or hardcode a browser path are not covered.

## Warnings

Warnings report something worth fixing that should not stop anyone's work. They never fail a run or change its exit code. The report lists them in `warnings`, each with its source (`python-dependencies`, `test` or `run-ledger`), the test that wrote it if any, and the message; the summary prints each one once, after the counts line. A test emits one by writing a line that begins `kaminos-test-warning: ` to stdout or stderr, for example `console.log('kaminos-test-warning: no WebGPU adapter, skipped the GPU leg')`. The line stays in the test's log and is left out of its failure signature, so a test that warns keeps the signature it would have without the warning.

## Run ledger

Each run of the command line, `npm test` included, appends one JSON line to `~/.local/state/kaminos/test-runs.jsonl`, creating the directory if needed: when the run finished, the repository root, branch and head commit and whether the tree was dirty, the selection (`full` or the `--only` list) and kinds, whether it passed and its failure phase, the counts, each warning's source, test and first line, the Python interpreter and its source, the duration and the report path. It records how the suite behaves in real work, so a check can be judged on recorded runs rather than on silence. `KAMINOS_RUN_LEDGER=<path>` writes it elsewhere and `KAMINOS_RUN_LEDGER=off` turns it off; `runSuite` called from code never writes it. A ledger that cannot be written is a warning, never a failure.

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
| `helper` | Imported or executed by other tests, never run on its own. Needs a reason. |

Files that existed when the runner was introduced are classified in `tests/suite.json`. A declaration that disagrees with that manifest is an error. An unclassified file fails the run, so a test can't silently go unexecuted.

Prefer behavior tests that import a module and exercise it. Avoid new assertions that match the text of `index.html` with regular expressions: they break when code moves and hide whether the behavior still works.

## Known failures

`tests/quarantine.json` lists failures that existed when the runner was introduced. Each entry has a class, an owner, a reason and a signature.

- **Signature:** what identifies the failure. For a plain script it is the first error line of its output, with generic assertion messages carrying their detail lines. For a `node:test` file the runner adds a reporter that writes structured events beside the log, and the signature lists every failing test by its suite path and the thrown error's name and first message line, with the assertion itself when Node generated the message: its operator, the compared values shown bounded and followed by a hash of the values rendered to a larger bound (six levels deep, 10,000 array elements, 20,000 characters per string), or for `assert.ok` the asserted expression and, when the call spans lines, its location in the file. Values are rendered as `util.inspect` shows them, with stack frames removed, so Error values appear as name and message wherever they sit; a line of an Error's own message that begins with `at ` is removed with them, and a frame of an unusual shape, such as nested `eval` or a file name with spaces or brackets, can leave its location behind. Every failed hook and every error caught outside a test is listed too. A listed test is a known failure only while it fails with exactly that signature. When a signature changes, the report lists the entries added and removed.
- **Limits of the assertion detail:** the hash covers what `util.inspect` shows of the compared values (not private fields, non-enumerable properties, getter values or WeakMap contents), so an assertion that compares objects carrying per-run data such as a generated id or a timestamp signs differently every run and cannot be quarantined by its detail; give that assertion a message of its own, which replaces the detail with a stable one. Two values that differ only past the hash bound sign the same. For a multi-line `assert.ok`, Node keeps only the first line of the expression, so the signature carries that line, plus the call's location when that line is just the opening parenthesis: an edit to a later line of the same call does not change the signature, and an edit above a call that carries its location does.
- **Changed signature:** a different failure, a timeout, or a test that cannot start is a new failure.
- **Passing again:** a listed test that passes fails the run until its entry is removed, so the list only shrinks.
- **Unsigned failure:** a `node:test` file whose tests started but whose events cannot be trusted is reported as an unsigned failure, with the reason: it exited before its summary (with any exit code), or a forked child or worker inherited the reporter and wrote into the same file. It counts as a new failure and can never be known; fix the cause rather than quarantining it. A file that only imports the framework, or fails while loading, is signed from its output like a plain script and can be quarantined.
- **How the runner tells them apart:** every Node test is started with a preloaded exit hook that writes one line to the log naming the process, its exit code, and whether the test harness started running tests, which the runner's own reporter marks when the harness loads it. The harness loads reporters asynchronously, so a file that registers tests and exits in the same turn of the event loop is judged by its exit code alone; its tests never ran. The runner matches the process it spawned; a relayed child's line is ignored. If a `node:test` file's events record a failing test, the file fails whatever its exit code says.

## Test roots outside tests/

The inference kit, the model ports and the material-photo demo keep their own tests. `excludedRoots` in `tests/suite.json` names each one with the reason it isn't run here, and every report lists them. A test directory or `*.test.mjs` file that is neither covered nor excluded fails the run.
