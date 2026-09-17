# Patchwork roadmap

## Next: make large mobile reviews comfortable

- [x] Remove the hard-coded 60-file snapshot limit so larger worktrees, including `map-of-experience`, are fully reviewable.
- [x] Add a full-source view alongside the diff view so a file can be read in its normal context.
- [x] Add a rendered Markdown preview while keeping the raw/source view available when needed.
- [x] Fix mobile scroll locking so an open file list scrolls independently without scrolling the file being viewed underneath it.
- [x] Let the phone back action close the file list, in addition to the visible close button, using browser history where appropriate.

One source is fetched and cached when opened, so an already-viewed file remains available offline without making the initial mobile snapshot unnecessarily large. A future optimization can prefetch all sources when the connection is fast.

## Next: make each file explainable

- [ ] Replace the placeholder Overview panel with an on-demand AI-generated overview for each file: what changed, how it behaves, why it matters, likely risks, and one review question. Cache it by file and diff version, with a basic metadata fallback offline.

## Then: make the connection effortless and reliable

- [x] Use a Cloudflare Quick Tunnel for HTTPS pairing without requiring phone certificate installation.
- [x] Add clear Quick Tunnel dependency/setup guidance and a friendly missing-`cloudflared` recovery flow.
- [ ] Evaluate a named Cloudflare Tunnel or Patchwork-managed relay for production reliability after the Quick Tunnel workflow is stable.
- [x] Build and locally install a distributable `.vsix`.
- [x] Add a proper VS Code Activity Bar entry with an on-demand pairing sidebar; keep companion auto-start opt-in.
- [ ] Decide on Marketplace publishing after the local workflow is stable.
- [ ] Exercise one real Codex and one real Claude Code subscription request end to end, including clear auth/provider errors.

## Later: motivation and product depth

- [ ] Improve reminders and review streak/progress cues without making the experience noisy.
- [ ] Support reliable notifications while the app is closed through push or a native mobile wrapper.
- [ ] Add richer review context and optional future actions only after the read-only review flow is dependable.
- [ ] Low priority: add application-level end-to-end encryption between the phone and laptop so the tunnel provider cannot read review traffic; pursue only if the added complexity is small.

## Completed

- [x] Read-only LAN companion for uncommitted changes.
- [x] Offline-capable PWA snapshot and local review state.
- [x] VS Code launcher with automatic port selection and QR pairing.
- [x] Local Codex/Claude Code CLI provider adapters.
- [x] Standards-compliant QR generation and pairing-panel scanability fix.
