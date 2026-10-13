# Testing

Run the suite from the repository root:

```sh
npm test
```

`tools/test-runner.mjs` runs every top-level file in `tests/` that `tests/suite.json` classifies as `node` or `python`. It writes a report and one complete log per test. Pass `--report <path>` to choose where. Other flags are `--parallel <n>`, `--timeout-ms <ms>`, `--kinds node,python` and `--only tests/a.mjs,tests/b.mjs`.

## Classifying a new test

Add every new test file to `tests/suite.json`. An unclassified file fails the run, so a test can't silently go unexecuted.

| Kind | Meaning |
| --- | --- |
| `node` | A self-contained Node script that exits 0 on success. |
| `python` | A self-contained Python script that exits 0 on success. |
| `browser` | Launches or drives a browser. Needs a `reason`. Not run by the default suite. |
| `manual` | Needs arguments, a live page, or a private environment. Needs a `reason`. |
| `helper` | Imported by other tests. Needs a `reason`. |

Prefer behavior tests that import a module and exercise it. Avoid new assertions that match the text of `index.html` with regular expressions: they break when code moves and hide whether the behavior still works.

## Known failures

`tests/quarantine.json` lists failures that existed when the runner was introduced, each with a class, owner and first error.
- A listed test that still fails does not fail the run.
- A listed test that passes fails the run until you remove its entry, so the list only shrinks.
- A failure that is not listed fails the run.

Fix the failure, or add an entry with a class, reason and owner when the failure is real and deliberately deferred.
