# RETRADE Monitor Worker

This folder is reserved for the always-on marketplace monitoring service.

The browser-facing `monitors.html` page is the control centre. The worker will later:

1. Read enabled monitor definitions from Supabase.
2. Poll supported marketplace sources conservatively.
3. Normalize listing data.
4. Deduplicate by marketplace + listing ID.
5. Apply category/model rules and deal scoring.
6. Store matching opportunities in Supabase.
7. Trigger configured notifications such as Discord.

## Security

Do not store marketplace passwords, cookies, payment information, Supabase service-role keys, Discord bot tokens or other secrets in the repository. Use environment variables only.

## Initial implementation direction

Keep the marketplace connector isolated from the rest of RETRADE so that it can be replaced without changing the dashboard or scoring system. The first live connector should only support listing detection and alerts; checkout automation is deliberately outside the initial scope.
