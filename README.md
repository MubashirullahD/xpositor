# Patchwork

Review a laptop's uncommitted Git changes from your phone. Patchwork is a read-only PWA with a local Node companion and an optional VS Code launcher. Notes, drafts and review decisions stay in the phone's browser. Agent walkthroughs are saved on the phone and companion so they can resume after reconnecting.

## Start

Requires Node.js 20+ and Git. No npm runtime dependencies are needed for the companion.

```sh
node companion.mjs /absolute/path/to/repository
```

Open `http://127.0.0.1:4321`. `npm run serve` runs the companion for the current repository. A clean repository shows an empty queue; sample files appear only after choosing **Explore demo** when no snapshot is loaded. Demo mode does not fabricate AI answers.

For phone access, use the VS Code launcher in [vscode-extension](vscode-extension/README.md). It starts a local LAN companion immediately by default. Put both devices on the same trusted Wi-Fi and choose **Patchwork: Start Phone Review**. The pairing sidebar can switch to **HTTPS tunnel** for access from another network; that mode requires `cloudflared`. Scan the pairing QR code. The laptop must remain running and connected. Keep the pairing link private.

Quick Tunnels are a development transport, with changing URLs and no uptime guarantee. Browser storage belongs to each URL's origin: **export a private backup before changing the tunnel URL**, then import it at the new one. The launcher also accepts an existing named tunnel and stable public URL; see its README for setup. Patchwork does not provision a domain, paid relay, or cloud database.

Advanced trusted-LAN preview: `PATCHWORK_HOST=0.0.0.0 node companion.mjs /path/to/repo` prints a pairing token. HTTPS is required for PWA installation on phones; optional `PATCHWORK_TLS_KEY` and `PATCHWORK_TLS_CERT` supply certificates. The tunnel is a trusted intermediary, not application-level end-to-end encryption.

## Review on mobile

- Read diffs, captured source and sanitized Markdown. Adjust code size, wrap long lines, fold unchanged context and jump between hunks.
- Mark a file reviewed explicitly; **reviewed and next** advances through the queue. Decisions survive refresh only when that file's repository, comparison base, branch, path and content revision match.
- Tap a line to add a private question, including an old/new side and range. Resolve questions separately from reviewing files. Notes on earlier revisions remain visible as historical notes.
- Drafts, selection, scroll position and conversations are stored in IndexedDB. Storage failures are visible. Export a full private backup or a Markdown review summary for desktop follow-up.
- Every capture downloads diffs and all available text sources together, then saves them to the device. Offline mode keeps that snapshot and notes; a failed connection never substitutes demo data.

The desktop uses a narrow navigation rail for the review queue, Code Guide, backups, and Preferences. Preferences groups the system/light/dark appearance, code size, wrapping, and diff-context folding; on phones it opens from the top bar. The file path appears once above compact view tabs, with review actions at the bottom. LAN HTTP allows reading already loaded code while disconnected, but browsers require HTTPS for PWA installation and offline relaunch. Use the tunnel for those features.

Snapshots bind diffs and source to the same captured revision. Refresh explicitly to see new laptop changes. Very large or rapidly changing worktrees fail visibly instead of silently omitting files. Current limits: 2,000 changed files, 2 MiB per file, 16 MiB per capture, and eight cached snapshots within 64 MiB. Old snapshots may expire on the companion; local review history remains on the device.

## Code guide and subscriptions

Install and sign in to Codex or Claude Code on the laptop. By default, Patchwork tries a verified Codex ChatGPT login, then a verified Claude Code login. Credentials stay on the laptop. Requests consume that account's allowance; availability and plan limits still apply. Patchwork never automatically falls back to a paid API key.

```sh
PATCHWORK_AI_PROVIDER=codex node companion.mjs /path/to/repo
# Alternatives: claude, auto (default), none (disable AI)
```

Open the model selector in the conversation composer (or below the walkthrough) to select a model and reasoning effort. Codex supplies the available choices dynamically; Patchwork does not maintain a model list. The choice applies to conversations and walkthroughs and is saved on the device. Other providers currently use their laptop configuration. Provider failures include actionable messages. If a model requires a newer CLI, update Codex on the laptop and restart the companion. Development was verified with Codex CLI 0.155.0, including a live Astra response.

Choose **Start walkthrough** for a repository-wide Codex guide. Patchwork first prepares a separate Overview summary for each changed file in small parallel batches. Completed summaries appear in their file tabs while the remaining files are still being prepared. Common lockfiles are skipped and labeled as such. The walkthrough then uses those file summaries and can search or read captured code, including unchanged callers, with paginated tools. Every changed file still appears in the review plan, and its guide overview discloses files it did not examine. Follow the suggested step order, open validated code references, and ask questions. The branch icon explores a question in a separate conversation while retaining the main walkthrough's place. Understanding a step never marks a file reviewed.

Codex guide threads persist and resume against the same captured snapshot. Refreshing unchanged code keeps that identity; changes to supporting code create a new snapshot. Reloading a phone reconnects to the existing response. Stop explicitly interrupts it. A companion restart preserves conversations but interrupts an active response without automatically replaying it. Choose the model and effort from Codex's dynamic catalog; no separate API key is needed.

Repository tools expose only immutable captured inventory, source, search and diffs. Native shell, writes, network tools, hooks and unrelated plugins are disabled. Patchwork enables the required tool host only for its dedicated guide process; users do not need to enable it in global CLI settings. Private notes are excluded unless included in a question. Retrieved code and sent questions reach the selected provider. Selected-file chat remains a text-only conversation. Claude and explicit API mode retain the bounded text walkthrough; repository exploration currently requires Codex.

The companion stores guide conversations and up to eight guide snapshots in `~/.patchwork/reviews/<repository-id>/`, with private file permissions. `PATCHWORK_STATE_DIR` overrides the parent directory. Codex also retains its own thread history. Guide storage is limited to 128 conversations and 32 MiB of conversation state per repository; snapshot files are limited to 64 MiB each. Unchanged context is capped at 10,000 paths and 32 MiB per capture, with unavailable source reasons exposed to the guide. To clear companion guide history, stop the companion and back up or remove that repository's cache directory. Phone notes and review decisions are separate. Downloaded guide text and changed sources work offline; new model turns and supporting-code retrieval require the laptop.

API billing is available only by explicit opt-in:

```sh
PATCHWORK_AI_PROVIDER=api OPENAI_API_KEY=your-key OPENAI_MODEL=your-model \
  node companion.mjs /path/to/repo
```

This mode is billed separately by the API provider. API requests use `store: false`. Setting an API key alone does not enable it. Native voice is deferred; see [TODO.md](TODO.md).

## Scope and focus

Choose **Unstaged**, **Staged** or **All** changes; the last choice is remembered. Unstaged is the default. Partially staged files have separate comparisons and review decisions, so staging a hunk does not silently approve the remaining work. Patchwork does not change the Git index.

The rail's focus timer offers 25 minutes of focus and a 5-minute break, with pause and reset. Break suggestions include walking, stretching, conversation, doing nothing or a small sweet snack, without scrolling feeds. The next focus period waits for you to start it. Drag the Code Guide divider on desktop, or focus it and use arrow keys, to resize the column; its width is remembered.

The separate **Mindful breathing** icon opens a quiet exercise without changing the focus timer or review position. An expanding and contracting circle guides gentle inhales and exhales; a prompt invites you to notice the breath and return to it when attention wanders. Choose 1, 3 or 5 minutes and a comfortable pace, then pause or end at any time. The exercise pauses when the app moves to the background. Reduced-motion settings keep the guidance in text without animating the circle. Duration and pace choices are saved on this device.

## Checks and packaging

```sh
npm test
npm run extension:bundle
cd vscode-extension
npm install
npm run package
```

For the browser regression, start the companion with AI disabled and run `playwright-cli open http://127.0.0.1:4321`, then `playwright-cli run-code --filename=tests/browser-review.cjs`. The scenario uses stub responses and an isolated browser, checks phone/tablet behavior and saves screenshots under `/tmp`.

The default automated checks use temporary repositories and stub providers; they do not spend an AI subscription or require real API credentials. HTTP tests need permission to bind loopback ports. The extension packages the companion and all required modules; source-checkout fallback is only available in extension development mode.

Patchwork does not stage, edit, commit, publish comments or approve pull requests. Review decisions are local personal state, not remote repository approvals.

Reading defaults keep long lines unwrapped and fold unchanged context; saved choices remain respected. Outside text fields, menus, tabs and the guide, ↑/↓ smoothly scroll the reader, ←/→ select adjacent files without wrapping, and Return marks the current file reviewed and advances. Holding Return does not review additional files. Reduced-motion preferences disable smooth scrolling. Reviewing the final outstanding file opens a completion page, retained across reloads; refreshing changed code returns to the pending review.

Opt-in live subscription checks: `node tests/live-agent-guide.mjs` exercises a 100-file plan and unchanged caller in a fork; `node tests/live-guide-resume.mjs` checks real thread resume and branching after companion restarts. These consume the signed-in Codex allowance. `tests/browser-agent-guide.cjs` covers guide reconnection, branches, citations, cancellation and phone layout with mocked responses.

## Listen & follow

Starting a Codex walkthrough automatically prepares its first teaching chapter and audio. Opening another chapter prepares it in the same way. The existing subscription generates 4–8 short spoken sections: context, a concrete example, code references, an edge case and a check-your-understanding question. References highlight the main code reader, including captured supporting files; Code Guide contains the explanation without duplicate snippets. Playback pauses at the end of each section. In the walkthrough, use Left/Right for Back/Next and Space for Play/Pause; text fields and native controls retain their usual keys. This never marks code reviewed.

Transcript words highlight using estimated positions inside measured speech phrases. This follows the audio clock, including pause and playback speed, but is not exact word alignment. Speech remains local and requires no additional paid API.

Speech uses local Kokoro on the laptop, with no TTS API bill. One-time setup from the project folder:

```sh
npm run setup:voice
```

The packaged extension includes the same setup script under `bundle/setup-voice.mjs`; run it with Node if using only the VSIX. Setup downloads the pinned speech runtime and model to `~/.patchwork/voice` (`PATCHWORK_VOICE_HOME` overrides this). It needs internet and disk space for the initial dependencies/model. A separate speech process keeps model loading and synthesis out of the companion's HTTP event loop. Text and code are never sent to a cloud TTS provider.

Choose Heart, Bella or Michael under **Voice & speed**. Playback prepares the next segment ahead, supports pause/resume and manual Back/Next, and pauses when you ask a question. Reload retains the segment, transcript and captured excerpts; it never autoplays. “Explain more simply” and “Another example” use the existing text conversation and preserve the lesson's position. Listening does not imply approval.

Current limits: English narration, Codex repository exploration, laptop required for new audio, and no microphone or spoken interruption yet. Audio clips are bounded in-memory caches rather than offline downloads. Text and references remain available from saved device state. Phone browser policies may require another tap to start audio; real Safari/Samsung playback still needs device validation. Voice setup failures leave the transcript usable.

Opt-in validation: `node tests/live-audio-lesson.mjs` generates a real lesson about Patchwork request deduplication through the signed-in Codex subscription. `tests/browser-audio-lesson.cjs` checks synchronization, playback controls and phone layout with stubbed audio. The default test suite covers citation grounding, persistence sanitization and speech-worker failure/caching behavior.

During walkthrough, teaching-chapter and audio preparation, **Try a breathing exercise** offers a quiet minute without interrupting generation. Choose gentle paced breathing or noticing your surroundings. Time and pace settings stay tucked away, and the Pomodoro remains independent. A ready message lets you return when you choose; audio never starts over the exercise. The first audio segment prepares automatically after a teaching chapter is generated. If preparation takes longer than the exercise, the interface says so rather than promising a completion time. Preparation errors and cancellation remain visible through the return control.

The pause is optional: thoughts do not need to disappear, and there is no expected emotional outcome. Breathing copy emphasizes comfort rather than forcing a rhythm, consistent with the [NHS breathing guidance](https://www.nhs.uk/mental-health/self-help/guides-tools-and-activities/breathing-exercises-for-stress/). The surroundings option uses normal breathing. These controls are a brief rest aid, not an assessment or treatment feature; no mindfulness session history or health data is collected.
