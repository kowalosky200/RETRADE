# Stage 4 resilience audit

Stage 4 covers offline durability, multi-device convergence, backup/restore and recovery behaviour.

## First-pass findings

- Fixed the release-candidate outbox coverage check so it inspects the authoritative persistence implementation.
- Added a deterministic content fingerprint to new V5 backups. Existing count-only V5 and legacy backups remain importable, while newly exported backups detect value-level corruption.
- Isolated pending settings by user ID so two accounts using one browser cannot overwrite each other's durable settings queue. A matching legacy queue entry migrates automatically.

No Supabase schema change is required for these fixes.
