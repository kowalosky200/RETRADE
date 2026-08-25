# RETRADE Development

Development-only assets live here. Production app code should stay outside this folder.

Suggested structure:

- `dev/sql/` — Supabase migrations and rollback notes.
- `dev/seed/` — demo/historical datasets for local testing.
- `dev/tests/` — fixtures and repeatable test cases.
- `dev/docs/` — implementation notes and handovers.

Do not commit secrets or production credentials. Keep the canonical app filenames unchanged and use Git branches for feature development rather than maintaining duplicate `index_dev*.html` versions.
