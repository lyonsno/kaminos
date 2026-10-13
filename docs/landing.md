# Landing on main

Lanes land by fast-forwarding `main` to their branch tip; there are no pull requests. On 2026-10-13 main went red because a lane pushed a commit to `main` that had never had a green run of the `tests` workflow for that exact commit. `tools/land.mjs` makes that push conditional.

The tool is voluntary today: nothing on the remote stops a bare `git push origin <sha>:main`, and such a push still lands. Until enforcement exists, landing through the tool is the agreed practice, and a landing made without it is how main went red.

## What it checks

The commit is read once, at the start; every step checks and pushes that commit, not whatever HEAD is by then. In order; the first failure ends the run.

1. **clean-tree**: `git status --porcelain` is empty. Modified and untracked files both count.
2. **fetch**: `git fetch <remote> +refs/heads/main:refs/remotes/<remote>/main`.
3. **rebased**: `git merge-base <remote>/main <commit>` equals `<remote>/main`, so the branch contains current main and the push is a fast-forward. A commit main already contains is behind main; one that diverged must be rebased first. A rebase makes a new commit, which needs its own run.
4. **ci**: `gh run list -R <owner/name> --workflow tests.yml --commit <commit> --json ...`. A run whose head SHA is not the commit never counts, whatever gh returns. The latest completed run decides, and it must have concluded `success`. A failed run refuses; the message also reports main's own latest run, so an inherited failure ("main itself is red at run N; this branch inherits it") is told apart from the branch's own. When no run exists, the branch is pushed at the commit unless the remote's branch is there already, the workflow is dispatched once with `gh workflow run tests.yml -R <owner/name> --ref <branch>`, and the tool polls every 30 seconds for the run whose head SHA is the commit until it completes. A run already queued or running is awaited instead of dispatching. The wait is bounded only by the workflow's own lifecycle: GitHub's 24-hour queue limit, then the job's `timeout-minutes` from `.github/workflows/tests.yml`. A failed run is never re-dispatched. `--no-dispatch` refuses instead of pushing, dispatching or waiting, and prints the dispatch command; wait by hand with `gh run watch <run id>`, then land again.
5. **push**: `git push <remote> <commit>:refs/heads/main`. If main moved between the check and the push, git rejects the non-fast-forward; that is reported as the outcome `main-moved` and not retried. Rebase onto the new main and land again once the rebased commit has its own green run. A push that exited 0 is landed whatever happens afterwards; main is read back for the receipt only.

## Running it

```sh
node tools/land.mjs --dry-run --no-dispatch   # every check against existing runs; changes nothing on the remote
node tools/land.mjs --dry-run                 # dispatches and waits when needed, but does not push main
node tools/land.mjs                           # land
```

Flags: `--dry-run`; `--no-dispatch`; `--receipt <path>` (default `test-results/landing-<commit>-<time>.json` under the repository, a path git ignores); `--remote <name>` (default `origin`); `--repo <owner/name>` (default: from the remote's push URL); `--root <path>`; `--gh <path>` and `--git <path>` to substitute the executables. Exit 0 when landed or when a dry run passed every check; 1 when refused, including `main-moved`; 2 on bad arguments; 3 when the run could not find out: a fetch, gh query, dispatch or push that failed, a wait that outlived the workflow's lifecycle, or a receipt that could not be written. It prints one summary line naming the outcome and the receipt.

## The receipt

JSON with schema `kaminos.landing-receipt.v1`:

- `outcome`: `landed`, `dry-run`, `refused`, `main-moved` or `error`, with `ok`, `reason`, the one-line `message` and, for an error, its `failurePhase`.
- `sha`, `branch` (null when detached), `remote` (name, push URL, the resolved repository and whether it came from the URL or `--repo`).
- `main.before`, as fetched; `main.after`, as the remote reports it after the push stage, null when the run ended before it or main could not be read back (then `afterError` says why); `afterContainsSha`.
- `ci`: the workflow file, the first `gh` command and how many listings were made, the `--limit` and whether a listing filled it, every run returned (id, status, conclusion, workflow, head SHA, event, branch, URL, creation time and whether it counted), the run the decision rested on, main's own latest run when the decision was a failure, the dispatch (branch tip, whether the branch was pushed, the command) and the wait (polls, elapsed time, bounds).
- `checks`: every check with `pass`, `fail` or `skipped` and its detail.
- `push`: exit code and both streams, or null when no push was attempted.
- `startedAt`, `finishedAt`, and the effective `git`, `gh` and poll interval.

The receipt is written whenever it can be, for a landing, a refusal or an error alike; if writing it fails, the summary still prints, the error goes to stderr, and the exit code is 3. `tests/land-contracts.mjs` runs the tool against a bare origin, a clone and the stub `gh` in `tests/land-gh-stub.mjs`.
