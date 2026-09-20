# Patchwork

Review a laptop's uncommitted Git changes from your phone. Patchwork is a read-only PWA with a local Node companion and an optional VS Code launcher. Notes, drafts, review decisions and walkthrough progress stay in the phone's browser.

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
- Every capture downloads diffs and all available text sources together, then saves them to the device. The status shows how many sources are saved. Offline mode keeps that snapshot and notes; a failed connection never substitutes demo data.

The desktop uses a narrow navigation rail for the review queue, Code Guide, backups, and Preferences. Preferences groups the system/light/dark appearance, code size, wrapping, and diff-context folding; on phones it opens from the top bar. The file path appears once above compact view tabs, with review actions at the bottom. LAN HTTP allows reading already loaded code while disconnected, but browsers require HTTPS for PWA installation and offline relaunch. Use the tunnel for those features.

Snapshots bind diffs and source to the same captured revision. Refresh explicitly to see new laptop changes. Very large or rapidly changing worktrees fail visibly instead of silently omitting files. Current limits: 2,000 changed files, 2 MiB per file, 16 MiB per capture, and eight cached snapshots within 64 MiB. Old snapshots may expire on the companion; local review history remains on the device.

## Code guide and subscriptions

Install and sign in to Codex or Claude Code on the laptop. By default, Patchwork tries a verified Codex ChatGPT login, then a verified Claude Code login. Credentials stay on the laptop. Requests consume that account's allowance; availability and plan limits still apply. Patchwork never automatically falls back to a paid API key.

```sh
PATCHWORK_AI_PROVIDER=codex node companion.mjs /path/to/repo
# Alternatives: claude, auto (default), none (disable AI)
```

Open the model selector in the conversation composer (or below the walkthrough) to select a model and reasoning effort. Codex supplies the available choices dynamically; Patchwork does not maintain a model list. The choice applies to conversations and walkthroughs and is saved on the device. Other providers currently use their laptop configuration. Provider failures include actionable messages. If a model requires a newer CLI, update Codex on the laptop and restart the companion. Development was verified with Codex CLI 0.155.0, including a live Astra response.

Codex uses its app-server conversation protocol, streams replies, and retains a bounded set of ephemeral conversation threads. Claude Code receives explicit conversation history. Both run without repository tools in an empty temporary directory. Selected captured code and the questions you send reach the chosen provider. Private notes are excluded unless you put them into a question yourself.

The guided walkthrough builds a short sequence covering intent, execution, edge cases and verification across selected related changed files. Citations are checked against the captured snapshot. It shows the included scope and missing context; it cannot inspect arbitrary unchanged callers. Understanding a step never marks a file reviewed.

API billing is available only by explicit opt-in:

```sh
PATCHWORK_AI_PROVIDER=api OPENAI_API_KEY=your-key OPENAI_MODEL=your-model \
  node companion.mjs /path/to/repo
```

This mode is billed separately by the API provider. API requests use `store: false`. Setting an API key alone does not enable it. Native voice is deferred; see [TODO.md](TODO.md).

## Checks and packaging

```sh
npm test
npm run extension:bundle
cd vscode-extension
npm install
npm run package
```

For the browser regression, start the companion with AI disabled and run `playwright-cli open http://127.0.0.1:4321`, then `playwright-cli run-code --filename=tests/browser-review.cjs`. The scenario uses stub responses and an isolated browser, checks phone/tablet behavior and saves screenshots under `/tmp`.

The automated checks use temporary repositories and stub providers; they do not spend an AI subscription or require real API credentials. HTTP tests need permission to bind loopback ports. The extension packages the companion and all required modules; source-checkout fallback is only available in extension development mode.

Patchwork does not stage, edit, commit, publish comments or approve pull requests. Review decisions are local personal state, not remote repository approvals.

Reading defaults enable wrapping and folded unchanged context; saved choices remain respected. Outside text fields, menus, tabs and the guide, ↑/↓ smoothly scroll the reader, ←/→ select adjacent files without wrapping, and Return marks the current file reviewed and advances. Holding Return does not review additional files. Reduced-motion preferences disable smooth scrolling. Reviewing the final outstanding file opens a completion page, retained across reloads; refreshing changed code returns to the pending review.
