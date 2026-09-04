# Supabase migration history

This directory is intentionally flat. Supabase discovers migration files here by their timestamped filenames.

The numbered Stage 1 and Stage 2 files are production history. Once applied, they must not be moved, renamed, edited or grouped into subfolders. Add every future database change as a new migration that supersedes earlier behaviour.

Some early files are read-only audit or verification steps. They remain here because removing an existing migration can make local and remote migration histories disagree.
