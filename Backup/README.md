# Legacy Backup Snapshot

This directory is retained only as a historical pre-split reference.

It is **not** the active RETRADE application and it is **not** the production backup system.

Current application source lives in the repository root as separate files such as `index.html`, `app.js`, `app.css`, `accounting.js`, `reports.js` and `sw.js`.

Do not place live RETRADE exports, Supabase data, customer/order data, credentials or current JSON backups in this directory. Local business-data backups must be stored outside this public source repository.

For code recovery, use Git history and the `archive/*` milestone branches. For production-data recovery, use the separate Supabase backup/export process.
