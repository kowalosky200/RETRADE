# RETRADE

RETRADE is a static web application backed by Supabase.

## Repository layout

- `index.html`, `app.js`, `app.css`, `accounting.js`, `reports.js` — production application
- `supabase/migrations/` — append-only production database history
- `docs/` — development guidance and completed audit evidence
- `archive/legacy-site/` — retained pre-current site snapshot
- `.github/workflows/ci.yml` — active repository checks
- `.github/archive/` — completed one-off workflows and patch utilities, retained for traceability

Generated exports, database backups, credentials and local business data do not belong in this repository.
