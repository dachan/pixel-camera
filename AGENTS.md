# Project notes for agents

## Workflow

- After completing code changes, always commit, push, and deploy — without
  asking for confirmation each time. Sequence: commit (logical, file-granularity
  since interactive hunk staging isn't available), `git push`, then
  `./scripts/deploy.sh` (it builds first and aborts on error, so a broken build
  never reaches the Pi). Deploy target is `dachan@pixel.local`.
- Never use the auto-memory directory for this project. Save all context,
  preferences, and standing instructions here in `AGENTS.md` instead.
