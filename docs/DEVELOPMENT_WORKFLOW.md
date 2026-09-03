# RETRADE Development Workflow

This repository uses a simple protected-main workflow designed for a single-owner production app with several parallel workstreams.

## Branch roles

- `main` — production / known-good code only. Do not experiment or develop directly here.
- `archive/*` — milestone snapshots of known-good states. Do not develop on these branches.
- `audit/*` — staged reliability, security and integrity audits.
- `fix/*` — isolated bug fixes.
- `feature/*` — product features.
- `ui/*` — visual/UX work that is independent from backend changes.
- `chore/*` — repository/tooling/maintenance work.

Current Stage 2 milestone:

- `archive/stage2-complete-2026-09-03`

## Required workflow

1. Start from the latest known-good `main`.
2. Create one branch for one logical workstream.
3. Make small, focused commits. Avoid mixing unrelated fixes.
4. Test the changed behaviour before opening a pull request.
5. Review the complete branch diff against `main`.
6. Merge only through a pull request.
7. Delete short-lived work branches after successful merge when no longer needed.
8. Create an `archive/*` milestone branch for major verified releases/audit stages when a Git tag/release is not being used.

## Commit messages

Use a short conventional prefix and explain the cause where useful:

- `fix(sync): ...`
- `fix(lifecycle): ...`
- `fix(accounting): ...`
- `feat(monitors): ...`
- `ui(loading): ...`
- `chore(db): ...`
- `docs(repo): ...`

For risky fixes, the commit body should record:

- root cause,
- user-visible effect,
- what was changed,
- verification performed.

## Pull-request standard

Every pull request should answer:

- What problem is being solved?
- What files/systems changed?
- What was deliberately not changed?
- What tests/checks were run?
- Are database migrations required?
- Is rollback straightforward?

Risky areas require explicit regression checks:

- sync/outbox/multi-device behaviour,
- stock lifecycle / returns / relisting / resale,
- cash ledger / partner settlements / accounting,
- migrations / RLS / ownership,
- import/export and recovery.

## Production database migrations

Production migrations are append-only history.

Once a migration has been applied to production:

- do not edit or rewrite that migration to change history,
- create a new numbered migration that repairs or supersedes it,
- make migrations defensive and idempotent where practical,
- include read-only verification queries,
- record whether the migration was actually applied in production.

Direct SQL used to repair production must be captured in the repository afterwards so Git remains the source of truth for what happened.

## Data safety

The Git repository protects source code; it is not the production-data backup.

Do not commit:

- Supabase exports containing live user/business data,
- RETRADE JSON backups,
- customer/order/sales exports,
- credentials, service-role keys or `.env` files,
- supplier/customer spreadsheets containing non-public data.

Keep production-data backups in a separate private storage location and use Supabase backup/export facilities separately from Git.

## Backup / rollback model

There are three independent recovery layers:

1. **Git history** — every committed code change is traceable and revertible.
2. **Milestone branches/tags** — easy known-good restore points for major stages.
3. **Supabase backups/exports** — recovery for production data, independent of code.

If a regression appears after a merge:

1. identify the first bad commit/PR,
2. compare it with the last known-good milestone,
3. prefer reverting the offending commit/PR instead of manually reconstructing old files,
4. use a fresh `fix/*` branch for the repair,
5. preserve the failed history so the cause remains traceable.

## Parallel RETRADE workstreams

Separate projects should remain separate branches until proven compatible. Examples:

- `audit/stage-3-data-integrity`
- `feature/monitors`
- `ui/loading-system`

Do not merge one project into another simply to share unfinished work. Rebase/merge from updated `main` when a workstream needs changes that have already been proven and merged.

## Direct-main exception

Direct writes to `main` should be treated as an emergency exception only. Repository protection should be configured to require pull requests, block force-pushes and block deletion of `main`.
