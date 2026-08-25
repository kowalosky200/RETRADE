# RETRADE database migrations

Run migrations in numeric order against the RETRADE Supabase project.

## Monitors v0.1

1. `001_monitors.sql` — creates categories, model intelligence, monitors, detected listings and scored matches; adds indexes, RLS and ownership policies.
2. `002_monitor_ownership_guard.sql` — prevents a monitor from referencing another user's category.

## Applying migrations

Use the Supabase SQL Editor against the development project/database first. Do not run development seed/reset scripts against production.

After both migrations succeed, the Monitors UI can use cloud persistence once `monitors.html` is supplied with the same authenticated Supabase client/configuration as the main RETRADE app.

The browser must only use the normal public/publishable Supabase key. Never place a service-role key, database password, Vinted credential, Discord token or other private secret in this repository.

## Shared client hook

`modules/monitors/monitor-api.js` looks for an authenticated client in this order:

- `window.RETRADE_MONITOR_CONFIG.supabaseClient`
- `window.RETRADE_SUPABASE`
- `window.supabaseClient`

If none is present, or the monitor tables have not been migrated, the page deliberately falls back to local browser storage. This keeps local development usable while the main app's Supabase bootstrap is being modularised.
