# Xpositor roadmap

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

Checked 18 September 2026: the [official voice documentation](https://learn.chatgpt.com/docs/features/voice) covers the ChatGPT desktop app and paired iOS Remote on supported plans, subject to rollout and workspace settings. That does not establish support for embedding the same subscription voice experience in Xpositor.

Installed `codex-cli 0.146.0` exposes `thread/realtime/*` request methods only when generating the experimental protocol. Its stable request union excludes them. The [App Server documentation](https://learn.chatgpt.com/docs/app-server) explicitly gates experimental methods. A reliable public subscription contract and account entitlement for third-party voice were not verified, so no voice session or paid audio service was added. This is a deferred feasibility item, not a claim that voice is technically impossible.

Possible future low-cost experiment: device dictation plus device read-aloud, with explicit controls and privacy disclosure. It would be a turn-by-turn accessibility aid, not a natural interruptible conversation.

## Release validation and later product work

- [ ] Exercise a real phone/Safari PWA install, offline relaunch and reconnection over cellular. Current browser checks used Chromium at phone/tablet sizes.
- [x] Verify live Claude Code subscription generation: overview plan, audio lesson, follow-ups and deep review with repository tools (27 September 2026).
- [ ] Exercise the existing named-tunnel configuration against a real hostname. Lifecycle behavior is covered by mocks; Xpositor does not provision infrastructure.
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

## Latest feedback

- [x] Quiet successful connection state; capture age in the Refresh tooltip.
- [x] System/light/dark theme toggle, dark hover states, and initially collapsed Code Guide.
- [x] Composer model controls, icon-only new conversation, and shared send/interrupt button.
- [x] One-click walkthrough start and simpler step navigation, with options/overview tucked away.
- [x] Reuse the companion and tunnel when switching transport; add pairing-button spacing.

- [x] Implement the approved narrow desktop rail, consolidated Preferences, single file heading, and full-height code reader.

## Next implementation priorities

The following implementation priorities are complete for Codex; see the [agent-guide design and acceptance criteria](docs/agent-guide-design.md).

1. [x] **Review scope:** Add Unstaged / Staged / All changes and remember the user's selection. Handle partially staged files correctly, keep review decisions tied to the chosen comparison and revision, and retain staged code as agent context without automatically marking entire files reviewed.
2. [x] **Repository-wide agent guide:** Replace bounded prompts with read-only repository exploration using the existing subscription connection. Let the agent search and read relevant changed and unchanged files, including callers; account for every changed file in large reviews and disclose any omissions.
3. [x] **Guided review:** Generate an overview and suggested file order, then walk through changes conversationally with navigable code references and saved progress.
4. [x] **Branched conversations:** Allow a follow-up question to open its own conversation without losing the main walkthrough's place or context.

## Focus and workspace improvements

- [x] **Built-in Pomodoro:** Add a 25-minute focus period followed by a 5-minute break, with start, pause/resume, and reset controls. Preserve the review position and keep timer state accurate when the tab is backgrounded or reloaded. Keep the timer unobtrusive while reviewing.
- [x] **Screen-free break suggestions:** Encourage doing nothing, walking, stretching, having a conversation, or optionally enjoying a small sweet snack. Suggest avoiding scrolling and feeds during the break. Present these as optional activities, not medical or nutritional claims.
- [x] **Resizable Code Guide column:** Add a draggable divider between the reader and Code Guide on desktop. Support keyboard resizing, sensible minimum/maximum widths, and a remembered width preference. Preserve the existing mobile drawer behavior.

Implementation check, 20 September 2026: scopes, Pomodoro and the resizable guide passed unit and desktop/mobile browser checks. Codex now uses captured repository tools, generates complete plans, and supports ordinary follow-ups and separate branches. The browser reconnects to saved run IDs without repeating generation. Companion history and snapshots persist with private file permissions; interrupted requests are reported without automatic replay.

Live Luna checks passed: a four-step plan covered all 100 changed files with all 100 recorded as examined; a branch found an unchanged caller after the original worktree changed. A separate test resumed a real Codex thread and forked it after companion restarts while preserving the main conversation. Repository-tool tests deny writes and out-of-capture reads. Browser checks cover one-action start, citations, branches, saved position, phone layout and explicit stop. Claude repository-tool parity and voice remain deferred as described above.

## Audio teaching pilot

- [x] Expand one walkthrough chapter into short speech-oriented teaching segments with small, validated old/new source excerpts and a focused line.
- [x] Local Kokoro speech adapter, three voices, speed control, next-segment buffering, pause/resume and automatic segment highlighting.
- [x] Saved transcript/excerpts and segment position; typed questions pause audio and retain the lesson's place.
- [ ] Evaluate comprehension and voice quality on a real confusing change before extending to whole-review lessons.
- [ ] Validate audio start, interruption, backgrounding and reconnection on Safari and Samsung Internet.
- [ ] Consider downloadable audio lessons and microphone questions after the pilot evaluation. No paid speech service is enabled.

Pilot validation, 22 September 2026: full regression suite passed; live Luna generated a grounded seven-segment lesson from Xpositor request-deduplication code. All three Kokoro voices generated real WAV audio locally (about 15–17 seconds to synthesize a 26-second segment on the development laptop). Chromium native-audio checks cover pause/resume, segment advance and question interruption; layout and transcript checks cover phone widths down to 320 px. Human comprehension/voice preference and real phone browser behavior remain evaluation items.
