# Testing

Run the suite from the repository root after `npm ci`. If `node_modules` is a link to another worktree's install (many worktrees share one), do not run `npm ci` or `npm install` in this worktree or in the one it points to: either empties or changes the shared install for every worktree linked to it. To get your own install, `unlink node_modules` (it removes only the link), then `npm ci`. The runner's summary names a shared install, and when packages are missing it gives that remedy.

```sh
npm test
npm test -- --only tests/a.mjs,tests/b.mjs
```

`tools/test-runner.mjs` runs every top-level `.mjs` and `.py` file in `tests/` whose kind is `node` or `python`. It writes a report and one complete log per test. Pass `--report <path>` to choose where. Other flags are `--parallel <n>`, `--timeout-ms <ms>`, `--kinds node,python` and `--only <files>`.

Two environment variables shorten waits for the runner's and the landing tool's own contracts, and both are printed whenever they are in effect: `KAMINOS_LATE_LAUNCH_SETTLE_MS` (default 2000) is how long the runner waits after the last test for browser launches a test handed to a detached process; below the default such launches may be missed. `KAMINOS_LAND_POLL_MS` (default 30000) is the landing tool's poll interval; every poll is a gh call on the shared API limit. Leave both unset in ordinary runs.

Landing goes as `AGENTS.md` says: during the trial that began on 2026-10-17, the full suite's result for a lane commit comes from the advisory `tests` workflow run on its branch push, not from a local run on the shared machine. `docs/landing.md` describes the workflow, and `tools/land.mjs` for a future pilot.

`requirements.txt` at the repository root lists the Python distributions the suite needs: bare distribution names (`pillow`, not `PIL`), one per line, with comments and blank lines allowed. They belong in a repo-local venv; from the repository root, `uv venv --allow-existing .venv && uv pip install --python .venv/bin/python3 -r requirements.txt` creates it, completes it, or repairs one whose interpreter is broken (the system and Homebrew interpreters are externally managed and refuse `pip install`; CI installs into its own interpreter). If you have a working python3 that is not a uv shim, `python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt` also works on a fresh tree.

The runner uses one Python interpreter and names it, with where it came from, at the end of the summary line: `KAMINOS_PYTHON` when it is set; otherwise `.venv/bin/python3` under the repository root when it resolves to an executable file; otherwise the `python3` on your path. It checks the requirements with that interpreter, runs Python tests with it, and gives it to child tests that spawn a bare `python3`: with the venv, `.venv/bin` goes first on their `PATH`; with `KAMINOS_PYTHON`, a run-private directory under the logs holding a `python3` that execs it by its own path, so a venv interpreter keeps its venv. A programmatic caller that passes `executables.python` gets it for the check and the Python tests only. The report records the choice in `effective.pythonExecutable`.

The Python check never fails a run. Before running anything, whatever tests are selected, the runner checks that every distribution in `requirements.txt` is installed in that interpreter. Installed means the package metadata is present (`importlib.metadata`), not that the package imports: a broken install passes the check and fails in the test that uses it. A missing distribution, a line that is not a bare distribution name, an interpreter that cannot run, a `.venv/bin/python3` that does not resolve to an executable file (the runner then uses the `python3` on your path), or a `KAMINOS_PYTHON` that cannot be found is a warning naming what was found and the command that fixes it, written out for the checkout: the venv command above or, under `KAMINOS_PYTHON`, `uv pip install --python <that interpreter> -r requirements.txt`. The tests run either way, so a test that needs a missing package fails as an ordinary test failure. One exception: without Pillow, `tests/authoring-image-preparation-serving.py` exits 0 locally (counted as passed) and writes a `kaminos-test-warning:` line saying it skipped, so the skip shows in the summary, the report and the run ledger; under `CI` it still fails.

The runner checks that every package in `package-lock.json` is installed at the locked version before running anything, and records whether integrity could be verified. It hands child tests a stub executable through `KAMINOS_CHROME`, `CHROME_BIN`, `CHROME` and `KAMINOS_SHARP_WEBGPU_CHROME`. A witness that reaches a browser launch hits the stub, which records the attempt and fails; the run then fails and names the test. Witnesses that read other variables or hardcode a browser path are not covered.

## Warnings

Warnings report something worth fixing that should not stop anyone's work. They never fail a run or change its exit code. The report lists them in `warnings`, each with its source (`python-dependencies`, `test` or `run-ledger`), the test that wrote it if any, and the message; the summary prints each one once, after the counts line. A test emits one by writing a line that begins `kaminos-test-warning: ` to stdout or stderr, for example `console.log('kaminos-test-warning: no WebGPU adapter, skipped the GPU leg')`. The line stays in the test's log and is left out of its failure signature, so a test that warns keeps the signature it would have without the warning.

## Run ledger

Each run of the command line, `npm test` included, appends JSON lines to `~/.local/state/kaminos/test-runs.jsonl`, creating the directory if needed. Before it parses its arguments it appends a `start` line: a `runId`, when it started, the repository root (`--root` or the working directory), its branch, the process id and the arguments. When it ends it appends a `finish` line with the same `runId`. A `start` with no `finish` is a run that was killed or crashed, for example one stopped for taking too long. Bad arguments give a `finish` in the `arguments` phase with the error and the arguments. A finished run's line records when the run finished, the repository root, branch and head commit and whether the tree was dirty, the selection (`full` or the `--only` list) and kinds, whether it passed and its failure phase, the counts, each warning's source, test and first line, the Python interpreter and its source, the duration and the report path. It records how the suite behaves in real work, so a check can be judged on recorded runs rather than on silence. `KAMINOS_RUN_LEDGER=<path>` writes it elsewhere and `KAMINOS_RUN_LEDGER=off` turns it off; `runSuite` called from code never writes it. A ledger that cannot be written is a warning, never a failure.

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
| `browser` | Launches or drives a browser. Needs a reason. Run by `npm test` only when `KAMINOS_BROWSER` is set and the test opts in; see below. |
| `manual` | Needs arguments, a live page, or a private environment. Needs a reason. |
| `helper` | Imported or executed by other tests, never run on its own. Needs a reason. |

Files that existed when the runner was introduced are classified in `tests/suite.json`. A declaration that disagrees with that manifest is an error. An unclassified file fails the run, so a test can't silently go unexecuted.

Prefer behavior tests that import a module and exercise it. Avoid new assertions that match the text of `index.html` with regular expressions: they break when code moves and hide whether the behavior still works.

## Browser tests

A browser-kind test runs when `KAMINOS_BROWSER` names an executable file and the test opts in to that route, with the `route` token on its declaration line or `"route": true` in its `tests/suite.json` entry:

```js
// kaminos-test: browser route — loads the authoring page in a headless Chrome for Testing
```

```sh
KAMINOS_BROWSER="<path to Google Chrome for Testing>" npm test
KAMINOS_BROWSER="<path>" npm test -- --only tests/gui-smoke.mjs
```

Opt a test in only once every browser it launches, itself or through a witness, carries `--use-mock-keychain` and `--password-store=basic`: a Chrome started with a temporary `HOME` and without them makes macOS raise a "Keychain Not Found" dialog on the operator's screen at every launch, while the test still passes. Today only `tests/gui-smoke.mjs` and `tests/gui-smoke-contracts.mjs` opt in; opting in another lane's browser test is its owner's call. A browser-kind test that has not opted in is listed as not run, with its reason after "not opted in to the KAMINOS_BROWSER route". The runner checks the path before any test runs; a path that is missing, not a file, not executable, or whose real path, in the volume's own spelling, lies inside the installed `Google Chrome.app` (directly, through a link, or spelled in another case) fails the run in the `browser` phase, with the report written. Opted-in tests receive the executable's real path as `KAMINOS_CHROME`; `CHROME_BIN`, `CHROME` and `KAMINOS_SHARP_WEBGPU_CHROME` keep the stub, so a browser test that launches through one of those is recorded as a blocked launch. Node and Python tests keep the stub for all four. Without `KAMINOS_BROWSER`, browser-kind tests are listed as not run with their reason. The report's `effective.browser` records the executable, its real path and its `--version` (asked with the same two switches and a private profile directory that is removed afterwards, and bounded at ten seconds; `versionError` says why it is missing), or null.

Use Chrome for Testing, never the installed Google Chrome: a headless run of the installed app can take over the operator's browser. Locally, Playwright's Chromium (`~/Library/Caches/ms-playwright/chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`) is one, or install one without adding a dependency: `npx --yes @puppeteer/browsers install chrome@stable --path <dir>`, which prints the executable's path.

`tests/gui-smoke.mjs` serves the repository with `serve.py` on a free port, loads `/index.html` headless, adds two meshes through `window.kaminosSceneAuthoring`, selects the first Scene Objects row and opens every sidebar tab. It fails on any uncaught exception, console error, failed request logged as an error, or dialog, except entries in its `ALLOWED` list, each with a reason; an allowlist entry that matched nothing is printed so it can be removed. It never reaches the operator's stores: `serve.py` runs with `--volume-settings-store`, `--no-shared-basin-store`, `--volume-basin-session-store` and `--volume-cockpit-layout-store` pointing into a temporary run directory, with `HOME`, the scenes directory and the LERMS preview root there as well and without the caller's `KAMINOS_*` and `GPU_GREENROOM_DIR` variables, and the browser gets the same `HOME`; the run fails unless every path, and every store `serve.py` reports using, sits in that directory, which is removed at the end. The browser is launched with `--use-mock-keychain`, `--password-store=basic` and a profile inside the run directory. A `KAMINOS_CHROME` whose real path lies inside the installed Google Chrome, also through a link or in another case, is refused before anything starts. The server and the browser stay in the test's process group, so a runner timeout or interrupt stops them with it. The receipt, `kaminos-gui-smoke-<time>-<pid>.json` under the OS temp directory, is written when the run starts and at every phase, and its path is printed first: the executable, its real path and browser version, the isolation paths, the URL, each step and tab with its timing, every error with whether it was allowed, and the phase reached or failed in. `tests/gui-smoke-contracts.mjs` holds the smoke's harness contracts.

`tests/index-html-unresolved-names-contracts.mjs` is the static half, a node-kind test that warns and does not fail. It runs `tools/index-html-unresolved-names.mjs` over every inline script and handler attribute in `index.html` and, for each name used but declared nowhere the browser would find it, prints `kaminos-test-warning: index.html unresolved name <name> at <line>:<col>; check the name is defined in index.html or in a script it loads` to its output, which the runner lists in the report's `warnings` and prints in its summary (see Warnings above); then it passes. When the parser it uses (the acorn bundled in Node, reached with `--expose-internals`) is unavailable, it prints a warning saying so and passes. `KAMINOS_STRICT_UNRESOLVED=1` makes findings, and a checker that cannot run, fail the test. To see the findings with their scopes: `node tools/index-html-unresolved-names.mjs` (exit 1 when there are any).

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
