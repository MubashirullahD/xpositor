# Patchwork roadmap

## Completed in the review hardening pass

- [x] Escape repository metadata and Markdown; restrict static files; add CSP and API origin/content-type checks.
- [x] Capture immutable diffs and source, parse exact Git paths, include nested untracked files, handle renames/deletions/binary files, and refuse symlink escapes.
- [x] Surface Git errors and explicit resource limits instead of silently incomplete snapshots.
- [x] Bind review decisions to repository/comparison/path/revision; retain historical notes and separate snapshot conversations.
- [x] IndexedDB persistence, immediate draft/progress writes, storage errors, private backup/import, cached-source clearing and Markdown handoff summaries.
- [x] Readable phone code, font controls, wrap, context folding, hunk navigation, anchored questions and sticky review actions.
- [x] Reachable phone/tablet guide, modal focus handling, keyboard tabs, Back/Escape handling and distinct internet/laptop/provider state.
- [x] Remove fabricated real-workspace AI replies, inert navigation and hardcoded progress cues. Demo is explicit.
- [x] Repair launcher restart races, startup timeout/error retention, repeated sidebar activation, and multi-root selection.
- [x] Offer existing named tunnels with stable pairing credentials; retain a free Quick Tunnel default with clear origin/backup guidance.
- [x] Subscription-authenticated Codex app-server conversations, streamed replies, stop/cancel, bounded processes/context, and no automatic API-key fallback.
- [x] Structured walkthroughs across related changed files: depth/time, scope disclosure, validated citations, code navigation, simpler/example/caller follow-ups, saved progress, and separate understood/reviewed decisions.
- [x] Portable snapshot/provider/HTTP/launcher/frontend tests, mobile/tablet browser checks, and an updated local VSIX.
- [x] Verify a live Codex ChatGPT-subscription explanation, four-step two-file walkthrough and follow-up using synthetic code.

## Voice — deferred to preserve the free app model

- [ ] Revisit natural voice when subscription-backed third-party embedding has a supported, verified integration path. Keep text fully usable; do not add a separately billed audio service by default.

Checked 18 September 2026: the [official voice documentation](https://learn.chatgpt.com/docs/features/voice) covers the ChatGPT desktop app and paired iOS Remote on supported plans, subject to rollout and workspace settings. That does not establish support for embedding the same subscription voice experience in Patchwork.

Installed `codex-cli 0.146.0` exposes `thread/realtime/*` request methods only when generating the experimental protocol. Its stable request union excludes them. The [App Server documentation](https://learn.chatgpt.com/docs/app-server) explicitly gates experimental methods. A reliable public subscription contract and account entitlement for third-party voice were not verified, so no voice session or paid audio service was added. This is a deferred feasibility item, not a claim that voice is technically impossible.

Possible future low-cost experiment: device dictation plus device read-aloud, with explicit controls and privacy disclosure. It would be a turn-by-turn accessibility aid, not a natural interruptible conversation.

## Release validation and later product work

- [ ] Exercise a real phone/Safari PWA install, offline relaunch and reconnection over cellular. Current browser checks used Chromium at phone/tablet sizes.
- [ ] Verify live Claude Code subscription generation. Its adapter/auth/error behavior is covered by stubs; live generation was verified with Codex only.
- [ ] Exercise the existing named-tunnel configuration against a real hostname. Lifecycle behavior is covered by mocks; Patchwork does not provision infrastructure.
- [ ] Expand context to explicitly selected unchanged callers with equally strict snapshot boundaries; current walkthroughs use changed files only.
- [ ] Add branch/commit comparisons and PR review after validating the uncommitted-change workflow with users.
- [ ] Decide on Marketplace publishing. The VSIX is built locally; it has not been published or automatically installed.
- [ ] Consider a framework migration only when incremental DOM updates and richer interaction justify it.
- [ ] Keep reminders, streaks, push delivery, and optional application-level end-to-end encryption behind core review reliability.

Development-machine compatibility: upgraded the Homebrew Codex CLI from 0.146.0 to 0.155.0; verified live Astra generation and dynamic discovery of Sol, Astra, Terra, Luna and GPT-5.5. Models and effort choices now come from Codex at runtime. No user-global model setting was changed.

## User-feedback polish completed

- [x] Download all captured text sources with the diff and report device-save state.
- [x] Working wrap and diff-context folding; collapsible desktop queue with unclipped counts.
- [x] Flush-bottom opaque review actions; collapsed desktop backup controls; isolated mobile guide scrolling and centered Send icon.
- [x] System light/dark palette and browser color-scheme metadata.
- [x] LAN HTTP by default, with an optional HTTPS tunnel and LAN-address selection in the launcher.
- [x] Dynamic Codex model/effort selection and actionable nested provider-error messages on mobile.
