# app-devkit

Instructions for every AI assistant working here (Claude Code reads this through `CLAUDE.md`).

Reusable GitHub Actions building blocks (composite actions) and deploy workflows for the owner's web apps. Many apps
call these at `@v1`; some pin an exact `v1.x.y`.

## Public here, private elsewhere

Anything merged here is public. Keep only code, docs, general rules and **made-up** sample data. Never commit
secrets, tokens, personal data, real names or patient details. Private notes belong in the owner's private notes
repo; never copy anything from there into this repo, a PR or an issue (neutral pointers like "ask the owner" are fine).

## Rules that bite

- **A released `v1.x.y` never changes.** Fixes go in a new version with a CHANGELOG entry; breaking = new major.
  `v1` moves only forward (`release.yml` does it; sessions cannot push tags).
- **Every block is tested in `ci.yml` on a fixture.** Add or change a block and its fixture job together.
- **Nothing app-specific**: no app names, project ids, domains or paths. Callers pass them in.
- Keep `ubuntu-24.04`, no `--with-deps`, `timeout-minutes` and `concurrency` on every workflow.
- Deploy workflows must skip cleanly (green, with a notice) when their secrets or values are missing.
- Changing a deploy workflow affects every app that calls `@v1`: test in a canary app before moving `v1`.

## Checks before merging

```
bash scripts/test-clean.sh    # secret-cleaning function used by deploy-worker.yml
```

CI also runs actionlint and each block on a fixture. Wait for it to be green.

## Releasing

Bump `version` in `package.json`, add the CHANGELOG entry, merge with CI green; `release.yml` tags the commit.

## Working with the owner

- Instructions mostly come from a phone. Work through a request to the end; ask only when a decision is genuinely
  the owner's. When asked to plan, plan and wait.
- Keep each PR small and finished on its own. Start PR titles with "app-devkit: …".
- Merge your own PRs once the checks pass, then report with the PR link and call `unsubscribe_pr_activity`.
- Keep `NOTES.md` (lasting decisions, how to test) and `STATUS.md` (now, next, dated decisions) current.
  Cheap end of session: `quick-save`.
- Plain words, short; explain technical terms briefly the first time.
