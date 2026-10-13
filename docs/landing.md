# Landing on main

Lanes land by fast-forwarding `main` to their branch tip; there are no pull requests. On 2026-10-13 main went red because a lane pushed a commit to `main` that had never had a green run of the `tests` workflow for that exact commit. `tools/land.mjs` makes that push conditional.

The tool is voluntary today: nothing on the remote stops a bare `git push origin <sha>:main`, and such a push still lands. Until enforcement exists, landing through the tool is the agreed practice, and a landing made without it is how main went red.

## What it checks

The commit is read once, at the start; every step checks, dispatches for and pushes that commit, not whatever HEAD is by then. In order; the first failure ends the run.

1. **clean-tree**: `git status --porcelain` is empty. Modified and untracked files both count.
2. **fetch**: `git fetch <remote> +refs/heads/main:refs/remotes/<remote>/main`.
3. **rebased**: `git merge-base <remote>/main <commit>` equals `<remote>/main`, so the branch contains current main and the push is a fast-forward. A commit main already contains is behind main; one that diverged must be rebased first. A rebase makes a new commit, which needs its own run.
4. **ci**: `gh run list -R <owner/name> --workflow tests.yml --commit <commit> --json ...`. A run whose head SHA is not the commit never counts, whatever gh returns. The latest completed run decides, and it must have concluded `success`. A failed run refuses; the message also reports main's own latest run with both run URLs ("main is also red at run N; compare the failures before attributing"), without deciding whose failure it is. A run already queued or running is awaited. When no run exists, the tool pushes the commit to its own ref, `land/<sha>` (never the lane's branch and never main, so a checkout on `main` or a branch that diverged from its remote copy changes nothing it should not), dispatches the workflow once from that ref with `gh workflow run tests.yml -R <owner/name> --ref land/<sha>`, and waits for the run whose head SHA is the commit: by id when gh prints the run URL (a run for any other commit is refused at once), by listing otherwise. The ref is deleted when the attempt concludes, whatever the outcome, and the receipt records the deletion; a `land/<sha>` ref already at the commit is reused. A failed run is never re-dispatched.
5. **push**: `git push <remote> <commit>:refs/heads/main`. If main moved between the check and the push, git rejects the non-fast-forward; that is reported as the outcome `main-moved` and not retried. Rebase onto the new main and land again once the rebased commit has its own green run. A push that exited 0 is landed whatever happens afterwards; main is read back for the receipt only.

## Waiting for a run

A dispatched run takes 10 to 70 minutes: the suite is about seven minutes, a macOS runner can queue for a while, and the job's own timeout is 60 minutes. Run the tool in the background, or run it again later: a re-run finds the pending run and awaits it rather than dispatching another. While waiting, the tool polls every 30 seconds and prints one line to stderr per state change (dispatched, queued, in progress, concluded). The wait is bounded per state by the workflow's own lifecycle: ten minutes for a dispatched run to be listed at all, GitHub's 24-hour queue limit, then the job's `timeout-minutes` from `.github/workflows/tests.yml` once it runs. SIGINT or SIGTERM ends the wait with a partial receipt naming the run being awaited, exit code 130; the run itself continues on GitHub. By hand: `gh run watch <run id>`.

## Running it

```sh
node tools/land.mjs --dry-run    # every check against existing runs; changes nothing on the remote
node tools/land.mjs --ci-only    # get this commit's run green through land/<sha>, report, never push main
node tools/land.mjs              # land: dispatch and wait if needed, then fast-forward main
```

Flags: `--dry-run` (implies `--no-dispatch`: no ref is pushed and nothing is dispatched); `--ci-only`; `--no-dispatch` (refuse instead of dispatching, and say how to get a run); `--receipt <path>` (default `test-results/landing-<commit>-<time>.json` under the repository, a path git ignores); `--remote <name>` (default `origin`); `--repo <owner/name>` (default: from the remote's push URL); `--root <path>`; `--gh <path>` and `--git <path>` to substitute the executables. `--dry-run` and `--ci-only` exclude each other. Exit 0 when landed, or when a dry run or `--ci-only` passed every check; 1 when refused, including `main-moved`; 2 on bad arguments; 3 when the run could not find out: a fetch, gh query, dispatch or push that failed, a wait that outlived the workflow's lifecycle, or a receipt that could not be written; 130 when interrupted. It prints one summary line naming the outcome and the receipt.

## The receipt

JSON with schema `kaminos.landing-receipt.v1`:

- `outcome`: `landed`, `dry-run`, `ci-only`, `refused`, `main-moved`, `error` or `interrupted`, with `ok`, `reason`, the one-line `message` and, for an error, its `failurePhase`.
- `sha`, `branch` (null when detached), `remote` (name, push URL, the resolved repository and whether it came from the URL or `--repo`), and the mode flags.
- `main.before`, as fetched; `main.after`, as the remote reports it after the push stage, null when the run ended before it or main could not be read back (then `afterError` says why); `afterContainsSha`.
- `ci`: the workflow file, the first `gh` command and how many queries were made, the `--limit` and whether a listing filled it, every run returned (id, status, conclusion, workflow, head SHA, event, branch, URL, creation time, attempt and whether it counted), the run the decision rested on, main's own latest run when the decision was a failure, the dispatch (the `land/<sha>` ref, whether it existed or was pushed, whether it was deleted, the command, the run URL and id gh printed) and the wait (polls, elapsed time, the run followed by id, every state change with its time, and the bounds with where the job timeout came from).
- `checks`: every check with `pass`, `fail` or `skipped` and its detail.
- `push`: exit code and both streams, or null when no push was attempted.
- `startedAt`, `finishedAt`, and the effective `git`, `gh` and poll interval.

The receipt is written whenever it can be, for a landing, a refusal, an error or an interruption alike; if writing it fails, the summary still prints, the error goes to stderr, and the exit code is 3. `tests/land-contracts.mjs` runs the tool against a bare origin, a clone and the stub `gh` in `tests/land-gh-stub.mjs`, on a clock the contracts control.
