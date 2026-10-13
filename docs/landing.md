# Landing on main

Lanes land by fast-forwarding `main` to their branch tip; there are no pull requests. On 2026-10-13 main went red because a lane pushed a commit to `main` that had never had a green run of the `tests` workflow for that exact commit. `tools/land.mjs` makes the push conditional. Land with it, not with a bare `git push origin HEAD:main`.

## What it checks

In order; the first failure refuses, and nothing after it runs.

1. **clean-tree**: `git status --porcelain` is empty. Modified and untracked files both count.
2. **fetch**: `git fetch <remote>`, so `<remote>/main` is current.
3. **rebased**: `git merge-base <remote>/main HEAD` equals `<remote>/main`, so the branch contains current main and the push is a fast-forward. Otherwise: rebase first. A branch already at main has nothing to land.
4. **ci**: `gh run list -R <owner/name> --commit <sha> --json ...` for HEAD's full SHA. A run of the `tests` workflow for that exact commit must have concluded `success`. No run, a run still in progress (named by id), a run that concluded anything else, a run for another commit or another workflow, and a `gh` query that fails each refuse with their own reason. The repository comes from the remote URL; `--repo owner/name` overrides it.
5. **push**: `git push <remote> HEAD:main`. If main moved between the check and the push, git rejects the non-fast-forward; that is reported as the outcome `main-moved` and not retried. Rebase onto the new main and land again once the rebased commit has its own green run.

## Running it

```sh
node tools/land.mjs --dry-run   # every check and the receipt, no push
node tools/land.mjs             # land
node tools/land.mjs --receipt path/to/receipt.json --remote origin
```

Flags: `--dry-run`; `--receipt <path>` (default: a fresh directory under the OS temp dir); `--remote <name>` (default `origin`); `--repo <owner/name>`; `--workflow <name>` (default `tests`); `--root <path>`; `--gh <path>` and `--git <path>` to substitute the executables. Exit 0 when landed or when a dry run passes every check, 1 on any refusal, 2 on bad arguments. It prints one summary line naming the outcome and the receipt.

Getting a run for the commit: the workflow runs on pushes to `main` and to the branch patterns listed in `.github/workflows/tests.yml`, and on manual dispatch. For any other branch, push it and dispatch the workflow for it, `gh workflow run tests.yml --ref <branch>`; the run's head SHA is the branch tip at dispatch. A rebase makes a new commit, which needs its own run.

## The receipt

JSON with schema `kaminos.landing-receipt.v1`:

- `outcome`: `landed`, `dry-run`, `refused`, `main-moved`, `push-failed` or `error`, with `ok`, `reason` and the one-line `message`.
- `sha`, `branch` (null when detached), `remote` (name, URL, the resolved repository and whether it came from the URL or `--repo`).
- `main.before`, as fetched, and `main.after`, as the remote reports it after the push stage; null when the run refused before reaching it.
- `ci`: the workflow, the exact `gh` command, every run returned with whether it counted, and the run the decision rested on.
- `checks`: every check with `pass`, `fail` or `skipped` and its detail.
- `push`: exit code and both streams, or null when no push was attempted.
- `startedAt`, `finishedAt`, and the effective `git` and `gh` executables.

A receipt is written for every invocation, including one that crashes (`outcome: error` with `failurePhase`). `tests/land-contracts.mjs` runs the tool against a bare origin, a clone and a stub `gh`.
