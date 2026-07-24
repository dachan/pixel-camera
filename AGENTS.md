# Project notes for agents

## Workflow

- After completing code changes, always commit, push, and deploy — without
  asking for confirmation each time. Sequence: commit (logical, file-granularity
  since interactive hunk staging isn't available), `git push`, then
  `./scripts/deploy.sh` (it builds first and aborts on error, so a broken build
  never reaches the Pi). Deploy target is `dachan@pixel.local`.
- Never use the auto-memory directory for this project. Save all context,
  preferences, and standing instructions here in `AGENTS.md` instead.

## Icons

- Any new icon must match the existing stroke-style set: 24×24 viewBox,
  `fill-none`, `stroke-current`, thin stroke (`stroke-[1.5]`), round caps and
  joins. Reuse the shared `SVG_CLASS` in
  `frontend/src/components/camera-controls/control-tab-icons.tsx`; see also
  Slider's `LockIcon`/`DisabledIcon`. Draw new icons to fit this family.
